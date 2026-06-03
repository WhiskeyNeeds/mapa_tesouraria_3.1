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
