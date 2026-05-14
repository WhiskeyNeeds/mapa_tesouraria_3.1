import XLSX from 'xlsx'
import type { ParsedMovement } from './utils.js'
import { cellToDate, cellToAmount, cellToString } from './utils.js'

// Header row index (0-based): row 18 in Excel = index 17
// Data starts at index 18
const HEADER_ROW = 17
const DATA_START = 18

export function parseBPI(buffer: Buffer): ParsedMovement[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: true })

  const results: ParsedMovement[] = []

  for (let i = DATA_START; i < rows.length; i++) {
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
