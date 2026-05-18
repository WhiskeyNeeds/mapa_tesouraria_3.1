import XLSX from 'xlsx'
import type { ParsedMovement } from './utils.js'
import { cellToDate, cellToAmount, cellToString } from './utils.js'

// Template columns: Data | Descrição | Valor | Saldo
const DATA_START = 1

export function parseTemplate(buffer: Buffer): ParsedMovement[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: true })

  const results: ParsedMovement[] = []

  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length < 3) continue

    const date = cellToDate(row[0])
    const description = cellToString(row[1])
    const amount = cellToAmount(row[2], 'plain')
    const balanceAfter = row[3] != null && row[3] !== '' ? cellToAmount(row[3], 'plain') : undefined

    if (!date || !description || isNaN(amount)) continue

    results.push({ date, description, amount, balanceAfter })
  }

  return results
}
