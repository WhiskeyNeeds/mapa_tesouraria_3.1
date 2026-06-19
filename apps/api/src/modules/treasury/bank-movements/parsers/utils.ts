import XLSX from 'xlsx'
import type { CsvMovement } from '../bank-movements.service.js'

export type ParsedMovement = CsvMovement

/** Read the first worksheet as an array-of-arrays, dropping blank rows. */
export function readSheetRows(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', blankrows: false, raw: true }) as unknown[][]
}

const normalizeCell = (v: unknown) =>
  String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/**
 * Find the data-header row index by locating the first row that contains ALL the
 * given keywords. Returns -1 if none match. This makes parsers resilient to the
 * variable number of metadata/blank rows banks place above the table (dropping
 * blank rows shifts a hardcoded index and silently loses movements).
 */
export function findHeaderRow(rows: unknown[][], keywords: string[], limit = 50): number {
  const kws = keywords.map(normalizeCell)
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const cells = (rows[i] ?? []).map(normalizeCell)
    if (kws.every((k) => cells.some((c) => c.includes(k)))) return i
  }
  return -1
}

export function parsePortugueseAmount(s: string): number {
  return parseFloat(s.trim().replace(/\./g, '').replace(',', '.'))
}

export function parseDotDecimalAmount(s: string): number {
  return parseFloat(s.trim().replace(/,/g, ''))
}

export function parseDateDMY(s: string, sep: '/' | '-' = '-'): string {
  const parts = s.trim().split(sep)
  if (parts.length !== 3) return s
  const [d, m, y] = parts
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function cellToDate(val: unknown): string {
  if (val instanceof Date) {
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, '0')
    const d = String(val.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof val === 'string' && val.trim()) {
    const s = val.trim()
    if (s.includes('/')) return parseDateDMY(s, '/')
    return parseDateDMY(s, '-')
  }
  return ''
}

export function cellToAmount(val: unknown, format: 'pt' | 'dot' | 'plain' = 'plain'): number {
  if (typeof val === 'number') return val
  if (typeof val === 'string' && val.trim()) {
    const s = val.trim()
    if (format === 'pt') return parsePortugueseAmount(s)
    if (format === 'dot') return parseDotDecimalAmount(s)
    return parseFloat(s)
  }
  return 0
}

export function cellToString(val: unknown): string {
  if (val == null) return ''
  return String(val).trim()
}
