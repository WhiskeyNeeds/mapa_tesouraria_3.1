import { PrismaClient } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';
declare module 'fastify' {
    interface FastifyInstance {
        prisma: PrismaClient;
    }
}
declare const prismaPlugin: FastifyPluginAsync;
export default prismaPlugin;
//# sourceMappingURL=prisma.d.ts.map