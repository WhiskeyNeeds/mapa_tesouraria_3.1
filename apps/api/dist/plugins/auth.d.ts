import type { FastifyPluginAsync } from 'fastify';
export interface JwtPayload {
    sub: string;
    name: string;
    email: string;
    roles: Array<{
        name: string;
        level: number;
    }>;
    clientIds: string[];
    type: 'access' | 'refresh';
}
declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JwtPayload;
        user: JwtPayload;
    }
}
declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        requireClientAccess: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}
declare const authPlugin: FastifyPluginAsync;
export default authPlugin;
//# sourceMappingURL=auth.d.ts.map