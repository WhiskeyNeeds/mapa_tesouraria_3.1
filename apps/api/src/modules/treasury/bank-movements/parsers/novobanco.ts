import type { ParsedMovement } from './utils.js'
import { parsePortugueseAmount, parseDateDMY, cellToString } from './utils.js'

export function parseNovoBanco(buffer: Buffer): ParsedMovement[] {
  // Encoding: ISO-8859-1 / Windows-1252, semicolon separator
  // Header row identified by "Data Lançamento" or "Data Movimento"
  // Amount columns: either Débito + Crédito (separate) or a single signed Montante
  const text = buffer.toString('latin1')
  const lines = text.split(/\r?\n/)

  const results: ParsedMovement[] = []
  let dataStarted = false
  let debitCol = -1
  let creditCol = -1
  let amountCol = -1
  let balanceCol = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue

    const cols = raw.split(';').map((c) => c.replace(/^["']|["']$/g, '').trim())

    if (!dataStarted) {
      const norm = cols.map((c) =>
        c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      )
      const dateIdx = norm.findIndex((c) => c.includes('data lancamento') || c.includes('data movimento'))
      if (dateIdx === -1) continue

      // Identify amount columns
      debitCol  = norm.findIndex((c) => c.includes('debito') || c === 'debito')
      creditCol = norm.findIndex((c) => c.includes('credito') || c === 'credito')
      amountCol = norm.findIndex((c) => c.includes('montante') || c.includes('valor') || c.includes('importe'))
      balanceCol = norm.findIndex((c) => c.includes('saldo'))

      dataStarted = true
      continue
    }

    if (cols.length < 3) continue

    const rawDate = cols[0]
    const rawValueDate = cols[1]
    const description = cellToString(cols[2])

    if (!rawDate || rawDate === '') continue

    const date = parseDateDMY(rawDate, '-')
    const bookingDate = rawValueDate ? parseDateDMY(rawValueDate, '-') : undefined

    if (!date) continue

    let amount: number
    if (debitCol !== -1 && creditCol !== -1) {
      const debitStr = cols[debitCol] ?? ''
      const creditStr = cols[creditCol] ?? ''
      const debit = debitStr ? parsePortugueseAmount(debitStr) : 0
      const credit = creditStr ? parsePortugueseAmount(creditStr) : 0
      if (isNaN(debit) && isNaN(credit)) continue
      amount = (credit > 0 ? credit : 0) - (debit > 0 ? debit : 0)
    } else if (amountCol !== -1) {
      const amountStr = cols[amountCol] ?? ''
      if (!amountStr) continue
      amount = parsePortugueseAmount(amountStr)
    } else {
      // fallback: column 3
      const amountStr = cols[3] ?? ''
      if (!amountStr) continue
      amount = parsePortugueseAmount(amountStr)
    }

    if (isNaN(amount)) continue

    const balanceStr = balanceCol !== -1 ? (cols[balanceCol] ?? '') : ''
    const balanceAfter = balanceStr ? parsePortugueseAmount(balanceStr) : undefined

    results.push({
      date,
      bookingDate: bookingDate || undefined,
      description,
      amount,
      balanceAfter: balanceAfter != null && !isNaN(balanceAfter) ? balanceAfter : undefined,
    })
  }

  return results
}
