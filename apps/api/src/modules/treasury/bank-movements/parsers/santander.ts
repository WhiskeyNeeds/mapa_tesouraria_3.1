import type { ParsedMovement } from './utils.js'
import { readSheetRows, findHeaderRow, cellToDate, cellToAmount, cellToString } from './utils.js'

// Santander Excel export — header usually on the first row, data right after.
const FALLBACK_DATA_START = 1

export function parseSantander(buffer: Buffer): ParsedMovement[] {
  const rows = readSheetRows(buffer)
  const header = findHeaderRow(rows, ['data da operacao'])
  const start = header >= 0 ? header + 1 : FALLBACK_DATA_START

  const results: ParsedMovement[] = []

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length < 5) continue

    // Columns: Data da operação | Data valor | Descrição da Conta | Tipo | Montante | Moeda | Saldo contabilístico | Moeda
    const date = cellToDate(row[0])
    const bookingDate = cellToDate(row[1])
    const description = cellToString(row[2])
    // Santander uses plain dot decimal: "-7291.31" (already signed)
    const amount = cellToAmount(row[4], 'plain')
    const balanceAfter = (row[6] != null && row[6] !== '') ? cellToAmount(row[6], 'plain') : undefined

    if (!date || !description || isNaN(amount)) continue

    results.push({ date, bookingDate, description, amount, balanceAfter })
  }

  return results
}
