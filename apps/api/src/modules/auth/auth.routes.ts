import type { FastifyInstance } from 'fastify'
import { AuthService } from './auth.service.js'

export async function authRoutes(fastify: FastifyInstance) {
  const svc = new AuthService(fastify.prisma, fastify)

  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string }
    const tokens = await svc.login({ email, password })
    return reply.send(tokens)
  })

  fastify.post('/auth/register', async (request, reply) => {
    const body = request.body as { name: string; email: string; password: string; phone?: string }
    const tokens = await svc.register(body)
    return reply.status(201).send(tokens)
  })

  fastify.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string }
    const tokens = await svc.refresh(refreshToken)
    return reply.send(tokens)
  })

  fastify.post('/auth/logout', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    await svc.logout(request.user.sub)
    return reply.status(204).send()
  })

  fastify.post('/auth/set-password', async (request, reply) => {
    const { token, password } = request.body as { token: string; password: string }
    const tokens = await svc.setPassword(token, password)
    return reply.send(tokens)
  })

  fastify.post('/auth/forgot-password', async (request, reply) => {
    const { email } = request.body as { email: string }
    await svc.forgotPassword(email)
    return reply.status(200).send({ message: 'If the email exists, instructions were sent.' })
  })

  fastify.post('/auth/change-password', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string }
    await svc.changePassword(request.user.sub, currentPassword, newPassword)
    return reply.status(204).send()
  })

  fastify.get('/auth/me', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const user = await fastify.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    })
    return reply.send(user)
  })
}
