import { describe, it, expect, vi } from 'vitest'
import { auditBudgetTxnTransition } from './budget-events.js'

function mkPrisma() {
  return {
    treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    treasuryBudget: { findMany: vi.fn().mockResolvedValue([
      { id: 'bA', name: 'Budget A' },
      { id: 'bB', name: 'Budget B' },
    ]) },
  } as never
}
const base = { clientId: 'c1', docType: 'payable' as const, docId: 'd1', entityName: 'ACME', amount: 123 }

describe('auditBudgetTxnTransition', () => {
  it('null -> X auto: regista budget.txn_auto_assign com userId null', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: null, beforeAuto: false, afterBudgetId: 'bA', afterAuto: true })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'budget.txn_auto_assign', entityType: 'Budget', entityId: 'bA', userId: null }),
    }))
  })

  it('null -> X manual: regista budget.txn_move_in com userId', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: null, beforeAuto: false, afterBudgetId: 'bA', afterAuto: false })
    const create = (p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_move_in', entityId: 'bA', userId: 'u1' }) }))
  })

  it('X -> Y: regista move_out em X e move_in em Y com nomes', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: false, afterBudgetId: 'bB', afterAuto: false })
    const create = (p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_move_out', entityId: 'bA', payload: expect.objectContaining({ toBudgetName: 'Budget B' }) }) }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_move_in', entityId: 'bB', payload: expect.objectContaining({ fromBudgetName: 'Budget A' }) }) }))
  })

  it('X -> null: regista budget.txn_unassign em X', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: false, afterBudgetId: null, afterAuto: false })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_unassign', entityId: 'bA' }) }))
  })

  it('mesmo budget, auto true->false: regista budget.txn_confirm', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: true, afterBudgetId: 'bA', afterAuto: false })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_confirm', entityId: 'bA' }) }))
  })

  it('sem mudança relevante: não regista nada', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: false, afterBudgetId: 'bA', afterAuto: false })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).not.toHaveBeenCalled()
  })
})
