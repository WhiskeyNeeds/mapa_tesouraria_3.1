import { describe, it, expect, vi } from 'vitest'
import { TreasuryReconciliationsService } from './reconciliations.service.js'

/** Fabrica um prisma falso suficiente para `preview()`, com um movimento e um
 *  documento (receivable ou payable) ligado ao TOConline cujos campos locais de
 *  valor estão a `null` (o pending real vive no espelho `toc*Document`). */
function makePrisma(opts: {
  movementAmount: number
  doc: Record<string, unknown>
  tocDoc: Record<string, unknown> | null
  kind: 'receivable' | 'payable'
}) {
  const tocFindUnique = vi.fn().mockResolvedValue(opts.tocDoc)
  return {
    treasuryBankMovement: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'm1', amount: opts.movementAmount, reconciledAmount: 0 },
      ]),
    },
    treasuryReceivable: {
      findFirst: vi.fn().mockResolvedValue(opts.kind === 'receivable' ? opts.doc : null),
    },
    treasuryPayable: {
      findFirst: vi.fn().mockResolvedValue(opts.kind === 'payable' ? opts.doc : null),
    },
    tocSalesDocument: { findUnique: tocFindUnique },
    tocPurchaseDocument: { findUnique: tocFindUnique },
  } as never
}

describe('preview — documentos ligados ao TOConline', () => {
  it('valida a alocação contra o pending real do espelho TOC, não o pendingAmount local (null)', async () => {
    const prisma = makePrisma({
      kind: 'receivable',
      movementAmount: 81.98,
      doc: {
        id: 'r1', clientId: 'c1', tocSalesDocId: '5', status: 'OPEN',
        totalAmount: null, pendingAmount: null, receivedAmount: null, reference: null,
      },
      tocDoc: { tocId: 5, grossTotal: 28.6, pendingTotal: 28.6, status: 1, raw: { document_no: 'FT 2022/4' } },
    })
    const svc = new TreasuryReconciliationsService(prisma)

    const result = await svc.preview('c1', {
      movementIds: ['m1'],
      allocations: [{ type: 'receivable', id: 'r1', amount: 28.6 }],
      isDryRun: true,
    })

    expect(result.totalAllocated).toBe(28.6)
  })

  it('rejeita uma alocação acima do pending real do espelho TOC', async () => {
    const prisma = makePrisma({
      kind: 'receivable',
      movementAmount: 81.98,
      doc: {
        id: 'r1', clientId: 'c1', tocSalesDocId: '5', status: 'OPEN',
        totalAmount: null, pendingAmount: null, receivedAmount: null, reference: null,
      },
      tocDoc: { tocId: 5, grossTotal: 28.6, pendingTotal: 28.6, status: 1, raw: { document_no: 'FT 2022/4' } },
    })
    const svc = new TreasuryReconciliationsService(prisma)

    await expect(svc.preview('c1', {
      movementIds: ['m1'],
      allocations: [{ type: 'receivable', id: 'r1', amount: 50 }],
      isDryRun: true,
    })).rejects.toThrow(/exceeds pending 28\.6 for FT 2022\/4/)
  })

  it('aplica o mesmo overlay a payables ligados ao TOConline', async () => {
    const prisma = makePrisma({
      kind: 'payable',
      movementAmount: -81.98,
      doc: {
        id: 'p1', clientId: 'c1', tocPurchasesDocId: '7', status: 'OPEN',
        totalAmount: null, pendingAmount: null, paidAmount: null, reference: null,
      },
      tocDoc: { tocId: 7, grossTotal: 40, pendingTotal: 40, status: 1, raw: { document_no: 'FC 2022/9' } },
    })
    const svc = new TreasuryReconciliationsService(prisma)

    const result = await svc.preview('c1', {
      movementIds: ['m1'],
      allocations: [{ type: 'payable', id: 'p1', amount: 40 }],
      isDryRun: true,
    })

    expect(result.totalAllocated).toBe(40)
  })
})

describe('confirm — atualização local de documentos TOConline', () => {
  it('marca PARTIAL (não SETTLED) numa alocação parcial contra um doc TOC com total/received locais null', async () => {
    const receivableUpdate = vi.fn().mockResolvedValue({})
    const tocDoc = { tocId: 5, grossTotal: 100, pendingTotal: 100, status: 1, raw: { document_no: 'FT 2022/4' } }
    const localDoc = {
      id: 'r1', clientId: 'c1', tocSalesDocId: '5', status: 'OPEN',
      totalAmount: null, pendingAmount: null, receivedAmount: null, reference: null,
    }

    const tx = {
      treasuryReconciliation: {
        create: vi.fn().mockResolvedValue({ id: 'recon1' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'recon1' }),
      },
      treasuryBankMovement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', amount: 81.98, reconciledAmount: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      treasuryReconciliationMovement: { create: vi.fn().mockResolvedValue({}) },
      treasuryReconciliationReceivable: { create: vi.fn().mockResolvedValue({}) },
      treasuryReceivable: { findUnique: vi.fn().mockResolvedValue(localDoc), update: receivableUpdate },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }

    const prisma = {
      treasuryBankMovement: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', amount: 81.98, reconciledAmount: 0 }]) },
      treasuryReceivable: { findFirst: vi.fn().mockResolvedValue(localDoc) },
      treasuryPayable: { findFirst: vi.fn().mockResolvedValue(null) },
      tocSalesDocument: { findUnique: vi.fn().mockResolvedValue(tocDoc) },
      tocPurchaseDocument: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never
    const svc = new TreasuryReconciliationsService(prisma)

    await svc.confirm('c1', 'u1', {
      movementIds: ['m1'],
      allocations: [{ type: 'receivable', id: 'r1', amount: 30 }],
      isDryRun: true,
    })

    expect(receivableUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({ status: 'PARTIAL', receivedAmount: 30, pendingAmount: 70 }),
    }))
  })

  it('marca PAID (não SETTLED) quando a alocação cobre totalmente um receivable', async () => {
    const receivableUpdate = vi.fn().mockResolvedValue({})
    const tocDoc = { tocId: 5, grossTotal: 100, pendingTotal: 100, status: 1, raw: { document_no: 'FT 2022/4' } }
    const localDoc = {
      id: 'r1', clientId: 'c1', tocSalesDocId: '5', status: 'OPEN',
      totalAmount: null, pendingAmount: null, receivedAmount: null, reference: null,
    }

    const tx = {
      treasuryReconciliation: {
        create: vi.fn().mockResolvedValue({ id: 'recon1' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'recon1' }),
      },
      treasuryBankMovement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', amount: 100, reconciledAmount: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      treasuryReconciliationMovement: { create: vi.fn().mockResolvedValue({}) },
      treasuryReconciliationReceivable: { create: vi.fn().mockResolvedValue({}) },
      treasuryReceivable: { findUnique: vi.fn().mockResolvedValue(localDoc), update: receivableUpdate },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }

    const prisma = {
      treasuryBankMovement: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', amount: 100, reconciledAmount: 0 }]) },
      treasuryReceivable: { findFirst: vi.fn().mockResolvedValue(localDoc) },
      treasuryPayable: { findFirst: vi.fn().mockResolvedValue(null) },
      tocSalesDocument: { findUnique: vi.fn().mockResolvedValue(tocDoc) },
      tocPurchaseDocument: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never
    const svc = new TreasuryReconciliationsService(prisma)

    await svc.confirm('c1', 'u1', {
      movementIds: ['m1'],
      allocations: [{ type: 'receivable', id: 'r1', amount: 100 }],
      isDryRun: true,
    })

    expect(receivableUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({ status: 'PAID', receivedAmount: 100, pendingAmount: 0, settledAt: expect.any(Date) }),
    }))
    // Regista a reconciliação na timeline da fatura (entityType Receivable).
    expect(tx.treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'receivable.reconcile',
        entityType: 'Receivable',
        entityId: 'r1',
        payload: expect.objectContaining({ amount: 100, fullySettled: true }),
      }),
    }))
  })

  it('marca PAID (não SETTLED) quando a alocação cobre totalmente um payable', async () => {
    const payableUpdate = vi.fn().mockResolvedValue({})
    const tocDoc = { tocId: 7, grossTotal: 40, pendingTotal: 40, status: 1, raw: { document_no: 'FC 2022/9' } }
    const localDoc = {
      id: 'p1', clientId: 'c1', tocPurchasesDocId: '7', status: 'OPEN',
      totalAmount: null, pendingAmount: null, paidAmount: null, reference: null,
    }

    const tx = {
      treasuryReconciliation: {
        create: vi.fn().mockResolvedValue({ id: 'recon1' }),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'recon1' }),
      },
      treasuryBankMovement: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm1', amount: -40, reconciledAmount: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      treasuryReconciliationMovement: { create: vi.fn().mockResolvedValue({}) },
      treasuryReconciliationPayable: { create: vi.fn().mockResolvedValue({}) },
      treasuryPayable: { findUnique: vi.fn().mockResolvedValue(localDoc), update: payableUpdate },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }

    const prisma = {
      treasuryBankMovement: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', amount: -40, reconciledAmount: 0 }]) },
      treasuryReceivable: { findFirst: vi.fn().mockResolvedValue(null) },
      treasuryPayable: { findFirst: vi.fn().mockResolvedValue(localDoc) },
      tocSalesDocument: { findUnique: vi.fn().mockResolvedValue(null) },
      tocPurchaseDocument: { findUnique: vi.fn().mockResolvedValue(tocDoc) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never
    const svc = new TreasuryReconciliationsService(prisma)

    await svc.confirm('c1', 'u1', {
      movementIds: ['m1'],
      allocations: [{ type: 'payable', id: 'p1', amount: 40 }],
      isDryRun: true,
    })

    expect(payableUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ status: 'PAID', paidAmount: 40, pendingAmount: 0 }),
    }))
  })
})

describe('reverse — restauro de documentos TOConline', () => {
  it('reverte parcialmente um doc TOC sem gravar pendingAmount negativo (usa o total real do espelho)', async () => {
    const receivableUpdate = vi.fn().mockResolvedValue({})
    // Doc TOC gross=100 com 70 já recebidos (2 reconciliações); revertemos a de 30.
    const tx = {
      treasuryReceivable: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'r1', tocSalesDocId: '5', status: 'PARTIAL',
          totalAmount: null, pendingAmount: null, receivedAmount: 70,
        }),
        update: receivableUpdate,
      },
      treasuryReconciliation: { update: vi.fn().mockResolvedValue({}) },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = {
      tocSalesDocument: { findUnique: vi.fn().mockResolvedValue({ status: 1, grossTotal: 100, pendingTotal: 100, raw: {} }) },
      tocPurchaseDocument: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never
    const svc = new TreasuryReconciliationsService(prisma)
    vi.spyOn(svc, 'getById').mockResolvedValue({
      status: 'CONFIRMED',
      movements: [],
      receivables: [{ receivableId: 'r1', amountAllocated: 30 }],
      payables: [],
    } as never)

    await svc.reverse('c1', 'recon1', 'u1')

    expect(receivableUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'r1' },
      data: expect.objectContaining({ status: 'PARTIAL', receivedAmount: 40, pendingAmount: 60 }),
    }))
  })
})
