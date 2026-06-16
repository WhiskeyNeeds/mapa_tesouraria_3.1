import { describe, it, expect, vi } from 'vitest'
import { detachDocFromConfirmedReconciliations } from './reconciliation-detach.js'

describe('detachDocFromConfirmedReconciliations', () => {
  it('numa reconciliação 1-para-1, liberta o movimento, remove a ligação e marca a reconciliação como revertida', async () => {
    const movementUpdate = vi.fn().mockResolvedValue({})
    const movLinkUpdate = vi.fn().mockResolvedValue({})
    const recvDelete = vi.fn().mockResolvedValue({})
    const reconUpdate = vi.fn().mockResolvedValue({})

    const recon = {
      id: 'rec1', totalAllocated: 100,
      movements: [{ id: 'rm1', movementId: 'm1', amount: 100 }],
      receivables: [{ id: 'link1', receivableId: 'r1', amountAllocated: 100 }],
      payables: [],
    }

    const tx = {
      treasuryReconciliationReceivable: {
        findMany: vi.fn().mockResolvedValue([{ id: 'link1', amountAllocated: 100, reconciliation: recon }]),
        delete: recvDelete,
      },
      treasuryReconciliationPayable: { findMany: vi.fn().mockResolvedValue([]) },
      treasuryBankMovement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', amount: 100, reconciledAmount: 100 }),
        update: movementUpdate,
      },
      treasuryReconciliationMovement: { update: movLinkUpdate },
      treasuryReconciliation: { update: reconUpdate },
    } as never

    const result = await detachDocFromConfirmedReconciliations(tx, 'c1', 'u1', 'receivable', 'r1')

    expect(result).toEqual({ reconciliations: 1, amount: 100 })
    // Movimento totalmente libertado.
    expect(movementUpdate).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { reconciledAmount: 0, status: 'CLASSIFIED' } })
    // Ligação do documento removida.
    expect(recvDelete).toHaveBeenCalledWith({ where: { id: 'link1' } })
    // Reconciliação fica sem documentos → marcada como revertida.
    expect(reconUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'rec1' },
      data: expect.objectContaining({ status: 'REVERSED' }),
    }))
  })

  it('não faz nada quando o documento não tem reconciliações confirmadas', async () => {
    const tx = {
      treasuryReconciliationReceivable: { findMany: vi.fn().mockResolvedValue([]) },
      treasuryReconciliationPayable: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    const result = await detachDocFromConfirmedReconciliations(tx, 'c1', 'u1', 'receivable', 'r1')
    expect(result).toEqual({ reconciliations: 0, amount: 0 })
  })
})
