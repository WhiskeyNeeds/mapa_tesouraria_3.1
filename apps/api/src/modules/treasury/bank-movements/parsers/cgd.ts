import type { ParsedMovement } from './utils.js'
import { parsePortugueseAmount, parseDateDMY, cellToString } from './utils.js'

export function parseCGD(buffer: Buffer): ParsedMovement[] {
  // ISO-8859-1 encoding, semicolon separator, 14-line metadata header
  // Data header on line 15: Data mov.;Data-valor;Descrição;Montante;Saldo contabilístico após movimento
  const text = buffer.toString('latin1')
  const lines = text.split(/\r?\n/)

  const results: ParsedMovement[] = []

  // Locate the data header dynamically — the metadata block length can vary.
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const headerIdx = lines.findIndex((l) => norm(l).includes('data mov'))
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : 15

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(';')
    if (cols.length < 4) continue

    const rawDate = cols[0].trim()
    const rawValueDate = cols[1].trim()
    const description = cols[2].trim()
    const rawAmount = cols[3].trim()

    if (!rawDate || !rawAmount || rawDate === 'Data mov.') continue

    const date = parseDateDMY(rawDate, '-')
    const bookingDate = rawValueDate ? parseDateDMY(rawValueDate, '-') : undefined
    const amount = parsePortugueseAmount(rawAmount)
    const balanceStr = cols[4]?.trim()
    const balanceAfter = balanceStr ? parsePortugueseAmount(balanceStr) : undefined

    if (!date || isNaN(amount)) continue

    results.push({ date, bookingDate, description: cellToString(description), amount, balanceAfter })
  }

  return results
}
