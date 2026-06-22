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
// Format (page 2 of Extrato Consolidado). NOTE: pdf-parse glues the columns
// together with NO whitespace — both dates run together, and the amount+balance
// are stuck to the description:
//   "02-0202-02ORDENADO ... FR-E1241422-1.580,776.062,34"
//   layout: DATE_MOV DATE_VAL | description | SIGNED_AMOUNT | UNSIGNED_BALANCE
//
// Because reference numbers can be glued directly to the amount
// (e.g. "...MYLAN-28652188811.229,16"), the amount cannot be parsed reliably by
// lexing alone. The running balance (which always ends the line) is the source of
// truth, so each amount is derived as the delta vs. the previous balance — the same
// strategy used by the BPI PDF parser.

/** Portuguese amount token: 1.234,56 / -1.234,56 (dot thousands, comma decimal) */
const PT_TOKEN = /[-+]?\d{1,3}(?:\.\d{3})*,\d{2}/
/** Two glued dates at the start of a movement line: "02-0202-02" */
const SANTANDER_HEAD = /^(\d{2}-\d{2})(\d{2}-\d{2})(.*)$/

function findInitialBalance(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    if (!/saldo\s*inicial/i.test(lines[i])) continue
    // Number may be on the same line or a following one ("Saldo InicialEUR" / "7.643,11")
    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
      const m = lines[j].match(PT_TOKEN)
      if (m) return parsePortugueseAmount(m[0])
    }
    return null
  }
  return null
}

function parseSantanderPDF(text: string, period: { start: string; end: string }): ParsedMovement[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim())

  let prevBalance = findInitialBalance(lines)
  if (prevBalance === null) return []

  const results: ParsedMovement[] = []
  for (const line of lines) {
    const head = SANTANDER_HEAD.exec(line)
    if (!head) continue
    const [, dateMov, dateVal, rest] = head

    // First PT token closes the amount; the trailing PT token is the running balance.
    const amtMatch = rest.match(PT_TOKEN)
    if (!amtMatch || amtMatch.index === undefined) continue
    const afterAmt = rest.slice(amtMatch.index + amtMatch[0].length)
    const balMatch = afterAmt.match(PT_TOKEN)
    if (!balMatch) continue

    const balanceAfter = parsePortugueseAmount(balMatch[0])
    if (isNaN(balanceAfter)) continue

    const date = parseDateDDMM(dateMov, '-', period.start, period.end)
    if (!date) continue
    const bookingDate = parseDateDDMM(dateVal, '-', period.start, period.end)

    // Amount derived from the balance delta (authoritative, sign-safe).
    const amount = Math.round((balanceAfter - prevBalance) * 100) / 100
    const description = rest.slice(0, amtMatch.index).replace(/\s{2,}/g, ' ').trim()

    results.push({
      date,
      bookingDate: bookingDate && bookingDate !== date ? bookingDate : undefined,
      description: description || 'Movimento',
      amount,
      balanceAfter,
    })
    prevBalance = balanceAfter
  }
  return results
}

// ── BPI PDF ───────────────────────────────────────────────────────────────────
// BPI "Extracto de Conta" has 6 columns: DATA MOV | DATA VAL | DESCRIÇÃO | MOEDA | VALOR | SALDO
//
// Two extraction strategies depending on how pdf-parse reads the PDF:
//   A) Row-based: each movement appears as one line with both dates + description + amount + balance
//   B) Column-based: all DATA MOV dates, then all DATA VAL dates, then all descriptions,
//      then all VALOR values, then all SALDO values (pdf-parse column-stream order)
//
// Key fixes vs prior version:
//   • Credit VALOR amounts have no + sign (e.g. "3 137,48") — cannot rely on sign for detection
//   • Use running-balance constraint (initBal + valor = saldo) to distinguish VALOR from SALDO
//   • Extended SKIP set covers BPI header noise: company name, address, postal codes, PI ref lines

function parseBPIPDF(text: string, period: { start: string; end: string }): ParsedMovement[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // ── Strategy A: Row-based ─────────────────────────────────────────────────────
  // Pattern per line: DD/MM  DD/MM  <description>  [-]amount  balance
  const ROW_RE = /^(\d{2}\/\d{2})\s+(\d{2}\/\d{2})\s+(.+?)\s+(-?\d{1,3}(?:\s\d{3})*,\d{2})\s+(\d{1,3}(?:\s\d{3})*,\d{2})$/
  const rowOut: ParsedMovement[] = []
  for (const line of lines) {
    const m = ROW_RE.exec(line)
    if (!m) continue
    const date   = parseDateDDMM(m[1], '/', period.start, period.end)
    const bd     = parseDateDDMM(m[2], '/', period.start, period.end)
    const amount = parseSpaceAmt(m[4])
    const bal    = parseSpaceAmt(m[5])
    if (!date || isNaN(amount) || isNaN(bal) || amount === 0) continue
    const desc = m[3].replace(/^\d{2}\/\d{2}\s+/, '').replace(/\s{2,}/g, ' ').trim()
    if (!desc) continue
    rowOut.push({ date, bookingDate: bd !== date ? bd : undefined, description: desc, amount, balanceAfter: bal })
  }
  if (rowOut.length >= 3) return rowOut

  // ── Strategy B: Column-streamed ───────────────────────────────────────────────
  // pdf-parse emits the movement table as separate column streams, NOT as rows.
  // Per page the tokens arrive in distinct blocks, always in this order:
  //   descriptions… → saldos… → dates… → valores…
  // followed by the next page's descriptions, and so on. So each movement's amount
  // is its own VALOR (sign-safe: debits carry "-", credits none) and the running
  // balance is the printed SALDO — both read directly, never inferred by lexing.
  // A small state machine segments the stream per page; then we pair
  // description[i] ↔ valor[i] ↔ saldo[i].
  const SKIP_RES = [
    // Table column headers
    /^(data\s*(mov|val)?|descri[çc][aã]o(\s+do\s+movimento)?|moeda|valor|saldo)$/i,
    // BPI document structure
    /^dep[oó]sitos?\s+[aà]\s+ordem/i,
    /^conta\s+valor\s+bpi/i,
    /^(iban|nib)[\s:]/i,
    /^bpi\s+(direto|directo)/i,
    /^(banco\s+bpi|sede:|capital\s+social)/i,
    /^(extracto(\s+de\s+conta)?|per[íi]odo)/i,
    /^p[áa]g\.?\s*\d/i,
    /^\d+\s*[\/|]\s*\d+$/,   // page refs "1/2", "Pág. 2/2"
    /^[-=*_]{3,}$/,
    // Summary lines
    /^(saldo\s+actual|saldo\s+anterior|saldo\s+disponivel)/i,
    // Footer legal text
    /^o\s+bpi\s+informa/i,
    /^(informa-?se|taxa\s+anual|preç[aã]rio|facilidade\s+de\s+descoberto|taeg)/i,
    /^(correspondendo|qualquer\s+exemplo|mantêm-?se|considerado)/i,
    // Standalone currency codes (MOEDA column)
    /^(eur|usd|gbp|chf)$/i,
    // Lone column-header words
    /^(mov|val|data)$/i,
    // BPI-specific reference lines
    /^pi\s+\d+/i,               // "PI 00231 EX 000001 2623985502"
    /^\d-\d{7}-\d{3}-\d{3}$/,  // account number "9-5697074-000-001"
    /^\d{3}\/\d{4}$/,           // extract sequence "002/2026"
    // Address / company header area
    /^\d{4}\s*-\s*\d{3}/,       // postal code "4470 - 157 MAIA"
    /^(partic\b|rua\s|av(enida)?\s)/i,
  ]

  const NUM_RE  = /^-?\s*\d{1,3}(?:\s\d{3})*,\d{2}$/   // standalone space-thousands amount
  const DATE_RE = /^\d{2}\/\d{2}$/

  type Page = { descs: string[]; saldos: number[]; dates: string[]; valores: number[] }
  const pages: Page[] = []
  let cur: Page | null = null
  let phase: 'desc' | 'saldo' | 'date' | 'valor' = 'desc'
  let started = false
  const newPage = (): Page => { const p: Page = { descs: [], saldos: [], dates: [], valores: [] }; pages.push(p); return p }

  for (const line of lines) {
    if (!started) {
      // Discard the whole document header until the opening-balance marker.
      if (/saldo\s+anterior/i.test(line)) { started = true; cur = newPage(); phase = 'desc' }
      continue
    }
    // Classify numbers and dates BEFORE skip rules: a DD/MM date ("02/02") also
    // matches the page-ref skip pattern ("1/2"), so it must be recognised first.
    if (NUM_RE.test(line)) {
      const v = parseSpaceAmt(line)
      if (phase === 'desc' || phase === 'saldo') { phase = 'saldo'; cur!.saldos.push(v) }
      else { phase = 'valor'; cur!.valores.push(v) }   // first number after the dates → VALOR block
    } else if (DATE_RE.test(line)) {
      if (phase !== 'valor') { phase = 'date'; cur!.dates.push(line) }
    } else if (SKIP_RES.some((r) => r.test(line))) {
      continue
    } else {
      // Free text. A description block following the VALOR block means a new page.
      if (phase === 'valor') { cur = newPage(); phase = 'desc'; cur.descs.push(line) }
      else if (phase === 'desc') { cur!.descs.push(line) }
      // Text seen mid saldo/date block is interleaved noise → ignore.
    }
  }

  if (!pages.length) return []

  // Opening balance: prefer it inline ("SALDO ANTERIOR … 44 919,61"); otherwise it
  // is the first saldo token of page 1.
  let inlineOpen: number | null = null
  for (const line of lines) {
    const m = line.match(/saldo\s+anterior\s+(?:contabilistico\s+)?(-?\d[\d\s]*,\d{2})\s*$/i)
    if (m) { inlineOpen = parseSpaceAmt(m[1]); break }
  }

  const out: ParsedMovement[] = []
  let opening = inlineOpen ?? pages[0].saldos[0] ?? 0

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p]
    const n = page.valores.length
    if (n === 0) continue
    // On page 1 the saldo block leads with the opening balance (unless it was inline).
    const afterBalances = (p === 0 && inlineOpen === null) ? page.saldos.slice(1) : page.saldos
    // Value dates are the last n entries of the date block; the sparser leading
    // entries are the DATA MOV column (only printed for some movements).
    const valDates = page.dates.slice(-n)

    let prev = opening
    for (let i = 0; i < n; i++) {
      const amount = page.valores[i]
      const desc = page.descs[i]
      if (desc === undefined) break
      // Printed SALDO is authoritative; fall back to the running sum if a balance
      // token is missing so the chain stays usable.
      const expected = Math.round((prev + amount) * 100) / 100
      const balanceAfter = afterBalances[i] != null ? afterBalances[i] : expected

      // The running balance is ordered by VALUE date, and the whole balance
      // subsystem (consistency checks, day-grouped chaining) keys off `date` — so
      // `date` MUST be the value date. Card-purchase descriptions also carry an
      // earlier operation date ("02/02 COMPRA …"); keep it in bookingDate (it is
      // stored but not shown) and strip it from the description.
      const valDate = valDates[i] ? parseDateDDMM(valDates[i], '/', period.start, period.end) : ''
      const date = valDate || period.start
      const movMatch = desc.match(/^(\d{2})\/(\d{2})\b/)
      const opDate = movMatch ? parseDateDDMM(`${movMatch[1]}/${movMatch[2]}`, '/', period.start, period.end) : ''
      const bookingDate = opDate && opDate !== date ? opDate : undefined
      const cleanDesc = desc.replace(/^\d{2}\/\d{2}\s+/, '').replace(/\s{2,}/g, ' ').trim()
      if (cleanDesc) out.push({ date, bookingDate, description: cleanDesc, amount, balanceAfter })
      prev = balanceAfter
    }
    opening = prev
  }

  return out
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

export function extractMovementsFromText(text: string, bank?: SupportedBank): ParsedMovement[] {
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
