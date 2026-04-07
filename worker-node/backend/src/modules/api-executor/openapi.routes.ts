import type { FastifyInstance } from 'fastify';
import { OpenAPIService } from './openapi.service.js';

export async function openapiRoutes(app: FastifyInstance) {
  const openAPIService = new OpenAPIService(app.db);

  app.get('/api/v1/:projectSlug/docs', async (request, reply) => {
    const { projectSlug } = request.params as { projectSlug: string };

    const project = await resolveProject(app, projectSlug);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${projectSlug} API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: './docs/openapi.json', dom_id: '#swagger-ui', deepLinking: true });</script>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  app.get('/api/v1/:projectSlug/docs/openapi.json', async (request, reply) => {
    const { projectSlug } = request.params as { projectSlug: string };

    const project = await resolveProject(app, projectSlug);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
    const baseUrl = `${protocol}://${host}`;

    const spec = await openAPIService.generateSpec(
      projectSlug,
      project.id,
      project.db_schema,
      baseUrl,
    );

    return reply.type('application/json').send(spec);
  });
}

async function resolveProject(
  app: FastifyInstance,
  slug: string,
): Promise<{ id: string; db_schema: string } | null> {
  try {
    const project = await app.db('_dataforge_projects')
      .where({ slug })
      .select('id', 'db_schema')
      .first();
    return project ?? null;
  } catch {
    try {
      const project = await app.db('projects')
        .where({ slug })
        .select('id', 'db_schema')
        .first();
      return project ?? null;
    } catch {
      return null;
    }
  }
}
