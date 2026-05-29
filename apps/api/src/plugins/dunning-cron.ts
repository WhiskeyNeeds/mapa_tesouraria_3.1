import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { TreasuryDunningRulesService } from '../modules/treasury/dunning-rules/dunning-rules.service.js'
import { FollowupsService } from '../modules/treasury/followups/followups.service.js'
import { ToconlineService } from '../modules/toconline/toconline.service.js'

const DAILY_HOUR = Number(process.env.DUNNING_CRON_HOUR ?? 8)
const DAILY_MINUTE = Number(process.env.DUNNING_CRON_MINUTE ?? 0)

function msUntilNext(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

const dunningCronPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const toconline = new ToconlineService(fastify.prisma)
  const followups = new FollowupsService(fastify.prisma, toconline)
  const svc = new TreasuryDunningRulesService(fastify.prisma, followups, toconline)
  let timer: ReturnType<typeof setTimeout> | null = null

  const runDaily = async () => {
    try {
      const summary = await svc.executeAll()
      fastify.log.info(
        { ...summary },
        `[dunning-cron] daily run completed: ${summary.totalSent} sent, ${summary.totalSkipped} skipped`,
      )
    } catch (err) {
      fastify.log.error({ err }, '[dunning-cron] unhandled error')
    }
  }

  const scheduleNext = () => {
    const delay = msUntilNext(DAILY_HOUR, DAILY_MINUTE)
    fastify.log.info(
      `[dunning-cron] next run at ${new Date(Date.now() + delay).toISOString()}`,
    )
    timer = setTimeout(async () => {
      await runDaily()
      scheduleNext()
    }, delay)
  }

  fastify.addHook('onReady', async () => {
    scheduleNext()
  })

  fastify.addHook('onClose', async () => {
    if (timer) clearTimeout(timer)
  })
})

export default dunningCronPlugin
