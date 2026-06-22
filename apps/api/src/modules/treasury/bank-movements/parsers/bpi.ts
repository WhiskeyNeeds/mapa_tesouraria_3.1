import type { ParsedMovement } from './utils.js'
import { readSheetRows, findHeaderRow, cellToDate, cellToAmount, cellToString } from './utils.js'

// Fallback if the header row can't be located (real header is around index 11-17).
const FALLBACK_DATA_START = 18

export function parseBPI(buffer: Buffer): ParsedMovement[] {
  const rows = readSheetRows(buffer)
  const header = findHeaderRow(rows, ['valor em eur'])
  const start = header >= 0 ? header + 1 : FALLBACK_DATA_START

  const results: ParsedMovement[] = []

  for (let i = start; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length < 4) continue

    // Columns: Data Mov. | Data Valor | Descrição do Movimento | Valor em EUR | Saldo em EUR
    const date = cellToDate(row[0])
    const bookingDate = cellToDate(row[1])
    const description = cellToString(row[2])
    // BPI uses Portuguese number format: "-3.874,50"
    const amount = cellToAmount(row[3], 'pt')
    const balanceAfter = (row[4] != null && row[4] !== '') ? cellToAmount(row[4], 'pt') : undefined

    if (!date || !description || isNaN(amount)) continue

    results.push({ date, bookingDate, description, amount, balanceAfter })
  }

  return results
}
