import type { Knex } from 'knex';
import { AppError } from '../../middleware/error-handler.js';
import { FlowExecutor, type FlowNode, type FlowContext } from './flow.executor.js';

export class FlowsService {
  private executor: FlowExecutor;

  constructor(private db: Knex) {
    this.executor = new FlowExecutor(db);
  }

  async create(projectId: string, input: {
    name: string;
    description?: string;
    trigger_type: string;
    trigger_config?: Record<string, unknown>;
    nodes?: FlowNode[];
    edges?: Record<string, unknown>[];
    is_active?: boolean;
  }) {
    const [flow] = await this.db('flows')
      .insert({
        project_id: projectId,
        name: input.name,
        description: input.description ?? null,
        trigger_type: input.trigger_type,
        trigger_config: JSON.stringify(input.trigger_config ?? {}),
        nodes: JSON.stringify(input.nodes ?? []),
        edges: JSON.stringify(input.edges ?? []),
        is_active: input.is_active ?? true,
      })
      .returning('*');
    return flow;
  }

  async findAll(projectId: string) {
    return this.db('flows')
      .where({ project_id: projectId })
      .orderBy('created_at', 'desc');
  }

  async findById(flowId: string, projectId: string) {
    const flow = await this.db('flows')
      .where({ id: flowId, project_id: projectId })
      .first();
    if (!flow) throw new AppError(404, 'Flow not found');
    return flow;
  }

  async update(flowId: string, projectId: string, input: Record<string, unknown>) {
    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.trigger_type !== undefined) updateData.trigger_type = input.trigger_type;
    if (input.trigger_config !== undefined) updateData.trigger_config = JSON.stringify(input.trigger_config);
    if (input.nodes !== undefined) updateData.nodes = JSON.stringify(input.nodes);
    if (input.edges !== undefined) updateData.edges = JSON.stringify(input.edges);
    if (input.is_active !== undefined) updateData.is_active = input.is_active;

    const [flow] = await this.db('flows')
      .where({ id: flowId, project_id: projectId })
      .update(updateData)
      .returning('*');
    if (!flow) throw new AppError(404, 'Flow not found');
    return flow;
  }

  async delete(flowId: string, projectId: string) {
    const deleted = await this.db('flows')
      .where({ id: flowId, project_id: projectId })
      .delete();
    if (!deleted) throw new AppError(404, 'Flow not found');
  }

  async executeFlow(flowId: string, projectId: string, triggerData?: unknown) {
    const flow = await this.findById(flowId, projectId);
    const nodes: FlowNode[] = typeof flow.nodes === 'string' ? JSON.parse(flow.nodes) : flow.nodes;

    if (!nodes.length) {
      throw new AppError(400, 'Flow has no nodes');
    }

    // Resolve the project's schema — this is the only schema nodes are allowed to use
    const project = await this.db('projects').where({ id: projectId }).select('db_schema').first();
    if (!project?.db_schema) {
      throw new AppError(400, 'Project has no database schema assigned');
    }
    const projectSchema: string = project.db_schema;

    // Create a run record
    const [run] = await this.db('flow_runs')
      .insert({
        flow_id: flowId,
        status: 'running',
        trigger_data: triggerData ? JSON.stringify(triggerData) : null,
      })
      .returning('*');

    const context: FlowContext = {
      trigger: triggerData ?? {},
      results: {},
      variables: {},
    };

    // Build node map for quick lookup
    const nodeMap = new Map<string, FlowNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    const nodeResults: Record<string, unknown> = {};

    try {
      // Start from first node and follow the chain
      let currentNodeId: string | null = nodes[0]?.id ?? null;
      let iterations = 0;
      const maxIterations = 100; // Safety guard

      while (currentNodeId && iterations < maxIterations) {
        iterations++;
        const node = nodeMap.get(currentNodeId);
        if (!node) break;

        const { result, nextNodeId } = await this.executor.executeNode(node, context, projectSchema);
        nodeResults[node.id] = result;
        context.results[node.id] = result;

        currentNodeId = nextNodeId;
      }

      await this.db('flow_runs')
        .where({ id: run.id })
        .update({
          status: 'success',
          node_results: JSON.stringify(nodeResults),
          completed_at: new Date().toISOString(),
        });

      await this.db('flows')
        .where({ id: flowId })
        .update({
          run_count: this.db.raw('run_count + 1'),
          last_run_at: new Date().toISOString(),
        });

      return { status: 'success', nodeResults };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      await this.db('flow_runs')
        .where({ id: run.id })
        .update({
          status: 'failed',
          node_results: JSON.stringify(nodeResults),
          completed_at: new Date().toISOString(),
          error: errorMsg,
        });

      await this.db('flows')
        .where({ id: flowId })
        .update({
          run_count: this.db.raw('run_count + 1'),
          last_run_at: new Date().toISOString(),
        });

      return { status: 'failed', error: errorMsg, nodeResults };
    }
  }

  async getRuns(flowId: string, limit = 50) {
    return this.db('flow_runs')
      .where({ flow_id: flowId })
      .orderBy('started_at', 'desc')
      .limit(limit);
  }
}
