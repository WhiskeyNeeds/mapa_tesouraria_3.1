import type { ParsedMovement } from './utils.js'
import { readSheetRows, findHeaderRow, cellToDate, cellToAmount, cellToString } from './utils.js'

// Fallback if the header row can't be located (real header is around index 6-7).
const FALLBACK_DATA_START = 8

export function parseBCP(buffer: Buffer): ParsedMovement[] {
  const rows = readSheetRows(buffer)
  const header = findHeaderRow(rows, ['data lancamento'])
  const start = header >= 0 ? header + 1 : FALLBACK_DATA_START

  const results: ParsedMovement[] = []

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length < 4) continue

    // Columns: Data Lançamento | Data Valor | Descrição | Montante | Saldo Contabilistico | Moeda | ...
    const date = cellToDate(row[0])
    const bookingDate = cellToDate(row[1])
    const description = cellToString(row[2])
    // BCP stores amounts as plain dot-decimal or raw numbers
    const amount = cellToAmount(row[3], 'dot')
    const balanceAfter = (row[4] != null && row[4] !== '') ? cellToAmount(row[4], 'dot') : undefined

    if (!date || !description || isNaN(amount)) continue

    results.push({ date, bookingDate, description, amount, balanceAfter })
  }

  return results
}
