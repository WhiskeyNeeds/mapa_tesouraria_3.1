import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number, currency = 'EUR'): string {
  const parts = new Intl.NumberFormat('pt-PT', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(Number(value))
  return parts.map((p) => (p.type === 'group' ? '\u00A0' : p.value)).join('')
}

export function formatDate(date: string | Date, fmt = 'dd/MM/yyyy'): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, fmt, { locale: pt })
}

export function formatDatetime(date: string | Date): string {
  return formatDate(date, 'dd/MM/yyyy HH:mm')
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
