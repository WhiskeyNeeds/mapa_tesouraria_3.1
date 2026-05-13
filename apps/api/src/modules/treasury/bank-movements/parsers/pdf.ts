import { createRequire } from 'node:module'
import type { ParsedMovement } from './utils.js'
import { parsePortugueseAmount, parseDateDMY, parseDotDecimalAmount } from './utils.js'
import type { SupportedBank } from './index.js'

// Strings for per-call RegExp construction (avoids global regex lastIndex issues)
const DATE_STR = '\\b(\\d{2}[/\\-]\\d{2}[/\\-]\\d{4})\\b'
// Portuguese thousands+comma decimal: 1.234,56 or -1.234,56
const PT_AMT_STR = '[+\\-]?\\d{1,3}(?:\\.\\d{3})*,\\d{2}'
// Plain dot-decimal: 1234.56 or -1234.56
const PLAIN_AMT_STR = '[+\\-]?\\d{1,}\\. \\d{2}\\b'

// Lines that are headers, footers or metadata — skip them
const SKIP_RE = [
  /^(data|saldo|descri[çc]|movimen|lan[çc]am|d[eé]bito|cr[eé]dito|p[aá]g(ina)?|extrato|conta[:\s]|per[ií]odo|titular|n\.?[oº]\s*conta|iban|moeda)/i,
  /^\d+\s*[\/|]\s*\d+$/,     // page numbers "3 / 5"
  /^[-=*_]{3,}$/,             // separator lines
  /^(millennium|bankinter|santander|caixa geral|bpi|novo banco)/i,
]

function parseDate(s: string): string {
  const sep = s.includes('/') ? '/' : '-'
  return parseDateDMY(s, sep)
}

function parseAmt(s: string): number {
  const clean = s.replace(/\s/g, '')
  return clean.includes(',') ? parsePortugueseAmount(clean) : parseDotDecimalAmount(clean)
}

export async function parsePDF(buffer: Buffer, bank?: SupportedBank): Promise<ParsedMovement[]> {
  // pdf-parse ships as CJS — bridge via createRequire in this ESM module
  const req = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = req('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
  const { text } = await pdfParse(buffer)
  return extractMovements(text, bank)
}

function extractMovements(text: string, _bank?: SupportedBank): ParsedMovement[] {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim())

  // Detect predominant date separator in this document
  const slashCount = rawLines.filter((l) => /^\d{2}\/\d{2}\/\d{4}/.test(l)).length
  const dashCount  = rawLines.filter((l) => /^\d{2}-\d{2}-\d{4}/.test(l)).length
  const sep = dashCount > slashCount ? '-' : '/'
  const DATE_START = sep === '-' ? /^\d{2}-\d{2}-\d{4}/ : /^\d{2}\/\d{2}\/\d{4}/

  // Detect whether the document uses split Débito / Crédito columns
  const fullDoc = rawLines.join(' ')
  const hasSplitCols =
    /d[eé]bito/i.test(fullDoc) && /cr[eé]dito/i.test(fullDoc)

  // Group consecutive lines into movement blocks.
  // A new block starts whenever a line begins with a date.
  const groups: string[][] = []
  let cur: string[] | null = null

  for (const line of rawLines) {
    if (!line) continue
    if (SKIP_RE.some((re) => re.test(line))) {
      if (cur) { groups.push(cur); cur = null }
      continue
    }
    if (DATE_START.test(line)) {
      if (cur) groups.push(cur)
      cur = [line]
    } else if (cur) {
      cur.push(line)
    }
  }
  if (cur) groups.push(cur)

  const movements: ParsedMovement[] = []

  for (const group of groups) {
    const full = group.join(' ')

    // --- Dates ---
    const dateMatches = [...full.matchAll(new RegExp(DATE_STR, 'g'))]
    if (!dateMatches.length) continue
    const date = parseDate(dateMatches[0][1])
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const bookingDate = dateMatches[1] ? parseDate(dateMatches[1][1]) : undefined

    // --- Amounts: prefer PT format; fall back to plain decimal ---
    const ptAmts = [...full.matchAll(new RegExp(PT_AMT_STR, 'g'))].map((m) => m[0].replace(/\s/g, ''))
    const amounts: string[] = ptAmts.length > 0
      ? ptAmts
      : [...full.matchAll(new RegExp(PLAIN_AMT_STR, 'g'))].map((m) => m[0].replace(/\s/g, ''))

    if (!amounts.length) continue

    let amount: number
    let balanceAfter: number | undefined

    if (hasSplitCols && amounts.length === 3) {
      // Split format: debit | credit | balance
      // One of debit/credit is 0 — the other is the transaction value
      const debit  = parseAmt(amounts[0])
      const credit = parseAmt(amounts[1])
      balanceAfter  = parseAmt(amounts[2])
      // Non-zero side determines direction; sign is fixed below via balance-delta pass
      amount = credit > 0 && !isNaN(credit) ? credit : debit > 0 && !isNaN(debit) ? -debit : 0
    } else if (amounts.length >= 2) {
      amount      = parseAmt(amounts[amounts.length - 2])
      balanceAfter = parseAmt(amounts[amounts.length - 1])
    } else {
      amount = parseAmt(amounts[0])
    }

    if (isNaN(amount)) continue

    // --- Description: strip dates and amounts from full text ---
    let desc = full
    for (const m of dateMatches) desc = desc.replace(m[0], '')
    for (const a of amounts) desc = desc.replace(a, '')
    desc = desc.replace(/\s{2,}/g, ' ').trim()
    if (!desc) desc = 'Movimento'

    movements.push({ date, bookingDate: bookingDate ?? undefined, description: desc, amount, balanceAfter })
  }

  // --- Balance-delta pass: fix signs for split-column PDFs ---
  // When two consecutive movements both have balanceAfter and |delta| ≈ |amount|,
  // align the sign of the amount to match the balance direction.
  for (let i = 1; i < movements.length; i++) {
    const prev = movements[i - 1]
    const curr = movements[i]
    if (prev.balanceAfter == null || curr.balanceAfter == null) continue
    const delta    = Math.round((curr.balanceAfter - prev.balanceAfter) * 100) / 100
    const absAmt   = Math.abs(curr.amount)
    const absDelta = Math.abs(delta)
    if (Math.abs(absDelta - absAmt) < 0.02) curr.amount = delta
  }

  return movements.filter((m) => m.description && !isNaN(m.amount) && m.amount !== 0)
}
