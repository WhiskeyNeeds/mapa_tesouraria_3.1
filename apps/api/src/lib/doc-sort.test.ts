import { describe, it, expect } from 'vitest'
import { compareDocs } from './doc-sort.js'

type Row = { id: string; reference?: string | null; promisedPaymentDate?: Date | null; dueDate?: Date | null; totalAmount?: number }

const d = (s: string) => new Date(s)

describe('compareDocs — coluna "Pagamento"', () => {
  it('ordena por data efetiva (promisedPaymentDate ?? dueDate), igual ao que é exibido', () => {
    const rows: Row[] = [
      { id: 'A', promisedPaymentDate: null, dueDate: d('2026-01-30') }, // efetiva 01-30
      { id: 'B', promisedPaymentDate: null, dueDate: d('2026-01-01') }, // efetiva 01-01
      { id: 'C', promisedPaymentDate: d('2026-01-15'), dueDate: d('2026-02-20') }, // efetiva 01-15
    ]
    const sorted = [...rows].sort((a, b) => compareDocs(a, b, 'promisedPaymentDate', 'asc'))
    expect(sorted.map((r) => r.id)).toEqual(['B', 'C', 'A'])
  })

  it('respeita a direção desc', () => {
    const rows: Row[] = [
      { id: 'A', promisedPaymentDate: null, dueDate: d('2026-01-30') },
      { id: 'B', promisedPaymentDate: null, dueDate: d('2026-01-01') },
      { id: 'C', promisedPaymentDate: d('2026-01-15'), dueDate: d('2026-02-20') },
    ]
    const sorted = [...rows].sort((a, b) => compareDocs(a, b, 'promisedPaymentDate', 'desc'))
    expect(sorted.map((r) => r.id)).toEqual(['A', 'C', 'B'])
  })

  it('coloca docs sem qualquer data no fim (asc)', () => {
    const rows: Row[] = [
      { id: 'A', promisedPaymentDate: null, dueDate: null },
      { id: 'B', promisedPaymentDate: null, dueDate: d('2026-01-10') },
    ]
    const sorted = [...rows].sort((a, b) => compareDocs(a, b, 'promisedPaymentDate', 'asc'))
    expect(sorted.map((r) => r.id)).toEqual(['B', 'A'])
  })

  it('desempata faturas com a mesma data de pagamento por vencimento, depois nº doc (mesma direção)', () => {
    // Caso real: 22 tem data prometida 10/06 (vence 30/04); 38 vence 10/06 sem
    // data prometida. Ambas valem 10/06 → empate. Em desc, desempate por
    // vencimento desc coloca a 38 (vence 10/06) antes da 22 (vence 30/04).
    const rows: Row[] = [
      { id: '22', reference: 'FT 2022/22', promisedPaymentDate: d('2026-06-10'), dueDate: d('2026-04-30') },
      { id: '38', reference: 'FT 2022/38', promisedPaymentDate: null, dueDate: d('2026-06-10') },
      { id: '36', reference: 'FT 2022/36', promisedPaymentDate: null, dueDate: d('2026-06-02') },
    ]
    const sorted = [...rows].sort((a, b) => compareDocs(a, b, 'promisedPaymentDate', 'desc'))
    expect(sorted.map((r) => r.id)).toEqual(['38', '22', '36'])
  })

  it('é determinístico em empate total de datas (desempate por nº de documento)', () => {
    const mk = (id: string, reference: string): Row => ({ id, reference, promisedPaymentDate: null, dueDate: d('2026-06-10') })
    const a = [mk('x', 'FT 2022/9'), mk('y', 'FT 2022/3')]
    const b = [mk('y', 'FT 2022/3'), mk('x', 'FT 2022/9')]
    const sa = [...a].sort((p, q) => compareDocs(p, q, 'promisedPaymentDate', 'asc')).map((r) => r.id)
    const sb = [...b].sort((p, q) => compareDocs(p, q, 'promisedPaymentDate', 'asc')).map((r) => r.id)
    expect(sa).toEqual(sb) // mesma ordem independentemente da ordem de entrada
  })

  it('ordena campos não-data normalmente (ex. totalAmount)', () => {
    const rows: Row[] = [
      { id: 'A', totalAmount: 30 },
      { id: 'B', totalAmount: 10 },
      { id: 'C', totalAmount: 20 },
    ]
    const sorted = [...rows].sort((a, b) => compareDocs(a, b, 'totalAmount', 'asc'))
    expect(sorted.map((r) => r.id)).toEqual(['B', 'C', 'A'])
  })
})
