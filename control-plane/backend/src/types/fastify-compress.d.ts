declare module '@fastify/compress' {
  import { FastifyPluginCallback } from 'fastify';
  const compress: FastifyPluginCallback<{ global?: boolean }>;
  export default compress;
}
