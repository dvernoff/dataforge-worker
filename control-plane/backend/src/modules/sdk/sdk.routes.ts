import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requireRole } from '../../middleware/rbac.middleware.js';
import { generateTypeScript, generatePython, generateCurl } from './sdk.generator.js';
import { ProxyService } from '../proxy/proxy.service.js';

export async function sdkRoutes(app: FastifyInstance) {
  const proxyService = new ProxyService(app.db, app.redis);

  app.addHook('preHandler', authMiddleware);

  app.get('/:projectId/sdk/:language', {
    preHandler: [requireRole('viewer')],
  }, async (request, reply) => {
    const { projectId, language } = request.params as { projectId: string; language: string };

    if (!['typescript', 'python', 'curl'].includes(language)) {
      return reply.status(400).send({ error: 'Unsupported language. Use: typescript, python, curl' });
    }

    const project = await app.db('projects').where({ id: projectId }).first();
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const worker = await proxyService.getWorkerForProject(projectId);

    // Fetch endpoints from worker
    const result = await proxyService.forwardToWorker(
      worker.url,
      worker.apiKey,
      'GET',
      `/api/projects/${projectId}/endpoints`,
      { 'content-type': 'application/json' },
      null,
      projectId,
      worker.schema
    );

    const body = result.body as { endpoints?: Array<{ is_active: boolean; [key: string]: unknown }> } | null;
    const endpoints = (body?.endpoints ?? []).filter((ep) => ep.is_active);

    let code: string;
    switch (language) {
      case 'typescript':
        code = generateTypeScript(project.slug, worker.url, endpoints);
        break;
      case 'python':
        code = generatePython(project.slug, worker.url, endpoints);
        break;
      case 'curl':
        code = generateCurl(project.slug, worker.url, endpoints);
        break;
      default:
        code = '';
    }

    return { code, language, project_slug: project.slug };
  });
}
