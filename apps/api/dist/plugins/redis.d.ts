import type { FastifyPluginAsync } from 'fastify';
export interface RedisClient {
    get(key: string): Promise<string | null>;
    setex(key: string, ttl: number, value: string): Promise<void>;
    del(key: string): Promise<void>;
}
declare module 'fastify' {
    interface FastifyInstance {
        redis: RedisClient;
    }
}
declare const redisPlugin: FastifyPluginAsync;
export default redisPlugin;
//# sourceMappingURL=redis.d.ts.map