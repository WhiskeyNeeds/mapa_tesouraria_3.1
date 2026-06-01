import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Builds a lex-sortable key from a document reference. Extracts the 4-digit year
// and the trailing sequence number (after "/") so refs sort by year first and
// then numerically within the year — "FT 2024/9" < "FT 2024/10" < "FT 2025/1".
// Falls back to a lowercased version of the input when the pattern doesn't match.
export function refSortKey(ref: string | null | undefined): string {
  const s = ref ?? ''
  const m = s.match(/(\d{4})\D+(\d+)(?!.*\d)/)
  if (m) return `${m[1]}-${m[2].padStart(12, '0')}`
  return s.toLowerCase()
}

// Returns true when the given YYYY-MM-DD string falls on Saturday or Sunday.
// Empty/invalid strings are treated as non-weekend so they don't trip validation.
export function isWeekend(ymd: string): boolean {
  if (!ymd || ymd.length < 10) return false
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return false
  const day = new Date(y, m - 1, d).getDay()
  return day === 0 || day === 6
}

// Advances a YYYY-MM-DD string to the next Monday if it falls on a Saturday or Sunday.
// Returns the input unchanged when it's already a workday or invalid.
export function shiftToWorkday(ymd: string): string {
  if (!ymd || ymd.length < 10) return ymd
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ymd
  const date = new Date(y, m - 1, d)
  const day = date.getDay()
  if (day === 6) date.setDate(date.getDate() + 2) // Sat -> Mon
  else if (day === 0) date.setDate(date.getDate() + 1) // Sun -> Mon
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatCurrency(value: number, currency = 'EUR'): string {
  const parts = new Intl.NumberFormat('pt-PT', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).formatToParts(Number(value))
  return parts.map((p) => (p.type === 'group' ? '\u202F' : p.value)).join('')
}

export function formatDate(date: string | Date, fmt = 'dd/MM/yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, fmt, { locale: pt })
}

export function formatDatetime(date: string | Date): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm')
}

export function formatDateRelative(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'hoje'
  if (diffDays === 1) return 'ontem'
  if (diffDays <= 6) return `há ${diffDays} dias`
  return format(d, 'dd/MM/yyyy', { locale: pt })
}

export function tocStatusLabel(status: unknown): string {
  const map: Record<string | number, string> = {
    0: 'Rascunho', 1: 'Emitido', 2: 'Parcialmente liquidado', 3: 'Liquidado', 4: 'Anulado', 5: 'Comunicado',
    draft: 'Rascunho', issued: 'Emitido', partial: 'Parcialmente liquidado',
    settled: 'Liquidado', paid: 'Pago', cancelled: 'Anulado', voided: 'Anulado',
  }
  if (status == null) return '—'
  const key = typeof status === 'string' ? status.toLowerCase() : Number(status)
  return map[key] ?? String(status)
}

export function tocStatusVariant(status: unknown): 'green' | 'yellow' | 'red' | 'gray' | 'blue' {
  const n = Number(status)
  if (n === 3 || n === 2) return 'green'
  if (n === 1 || n === 5) return 'blue'
  if (n === 4) return 'red'
  if (typeof status === 'string') {
    const s = status.toLowerCase()
    if (['settled', 'paid', 'partial'].includes(s)) return 'green'
    if (['issued'].includes(s)) return 'blue'
    if (['cancelled', 'voided'].includes(s)) return 'red'
    if (['draft'].includes(s)) return 'gray'
  }
  return 'gray'
}

// `settledInToc` distingue a origem do estado SETTLED: liquidado no próprio
// TOConline → "Liquidado"; liquidado localmente nesta plataforma → "Pago".
// Default `true` preserva "Liquidado" para todos os callers que não passam o
// flag (movimentos, reconciliação, documentos vindos do TOC).
export function statusLabel(status: string, settledInToc = true): string {
  const map: Record<string, string> = {
    OPEN: 'Emitido', PARTIAL: 'Parcialmente liquidado', SETTLED: 'Liquidado', VOID: 'Anulado',
    UNCLASSIFIED: 'Por classificar', CLASSIFIED: 'Classificado', RECONCILED: 'Reconciliado',
    DRAFT: 'Rascunho', CONFIRMED: 'Confirmado', REVERSED: 'Estornado',
  }
  if (status === 'SETTLED' && !settledInToc) return 'Pago'
  return map[status] ?? status
}

export function statusVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' | 'blue' {
  if (['SETTLED', 'CONFIRMED', 'RECONCILED', 'CLASSIFIED'].includes(status)) return 'green'
  if (['PARTIAL', 'DRAFT'].includes(status)) return 'yellow'
  if (['VOID', 'REVERSED'].includes(status)) return 'red'
  if (['OPEN', 'UNCLASSIFIED'].includes(status)) return 'blue'
  return 'gray'
}
