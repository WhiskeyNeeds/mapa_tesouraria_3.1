import { describe, it, expect, vi } from 'vitest'
import { syncParentDocStatus } from './parent-status.js'

function fakeDb(children: Array<{ status: string; receivedAmount?: number; pendingAmount?: number; promisedPaymentDate?: Date | null; dueDate?: Date | null }>) {
  const update = vi.fn().mockResolvedValue({})
  const delegate = {
    findMany: vi.fn().mockResolvedValue(children),
    findUnique: vi.fn().mockResolvedValue({ settledAt: null }),
    update,
  }
  return { db: { treasuryReceivable: delegate, treasuryPayable: delegate }, update }
}

describe('syncParentDocStatus (receivable)', () => {
  it('todas as parcelas SETTLED -> mãe SETTLED via INSTALLMENTS', async () => {
    const { db, update } = fakeDb([{ status: 'SETTLED', receivedAmount: 50, pendingAmount: 0 }, { status: 'SETTLED', receivedAmount: 50, pendingAmount: 0 }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ status: 'SETTLED', settledVia: 'INSTALLMENTS', settledAt: expect.any(Date) }),
    }))
  })

  it('uma parcela PAID e outra OPEN -> mãe PARTIAL sem settledVia', async () => {
    const { db, update } = fakeDb([{ status: 'PAID', receivedAmount: 50, pendingAmount: 0 }, { status: 'OPEN', receivedAmount: 0, pendingAmount: 50, promisedPaymentDate: new Date('2026-07-01') }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PARTIAL', settledVia: null, settledAt: null }),
    }))
  })

  it('todas OPEN -> mãe OPEN sem settledVia', async () => {
    const { db, update } = fakeDb([{ status: 'OPEN', receivedAmount: 0, pendingAmount: 50 }, { status: 'OPEN', receivedAmount: 0, pendingAmount: 50 }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'OPEN', settledVia: null }),
    }))
  })

  it('todas PAID -> mãe PAID via INSTALLMENTS', async () => {
    const { db, update } = fakeDb([{ status: 'PAID', receivedAmount: 50, pendingAmount: 0 }, { status: 'PAID', receivedAmount: 50, pendingAmount: 0 }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAID', settledVia: 'INSTALLMENTS' }),
    }))
  })

  it('sem parcelas -> não faz update', async () => {
    const { db, update } = fakeDb([])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).not.toHaveBeenCalled()
  })
})
