import type { ParsedMovement } from './utils.js'
import { readSheetRows, findHeaderRow, cellToDate, cellToAmount, cellToString } from './utils.js'

// Template columns: Data | Descrição | Valor | Saldo
const FALLBACK_DATA_START = 1

export function parseTemplate(buffer: Buffer): ParsedMovement[] {
  const rows = readSheetRows(buffer)
  const header = findHeaderRow(rows, ['data', 'valor'])
  const start = header >= 0 ? header + 1 : FALLBACK_DATA_START

  const results: ParsedMovement[] = []

  for (let i = start; i < rows.length; i++) {
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
