import type { Knex } from 'knex';
import { randomBytes } from 'crypto';

const FACEPUNCH_VALIDATE_URL = 'https://services.facepunch.com/sbox/auth/token';

interface SboxAuthConfig {
  service_name: string;
  session_table: string;
  steam_id_column: string;
  session_key_column: string;
  session_ttl_minutes?: number;
}

interface SboxTokenResponse {
  SteamId: string;
  Created: string;
  Expired: string;
  IsExpired: boolean;
}

export class SboxAuthPlugin {
  constructor(private db: Knex) {}

  async handleLogin(
    schema: string,
    config: SboxAuthConfig,
    body: { token: string; extra?: Record<string, unknown> }
  ): Promise<{ session_key: string; steam_id: string; is_new_player: boolean }> {
    if (!body.token) {
      throw Object.assign(new Error('Token is required'), { statusCode: 400 });
    }

    const tokenData = await this.validateToken(body.token);

    if (!tokenData.SteamId) {
      throw Object.assign(new Error('Invalid token: no Steam ID returned'), { statusCode: 401 });
    }

    if (tokenData.IsExpired) {
      throw Object.assign(new Error('Token has expired'), { statusCode: 401 });
    }

    const steamId = tokenData.SteamId;
    const sessionKey = this.generateSessionKey();
    const tableName = this.fullTable(schema, config.session_table);
    const now = new Date().toISOString();

    const existing = await this.db(tableName)
      .where(config.steam_id_column, steamId)
      .first();

    const allowedExtra: Record<string, unknown> = {};
    if (body.extra && typeof body.extra === 'object') {
      const systemFields = [config.steam_id_column, config.session_key_column, 'id', 'created_at', 'updated_at', 'last_active_at', 'last_login_at', 'is_admin', 'role', 'balance'];
      for (const [key, value] of Object.entries(body.extra)) {
        if (!systemFields.includes(key) && /^[a-z_][a-z0-9_]*$/.test(key)) {
          allowedExtra[key] = value;
        }
      }
    }

    if (existing) {
      await this.db(tableName)
        .where(config.steam_id_column, steamId)
        .update({
          [config.session_key_column]: sessionKey,
          last_login_at: now,
          last_active_at: now,
          ...allowedExtra,
        });

      return { session_key: sessionKey, steam_id: steamId, is_new_player: false };
    }

    await this.db(tableName)
      .insert({
        [config.steam_id_column]: steamId,
        [config.session_key_column]: sessionKey,
        last_login_at: now,
        last_active_at: now,
        created_at: now,
        ...allowedExtra,
      });

    return { session_key: sessionKey, steam_id: steamId, is_new_player: true };
  }

  async handleSessionCheck(
    schema: string,
    config: SboxAuthConfig,
    sessionKey: string
  ): Promise<Record<string, unknown> | null> {
    if (!sessionKey) {
      throw Object.assign(new Error('Session key is required'), { statusCode: 400 });
    }

    const tableName = this.fullTable(schema, config.session_table);

    const player = await this.db(tableName)
      .where(config.session_key_column, sessionKey)
      .first();

    if (!player) {
      return null;
    }

    const ttl = Number(config.session_ttl_minutes) || 0;
    if (ttl > 0 && player.last_active_at) {
      const lastActive = new Date(player.last_active_at).getTime();
      if (Date.now() > lastActive + ttl * 60 * 1000) {
        await this.db(tableName)
          .where(config.session_key_column, sessionKey)
          .update({ [config.session_key_column]: null });
        return null;
      }
    }

    await this.db(tableName)
      .where(config.session_key_column, sessionKey)
      .update({ last_active_at: new Date().toISOString() });

    const { [config.session_key_column]: _sessionKey, ...playerData } = player;
    return playerData;
  }

  async handleLogout(
    schema: string,
    config: SboxAuthConfig,
    sessionKey: string
  ): Promise<boolean> {
    if (!sessionKey) {
      throw Object.assign(new Error('Session key is required'), { statusCode: 400 });
    }

    const tableName = this.fullTable(schema, config.session_table);

    const updated = await this.db(tableName)
      .where(config.session_key_column, sessionKey)
      .update({ [config.session_key_column]: null });

    return updated > 0;
  }

  async getActiveSessions(
    schema: string,
    config: SboxAuthConfig
  ): Promise<Record<string, unknown>[]> {
    const tableName = this.fullTable(schema, config.session_table);

    return this.db(tableName)
      .whereNotNull(config.session_key_column)
      .select('*')
      .orderBy('last_active_at', 'desc');
  }

  async getPlayerProfile(
    schema: string,
    config: SboxAuthConfig,
    steamId: string
  ): Promise<Record<string, unknown> | null> {
    const tableName = this.fullTable(schema, config.session_table);

    const player = await this.db(tableName)
      .where(config.steam_id_column, steamId)
      .first();

    if (!player) return null;

    const { [config.session_key_column]: _sk, ...safe } = player;
    return safe;
  }

  async revokeSession(
    schema: string,
    config: SboxAuthConfig,
    steamId: string
  ): Promise<boolean> {
    const tableName = this.fullTable(schema, config.session_table);

    const updated = await this.db(tableName)
      .where(config.steam_id_column, steamId)
      .update({ [config.session_key_column]: null });

    return updated > 0;
  }

  async revokeAllSessions(
    schema: string,
    config: SboxAuthConfig
  ): Promise<number> {
    const tableName = this.fullTable(schema, config.session_table);

    const updated = await this.db(tableName)
      .whereNotNull(config.session_key_column)
      .update({ [config.session_key_column]: null });

    return updated;
  }

  async getStats(
    schema: string,
    config: SboxAuthConfig
  ): Promise<{ total: number; online: number; newToday: number }> {
    const tableName = this.fullTable(schema, config.session_table);

    const [totalResult] = await this.db(tableName).count('* as count');
    const total = Number(totalResult?.count ?? 0);

    const [onlineResult] = await this.db(tableName)
      .whereNotNull(config.session_key_column)
      .count('* as count');
    const online = Number(onlineResult?.count ?? 0);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [newResult] = await this.db(tableName)
      .where('created_at', '>=', todayStart.toISOString())
      .count('* as count');
    const newToday = Number(newResult?.count ?? 0);

    return { total, online, newToday };
  }

  async cleanExpiredSessions(
    schema: string,
    config: SboxAuthConfig
  ): Promise<number> {
    const ttl = Number(config.session_ttl_minutes) || 0;
    if (ttl <= 0) return 0;

    const tableName = this.fullTable(schema, config.session_table);
    const cutoff = new Date(Date.now() - ttl * 60 * 1000).toISOString();

    const updated = await this.db(tableName)
      .whereNotNull(config.session_key_column)
      .where('last_active_at', '<', cutoff)
      .update({ [config.session_key_column]: null });

    return updated;
  }

  private async validateToken(token: string): Promise<SboxTokenResponse> {
    try {
      const response = await fetch(FACEPUNCH_VALIDATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Facepunch API returned ${response.status}: ${text}`);
      }

      const data = (await response.json()) as SboxTokenResponse;
      return data;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Facepunch API')) {
        throw Object.assign(err, { statusCode: 502 });
      }
      throw Object.assign(
        new Error(`Failed to validate token: ${err instanceof Error ? err.message : String(err)}`),
        { statusCode: 502 }
      );
    }
  }

  private generateSessionKey(): string {
    return randomBytes(32).toString('hex');
  }

  private fullTable(schema: string, table: string): string {
    return schema ? `${schema}.${table}` : table;
  }
}
