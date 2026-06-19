import { describe, it, expect, vi } from 'vitest'
import { TreasuryBankMovementsService } from './bank-movements.service.js'

describe('delete — restauro de documentos TOConline ligados', () => {
  it('ao apagar um movimento, reverte a alocação sem gravar pendingAmount negativo num doc TOC', async () => {
    const receivableUpdate = vi.fn().mockResolvedValue({})
    // Movimento ligado a uma reconciliação confirmada de 30 sobre um doc TOC
    // (gross=100, 70 recebidos). Apagar o movimento deve repor pending=60.
    const tx = {
      treasuryReceivable: { update: receivableUpdate },
      treasuryPayable: { update: vi.fn().mockResolvedValue({}) },
      treasuryReconciliation: { delete: vi.fn().mockResolvedValue({}) },
      treasuryBankMovement: { update: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      treasuryBankMovement: {
        findFirst: vi.fn().mockResolvedValue({ id: 'm1', bankAccountId: 'b1', status: 'PARTIAL' }),
      },
      treasuryReconciliation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'recon1', status: 'CONFIRMED',
            receivables: [{
              receivableId: 'r1', amountAllocated: 30,
              receivable: { id: 'r1', tocSalesDocId: '5', status: 'PARTIAL', totalAmount: null, pendingAmount: null, receivedAmount: 70 },
            }],
            payables: [],
          },
        ]),
      },
      tocSalesDocument: { findUnique: vi.fn().mockResolvedValue({ status: 1, grossTotal: 100, pendingTotal: 100, raw: {} }) },
      tocPurchaseDocument: { findUnique: vi.fn().mockResolvedValue(null) },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
      // recalcBalance (pós-delete) faz early-return quando a conta não existe.
      treasuryBankAccount: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never

    const svc = new TreasuryBankMovementsService(prisma)
    await svc.delete('c1', 'm1', 'u1')

    expect(receivableUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({ status: 'PARTIAL', receivedAmount: 40, pendingAmount: 60 }),
    }))
  })
})
