import XLSX from 'xlsx'
import type { CsvMovement } from '../bank-movements.service.js'
import { parseCGD } from './cgd.js'
import { parseBCP } from './bcp.js'
import { parseBPI } from './bpi.js'
import { parseBankinter } from './bankinter.js'
import { parseSantander } from './santander.js'

export type SupportedBank = 'CGD' | 'BCP' | 'BPI' | 'Bankinter' | 'Santander' | 'NovoBanco'

export function detectBank(buffer: Buffer): SupportedBank | null {
  // CGD: CSV in latin1, first line contains "Consultar saldos"
  try {
    const preview = buffer.toString('latin1').slice(0, 300)
    if (preview.includes('Consultar saldos')) return 'CGD'
  } catch {}

  // Excel-based banks
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false }) as string[][]

    const headerText = (row: string[] | undefined) =>
      (row ?? []).map((c) => String(c).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))

    // Santander: no metadata, header on row 0
    const row0 = headerText(rows[0])
    if (row0.some((c) => c.includes('data da operacao'))) return 'Santander'

    // BPI: header on row 17 (index 17)
    const row17 = headerText(rows[17])
    if (row17.some((c) => c.includes('valor em eur') || c.includes('descricao do movimento'))) return 'BPI'

    // BCP / Bankinter: header on row 7 (index 7)
    const row7 = headerText(rows[7])
    if (row7.some((c) => c.includes('data lancamento'))) return 'BCP'
    if (row7.some((c) => c.includes('data movimento'))) return 'Bankinter'
  } catch {}

  return null
}

export function parseStatementFile(buffer: Buffer, bank: SupportedBank): CsvMovement[] {
  const detected = detectBank(buffer)

  if (detected && detected !== bank) {
    const names: Record<string, string> = {
      CGD: 'Caixa Geral de Depósitos',
      BCP: 'Millennium BCP',
      BPI: 'Banco BPI',
      Bankinter: 'Bankinter',
      Santander: 'Santander',
    }
    throw new Error(
      `O ficheiro parece ser do ${names[detected] ?? detected}, mas selecionou ${names[bank] ?? bank}.`
    )
  }

  switch (bank) {
    case 'CGD': return parseCGD(buffer)
    case 'BCP': return parseBCP(buffer)
    case 'BPI': return parseBPI(buffer)
    case 'Bankinter': return parseBankinter(buffer)
    case 'Santander': return parseSantander(buffer)
    case 'NovoBanco': throw new Error('Novo Banco format not supported yet')
    default: throw new Error(`Unknown bank: ${bank}`)
  }
}

export { SupportedBank as BankType }
