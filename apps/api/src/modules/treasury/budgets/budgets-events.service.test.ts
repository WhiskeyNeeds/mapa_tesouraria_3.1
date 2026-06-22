// apps/api/src/modules/treasury/budgets/budgets-events.service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TreasuryBudgetsService } from './budgets.service.js'

describe('budgets.listEvents', () => {
  it('lê audit logs do budget e devolve DTOs + nextCursor', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`, action: 'budget.create', createdAt: new Date(`2026-06-1${i}T00:00:00Z`),
      payload: { name: 'X' }, user: i === 0 ? { id: 'u1', name: 'João' } : null,
    }))
    const findMany = vi.fn().mockResolvedValue(rows)
    const prisma = { treasuryAuditLog: { findMany } } as never
    const svc = new TreasuryBudgetsService(prisma)
    const res = await svc.listEvents('c1', 'b1', { limit: 2 })
    // pediu limit+1=3, recebeu 3 => há mais; devolve 2 e nextCursor = createdAt do 2.º
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: 'c1', entityType: 'Budget', entityId: 'b1' }),
      orderBy: { createdAt: 'desc' }, take: 3,
    }))
    expect(res.events).toHaveLength(2)
    expect(res.events[0].actor).toEqual({ id: 'u1', name: 'João' })
    expect(res.events[1].actor).toBeNull()
    expect(res.nextCursor).toBe(rows[1].createdAt.toISOString())
  })
})
