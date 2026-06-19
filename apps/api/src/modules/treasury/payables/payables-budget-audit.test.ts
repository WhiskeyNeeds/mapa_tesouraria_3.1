import { describe, it, expect, vi } from 'vitest'
import * as budgetEvents from '../../../lib/budget-events.js'
import { TreasuryPayablesService } from './payables.service.js'

function svcWith(prismaOverrides: Record<string, unknown>) {
  const prisma = {
    treasuryPayable: { update: vi.fn().mockResolvedValue({ id: 'd1', budgetId: 'bB', budgetAutoAssigned: false }) },
    treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    ...prismaOverrides,
  } as never
  const budgetsSvc = { assertCompatible: vi.fn().mockResolvedValue(undefined) } as never
  return new TreasuryPayablesService(prisma, budgetsSvc, {} as never)
}

describe('payables.update — eventos de budget', () => {
  it('mover X -> Y chama auditBudgetTxnTransition com before/after corretos', async () => {
    const spy = vi.spyOn(budgetEvents, 'auditBudgetTxnTransition').mockResolvedValue()
    const svc = svcWith({})
    // getById e resolveLocalPayableId são internos; substituímos via prototype.
    vi.spyOn(svc as never as { resolveLocalPayableId: (...a: unknown[]) => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('d1' as never)
    vi.spyOn(svc as never as { getById: (...a: unknown[]) => Promise<unknown> }, 'getById').mockResolvedValue({
      id: 'd1', status: 'OPEN', tocPurchasesDocId: null, recurrenceId: null, parentId: null,
      budgetId: 'bA', budgetAutoAssigned: false, entityName: 'ACME', totalAmount: 123, categoryId: 'c',
    } as never)
    await svc.update('c1', 'u1', 'd1', { budgetId: 'bB' })
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      docType: 'payable', docId: 'd1', beforeBudgetId: 'bA', afterBudgetId: 'bB', afterAuto: false, userId: 'u1',
    }))
    spy.mockRestore()
  })
})
