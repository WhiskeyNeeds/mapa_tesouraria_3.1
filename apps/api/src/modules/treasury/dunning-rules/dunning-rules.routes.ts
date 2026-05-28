import type { FastifyInstance } from 'fastify'
import { TreasuryDunningRulesService } from './dunning-rules.service.js'
import { TreasuryDunningTracksService } from './dunning-tracks.service.js'
import { FollowupsService } from '../followups/followups.service.js'
import { ToconlineService } from '../../toconline/toconline.service.js'

export async function dunningRulesRoutes(fastify: FastifyInstance) {
  const toconline = new ToconlineService(fastify.prisma)
  const followups = new FollowupsService(fastify.prisma, toconline)
  const svc = new TreasuryDunningRulesService(fastify.prisma, followups, toconline)
  const tracksSvc = new TreasuryDunningTracksService(fastify.prisma)
  const prefix = '/treasury/:clientId/dunning-rules'
  const tracksPrefix = '/treasury/:clientId/dunning-tracks'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  // ── Réguas (tracks) ─────────────────────────────────────────────────
  fastify.get(tracksPrefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await tracksSvc.list(clientId))
  })

  fastify.get(`${tracksPrefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    return reply.send(await tracksSvc.getById(clientId, id))
  })

  fastify.post(tracksPrefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as Parameters<TreasuryDunningTracksService['create']>[1]
    return reply.status(201).send(await tracksSvc.create(clientId, body))
  })

  fastify.patch(`${tracksPrefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as Parameters<TreasuryDunningTracksService['update']>[2]
    return reply.send(await tracksSvc.update(clientId, id, body))
  })

  fastify.delete(`${tracksPrefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await tracksSvc.delete(clientId, id)
    return reply.status(204).send()
  })

  // ── Atribuições (cliente TOC → régua) ────────────────────────────────
  fastify.get(`${tracksPrefix}/assignments/:tocCustomerId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, tocCustomerId } = request.params as { clientId: string; tocCustomerId: string }
    return reply.send(await tracksSvc.getAssignmentForCustomer(clientId, tocCustomerId))
  })

  fastify.put(`${tracksPrefix}/assignments/:tocCustomerId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, tocCustomerId } = request.params as { clientId: string; tocCustomerId: string }
    const body = request.body as { trackId: string | null }
    return reply.send(await tracksSvc.setAssignment(clientId, tocCustomerId, body.trackId ?? null))
  })

  fastify.delete(`${tracksPrefix}/assignments/:tocCustomerId`, { onRequest: auth }, async (request, reply) => {
    const { clientId, tocCustomerId } = request.params as { clientId: string; tocCustomerId: string }
    await tracksSvc.setAssignment(clientId, tocCustomerId, null)
    return reply.status(204).send()
  })

  // ── Regras ──────────────────────────────────────────────────────────
  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const q = request.query as { trackId?: string }
    return reply.send(await svc.list(clientId, { trackId: q.trackId }))
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

  // Trigger manual do motor. Aceita `trackIds: string[]` opcional no body
  // para restringir a execução a um subset de réguas. Em produção corre
  // automaticamente via cron diário (sem filtro).
  fastify.post(`${prefix}/execute`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = (request.body ?? {}) as { trackIds?: string[] }
    return reply.send(await svc.execute(clientId, { trackIds: body.trackIds }))
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
