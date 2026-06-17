export interface PreviewMovement {
  /** ISO day, 'YYYY-MM-DD'. Authoritative for ordering across days. */
  date: string
  amount: number
  balanceAfter?: number | null
  /** 1-based file row, used to point the user at the offending line. */
  row: number
}

export interface BalanceIssue {
  row: number
  field: string
  message: string
}

/** Difference between a movement's expected and actual closing balance, in euros. */
function gapAt(prev: PreviewMovement, curr: PreviewMovement): number {
  const calculated = Math.round((Number(prev.balanceAfter) + curr.amount) * 100) / 100
  const actual = Math.round(Number(curr.balanceAfter) * 100) / 100
  return Math.round((calculated - actual) * 100) / 100
}

/** Counts consecutive pairs in a sequence whose balances do not chain. */
function brokenLinks(seq: PreviewMovement[]): number {
  let broken = 0
  for (let i = 1; i < seq.length; i++) {
    if (Math.abs(gapAt(seq[i - 1], seq[i])) > 0.01) broken++
  }
  return broken
}

/**
 * Returns a day's movements in chronological order.
 *
 * Bank statements carry only a date (no time), but the file itself is already
 * ordered chronologically within each day — just possibly newest-first
 * (exports commonly are). Rather than reconstruct the order by linking
 * balances (which is ambiguous whenever a balance level recurs within the day,
 * e.g. round-number deposits/withdrawals that return to a previous balance),
 * we simply keep the file order and pick the direction — as-is or reversed —
 * that chains with fewer broken links. This is immune to repeated balances.
 */
function orientDay(dayMovs: PreviewMovement[]): PreviewMovement[] {
  if (dayMovs.length <= 1) return dayMovs
  const reversed = [...dayMovs].reverse()
  return brokenLinks(reversed) < brokenLinks(dayMovs) ? reversed : dayMovs
}

/**
 * Detects balance discontinuities in a parsed bank statement, ignoring the
 * file's within-day ordering direction. Days are walked in date order, each
 * day's movements oriented chronologically, and consecutive pairs checked:
 * closing balance + next amount must equal the next closing balance (within
 * one cent). Day boundaries are validated by the same pairwise walk.
 *
 * Movements without a balance are skipped (they cannot be chained).
 */
export function findBalanceInconsistencies(movements: PreviewMovement[]): BalanceIssue[] {
  const withBalance = movements.filter(
    (m) => m.balanceAfter != null && !isNaN(m.balanceAfter),
  )
  if (withBalance.length < 2) return []

  // Group by day, preserving file order within each day (Map keeps insertion order).
  const byDay = new Map<string, PreviewMovement[]>()
  for (const m of withBalance) {
    if (!byDay.has(m.date)) byDay.set(m.date, [])
    byDay.get(m.date)!.push(m)
  }
  const ordered = [...byDay.keys()]
    .sort((a, b) => a.localeCompare(b))
    .flatMap((day) => orientDay(byDay.get(day)!))

  const issues: BalanceIssue[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const curr = ordered[i]
    const gap = gapAt(prev, curr)
    if (Math.abs(gap) > 0.01) {
      const calculated = Math.round((Number(prev.balanceAfter) + curr.amount) * 100) / 100
      const actual = Math.round(Number(curr.balanceAfter) * 100) / 100
      issues.push({
        row: curr.row,
        field: 'Saldo pós movimento',
        message: `Saldo inconsistente: esperado ${calculated.toFixed(2)} €, tem ${actual.toFixed(2)} € (diferença: ${gap > 0 ? '+' : ''}${gap.toFixed(2)} €)`,
      })
    }
  }
  return issues
}
