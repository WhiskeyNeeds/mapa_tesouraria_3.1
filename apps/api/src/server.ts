import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'

import prismaPlugin from './plugins/prisma.js'
import redisPlugin from './plugins/redis.js'
import authPlugin from './plugins/auth.js'
import tokenRefreshPlugin from './plugins/token-refresh.js'
import dunningCronPlugin from './plugins/dunning-cron.js'

import { authRoutes } from './modules/auth/auth.routes.js'
import { clientsRoutes } from './modules/clients/clients.routes.js'
import { toconlineRoutes } from './modules/toconline/toconline.routes.js'

import { categoriesRoutes } from './modules/treasury/categories/categories.routes.js'
import { bankAccountsRoutes } from './modules/treasury/bank-accounts/bank-accounts.routes.js'
import { bankMovementsRoutes } from './modules/treasury/bank-movements/bank-movements.routes.js'
import { receivablesRoutes } from './modules/treasury/receivables/receivables.routes.js'
import { payablesRoutes } from './modules/treasury/payables/payables.routes.js'
import { reconciliationsRoutes } from './modules/treasury/reconciliations/reconciliations.routes.js'
import { settingsRoutes } from './modules/treasury/settings/settings.routes.js'
import { classificationRulesRoutes } from './modules/treasury/classification-rules/classification-rules.routes.js'
import { dashboardRoutes } from './modules/treasury/dashboard/dashboard.routes.js'
import { recurrencesRoutes } from './modules/treasury/recurrences/recurrences.routes.js'
import { followupsRoutes } from './modules/treasury/followups/followups.routes.js'
import { budgetsRoutes } from './modules/treasury/budgets/budgets.routes.js'
import { budgetRulesRoutes } from './modules/treasury/budget-rules/budget-rules.routes.js'
import { entityConfigsRoutes } from './modules/treasury/entity-configs/entity-configs.routes.js'
import { budgetCategoriesRoutes } from './modules/treasury/budget-categories/budget-categories.routes.js'
import { dunningRulesRoutes } from './modules/treasury/dunning-rules/dunning-rules.routes.js'
import { HttpError } from './lib/errors.js'
import { TocScheduler } from './lib/toc-sync/scheduler.js'
import { ToconlineService } from './modules/toconline/toconline.service.js'

declare module 'fastify' {
  interface FastifyInstance {
    tocScheduler: TocScheduler
  }
}

const fastify = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

// ── Plugins ────────────────────────────────────────────────────────────────

await fastify.register(cors, {
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
})

await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

await fastify.register(prismaPlugin)
await fastify.register(redisPlugin)
await fastify.register(authPlugin)
await fastify.register(tokenRefreshPlugin)
await fastify.register(dunningCronPlugin)

// ── Global error handler ───────────────────────────────────────────────────

fastify.setErrorHandler((error, _request, reply) => {
  if (error instanceof HttpError) {
    return reply.status(error.statusCode).send({ error: error.message })
  }
  const fastifyError = error as { validation?: unknown }
  if (fastifyError.validation) {
    return reply.status(400).send({ error: 'Validation error', details: fastifyError.validation })
  }
  fastify.log.error(error)
  return reply.status(500).send({ error: 'Internal server error' })
})

// ── Routes ─────────────────────────────────────────────────────────────────

const V1 = '/api/v1'

await fastify.register(authRoutes, { prefix: V1 })
await fastify.register(clientsRoutes, { prefix: V1 })
await fastify.register(toconlineRoutes, { prefix: V1 })
await fastify.register(categoriesRoutes, { prefix: V1 })
await fastify.register(bankAccountsRoutes, { prefix: V1 })
await fastify.register(bankMovementsRoutes, { prefix: V1 })
await fastify.register(receivablesRoutes, { prefix: V1 })
await fastify.register(payablesRoutes, { prefix: V1 })
await fastify.register(reconciliationsRoutes, { prefix: V1 })
await fastify.register(settingsRoutes, { prefix: V1 })
await fastify.register(classificationRulesRoutes, { prefix: V1 })
await fastify.register(dashboardRoutes, { prefix: V1 })
await fastify.register(recurrencesRoutes, { prefix: V1 })
await fastify.register(followupsRoutes, { prefix: V1 })
await fastify.register(budgetsRoutes, { prefix: V1 })
await fastify.register(budgetRulesRoutes, { prefix: V1 })
await fastify.register(entityConfigsRoutes, { prefix: V1 })
await fastify.register(budgetCategoriesRoutes, { prefix: V1 })
await fastify.register(dunningRulesRoutes, { prefix: V1 })

fastify.get('/health', () => ({ status: 'ok', ts: new Date().toISOString() }))

// ── TOConline Sync Scheduler ──────────────────────────────────────────────

fastify.addHook('onReady', async () => {
  const tocSvc = new ToconlineService(fastify.prisma)
  const scheduler = new TocScheduler(fastify.prisma, tocSvc)
  await scheduler.start()
  fastify.decorate('tocScheduler', scheduler)
})

// ── Start ──────────────────────────────────────────────────────────────────

try {
  const port = Number(process.env.PORT ?? 3001)
  await fastify.listen({ port, host: '0.0.0.0' })
  fastify.log.info(`API running at http://localhost:${port}`)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
