import type { CsvMovement } from '../bank-movements.service.js'

export type ParsedMovement = CsvMovement

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
  if (val instanceof Date) return val.toISOString().substring(0, 10)
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
