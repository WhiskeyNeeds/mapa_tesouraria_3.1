import { describe, it, expect } from 'vitest'
import XLSX from 'xlsx'
import { parseBankinter } from './bankinter.js'
import { parseBCP } from './bcp.js'
import { parseBPI } from './bpi.js'

// Build a .xlsx Buffer from an array-of-arrays. The real bank exports place a
// variable number of metadata (and blank) rows above the data header; reading
// with { blankrows: false } drops the blank ones, so the header does NOT land at
// the index the parsers hardcoded. These fixtures place the header BEFORE the
// old hardcoded DATA_START to reproduce the "lost first movements" bug.
function makeXlsx(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('parseBankinter', () => {
  // Header at index 2 (real-world effective position after blank-row removal),
  // not the hardcoded 7 → DATA_START=8 used to skip almost everything.
  const buf = makeXlsx([
    ['Bankinter', '', '', '', ''],
    ['Nº de Conta à Ordem: 736 209420618 ( EUR) - CENTRIMPEX LDA', '', '', '', ''],
    ['Data Movimento', 'Data Valor', 'Descrição', 'Montante', 'Saldo'],
    ['10-02-2026', '10-02-2026', 'Pagamento - Deb. Devedor 000058970', -346.87, 0],
    ['06-02-2026', '06-02-2026', 'Imposto do Selo s/Comissao', -1.49, 346.87],
    ['06-02-2026', '06-02-2026', 'Com. Antecip. Oferta Aceite000097673', -37.28, 348.36],
    ['05-02-2026', '05-02-2026', 'Imposto do Selo s/Comissao', -0.14, 385.64],
    ['05-02-2026', '05-02-2026', 'Comissao de Gestao de OP000061325', -3.59, 385.78],
    ['05-12-2025', '05-12-2025', 'Imposto do Selo s/Comissao', -7.11, 389.37],
    ['05-12-2025', '05-12-2025', 'Com. Antecip. Oferta Aceite000093925', -177.68, 396.48],
    ['03-12-2025', '03-12-2025', 'Imposto do Selo s/Comissao', -1.61, 574.16],
    ['03-12-2025', '03-12-2025', 'Comissao de Gestao de OP000058970', -40.15, 575.77],
    ['02-12-2025', '02-12-2025', 'IVA s/Comissao', -31.05, 615.92],
    ['02-12-2025', '02-12-2025', 'Comissao de Abertura de Contrato', -135.0, 646.97],
    ['Conforme condições definidas em Preçário', '', '', '', ''],
  ])

  it('captures all 11 movements (does not drop the most recent one)', () => {
    expect(parseBankinter(buf)).toHaveLength(11)
  })

  it('includes the first/most recent movement with a zero balance (10-02, -346.87, saldo 0)', () => {
    const r = parseBankinter(buf)
    expect(r[0].date).toBe('2026-02-10')
    expect(r[0].description).toContain('Pagamento - Deb. Devedor')
    expect(r[0].amount).toBeCloseTo(-346.87, 2)
    expect(r[0].balanceAfter).toBeCloseTo(0, 2)
  })
})

describe('parseBCP', () => {
  // Header at index 2, not the hardcoded 7.
  const buf = makeXlsx([
    ['Millennium bcp', '', '', '', '', '', '', ''],
    ['Conta', '', '0000045507233005 - EUR', '', '', '', '', ''],
    ['Data Lançamento', 'Data Valor', 'Descrição', 'Montante', 'Saldo Contabilistico', 'Moeda', 'Notas', 'Tratado'],
    ['19/02/2026', '19/02/2026', 'PAG.DUC. 176426016257648', -106.64, 2590.5, 'EUR', '', 'Não'],
    ['17/02/2026', '17/02/2026', 'DD EDENRED Portug 01001377344', -1.06, 2697.14, 'EUR', '', 'Não'],
    ['17/02/2026', '17/02/2026', 'TRF. P/O  MUNICIPIA EMPRESA CARTOGRAF', 153.76, 2698.2, 'EUR', '', 'Não'],
    ['16/02/2026', '16/02/2026', 'TRF. P/O  SHAMIR PORTUGAL', 571.95, 2544.44, 'EUR', '', 'Não'],
    ['13/02/2026', '13/02/2026', 'PAG.DUC  -171426016162159', -102.36, 1972.49, 'EUR', '', 'Não'],
    ['13/02/2026', '13/02/2026', 'PAG.DUC  -171026016161659', -57.55, 2074.85, 'EUR', '', 'Não'],
    ['13/02/2026', '13/02/2026', 'PAGSERV INSTITUTO GESTAO FINAN 477661378', -210.09, 2132.4, 'EUR', '', 'Não'],
    ['13/02/2026', '13/02/2026', 'PAGSERV INSTITUTO GESTAO FINAN 477661289', -20.79, 2342.49, 'EUR', '', 'Não'],
  ])

  it('captures all 8 movements (does not drop the most recent one)', () => {
    expect(parseBCP(buf)).toHaveLength(8)
  })

  it('includes the first/most recent movement (19/02, -106.64)', () => {
    const r = parseBCP(buf)
    expect(r[0].date).toBe('2026-02-19')
    expect(r[0].description).toContain('PAG.DUC. 176426016257648')
    expect(r[0].amount).toBeCloseTo(-106.64, 2)
    expect(r[0].balanceAfter).toBeCloseTo(2590.5, 2)
  })
})

describe('parseBPI', () => {
  // Header at index 3, not the hardcoded 17 → DATA_START=18 dropped many rows.
  const buf = makeXlsx([
    ['BPI Net Empresas', '', '', '', ''],
    ['Conta e Moeda', '', '7-3676058.000.001 (EUR)', '', ''],
    ['Saldo Contabilístico', '', '35.910,82 EUR', '', ''],
    ['Data Mov.', 'Data Valor', 'Descrição do Movimento', 'Valor em EUR', 'Saldo em EUR'],
    ['20-02-2026', '20-02-2026', 'TRF SEPA+ INST 5117 P/ FLASHBANG P', '-3.874,50', '35.910,82'],
    ['18-02-2026', '18-02-2026', 'PAGAMENTO AO ESTADO - 156 190 253 968 119', '-348,00', '39.785,32'],
    ['18-02-2026', '18-02-2026', 'COBRANCA TSU NIF=507587693 - 202601', '-2.281,16', '40.133,32'],
    ['18-02-2026', '17-02-2026', 'DD VIA VERDE PAY, S.A. 10075351723', '-0,74', '42.414,48'],
    ['16-02-2026', '16-02-2026', 'TRF SEPA+ INST 5116 P/ Susana Boga', '-200,00', '42.415,22'],
    ['16-02-2026', '16-02-2026', '14/02 PAG. PORTAGEM/TELEF. PUBL.', '-12,40', '42.615,22'],
    ['16-02-2026', '16-02-2026', 'DD COMP. PORTUGUESA DE SEGUROS DE SAUDE', '-135,40', '42.627,62'],
    ['16-02-2026', '15-02-2026', '15/02 COMPRA EL-E WORTEN OEIRAS', '-1.154,96', '42.763,02'],
    ['12-02-2026', '12-02-2026', 'TRF CR SEPA+ 5115 P/ SUSANA BOGAL', '-585,00', '43.917,98'],
    ['12-02-2026', '12-02-2026', 'TRF CR SEPA+ 5114 P/ N FACTURA: 2', '-1.975,00', '44.502,98'],
    ['12-02-2026', '12-02-2026', 'TRF CR SEPA+ 5113 P/ N FACTURA: 2', '-7.108,90', '46.477,98'],
    ['10-02-2026', '10-02-2026', 'TRF SEPA+ INST 5112 DE CLECE, S.A.', '3.936,00', '53.586,88'],
    ['10-02-2026', '10-02-2026', '07/02 COMPRA EL-E IKEA ALFRAGIDE', '-31,49', '49.650,88'],
    ['10-02-2026', '10-02-2026', 'DD VIA VERDE PAY, S.A. 10075351723', '-16,49', '49.682,37'],
    ['09-02-2026', '09-02-2026', 'TRF CRED NAO SEPA+ RECEBIDA DELL', '4.913,85', '49.698,86'],
  ])

  it('captures all 15 movements (does not drop the 6 most recent)', () => {
    expect(parseBPI(buf)).toHaveLength(15)
  })

  it('includes the first/most recent movement (20-02, -3.874,50)', () => {
    const r = parseBPI(buf)
    expect(r[0].date).toBe('2026-02-20')
    expect(r[0].description).toContain('FLASHBANG')
    expect(r[0].amount).toBeCloseTo(-3874.5, 2)
    expect(r[0].balanceAfter).toBeCloseTo(35910.82, 2)
  })

  it('parses Portuguese number format and a positive credit', () => {
    const credit = parseBPI(buf).find((m) => m.description.includes('CLECE'))
    expect(credit!.amount).toBeCloseTo(3936.0, 2)
  })
})
