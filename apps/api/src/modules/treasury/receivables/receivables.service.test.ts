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
