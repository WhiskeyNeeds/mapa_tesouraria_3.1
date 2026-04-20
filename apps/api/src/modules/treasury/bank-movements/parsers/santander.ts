import XLSX from 'xlsx'
import type { ParsedMovement } from './utils.js'
import { cellToDate, cellToAmount, cellToString } from './utils.js'

// Santander has no metadata header — row 1 is the data header, data starts row 2
const DATA_START = 1

export function parseSantander(buffer: Buffer): ParsedMovement[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: true })

  const results: ParsedMovement[] = []

  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length < 5) continue

    // Columns: Data da operação | Data valor | Descrição da Conta | Tipo | Montante | Moeda | Saldo contabilístico | Moeda
    const date = cellToDate(row[0])
    const bookingDate = cellToDate(row[1])
    const description = cellToString(row[2])
    // Santander uses plain dot decimal: "-7291.31" (already signed)
    const amount = cellToAmount(row[4], 'plain')
    const balanceAfter = row[6] ? cellToAmount(row[6], 'plain') : undefined

    if (!date || !description || isNaN(amount)) continue

    results.push({ date, bookingDate, description, amount, balanceAfter })
  }

  return results
}
