import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
    0: 'Rascunho', 1: 'Emitido', 2: 'Parcialmente pago', 3: 'Liquidado', 4: 'Anulado', 5: 'Comunicado',
    draft: 'Rascunho', issued: 'Emitido', partial: 'Parcialmente pago',
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

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    OPEN: 'Aberto', PARTIAL: 'Parcial', SETTLED: 'Liquidado', VOID: 'Anulado',
    UNCLASSIFIED: 'Por classificar', CLASSIFIED: 'Classificado', RECONCILED: 'Reconciliado',
    DRAFT: 'Rascunho', CONFIRMED: 'Confirmado', REVERSED: 'Estornado',
  }
  return map[status] ?? status
}

export function statusVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' | 'blue' {
  if (['SETTLED', 'CONFIRMED', 'RECONCILED', 'CLASSIFIED'].includes(status)) return 'green'
  if (['PARTIAL', 'DRAFT'].includes(status)) return 'yellow'
  if (['VOID', 'REVERSED'].includes(status)) return 'red'
  if (['OPEN', 'UNCLASSIFIED'].includes(status)) return 'blue'
  return 'gray'
}
