import { describe, it, expect } from 'vitest'
import { mapTocStatus, resolveStatusOverlay, resolveDocAmounts } from './toc-overlay.js'

describe('mapTocStatus', () => {
  it('mapeia status TOC para o enum local', () => {
    expect(mapTocStatus(3)).toBe('SETTLED')
    expect(mapTocStatus(2)).toBe('PARTIAL')
    expect(mapTocStatus(1)).toBe('OPEN')
    expect(mapTocStatus(5)).toBe('OPEN')
  })
  it('devolve null para rascunho/anulado/ausente', () => {
    expect(mapTocStatus(0)).toBeNull()
    expect(mapTocStatus(4)).toBeNull()
    expect(mapTocStatus(null)).toBeNull()
    expect(mapTocStatus(undefined)).toBeNull()
  })
})

describe('resolveStatusOverlay', () => {
  it('OPEN local segue o TOC', () => {
    expect(resolveStatusOverlay('OPEN', null, 'OPEN', 100, 100)).toEqual({ status: 'OPEN', settled: 0, pending: 100, statusDiffers: false })
  })
  it('recibo TOConline (SETTLED) liquida automaticamente', () => {
    expect(resolveStatusOverlay('OPEN', null, 'SETTLED', 100, 0)).toEqual({ status: 'SETTLED', settled: 100, pending: 0, statusDiffers: false })
  })
  it('PARTIAL local deriva o pending do liquidado local sobre o gross TOC', () => {
    expect(resolveStatusOverlay('PARTIAL', 30, 'OPEN', 100, 100)).toEqual({ status: 'PARTIAL', settled: 30, pending: 70, statusDiffers: true })
  })
  it('anulação local prevalece', () => {
    expect(resolveStatusOverlay('VOID', null, 'OPEN', 100, 100)).toEqual({ status: 'VOID', settled: 0, pending: 0, statusDiffers: true })
  })
})

describe('resolveDocAmounts', () => {
  it('doc puramente local usa os campos da linha', () => {
    expect(resolveDocAmounts(
      { status: 'OPEN', reference: 'OP-1', totalAmount: 50, pendingAmount: 50, settledAmount: 0, isTocLinked: false },
      null,
    )).toEqual({ total: 50, settled: 0, pending: 50, reference: 'OP-1' })
  })

  it('doc TOC OPEN usa o pending do espelho, não o pendingAmount local (null)', () => {
    expect(resolveDocAmounts(
      { status: 'OPEN', reference: null, totalAmount: null, pendingAmount: null, settledAmount: null, isTocLinked: true },
      { status: 1, grossTotal: 28.6, pendingTotal: 28.6, raw: { document_no: 'FT 2022/4' } },
    )).toEqual({ total: 28.6, settled: 0, pending: 28.6, reference: 'FT 2022/4' })
  })

  it('doc TOC PARTIAL deriva o pending do liquidado local', () => {
    expect(resolveDocAmounts(
      { status: 'PARTIAL', reference: null, totalAmount: null, pendingAmount: null, settledAmount: 30, isTocLinked: true },
      { status: 2, grossTotal: 100, pendingTotal: 70, raw: { document_no: 'FT 9' } },
    )).toEqual({ total: 100, settled: 30, pending: 70, reference: 'FT 9' })
  })

  it('doc ligado mas com espelho TOC removido do sync cai para os campos locais', () => {
    expect(resolveDocAmounts(
      { status: 'OPEN', reference: 'FT 7', totalAmount: 40, pendingAmount: 40, settledAmount: 0, isTocLinked: true },
      null,
    )).toEqual({ total: 40, settled: 0, pending: 40, reference: 'FT 7' })
  })
})
