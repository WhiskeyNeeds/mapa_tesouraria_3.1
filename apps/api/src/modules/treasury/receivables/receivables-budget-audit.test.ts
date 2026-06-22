// apps/api/src/modules/treasury/receivables/receivables-budget-audit.test.ts
import { describe, it, expect, vi } from 'vitest'
import * as budgetEvents from '../../../lib/budget-events.js'
import { TreasuryReceivablesService } from './receivables.service.js'

describe('receivables.update — eventos de budget', () => {
  it('remover budget (X -> null) emite transição com afterBudgetId null', async () => {
    const prisma = {
      treasuryReceivable: { update: vi.fn().mockResolvedValue({ id: 'd1' }) },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never
    const budgetsSvc = { assertCompatible: vi.fn().mockResolvedValue(undefined) } as never
    const svc = new TreasuryReceivablesService(prisma, budgetsSvc, {} as never)
    vi.spyOn(svc as never as { resolveLocalReceivableId: (...a: unknown[]) => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('d1' as never)
    vi.spyOn(svc as never as { getById: (...a: unknown[]) => Promise<unknown> }, 'getById').mockResolvedValue({
      id: 'd1', status: 'OPEN', tocSalesDocId: null, recurrenceId: null, parentId: null,
      budgetId: 'bA', budgetAutoAssigned: false, entityName: 'Cliente X', totalAmount: 50, categoryId: 'c',
    } as never)
    const spy = vi.spyOn(budgetEvents, 'auditBudgetTxnTransition').mockResolvedValue()
    await svc.update('c1', 'u1', 'd1', { budgetId: null })
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      docType: 'receivable', beforeBudgetId: 'bA', afterBudgetId: null,
    }))
    spy.mockRestore()
  })
})
