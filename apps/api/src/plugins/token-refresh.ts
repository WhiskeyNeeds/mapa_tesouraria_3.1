import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { ToconlineService } from '../modules/toconline/toconline.service.js'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000

const tokenRefreshPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const svc = new ToconlineService(fastify.prisma)

  const getIntervalMs = async (): Promise<number> => {
    try {
      const settings = await fastify.prisma.treasurySettings.findMany({
        select: { syncIntervalMinutes: true },
      })
      if (settings.length === 0) return DEFAULT_INTERVAL_MS
      const minMinutes = Math.min(...settings.map((s) => s.syncIntervalMinutes))
      return Math.max(1, minMinutes) * 60 * 1000
    } catch {
      return DEFAULT_INTERVAL_MS
    }
  }

  const refreshTokens = async () => {
    try {
      await svc.refreshAllExpiring()
    } catch (err) {
      fastify.log.error({ err }, '[token-refresh] unhandled error')
    }
  }

  const purgeOldImports = async () => {
    try {
      const settings = await fastify.prisma.treasurySettings.findMany({
        select: { clientId: true, importFileRetentionDays: true },
      })

      for (const s of settings) {
        const cutoff = new Date(Date.now() - s.importFileRetentionDays * 24 * 60 * 60 * 1000)
        const { count } = await fastify.prisma.treasuryBankImport.deleteMany({
          where: {
            clientId: s.clientId,
            createdAt: { lt: cutoff },
            status: { in: ['DONE', 'FAILED', 'QUARANTINED'] },
          },
        })
        if (count > 0) {
          fastify.log.info(`[import-purge] deleted ${count} old import(s) for client ${s.clientId}`)
        }
      }
    } catch (err) {
      fastify.log.error({ err }, '[import-purge] unhandled error')
    }
  }

  fastify.addHook('onReady', async () => {
    await refreshTokens()
    await purgeOldImports()

    let timer: ReturnType<typeof setTimeout>

    // Re-reads syncIntervalMinutes on each tick so setting changes take effect within one cycle
    const scheduleNext = async () => {
      const intervalMs = await getIntervalMs()
      timer = setTimeout(async () => {
        await refreshTokens()
        await purgeOldImports()
        await scheduleNext()
      }, intervalMs)
    }

    await scheduleNext()
    fastify.addHook('onClose', async () => clearTimeout(timer))
  })
})

export default tokenRefreshPlugin
