import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'

export interface JwtPayload {
  sub: string
  name: string
  email: string
  roles: Array<{ name: string; level: number }>
  clientIds: string[]
  type: 'access' | 'refresh'
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload
    user: JwtPayload
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireClientAccess: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const authPlugin: FastifyPluginAsync = fp(async (fastify) => {
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'change-me',
  })

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
      if (request.user.type !== 'access') {
        return reply.status(401).send({ error: 'Invalid token type' })
      }
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  fastify.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticate(request, reply)
    const isAdmin = request.user.roles.some((r) => r.level === 0)
    if (!isAdmin) return reply.status(403).send({ error: 'Admin required' })
  })

  fastify.decorate('requireClientAccess', async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticate(request, reply)
    const params = request.params as Record<string, string>
    const clientId = params.clientId
    if (!clientId) return reply.status(400).send({ error: 'clientId required' })

    const isAdmin = request.user.roles.some((r) => r.level === 0)
    if (isAdmin) return

    // Re-validate against DB for freshness
    const link = await fastify.prisma.userClient.findUnique({
      where: { userId_clientId: { userId: request.user.sub, clientId } },
    })
    if (!link) return reply.status(403).send({ error: 'Access denied to this company' })
  })
})

export default authPlugin
