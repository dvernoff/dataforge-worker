import type { FastifyInstance } from 'fastify';
import { HealthService } from './health.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireSuperadmin } from '../../middleware/rbac.middleware.js';

export async function healthRoutes(app: FastifyInstance) {
  const healthService = new HealthService(app.db, app.redis);

  // GET /api/health — basic health check
  app.get('/', async () => {
    return {
      status: 'ok',
      service: 'dataforge-control-plane',
      timestamp: new Date().toISOString(),
    };
  });

  // GET /api/health/detailed — detailed metrics (superadmin only)
  app.get('/detailed', {
    preHandler: [authMiddleware, requireSuperadmin()],
  }, async () => {
    const detailed = await healthService.getDetailedHealth();

    // Also get total project count
    const [{ count: projectCount }] = await app.db('projects').count('id as count');

    return {
      ...detailed,
      totalProjects: Number(projectCount),
    };
  });
}
