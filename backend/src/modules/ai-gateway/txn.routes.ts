import type { FastifyInstance } from 'fastify';
import { nodeAuthMiddleware } from '../../middleware/node-auth.middleware.js';
import { requireWorkerRole } from '../../middleware/worker-rbac.middleware.js';
import { AppError } from '../../middleware/error-handler.js';
import { TxnManager } from './txn-manager.js';

function resolveProjectId(request: any): string {
  const id = request.projectId ?? (request.params as any).projectId;
  if (!id) throw new AppError(400, 'Missing project id');
  return id;
}

export async function txnRoutes(app: FastifyInstance) {
  app.addHook('preHandler', nodeAuthMiddleware);
  app.addHook('preHandler', requireWorkerRole('viewer'));

  app.get('/:projectId/transactions', async (request) => {
    const projectId = resolveProjectId(request);
    return { transactions: TxnManager.get().list(projectId) };
  });

  app.post('/:projectId/transactions/:txnId/rollback', { preHandler: [requireWorkerRole('admin')] }, async (request) => {
    const projectId = resolveProjectId(request);
    const { txnId } = request.params as { txnId: string };
    // validate that txn belongs to this project before rollback
    try {
      TxnManager.get().getTrx(txnId, projectId);
    } catch (err) {
      throw err;
    }
    return TxnManager.get().rollback(txnId, 'admin-force');
  });
}
