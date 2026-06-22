import { describe, it, expect } from 'vitest'
import { extractMovementsFromText } from './pdf.js'
import { findBalanceInconsistencies } from '../balance-consistency.js'

// Faithful reproduction of how `pdf-parse` emits a BPI "Extracto de Conta":
// the table is COLUMN-streamed, not row-streamed. Per page the tokens appear in
// blocks in this order:
//   descriptions… → saldos… → dates… → valores…
// with the opening balance printed on its OWN line (the "SALDO ANTERIOR
// CONTABILISTICO" label carries no number), and header/footer noise interleaved.
//
// Content is anonymized; the STRUCTURE mirrors a real statement exactly so the
// parser's segmentation, junk-filtering and credit/debit handling are exercised.
const BPI_PDF_TEXT = [
  '',
  'Sede: Avenida da Boavista, 1117 - 4100-129 PORTO',
  'BPI Direto 21 720 77 07  (atendimento personalizado)   www.bancobpi.pt   SWIFT BBPIPTPL',
  'Capital Social € 1.293.063.324,98, matriculada na CRCP sob o número 501 214 534',
  'CIDADE EXEMPLO',
  'RUA EXEMPLO N 1',
  'PARTIC EXEMPLO LDA',
  '4470 - 157 CIDADE',
  '9-0000000-000-001',
  '002/2026',
  'De 31/01/2026 a 27/02/2026',
  'Extracto',
  'Período',
  'EXTRACTO DE CONTA',
  'Conta',
  '00231 EX 000001 0000000000',
  'PI',
  ' ',
  'SALDO ANTERIOR CONTABILISTICO',
  // ── descriptions (5) ──
  'TRF CR INTRAB 0001 P/ PT50000000000000000000001 CLIENTE A',
  'DD ACME LIMITED 123456',
  '02/02 COMPRA EL-E 2903039/00 LOJA UM           PORTO',
  'TRF CR SEPA+ 0002 DE CLIENTE B',
  'COMISSÃO DE MANUTENCAO',
  // ── saldos (initial + 5) ──
  ' 5 000,00',
  ' 3 800,00',
  ' 3 750,00',
  ' 3 724,50',
  ' 5 224,50',
  ' 5 219,50',
  // ── dates (1 mov + 5 val) ──
  '02/02',
  '01/02',
  '03/02',
  '04/02',
  '05/02',
  '06/02',
  // ── column headers ──
  'DATA',
  'MOV',
  'SALDO',
  'MOEDA',
  'VALOR',
  'DATA',
  'VAL',
  'DESCRIÇÃO DO MOVIMENTO',
  'DEPÓSITOS À ORDEM   ',
  'CONTA VALOR BPI NEGOCIOS Nº: 9-0000000-000-001',
  'EUR',
  // ── valores (5): credits carry NO sign ──
  '-1 200,00',
  '-50,00',
  '-25,50',
  ' 1 500,00',
  '-5,00',
  // ── page-1 footer ──
  'NIB: 0010 0000 00000000001 56',
  'IBAN: PT50 0010 0000 0000 0000 0015 6',
  '',
  // ════════════════ PAGE 2 ════════════════
  'Sede: Avenida da Boavista, 1117 - 4100-129 PORTO',
  'BPI Direto 21 720 77 07   www.bancobpi.pt   SWIFT BBPIPTPL',
  'Capital Social € 1.293.063.324,98, matriculada na CRCP sob o número 501 214 534',
  'Pág. 2/2',
  // ── descriptions (3) ──
  '18/02 COMPRA EL-E 2903039/00 LOJA DOIS         LISBOA',
  'TRF CR SEPA+ 0003 DE CLIENTE C',
  'PAGAMENTO AO ESTADO - 100 000 000 000 000',
  // ── end-of-statement balance labels ──
  'SALDO ACTUAL CONTABILISTICO',
  'SALDO ACTUAL DISPONIVEL',
  // ── saldos (3 + 2 summary repeats) ──
  ' 5 209,50',
  ' 7 209,50',
  ' 7 000,00',
  ' 7 000,00',
  ' 7 000,00',
  // ── dates (1 mov + 3 val) ──
  '18/02',
  '20/02',
  '21/02',
  '27/02',
  // ── footer legal noise ──
  'O BPI informa que em caso de ultrapassagem de crédito na sua conta à ordem, cobrará juros',
  'Preçário em vigor, atualmente de 18,55%.',
  'Informa-se ainda que a Taxa anual nominal (TAN) da Facilidade de Descoberto é de 14,85%,',
  'correspondendo a uma TAEG de 16,59% para Trabalhadores por conta de outrem',
  'qualquer exemplo de um montante máximo da facilidade de descoberto contratado',
  'mantêm-se inalteradas. Para os Clientes Empresários em Nome Individual',
  'é considerado o Imposto do Selo sobre utilização de crédito, no valor de 0,141%',
  // ── column headers (page 2 variant: glued) ──
  'DATA',
  'MOV',
  'SALDO',
  'MOEDAVALORDATA',
  'VAL',
  'DESCRIÇÃO DO MOVIMENTO',
  'DEPÓSITOS À ORDEM   ',
  // ── valores (3) ──
  '-10,00',
  ' 2 000,00',
  '-209,50',
].join('\n')

describe('parseBPIPDF — column-streamed pdf-parse output', () => {
  const movements = extractMovementsFromText(BPI_PDF_TEXT, 'BPI')

  it('extracts exactly the 8 real movements (no header/footer junk)', () => {
    expect(movements).toHaveLength(8)
    // junk lines must never appear as movements
    const descs = movements.map((m) => m.description).join(' | ')
    expect(descs).not.toMatch(/SALDO ANTERIOR|Preçário|é considerado|MOEDA|EXTRACTO|^PI$|CIDADE EXEMPLO/i)
  })

  it('uses VALOR as the amount, preserving sign (credits have no +)', () => {
    expect(movements[0].amount).toBeCloseTo(-1200, 2)   // debit
    expect(movements[3].amount).toBeCloseTo(1500, 2)    // credit, space-thousands, no sign
    expect(movements[6].amount).toBeCloseTo(2000, 2)    // credit
  })

  it('aligns each printed SALDO with its movement', () => {
    expect(movements[0].balanceAfter).toBeCloseTo(3800, 2)
    expect(movements[3].balanceAfter).toBeCloseTo(5224.5, 2)
    expect(movements[7].balanceAfter).toBeCloseTo(7000, 2)
  })

  it('keeps the running balance consistent across both pages', () => {
    let prev = 5000 // opening balance
    for (const m of movements) {
      const expected = Math.round((prev + m.amount) * 100) / 100
      expect(m.balanceAfter).toBeCloseTo(expected, 2)
      prev = m.balanceAfter!
    }
  })

  it('uses the value date as the movement date (the balance chain follows it)', () => {
    // "02/02 COMPRA EL-E ... LOJA UM": operation 02/02, value/posting 04/02.
    // The running balance is ordered by value date, so date = value date and the
    // earlier operation date is kept in bookingDate (not shown to the user).
    const m = movements[2]
    expect(m.date).toBe('2026-02-04')        // value date — drives ordering/chain
    expect(m.bookingDate).toBe('2026-02-02') // operation date (embedded), preserved
    expect(m.description).toBe('COMPRA EL-E 2903039/00 LOJA UM PORTO')
  })

  it('has no booking date when operation and value dates coincide', () => {
    expect(movements[0].date).toBe('2026-02-01')
    expect(movements[0].bookingDate).toBeUndefined()
  })

  // Regression for the real bug: the server groups movements by `date` and walks
  // the balance chain in DATE order. If `date` were the operation date (out of
  // chain order), this would report spurious gaps.
  it('produces zero inconsistencies under the server check (date-sorted chain)', () => {
    const preview = movements.map((m, i) => ({
      date: m.date, amount: m.amount, balanceAfter: m.balanceAfter, row: i + 1,
    }))
    expect(findBalanceInconsistencies(preview)).toEqual([])
  })
})
