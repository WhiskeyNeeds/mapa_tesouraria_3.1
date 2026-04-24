import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { ToconlineService } from '../modules/toconline/toconline.service.js'

const INTERVAL_MS = 5 * 60 * 1000

const tokenRefreshPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const svc = new ToconlineService(fastify.prisma)

  const run = async () => {
    try {
      await svc.refreshAllExpiring()
    } catch (err) {
      fastify.log.error({ err }, '[token-refresh] unhandled error')
    }
  }

  fastify.addHook('onReady', async () => {
    await run()
    const timer = setInterval(run, INTERVAL_MS)
    fastify.addHook('onClose', async () => clearInterval(timer))
  })
})

export default tokenRefreshPlugin
