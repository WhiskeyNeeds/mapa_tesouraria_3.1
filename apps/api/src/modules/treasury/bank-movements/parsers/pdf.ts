import { createRequire } from 'node:module'
import type { ParsedMovement } from './utils.js'
import { parsePortugueseAmount, parseDateDMY } from './utils.js'
import type { SupportedBank } from './index.js'

// ── Amount helpers ────────────────────────────────────────────────────────────

/** Portuguese format: 1.234,56 or -1.234,56 (dot thousands, comma decimal) */
const PT_AMT_RE = /[-+]?\d{1,3}(?:\.\d{3})*,\d{2}/g

/** Space-thousands format used by BPI: 1 232,98 or -1 232,98 */
const SPACE_AMT_RE = /[-+]?\d{1,3}(?:\s\d{3})*,\d{2}/g

function parseSpaceAmt(s: string): number {
  return parseFloat(s.trim().replace(/\s/g, '').replace(',', '.'))
}

function parseAmt(s: string): number {
  const c = s.replace(/\s/g, '')
  return c.includes(',') ? parsePortugueseAmount(c) : parseFloat(c)
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseDateDDMM(ddmm: string, sep: '/' | '-', periodStart: string, periodEnd: string): string {
  const parts = ddmm.split(sep)
  if (parts.length !== 2) return ''
  const [dd, mm] = parts
  const month = parseInt(mm, 10)
  const startYear = parseInt(periodStart.slice(0, 4), 10)
  const endYear   = parseInt(periodEnd.slice(0, 4), 10)
  // For Dec→Jan spanning statements, dates whose month < period-start month belong to end year
  const year = (startYear !== endYear && month < parseInt(periodStart.slice(5, 7), 10))
    ? endYear
    : startYear
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function extractPeriod(text: string): { start: string; end: string } | null {
  // Santander: "PERÍODO DE 2026-01-31 A 2026-02-27"
  let m = text.match(/PER[IÍ]ODO\s+DE\s+(\d{4}-\d{2}-\d{2})\s+A\s+(\d{4}-\d{2}-\d{2})/i)
  if (m) return { start: m[1], end: m[2] }
  // BPI: "De 31/01/2026 a 27/02/2026"
  m = text.match(/\bDe\s+(\d{2})\/(\d{2})\/(\d{4})\s+a\s+(\d{2})\/(\d{2})\/(\d{4})/i)
  if (m) return { start: `${m[3]}-${m[2]}-${m[1]}`, end: `${m[6]}-${m[5]}-${m[4]}` }
  return null
}

// ── Santander PDF ─────────────────────────────────────────────────────────────
// Format (page 2 of Extrato Consolidado):
//   02-02 02-02 ORDENADO P/ JOANA CATARINA ... -1.580,77 6.062,34
//   Each line: DATE_MOV DATE_VAL DESCRIPTION SIGNED_AMOUNT UNSIGNED_BALANCE

function parseSantanderPDF(text: string, period: { start: string; end: string }): ParsedMovement[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  // Movement line starts with DD-MM DD-MM
  const LINE_RE = /^(\d{2}-\d{2})\s+(\d{2}-\d{2})\s+(.+?)\s+([-+]?\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/

  const results: ParsedMovement[] = []
  for (const line of lines) {
    const m = LINE_RE.exec(line)
    if (!m) continue
    const [, dateMov, dateVal, rawDesc, amtStr, balStr] = m
    const date        = parseDateDDMM(dateMov, '-', period.start, period.end)
    const bookingDate = parseDateDDMM(dateVal, '-', period.start, period.end)
    if (!date) continue
    const amount      = parsePortugueseAmount(amtStr)
    const balanceAfter = parsePortugueseAmount(balStr)
    if (isNaN(amount) || isNaN(balanceAfter)) continue
    results.push({
      date,
      bookingDate: bookingDate !== date ? bookingDate : undefined,
      description: rawDesc.replace(/\s{2,}/g, ' ').trim(),
      amount,
      balanceAfter,
    })
  }
  return results
}

// ── BPI PDF ───────────────────────────────────────────────────────────────────
// pdf-parse extracts BPI's 6-column layout (DATA MOV | DATA VAL | DESCRIÇÃO | MOEDA | VALOR | SALDO)
// column-by-column. Observed line types in the extracted text:
//   • Description lines  — DESCRIÇÃO column (may start with "DD/MM " purchase-date prefix)
//   • Signed numbers     — VALOR column: explicit +/- sign  e.g. "-1 232,98" / "+3 137,48"
//   • Unsigned numbers   — SALDO column: running balance    e.g. "44 919,61"
//   • Date-only lines    — DD/MM; first half = DATA MOV, second half = DATA VAL
// Strategy: separate VALOR (signed) from SALDO (unsigned) and use VALOR directly as amounts.

function parseBPIPDF(text: string, period: { start: string; end: string }): ParsedMovement[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l)

  const SKIP_RE = [
    /^(data\s+mov|data\s+val|descri[çc][aã]o(?:\s+do\s+movimento)?|moeda|valor|saldo|dep[oó]sitos?\s+[aà]\s+ordem|conta\s+valor|iban|nib|bpi\s+direto|banco\s+bpi|sede:|capital\s+social|extracto\s+de\s+conta|per[íi]odo|extracto|p[áa]g\.?\s*\d)/i,
    /^\d+\s*[\/|]\s*\d+$/,
    /^[-=*_]{3,}$/,
    /^(saldo\s+actual|saldo\s+anterior|saldo\s+disponivel|o\s+bpi\s+informa)/i,
    /^--\s*.+\s*--$/,        // page separators like "-- 2 of 2 --"
    /^(eur|usd|gbp|chf)$/i, // MOEDA column values
    /^(data|mov|val)$/i,     // lone column-header words that leak through
  ]

  // Signed standalone number → VALOR column (movement amount, always has explicit + or -)
  const VALOR_RE = /^([+-]\s*\d{1,3}(?:\s\d{3})*,\d{2})$/
  // Unsigned standalone number → SALDO column (running balance)
  const SALDO_RE = /^(\d{1,3}(?:\s\d{3})*,\d{2})$/
  const DATE_ONLY_RE = /^(\d{2}\/\d{2})$/

  // Extract initial balance from "SALDO ANTERIOR" line (used only in the delta fallback)
  let initialBalance: number | null = null
  for (const line of lines) {
    const m = line.match(/saldo\s+anterior\s+(?:contabilistico\s+)?([\d\s]+,\d{2})\s*$/i)
    if (m) { initialBalance = parseSpaceAmt(m[1]); break }
  }

  const descriptions: string[] = []
  const valors: number[] = []      // signed VALOR amounts
  const saldos: number[] = []      // unsigned SALDO running balances
  const rawDates: string[] = []

  for (const line of lines) {
    if (SKIP_RE.some((r) => r.test(line))) continue

    const vMatch = VALOR_RE.exec(line)
    if (vMatch) { valors.push(parseSpaceAmt(vMatch[1])); continue }

    const sMatch = SALDO_RE.exec(line)
    if (sMatch) { saldos.push(parseSpaceAmt(sMatch[1])); continue }

    const dMatch = DATE_ONLY_RE.exec(line)
    if (dMatch) { rawDates.push(dMatch[1]); continue }

    descriptions.push(line)
  }

  if (descriptions.length === 0) return []

  // Dates: first half = DATA MOV, second half = DATA VAL
  const half = Math.ceil(rawDates.length / 2)
  const movDates = rawDates.slice(0, half)
  const valDates = rawDates.slice(half)

  // Primary path: use signed VALOR values directly as amounts
  if (valors.length > 0) {
    // If saldos has more entries than valors, leading ones are period-start balances — skip them
    const saldoOff = Math.max(0, saldos.length - valors.length)
    const n = Math.min(descriptions.length, valors.length)
    const out: ParsedMovement[] = []

    for (let i = 0; i < n; i++) {
      const amount = valors[i]
      if (isNaN(amount) || amount === 0) continue

      const saldoIdx = saldoOff + i
      const balanceAfter = saldoIdx < saldos.length ? saldos[saldoIdx] : undefined

      const desc = descriptions[i].replace(/^\d{2}\/\d{2}\s+/, '').replace(/\s{2,}/g, ' ').trim()
      if (!desc) continue

      const date = movDates[i] ? parseDateDDMM(movDates[i], '/', period.start, period.end) : period.start
      const bookingDate = valDates[i] ? parseDateDDMM(valDates[i], '/', period.start, period.end) : undefined

      out.push({
        date,
        bookingDate: bookingDate && bookingDate !== date ? bookingDate : undefined,
        description: desc,
        amount,
        balanceAfter: balanceAfter != null && !isNaN(balanceAfter) ? balanceAfter : undefined,
      })
    }

    if (out.length > 0) return out
  }

  // Fallback: balance-delta derivation (for BPI variants without explicit VALOR signs)
  const allBalances = initialBalance != null ? [initialBalance, ...saldos] : saldos
  if (allBalances.length < 2) return []

  const n2 = Math.min(descriptions.length, allBalances.length - 1)
  const out2: ParsedMovement[] = []

  for (let i = 0; i < n2; i++) {
    const balBefore = allBalances[i]
    const balAfter  = allBalances[i + 1]
    const amount    = Math.round((balAfter - balBefore) * 100) / 100
    if (amount === 0) continue

    const desc = descriptions[i].replace(/^\d{2}\/\d{2}\s+/, '').replace(/\s{2,}/g, ' ').trim()
    if (!desc) continue

    const date = movDates[i] ? parseDateDDMM(movDates[i], '/', period.start, period.end) : period.start
    const bookingDate = valDates[i] ? parseDateDDMM(valDates[i], '/', period.start, period.end) : undefined

    out2.push({
      date,
      bookingDate: bookingDate && bookingDate !== date ? bookingDate : undefined,
      description: desc,
      amount,
      balanceAfter: balAfter,
    })
  }

  return out2
}

// ── Generic PDF parser (fallback) ─────────────────────────────────────────────
// Handles PDFs where each movement is on a single line starting with a full date
// (DD/MM/YYYY or DD-MM-YYYY) followed by description and amounts.

const FULL_DATE_RE = /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/g
const SKIP_LINES_RE = [
  /^(data|saldo|descri[çc]|movimen|lan[çc]am|d[eé]bito|cr[eé]dito|p[aá]g(ina)?|extrato|conta[:\s]|per[ií]odo|titular|n\.?[oº]\s*conta|iban|moeda)/i,
  /^\d+\s*[\/|]\s*\d+$/,
  /^[-=*_]{3,}$/,
  /^(millennium|bankinter|santander|caixa geral|bpi|novo banco)/i,
]

function parseGenericPDF(text: string): ParsedMovement[] {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim())

  const slashCount = rawLines.filter((l) => /^\d{2}\/\d{2}\/\d{4}/.test(l)).length
  const dashCount  = rawLines.filter((l) => /^\d{2}-\d{2}-\d{4}/.test(l)).length
  const sep = dashCount > slashCount ? '-' : '/'
  const DATE_START = sep === '-' ? /^\d{2}-\d{2}-\d{4}/ : /^\d{2}\/\d{2}\/\d{4}/

  const fullDoc = rawLines.join(' ')
  const hasSplitCols = /d[eé]bito/i.test(fullDoc) && /cr[eé]dito/i.test(fullDoc)

  const groups: string[][] = []
  let cur: string[] | null = null
  for (const line of rawLines) {
    if (!line) continue
    if (SKIP_LINES_RE.some((re) => re.test(line))) {
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
    const dateMatches = [...full.matchAll(FULL_DATE_RE)]
    if (!dateMatches.length) continue

    const date = parseDateDMY(dateMatches[0][1], dateMatches[0][1].includes('/') ? '/' : '-')
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const bookingDate = dateMatches[1]
      ? parseDateDMY(dateMatches[1][1], dateMatches[1][1].includes('/') ? '/' : '-')
      : undefined

    // Prefer PT-format amounts; fall back to plain decimal
    const ptAmts = [...full.matchAll(new RegExp(PT_AMT_RE.source, 'g'))].map((m) => m[0].replace(/\s/g, ''))
    const amounts = ptAmts.length > 0 ? ptAmts
      : [...full.matchAll(/[-+]?\d+\.\d{2}\b/g)].map((m) => m[0])

    if (!amounts.length) continue

    let amount: number
    let balanceAfter: number | undefined

    if (hasSplitCols && amounts.length === 3) {
      const debit  = parseAmt(amounts[0])
      const credit = parseAmt(amounts[1])
      balanceAfter = parseAmt(amounts[2])
      amount = credit > 0 && !isNaN(credit) ? credit : debit > 0 && !isNaN(debit) ? -debit : 0
    } else if (amounts.length >= 2) {
      amount       = parseAmt(amounts[amounts.length - 2])
      balanceAfter = parseAmt(amounts[amounts.length - 1])
    } else {
      amount = parseAmt(amounts[0])
    }

    if (isNaN(amount)) continue

    let desc = full
    for (const m of dateMatches) desc = desc.replace(m[0], '')
    for (const a of amounts) desc = desc.replace(a, '')
    desc = desc.replace(/\s{2,}/g, ' ').trim()
    if (!desc) desc = 'Movimento'

    movements.push({ date, bookingDate: bookingDate ?? undefined, description: desc, amount, balanceAfter })
  }

  // Balance-delta sign correction for split-column PDFs
  for (let i = 1; i < movements.length; i++) {
    const prev = movements[i - 1]
    const curr = movements[i]
    if (prev.balanceAfter == null || curr.balanceAfter == null) continue
    const delta  = Math.round((curr.balanceAfter - prev.balanceAfter) * 100) / 100
    const absAmt = Math.abs(curr.amount)
    if (Math.abs(Math.abs(delta) - absAmt) < 0.02) curr.amount = delta
  }

  return movements.filter((m) => m.description && !isNaN(m.amount) && m.amount !== 0)
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function parsePDF(buffer: Buffer, bank?: SupportedBank): Promise<ParsedMovement[]> {
  const req = createRequire(import.meta.url)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = req('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
  const { text } = await pdfParse(buffer)
  return extractMovementsFromText(text, bank)
}

function extractMovementsFromText(text: string, bank?: SupportedBank): ParsedMovement[] {
  const period = extractPeriod(text)
  const textLow = text.toLowerCase()

  // Santander PDF: "PERÍODO DE YYYY-MM-DD A YYYY-MM-DD" + "santander" in text
  const isSantander = bank === 'Santander'
    || (textLow.includes('santander') && /período de \d{4}-\d{2}-\d{2}/i.test(text))
  if (isSantander && period) {
    const r = parseSantanderPDF(text, period)
    if (r.length > 0) return r
  }

  // BPI PDF: "extracto de conta" + "bpi"
  const isBPI = bank === 'BPI'
    || (textLow.includes('bpi') && textLow.includes('extracto de conta'))
  if (isBPI && period) {
    const r = parseBPIPDF(text, period)
    if (r.length > 0) return r
  }

  // Generic fallback
  return parseGenericPDF(text)
}
