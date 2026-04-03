import type { Knex } from 'knex';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../utils/encryption.js';

export interface CreateNodeInput {
  name: string;
  slug: string;
  url?: string;
  region?: string;
  is_local?: boolean;
  max_projects?: number;
}

export interface UpdateNodeInput {
  name?: string;
  url?: string;
  region?: string;
  status?: string;
  max_projects?: number;
}

export interface HeartbeatPayload {
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  disk_total_gb?: number;
  disk_free_gb?: number;
  active_projects?: number;
}

export class NodesService {
  constructor(private db: Knex) {}

  // Auto-add columns for self-hosted nodes if they don't exist
  async ensurePersonalNodeColumns() {
    const hasOwner = await this.db.schema.hasColumn('nodes', 'owner_id');
    if (!hasOwner) {
      await this.db.schema.alterTable('nodes', (t) => {
        t.uuid('owner_id').nullable().references('id').inTable('users');
        t.boolean('is_system').defaultTo(false);
        t.string('current_version', 20).nullable();
        t.string('update_mode', 20).defaultTo('auto');
        t.string('setup_token', 255).nullable();
        t.timestamp('setup_token_expires').nullable();
      });
    }
    // Add disk metrics columns
    const hasDiskTotal = await this.db.schema.hasColumn('nodes', 'disk_total_gb');
    if (!hasDiskTotal) {
      await this.db.schema.alterTable('nodes', (t) => {
        t.float('disk_total_gb').defaultTo(0);
        t.float('disk_free_gb').defaultTo(0);
      });
    }
    // Add encrypted API key column for proxy forwarding
    const hasEncryptedKey = await this.db.schema.hasColumn('nodes', 'api_key_encrypted');
    if (!hasEncryptedKey) {
      await this.db.schema.alterTable('nodes', (t) => {
        t.text('api_key_encrypted').nullable();
      });
    }
  }

  async createPersonalNode(ownerId: string, input: { name: string; region?: string; update_mode?: string }) {
    await this.ensurePersonalNodeColumns();

    const setupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const slug = `personal-${input.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;

    const [node] = await this.db('nodes')
      .insert({
        name: input.name,
        slug,
        url: '', // Will be set when worker registers
        region: input.region ?? 'user',
        is_local: false,
        max_projects: 50,
        status: 'offline',
        owner_id: ownerId,
        is_system: false,
        update_mode: input.update_mode ?? 'auto',
        setup_token: setupToken,
        setup_token_expires: tokenExpires,
        api_key_hash: '', // Will be set on register
      })
      .returning('*');

    return { node, setupToken, tokenExpires };
  }

  async findPersonalNodes(ownerId: string) {
    await this.ensurePersonalNodeColumns();
    return this.db('nodes')
      .where({ owner_id: ownerId })
      .select('nodes.*')
      .select(
        this.db.raw(`(
          SELECT COUNT(*)::int FROM projects p
          WHERE p.node_id = nodes.id
        ) as projects_count`)
      )
      .orderBy('nodes.created_at', 'desc');
  }

  async deletePersonalNode(nodeId: string, ownerId: string) {
    await this.ensurePersonalNodeColumns();
    const node = await this.db('nodes').where({ id: nodeId, owner_id: ownerId }).first();
    if (!node) throw Object.assign(new Error('Node not found'), { statusCode: 404 });

    const projectsCount = await this.db('projects').where({ node_id: nodeId }).count('* as count').first();
    if (projectsCount && Number(projectsCount.count) > 0) {
      throw Object.assign(
        new Error(`Cannot delete node: ${projectsCount.count} project(s) are still assigned to it. Migrate or delete them first.`),
        { statusCode: 409 },
      );
    }

    await this.db('nodes').where({ id: nodeId }).del();
    return node;
  }

  async regenerateSetupToken(nodeId: string, ownerId: string) {
    await this.ensurePersonalNodeColumns();
    const node = await this.db('nodes').where({ id: nodeId, owner_id: ownerId }).first();
    if (!node) throw Object.assign(new Error('Node not found'), { statusCode: 404 });
    if (node.status === 'online') {
      throw Object.assign(new Error('Node is already connected'), { statusCode: 409 });
    }

    const setupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    await this.db('nodes').where({ id: nodeId }).update({
      setup_token: setupToken,
      setup_token_expires: tokenExpires,
      updated_at: new Date(),
    });

    return { setupToken, tokenExpires };
  }

  async registerWithSetupToken(setupToken: string, workerUrl: string) {
    await this.ensurePersonalNodeColumns();

    const node = await this.db('nodes')
      .where({ setup_token: setupToken })
      .where('setup_token_expires', '>', new Date())
      .first();

    if (!node) {
      throw Object.assign(new Error('Invalid or expired setup token'), { statusCode: 401 });
    }

    // Generate API key for the node
    const plainApiKey = crypto.randomBytes(64).toString('hex');
    const apiKeyHash = await bcrypt.hash(plainApiKey, env.BCRYPT_ROUNDS);
    const apiKeyEncrypted = encrypt(plainApiKey);

    await this.db('nodes')
      .where({ id: node.id })
      .update({
        url: workerUrl,
        api_key_hash: apiKeyHash,
        api_key_encrypted: apiKeyEncrypted,
        setup_token: null,
        setup_token_expires: null,
        status: 'online',
        last_heartbeat: new Date(),
        updated_at: new Date(),
      });

    return { nodeId: node.id, apiKey: plainApiKey };
  }

  async create(input: CreateNodeInput) {
    await this.ensurePersonalNodeColumns();
    const setupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const [node] = await this.db('nodes')
      .insert({
        name: input.name,
        slug: input.slug,
        url: input.url || '',
        region: input.region ?? 'default',
        is_local: input.is_local ?? false,
        max_projects: input.max_projects ?? 50,
        api_key_hash: '',
        status: 'offline',
        setup_token: setupToken,
        setup_token_expires: tokenExpires,
      })
      .returning('*');

    return { node, setupToken, tokenExpires };
  }

  async regenerateSystemToken(nodeId: string) {
    await this.ensurePersonalNodeColumns();
    const node = await this.db('nodes').where({ id: nodeId }).first();
    if (!node) throw Object.assign(new Error('Node not found'), { statusCode: 404 });

    const setupToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 60 * 60 * 1000);

    await this.db('nodes').where({ id: nodeId }).update({
      setup_token: setupToken,
      setup_token_expires: tokenExpires,
      updated_at: new Date(),
    });

    return { setupToken, tokenExpires };
  }

  async findAll() {
    await this.ensurePersonalNodeColumns();
    // Count projects per node. Projects with node_id=NULL belong to the local node.
    const nodes = await this.db('nodes')
      .select('nodes.*')
      .select(
        this.db.raw(`(
          SELECT COUNT(*)::int FROM projects p
          WHERE p.node_id = nodes.id
        ) as projects_count`)
      )
      .orderBy('nodes.created_at', 'asc');

    return nodes;
  }

  async findById(id: string) {
    const node = await this.db('nodes').where({ id }).first();
    if (!node) {
      throw Object.assign(new Error('Node not found'), { statusCode: 404 });
    }
    return node;
  }

  async update(id: string, input: UpdateNodeInput) {
    const [node] = await this.db('nodes')
      .where({ id })
      .update({ ...input, updated_at: new Date() })
      .returning('*');

    if (!node) {
      throw Object.assign(new Error('Node not found'), { statusCode: 404 });
    }
    return node;
  }

  async delete(id: string) {
    const node = await this.db('nodes').where({ id }).first();
    if (!node) {
      throw Object.assign(new Error('Node not found'), { statusCode: 404 });
    }

    const projectsCount = await this.db('projects').where({ node_id: id }).count('* as count').first();
    if (projectsCount && Number(projectsCount.count) > 0) {
      throw Object.assign(
        new Error(`Cannot delete node: ${projectsCount.count} project(s) are still assigned to it. Migrate or delete them first.`),
        { statusCode: 409 },
      );
    }

    await this.db('nodes').where({ id }).del();
    return node;
  }

  async processHeartbeat(nodeId: string, payload: HeartbeatPayload) {
    await this.ensurePersonalNodeColumns();
    const updateData: Record<string, unknown> = {
      cpu_usage: payload.cpu_usage,
      ram_usage: payload.ram_usage,
      disk_usage: payload.disk_usage,
      status: 'online',
      last_heartbeat: new Date(),
      updated_at: new Date(),
    };
    if (payload.disk_total_gb !== undefined) updateData.disk_total_gb = payload.disk_total_gb;
    if (payload.disk_free_gb !== undefined) updateData.disk_free_gb = payload.disk_free_gb;

    const [node] = await this.db('nodes')
      .where({ id: nodeId })
      .update(updateData)
      .returning('*');

    if (!node) {
      throw Object.assign(new Error('Node not found'), { statusCode: 404 });
    }
    return node;
  }

  async getDecryptedApiKey(nodeId: string): Promise<string | null> {
    const node = await this.db('nodes').where({ id: nodeId }).select('api_key_encrypted').first();
    if (!node?.api_key_encrypted) return null;
    try {
      return decrypt(node.api_key_encrypted);
    } catch {
      return null;
    }
  }

  /**
   * Find a node by its API key. Currently loads all nodes and bcrypt-compares each one.
   *
   * NOTE: This is a known scaling limitation. With many nodes, the linear scan of
   * bcrypt comparisons is slow. However, since bcrypt timing is intentionally variable,
   * this is not practically exploitable as a timing attack. If the number of nodes grows
   * significantly, consider storing a non-secret prefix/identifier alongside the hash
   * to allow indexed lookup before bcrypt verification.
   */
  async findByApiKey(plainApiKey: string) {
    await this.ensurePersonalNodeColumns();
    const nodes = await this.db('nodes').select('*');

    for (const node of nodes) {
      if (node.api_key_hash) {
        const match = await bcrypt.compare(plainApiKey, node.api_key_hash);
        if (match) return node;
      }
    }

    return null;
  }
}
