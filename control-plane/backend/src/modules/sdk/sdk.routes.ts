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

    const worker = await proxyService.getWorkerForProject(projectId);

    const result = await proxyService.forwardToWorker(
      worker.url,
      worker.apiKey,
      'GET',
      `/api/projects/${projectId}/endpoints`,
      {
        'content-type': 'application/json',
        'x-user-id': request.user.id,
        'x-user-role': ((request as unknown as Record<string, unknown>).projectRole as string) ?? 'viewer',
        'x-project-slug': worker.slug,
      },
      null,
      projectId,
      worker.schema
    );

    const body = result.body as { endpoints?: Array<{ is_active: boolean; [key: string]: unknown }> } | null;
    const endpoints = (body?.endpoints ?? []).filter((ep) => ep.is_active);

    let code: string;
    switch (language) {
      case 'typescript':
        code = generateTypeScript(worker.slug, worker.url, endpoints);
        break;
      case 'python':
        code = generatePython(worker.slug, worker.url, endpoints);
        break;
      case 'curl':
        code = generateCurl(worker.slug, worker.url, endpoints);
        break;
      default:
        code = '';
    }

    return { code, language, project_slug: worker.slug };
  });
}
