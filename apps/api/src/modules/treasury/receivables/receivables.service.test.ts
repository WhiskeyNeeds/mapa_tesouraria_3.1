import { describe, it, expect, vi } from 'vitest'
import { TreasuryReceivablesService } from './receivables.service.js'

function makeService() {
  return new TreasuryReceivablesService({} as never, {} as never, {} as never)
}

describe('bulkSetStatus', () => {
  it('despacha cada estado para o método por-documento correspondente', async () => {
    const svc = makeService()
    const pay = vi.spyOn(svc, 'pay').mockResolvedValue(undefined as never)
    const settle = vi.spyOn(svc, 'settle').mockResolvedValue(undefined as never)
    const unsettle = vi.spyOn(svc, 'unsettle').mockResolvedValue(undefined as never)
    const voidFn = vi.spyOn(svc, 'void').mockResolvedValue(undefined as never)

    await svc.bulkSetStatus('c1', 'u1', ['a', 'b'], 'PAID')
    expect(pay).toHaveBeenCalledTimes(2)
    expect(pay).toHaveBeenCalledWith('c1', 'u1', 'a')

    await svc.bulkSetStatus('c1', 'u1', ['c'], 'SETTLED')
    expect(settle).toHaveBeenCalledWith('c1', 'u1', 'c')

    await svc.bulkSetStatus('c1', 'u1', ['d'], 'OPEN')
    expect(unsettle).toHaveBeenCalledWith('c1', 'u1', 'd')

    await svc.bulkSetStatus('c1', 'u1', ['e'], 'VOID')
    expect(voidFn).toHaveBeenCalledWith('c1', 'u1', 'e')
  })

  it('é resiliente: um documento que falha não aborta os restantes', async () => {
    const svc = makeService()
    vi.spyOn(svc, 'pay')
      .mockRejectedValueOnce(new Error('Already paid'))
      .mockResolvedValueOnce(undefined as never)

    const res = await svc.bulkSetStatus('c1', 'u1', ['bad', 'good'], 'PAID')
    expect(res).toEqual({ updated: 1, failed: 1, errors: [{ id: 'bad', error: 'Already paid' }] })
  })
})

describe('void', () => {
  it('bloqueia anular uma fatura TOConline liquidada (status 3) mesmo com status local OPEN', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('r1')
    vi.spyOn(svc, 'getById').mockResolvedValue({
      id: 'r1', status: 'OPEN', tocSalesDocId: '123', _tocOverlay: { status: 3 },
    } as never)

    await expect(svc.void('c1', 'u1', 'toc-123')).rejects.toThrow(/liquidada no TOConline/)
  })

  it('bloqueia anular um documento já liquidado localmente', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('r2')
    vi.spyOn(svc, 'getById').mockResolvedValue({
      id: 'r2', status: 'SETTLED', tocSalesDocId: null, _tocOverlay: null,
    } as never)

    await expect(svc.void('c1', 'u1', 'r2')).rejects.toThrow(/settled/)
  })
})

describe('unsettle gating por settledVia', () => {
  function makeService() {
    return new TreasuryReceivablesService({} as never, {} as never, {} as never)
  }

  it('bloqueia reverter a mãe paga pelas parcelas (INSTALLMENTS)', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'PAID', settledVia: 'INSTALLMENTS', tocSalesDocId: null, _tocOverlay: null, children: [] } as never)
    await expect(svc.unsettle('c1', 'u1', 'p1')).rejects.toThrow(/parcela a parcela/)
  })

  it('bloqueia reverter um doc reconciliado pelo botão genérico (RECONCILIATION)', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('r1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'r1', status: 'PAID', settledVia: 'RECONCILIATION', tocSalesDocId: null, _tocOverlay: null, children: [] } as never)
    await expect(svc.unsettle('c1', 'u1', 'r1')).rejects.toThrow(/reconcilia/i)
  })
})

describe('create — origin pela ligação ao TOConline, não pela categoria', () => {
  function makeCreateService(category: Record<string, unknown>) {
    const tx = {
      treasuryReceivable: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'r1', ...args.data })),
      },
    }
    const prisma = {
      treasuryCategory: { findFirst: vi.fn().mockResolvedValue(category) },
      treasuryReceivable: { findFirst: vi.fn().mockResolvedValue(null) },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    }
    const budgetsSvc = { assertCompatible: vi.fn() }
    const budgetRulesSvc = { suggest: vi.fn().mockResolvedValue(null) }
    const svc = new TreasuryReceivablesService(prisma as never, budgetsSvc as never, budgetRulesSvc as never)
    return { svc, tx }
  }

  it('doc manual com categoria launchToc=true fica LOCAL e recebe numeração interna', async () => {
    const { svc, tx } = makeCreateService({ id: 'cat1', launchToc: true, type: 'REVENUE' })
    await svc.create('c1', 'u1', { categoryId: 'cat1', dueDate: '2026-06-18', totalAmount: 100 })
    const created = tx.treasuryReceivable.create.mock.calls[0][0].data
    expect(created.origin).toBe('LOCAL')
    expect(created.tocSalesDocId).toBeUndefined()
    expect(String(created.reference)).toMatch(/^INT \d{4}\/\d+$/)
  })

  it('doc associado a TOConline (com tocSalesDocId) fica TOCONLINE e mantém a referência', async () => {
    const { svc, tx } = makeCreateService({ id: 'cat1', launchToc: false, type: 'REVENUE' })
    await svc.create('c1', 'u1', { categoryId: 'cat1', dueDate: '2026-06-18', totalAmount: 100, tocSalesDocId: '999', reference: 'FT 2026/5' })
    const created = tx.treasuryReceivable.create.mock.calls[0][0].data
    expect(created.origin).toBe('TOCONLINE')
    expect(created.reference).toBe('FT 2026/5')
  })
})

describe('split (parcelas locais — Abordagem A)', () => {
  it('cria parcelas com referência sufixada, valor próprio e SEM tocSalesDocId', async () => {
    const created: Array<{ data: Record<string, unknown> }> = []
    const tx = {
      treasuryReceivable: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => { created.push(args); return { id: `child${created.length}`, ...args.data } }),
        update: vi.fn().mockResolvedValue({}),
      },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    const prisma = { $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) }
    const svc = new TreasuryReceivablesService(prisma as never, {} as never, {} as never)
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('m1')
    vi.spyOn(svc, 'getById').mockResolvedValue({
      id: 'm1', status: 'OPEN', parentId: null, reference: 'FT 2022/20', totalAmount: 100,
      tocSalesDocId: '555', tocCustomerId: '9', entityName: 'ACME', entityNif: null, origin: 'TOCONLINE',
      currency: 'EUR', documentDate: new Date('2022-01-01'), dueDate: new Date('2022-02-01'),
      categoryId: null, description: null, children: [],
    } as never)

    await svc.split('c1', 'u1', 'm1', [
      { promisedPaymentDate: '2022-03-01', amount: 60 },
      { promisedPaymentDate: '2022-04-01', amount: 40 },
    ])

    expect(created).toHaveLength(2)
    expect(created[0].data.reference).toBe('FT 2022/20-1')
    expect(created[1].data.reference).toBe('FT 2022/20-2')
    expect(created[0].data.totalAmount).toBe(60)
    expect(created[1].data.totalAmount).toBe(40)
    // Abordagem A: parcelas são documentos locais — não herdam a ligação ao TOConline.
    expect(created[0].data.tocSalesDocId).toBeUndefined()
    expect(created[1].data.tocSalesDocId).toBeUndefined()
  })
})
