import { describe, it, expect, vi } from 'vitest'
import { TreasuryPayablesService } from './payables.service.js'

// O construtor apenas guarda dependências (e instancia RecurrencesService que
// também só guarda o prisma), por isso passamos stubs vazios e espiamos os
// métodos por-documento — bulkSetStatus é puro despacho + acumulação resiliente.
function makeService() {
  return new TreasuryPayablesService({} as never, {} as never, {} as never)
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
    expect(pay).toHaveBeenCalledWith('c1', 'u1', 'b')

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
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({
      id: 'p1', status: 'OPEN', tocPurchasesDocId: '123', _tocOverlay: { status: 3 },
    } as never)

    await expect(svc.void('c1', 'u1', 'toc-123')).rejects.toThrow(/liquidada no TOConline/)
  })

  it('bloqueia anular um documento já liquidado localmente', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p2')
    vi.spyOn(svc, 'getById').mockResolvedValue({
      id: 'p2', status: 'SETTLED', tocPurchasesDocId: null, _tocOverlay: null,
    } as never)

    await expect(svc.void('c1', 'u1', 'p2')).rejects.toThrow(/settled/)
  })
})

describe('setReadyToPay', () => {
  // prisma mínimo: setReadyToPay corre dentro de $transaction, por isso o tx
  // expõe update (payable), audit log e follow-ups.
  function makeServiceWithPrisma() {
    const update = vi.fn().mockResolvedValue({ id: 'p1', readyToPay: true })
    const followupCreate = vi.fn().mockResolvedValue({})
    const tx = {
      treasuryPayable: { update },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
      treasuryFollowup: { create: followupCreate },
    }
    const prisma = {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    } as never
    return { svc: new TreasuryPayablesService(prisma, {} as never, {} as never), update, followupCreate }
  }

  it('permite marcar como pronta para pagar uma fatura em aberto (OPEN)', async () => {
    const { svc, update } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'OPEN', readyToPay: false } as never)

    await svc.setReadyToPay('c1', 'u1', 'p1', true)
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { readyToPay: true } })
  })

  it('bloqueia marcar como pronta para pagar uma fatura que não está em aberto (PARTIAL)', async () => {
    const { svc, update } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'PARTIAL', readyToPay: false } as never)

    await expect(svc.setReadyToPay('c1', 'u1', 'p1', true)).rejects.toThrow(/em aberto/)
    expect(update).not.toHaveBeenCalled()
  })

  it('permite sempre desmarcar (ready=false), mesmo fora de aberto', async () => {
    const { svc, update } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'PAID', readyToPay: true } as never)

    await svc.setReadyToPay('c1', 'u1', 'p1', false)
    expect(update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { readyToPay: false } })
  })

  it('ao desmarcar com uma data e motivo, grava readyToPay=false e promisedPaymentDate no mesmo update', async () => {
    const { svc, update } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'OPEN', readyToPay: true, promisedPaymentDate: null } as never)

    await svc.setReadyToPay('c1', 'u1', 'p1', false, '2026-07-01', 'Tesouraria sem fundos esta semana')
    expect(update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { readyToPay: false, promisedPaymentDate: new Date('2026-07-01') },
    })
  })

  it('exige motivo ao definir uma nova data de pagamento ao desmarcar', async () => {
    const { svc, update } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'OPEN', readyToPay: true, promisedPaymentDate: null } as never)

    await expect(svc.setReadyToPay('c1', 'u1', 'p1', false, '2026-07-01')).rejects.toThrow(/[Mm]otivo/)
    expect(update).not.toHaveBeenCalled()
  })

  it('ao definir nova data com motivo, cria uma NOTE e uma CALL_TASK para contactar o fornecedor', async () => {
    const { svc, followupCreate } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'OPEN', readyToPay: true, promisedPaymentDate: null } as never)

    await svc.setReadyToPay('c1', 'u1', 'p1', false, '2026-07-01', 'Tesouraria sem fundos esta semana')

    expect(followupCreate).toHaveBeenCalledTimes(2)
    expect(followupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'NOTE', direction: 'PAYABLE', payableId: 'p1', createdById: 'u1' }),
    }))
    expect(followupCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: 'CALL_TASK', direction: 'PAYABLE', payableId: 'p1', status: 'PENDING' }),
    }))
  })

  it('ao desmarcar com data null, repõe a data de vencimento e não cria follow-ups nem exige motivo', async () => {
    const { svc, update, followupCreate } = makeServiceWithPrisma()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'OPEN', readyToPay: true, promisedPaymentDate: new Date('2026-08-01') } as never)

    await svc.setReadyToPay('c1', 'u1', 'p1', false, null)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { readyToPay: false, promisedPaymentDate: null },
    })
    expect(followupCreate).not.toHaveBeenCalled()
  })
})
