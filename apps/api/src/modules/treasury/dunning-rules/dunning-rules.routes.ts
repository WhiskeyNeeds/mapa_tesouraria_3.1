import type { FastifyInstance } from 'fastify'
import { TreasuryDunningRulesService } from './dunning-rules.service.js'
import { FollowupsService } from '../followups/followups.service.js'
import { ToconlineService } from '../../toconline/toconline.service.js'

export async function dunningRulesRoutes(fastify: FastifyInstance) {
  const toconline = new ToconlineService(fastify.prisma)
  const followups = new FollowupsService(fastify.prisma, toconline)
  const svc = new TreasuryDunningRulesService(fastify.prisma, followups, toconline)
  const prefix = '/treasury/:clientId/dunning-rules'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.list(clientId))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryDunningRulesService['create']>[1]
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryDunningRulesService['update']>[2]
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })

  // Trigger manual do motor — escondido (sem UI). Útil para debugging e testes.
  // Em produção continua a correr automaticamente via cron diário.
  fastify.post(`${prefix}/execute`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.execute(clientId))
  })

  // Reset de idempotência: apaga TreasuryDunningExecution para permitir re-fire.
  // Para testes — pode ser filtrado por ruleId e/ou receivableId.
  fastify.delete(`${prefix}/executions`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { ruleId?: string; receivableId?: string }
    const { count } = await fastify.prisma.treasuryDunningExecution.deleteMany({
      where: {
        clientId,
        ...(q.ruleId ? { ruleId: q.ruleId } : {}),
        ...(q.receivableId ? { receivableId: q.receivableId } : {}),
      },
    })
    return reply.send({ deleted: count })
  })
}
