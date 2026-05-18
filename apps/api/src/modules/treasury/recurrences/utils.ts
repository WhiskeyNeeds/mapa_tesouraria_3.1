import type { TreasuryRecurrenceFrequency } from '@prisma/client'

export function computeNextDate(current: Date, frequency: TreasuryRecurrenceFrequency): Date {
  const d = new Date(current)
  switch (frequency) {
    case 'DAILY':      d.setDate(d.getDate() + 1); break
    case 'WEEKLY':     d.setDate(d.getDate() + 7); break
    case 'MONTHLY':    d.setMonth(d.getMonth() + 1); break
    case 'QUARTERLY':  d.setMonth(d.getMonth() + 3); break
    case 'SEMIANNUAL': d.setMonth(d.getMonth() + 6); break
    case 'ANNUAL':     d.setFullYear(d.getFullYear() + 1); break
    case 'CUSTOM':     d.setMonth(d.getMonth() + 1); break
  }
  return d
}
