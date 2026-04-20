import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import type { FastifyPluginAsync } from 'fastify'

export interface RedisClient {
  get(key: string): Promise<string | null>
  setex(key: string, ttl: number, value: string): Promise<void>
  del(key: string): Promise<void>
}

declare module 'fastify' {
  interface FastifyInstance {
    redis: RedisClient
  }
}

// In-memory fallback when Redis is not available (dev mode only)
const memStore = new Map<string, { value: string; exp: number }>()
const memRedis: RedisClient = {
  get: async (key) => {
    const entry = memStore.get(key)
    if (!entry) return null
    if (Date.now() > entry.exp) { memStore.delete(key); return null }
    return entry.value
  },
  setex: async (key, ttl, value) => { memStore.set(key, { value, exp: Date.now() + ttl * 1000 }) },
  del: async (key) => { memStore.delete(key) },
}

const redisPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // don't retry on startup
    enableOfflineQueue: false,
  })

  try {
    await client.connect()
    fastify.log.info('Redis connected')

    const redis: RedisClient = {
      get: (key) => client.get(key),
      setex: async (key, ttl, value) => { await client.setex(key, ttl, value) },
      del: async (key) => { await client.del(key) },
    }

    fastify.decorate('redis', redis)
    fastify.addHook('onClose', async () => client.quit())
  } catch (err) {
    fastify.log.warn('Redis unavailable, using in-memory fallback (not suitable for production)')
    await client.quit().catch(() => {})
    fastify.decorate('redis', memRedis)
  }
})

export default redisPlugin
