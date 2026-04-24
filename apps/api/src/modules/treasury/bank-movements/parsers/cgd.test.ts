import { describe, it, expect } from 'vitest'
import { parseCGD } from './cgd.js'

// Build a latin1 Buffer from a string (CGD exports ISO-8859-1)
function latin1(s: string): Buffer {
  return Buffer.from(s, 'latin1')
}

// 14-line metadata header matching the real CGD format
const HEADER = [
  'Consultar saldos e movimentos C  ordem - 20-02-2026;"=""0372016183430"""',
  'Nome cliente;ASSOCIACAO PAIS ENCARREGADOS EDUCACAO ALUNOS',
  'NIF;"=""504190474"""',
  '',
  'Dados da conta',
  'Conta;0372016183430 - EUR - Conta Extracto',
  'Saldo contabilístico;7.466,14 EUR',
  'Saldo disponível;7.466,14 EUR',
  '',
  'Dados da consulta',
  'Período;Últimos 90 dias',
  'Intervalo de;22-11-2025 a 20-02-2026',
  'Tipos de movimento;Todos',
  '',
  'Data mov.;Data-valor;Descrição;Montante;Saldo contabilístico após movimento',
].join('\n')

function makeCSV(dataLines: string[]): Buffer {
  return latin1([HEADER, ...dataLines].join('\n'))
}

describe('parseCGD', () => {
  it('parses a single credit movement', () => {
    const buf = makeCSV(['19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;110,36;9.111,58'])
    const result = parseCGD(buf)
    expect(result).toHaveLength(1)
    expect(result[0].date).toBe('2026-02-19')
    expect(result[0].bookingDate).toBe('2026-02-19')
    expect(result[0].description).toBe('TRF ENG EDUARDO BELMI')
    expect(result[0].amount).toBeCloseTo(110.36, 2)
    expect(result[0].balanceAfter).toBeCloseTo(9111.58, 2)
  })

  it('parses a single debit movement (negative amount)', () => {
    const buf = makeCSV(['19-02-2026;19-02-2026;PAGAMENTO TSU;-1.625,44;7.466,14'])
    const result = parseCGD(buf)
    expect(result).toHaveLength(1)
    expect(result[0].amount).toBeCloseTo(-1625.44, 2)
    expect(result[0].balanceAfter).toBeCloseTo(7466.14, 2)
  })

  it('parses multiple movements across different days', () => {
    const buf = makeCSV([
      '19-02-2026;19-02-2026;PAGAMENTO TSU;-1.625,44;7.466,14',
      '19-02-2026;19-02-2026;Multi Imposto;-45,00;9.091,58',
      '19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;25,00;9.136,58',
      '18-02-2026;18-02-2026;TFI SARA RAQUEL OLIVE;105,98;9.001,22',
      '18-02-2026;18-02-2026;TFI SARA RAQUEL OLIVE;81,98;8.895,24',
      '18-02-2026;18-02-2026;COMPRA CONTINENTE MOD;-6,68;8.813,26',
    ])
    const result = parseCGD(buf)
    expect(result).toHaveLength(6)
    // newest-first order preserved
    expect(result[0].date).toBe('2026-02-19')
    expect(result[3].date).toBe('2026-02-18')
  })

  it('correctly parses values from real CGD CSV excerpt', () => {
    // Data taken verbatim from the real CGD CSV file (lines 16-30)
    const buf = makeCSV([
      '19-02-2026;19-02-2026;PAGAMENTO TSU;-1.625,44;7.466,14',
      '19-02-2026;19-02-2026;Multi Imposto;-45,00;9.091,58',
      '19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;25,00;9.136,58',
      '19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;110,36;9.111,58',
      '18-02-2026;18-02-2026;TFI SARA RAQUEL OLIVE;105,98;9.001,22',
      '18-02-2026;18-02-2026;TFI SARA RAQUEL OLIVE;81,98;8.895,24',
      '18-02-2026;18-02-2026;COMPRA CONTINENTE MOD;-6,68;8.813,26',
      '16-02-2026;16-02-2026;LactogalProd Alim SA;-102,46;8.819,94',
    ])
    const result = parseCGD(buf)
    expect(result).toHaveLength(8)

    // Verify chain: on 2026-02-19, movements are newest-first
    const feb19 = result.filter((r) => r.date === '2026-02-19')
    expect(feb19).toHaveLength(4)

    // The "tail" of the chain (chain end = the movement whose balanceAfter
    // is not the start of any other) is the first listed: PAGAMENTO TSU → 7466.14
    // because 9091.58 - (-45) = 9136.58 → start of TRF EDUARDO (25), so Multi is not tail
    // 9111.58 - 110.36 = 9001.22 → 9001.22 is not a balanceAfter on feb19 → TRF 110.36 is not tail
    // wait, actually 9001.22 IS a balanceAfter of the feb18 day, not feb19
    // On feb19: {9466.14? no} let me verify…
    // PAGAMENTO TSU: balanceAfter=7466.14, start=7466.14+1625.44=9091.58
    // Multi Imposto: balanceAfter=9091.58, start=9091.58+45=9136.58
    // TRF 25,00: balanceAfter=9136.58, start=9136.58-25=9111.58
    // TRF 110,36: balanceAfter=9111.58, start=9111.58-110.36=9001.22
    // Starting balances = {9091.58, 9136.58, 9111.58, 9001.22}
    // 7466.14 NOT in starting balances → PAGAMENTO TSU is the tail (chain end)
    const pagtsu = feb19.find((r) => r.description === 'PAGAMENTO TSU')
    expect(pagtsu?.balanceAfter).toBeCloseTo(7466.14, 2)
    expect(pagtsu?.amount).toBeCloseTo(-1625.44, 2)
  })

  it('handles movements with thousands separator (1.001,73)', () => {
    const buf = makeCSV(['28-11-2025;28-11-2025;ANA RITA REBELO FERRE;-1.001,73;7.384,01'])
    const result = parseCGD(buf)
    expect(result[0].amount).toBeCloseTo(-1001.73, 2)
    expect(result[0].balanceAfter).toBeCloseTo(7384.01, 2)
  })

  it('skips empty lines and header', () => {
    const buf = makeCSV([
      '',
      '19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;25,00;9.136,58',
      '',
    ])
    const result = parseCGD(buf)
    expect(result).toHaveLength(1)
  })

  it('skips rows with missing or invalid date', () => {
    const buf = makeCSV([';19-02-2026;desc;25,00;1000,00'])
    const result = parseCGD(buf)
    expect(result).toHaveLength(0)
  })

  it('skips rows with too few columns', () => {
    const buf = makeCSV(['19-02-2026;19-02-2026;desc only'])
    const result = parseCGD(buf)
    expect(result).toHaveLength(0)
  })

  it('returns empty array for empty data section', () => {
    const buf = makeCSV([])
    const result = parseCGD(buf)
    expect(result).toHaveLength(0)
  })

  it('date conversion is correct for end-of-month dates', () => {
    const buf = makeCSV(['31-01-2026;31-01-2026;TEST;100,00;1.100,00'])
    const result = parseCGD(buf)
    expect(result[0].date).toBe('2026-01-31')
  })

  it('chain continuity: balanceAfter - amount = balanceAfter of previous movement', () => {
    // 19-02 chain from real data (newest-first):
    // PAGAMENTO TSU: -1625.44 → 7466.14   (chain tail, end of day)
    // Multi Imposto: -45.00 → 9091.58
    // TRF 25,00: +25.00 → 9136.58
    // TRF 110,36: +110.36 → 9111.58      (chain head, start of day = 9001.22)
    const buf = makeCSV([
      '19-02-2026;19-02-2026;PAGAMENTO TSU;-1.625,44;7.466,14',
      '19-02-2026;19-02-2026;Multi Imposto;-45,00;9.091,58',
      '19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;25,00;9.136,58',
      '19-02-2026;19-02-2026;TRF ENG EDUARDO BELMI;110,36;9.111,58',
    ])
    const result = parseCGD(buf)
    // Check chain integrity: each movement's (balanceAfter - amount) should be the starting balance
    // and the next movement in chain should have that as balanceAfter
    // PAGAMENTO: start = 7466.14 - (-1625.44) = 9091.58 = Multi's balanceAfter ✓
    expect(result[0].balanceAfter! - result[0].amount).toBeCloseTo(result[1].balanceAfter!, 2)
    // Multi: start = 9091.58 - (-45) = 9136.58 = TRF 25's balanceAfter ✓
    expect(result[1].balanceAfter! - result[1].amount).toBeCloseTo(result[2].balanceAfter!, 2)
    // TRF 25: start = 9136.58 - 25 = 9111.58 = TRF 110.36's balanceAfter ✓
    expect(result[2].balanceAfter! - result[2].amount).toBeCloseTo(result[3].balanceAfter!, 2)
  })
})
