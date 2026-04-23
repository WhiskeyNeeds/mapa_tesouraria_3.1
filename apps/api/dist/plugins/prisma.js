import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
const prismaPlugin = fp(async (fastify) => {
    const prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
    await prisma.$connect();
    fastify.decorate('prisma', prisma);
    fastify.addHook('onClose', async () => prisma.$disconnect());
});
export default prismaPlugin;
//# sourceMappingURL=prisma.js.map