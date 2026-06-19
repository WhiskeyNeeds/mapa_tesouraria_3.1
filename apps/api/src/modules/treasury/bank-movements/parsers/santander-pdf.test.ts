import { describe, it, expect } from 'vitest'
import { extractMovementsFromText } from './pdf.js'

// Faithful reproduction of the text that `pdf-parse` produces for
// "Extrato Santander Fevereiro 2026.pdf". Critically, pdf-parse GLUES the
// columns together with NO spaces (the two dates, and the amount+balance):
//   "02-0202-02ORDENADO ... FR-E1241422-1.580,776.062,34"
// The previous regex assumed space-separated columns (pdftotext -layout style),
// so it matched zero lines and the import failed with "Nenhum movimento encontrado".
const SANTANDER_PDF_TEXT = [
  'EXTRATO Nº 46CONTA Nº 0003.55544167020PERÍODO DE 2026-01-31 A 2026-02-27',
  'BANCO SANTANDER TOTTA, S.A.',
  'Detalhe de Movimentos da Conta à Ordem',
  'Moeda: EUR',
  'Data',
  'MovValorDescritivo do MovimentoMoedaValorSaldo',
  'Saldo InicialEUR',
  '7.643,11',
  '02-0202-02ORDENADO    P/ JOANA CATARINA OLIVEIRA FR-E1241422-1.580,776.062,34',
  '02-0202-02DÉBITO DIRETO-COMP. PORTUGUESA-02389630571-200,555.861,79',
  '05-0205-02COMISSÃO DE GESTÃO-15,805.845,99',
  '05-0205-02IS-VERBA 17.3.4 TGIS-S/COM-0,635.845,36',
  '06-0206-02PAG SERVICOS *9302 11717-026473290 IEFP-DELG.NORTE-125,885.719,48',
  '20-0220-02TRF.IMED.   P/ JOANA CORREIA VAZ SOUSA-E1284625-264,605.454,88',
  '23-0223-026366865-00-PAG.CTA.CARTAO-4,375.450,51',
  '24-0224-02TRF CRED SEPA+ DE MYLAN-28652188811.229,1616.679,67',
  '25-0224-02COMISSÃO IMOBILIZADO-21,5316.658,14',
  '25-0224-02IMP. SELO COMISSÃO IMOBILIZADO-0,8616.657,28',
  '26-0226-02COMISSÃO DE GESTÃO-10,0016.647,28',
  '26-0226-02IS-VERBA 17.3.4 TGIS-S/COM-0,4016.646,88',
  '26-0226-02DÉBITO DIRETO-AEGON SANTANDER -00185556517-5,0016.641,88',
  '26-0226-02COVERFLEX-05160240-3.000,0013.641,88',
  '27-0227-02TRF.IMED.   P/ JOANA CORREIA VAZ SOUSA-E1300785-332,1013.309,78',
  '27-0227-02ORDENADO    P/ DIANA RAQUEL VALENTE ACHANDO-E13012-1.196,8512.112,93',
  'Saldo Contabilístico Final EUR',
  '12.112,93',
].join('\n')

describe('parseSantanderPDF — glued pdf-parse output', () => {
  const movements = extractMovementsFromText(SANTANDER_PDF_TEXT, 'Santander')

  it('extracts all 16 movements', () => {
    expect(movements).toHaveLength(16)
  })

  it('parses the first movement (debit)', () => {
    const m = movements[0]
    expect(m.date).toBe('2026-02-02')
    expect(m.description).toContain('ORDENADO')
    expect(m.description).toContain('JOANA CATARINA')
    expect(m.amount).toBeCloseTo(-1580.77, 2)
    expect(m.balanceAfter).toBeCloseTo(6062.34, 2)
  })

  it('parses a credit whose amount has no sign and is glued to a reference number', () => {
    // "...MYLAN-28652188811.229,1616.679,67" → amount +11.229,16, saldo 16.679,67
    const m = movements.find((x) => x.description.includes('MYLAN'))
    expect(m).toBeDefined()
    expect(m!.amount).toBeCloseTo(11229.16, 2)
    expect(m!.balanceAfter).toBeCloseTo(16679.67, 2)
  })

  it('parses the last movement and final balance', () => {
    const m = movements[15]
    expect(m.date).toBe('2026-02-27')
    expect(m.description).toContain('DIANA')
    expect(m.amount).toBeCloseTo(-1196.85, 2)
    expect(m.balanceAfter).toBeCloseTo(12112.93, 2)
  })

  it('keeps the running balance consistent across every movement', () => {
    let prev = 7643.11
    for (const m of movements) {
      const expected = Math.round((prev + m.amount) * 100) / 100
      expect(m.balanceAfter).toBeCloseTo(expected, 2)
      prev = m.balanceAfter!
    }
  })

  it('captures booking date only when it differs from the movement date', () => {
    // line "25-0224-02IMP. SELO..." → mov 25-02, val 24-02 → bookingDate set
    const m = movements.find((x) => x.description.includes('IMP. SELO'))
    expect(m!.date).toBe('2026-02-25')
    expect(m!.bookingDate).toBe('2026-02-24')
  })
})
