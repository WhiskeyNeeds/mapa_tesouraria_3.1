import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'
import {
  syncClientGroup, syncClientFull,
  TRANSACTIONAL_ENTITIES, MASTER_ENTITIES,
  type SyncResult,
} from './sync-client.js'

const TRANSACTIONAL_INTERVAL = 5 * 60 * 1000
const MASTER_INTERVAL = 30 * 60 * 1000

interface ClientTimers {
  transactional: ReturnType<typeof setTimeout> | null
  master: ReturnType<typeof setTimeout> | null
}

export class TocScheduler {
  private timers = new Map<string, ClientTimers>()

  constructor(
    private prisma: PrismaClient,
    private svc: ToconlineService,
  ) {}

  async start() {
    const configs = await this.prisma.toconlineConfig.findMany({
      where: { status: 'ACTIVE' },
      select: { clientId: true },
    })
    for (const { clientId } of configs) {
      await this.registerClient(clientId)
    }
    console.info(`[TocScheduler] started for ${configs.length} client(s)`)
  }

  async registerClient(clientId: string) {
    if (this.timers.has(clientId)) return
    const timers: ClientTimers = { transactional: null, master: null }
    this.timers.set(clientId, timers)
    await this._scheduleLoop(clientId, 'transactional', TRANSACTIONAL_ENTITIES, TRANSACTIONAL_INTERVAL, timers)
    await this._scheduleLoop(clientId, 'master', MASTER_ENTITIES, MASTER_INTERVAL, timers)
    console.info(`[TocScheduler] registered client ${clientId}`)
  }

  unregisterClient(clientId: string) {
    const timers = this.timers.get(clientId)
    if (!timers) return
    if (timers.transactional) clearTimeout(timers.transactional)
    if (timers.master) clearTimeout(timers.master)
    this.timers.delete(clientId)
    console.info(`[TocScheduler] unregistered client ${clientId}`)
  }

  async triggerSync(clientId: string): Promise<SyncResult> {
    return syncClientFull(this.prisma, this.svc, clientId)
  }

  private async _scheduleLoop(
    clientId: string,
    group: 'master' | 'transactional',
    entities: string[],
    interval: number,
    timers: ClientTimers,
  ) {
    const states = await this.prisma.tocSyncState.findMany({
      where: { clientId, entityType: { in: entities } },
    })
    const oldestMs = states.length === entities.length
      ? Math.min(...states.map(s => s.lastSyncAt?.getTime() ?? 0))
      : 0
    const elapsed = Date.now() - oldestMs
    const delay = elapsed >= interval ? 0 : interval - elapsed

    const run = async () => {
      try {
        await syncClientGroup(this.prisma, this.svc, clientId, group)
      } catch (err) {
        console.error(`[TocScheduler] ${clientId}/${group} unhandled:`, err)
      }
      const t = setTimeout(run, interval)
      if (group === 'transactional') timers.transactional = t
      else timers.master = t
    }

    const t = setTimeout(run, delay)
    if (group === 'transactional') timers.transactional = t
    else timers.master = t
  }
}
