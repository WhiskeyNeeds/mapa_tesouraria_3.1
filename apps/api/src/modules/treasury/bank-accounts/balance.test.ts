import { describe, it, expect } from 'vitest'
import { findDayTail, computeManualBalances, resolveAccountBalance } from './balance.js'
import type { MovementSnapshot } from './balance.js'

function d(date: string) { return new Date(date) }

function mov(overrides: Partial<MovementSnapshot> & { id: string }): MovementSnapshot {
  return { date: d('2026-01-01'), amount: 0, balanceAfter: null, source: 'CSV_IMPORT', ...overrides }
}

// ── findDayTail ───────────────────────────────────────────────────────────────

describe('findDayTail', () => {
  it('returns undefined for empty list', () => {
    expect(findDayTail([])).toBeUndefined()
  })

  it('returns single movement', () => {
    const m = mov({ id: 'a', amount: 100, balanceAfter: 1100 })
    expect(findDayTail([m])).toBe(m)
  })

  it('detects tail in a 3-movement chain', () => {
    // Chain: 1000 → +100 → 1100 → -50 → 1050 → +200 → 1250
    // tail is the one whose balanceAfter (1250) is not anyone's starting balance
    const a = mov({ id: 'a', amount: 100, balanceAfter: 1100 })  // start=1000
    const b = mov({ id: 'b', amount: -50, balanceAfter: 1050 })  // start=1100
    const c = mov({ id: 'c', amount: 200, balanceAfter: 1250 })  // start=1050 ← tail
    expect(findDayTail([a, b, c])?.id).toBe('c')
  })

  it('falls back to first element when chain is ambiguous', () => {
    // Two movements with same amount — impossible to detect tail reliably
    const a = mov({ id: 'a', amount: 100, balanceAfter: 1100 })
    const b = mov({ id: 'b', amount: 100, balanceAfter: 1200 })
    // 1100-100=1000, 1200-100=1100: 1100 IS a starting balance (=a.balanceAfter), so b is tail
    expect(findDayTail([a, b])?.id).toBe('b')
  })
})

// ── resolveAccountBalance ─────────────────────────────────────────────────────

describe('resolveAccountBalance', () => {
  it('returns openingBalance when no movements', () => {
    expect(resolveAccountBalance(1000, [])).toBe(1000)
  })

  it('anchors on last bank-verified balance', () => {
    const movements: MovementSnapshot[] = [
      mov({ id: 'a', date: d('2026-01-10'), amount: 100, balanceAfter: 1100, source: 'CSV_IMPORT' }),
      mov({ id: 'b', date: d('2026-01-15'), amount: -50, balanceAfter: 1050, source: 'CSV_IMPORT' }),
    ]
    expect(resolveAccountBalance(1000, movements)).toBe(1050)
  })

  it('adds manual amounts on top of chain balance', () => {
    const movements: MovementSnapshot[] = [
      mov({ id: 'a', date: d('2026-01-10'), amount: 100, balanceAfter: 1100, source: 'CSV_IMPORT' }),
      mov({ id: 'm', date: d('2026-01-11'), amount: 200, balanceAfter: null, source: 'MANUAL' }),
    ]
    expect(resolveAccountBalance(1000, movements)).toBe(1300)
  })

  it('ignores manual movements as chain anchors', () => {
    // Even if MANUAL has a balanceAfter computed, it must not be used as chain anchor
    const movements: MovementSnapshot[] = [
      mov({ id: 'a', date: d('2026-01-10'), amount: 100, balanceAfter: 1100, source: 'CSV_IMPORT' }),
      mov({ id: 'm', date: d('2026-01-11'), amount: 50, balanceAfter: 1150, source: 'MANUAL' }),
      mov({ id: 'b', date: d('2026-01-15'), amount: 200, balanceAfter: 1300, source: 'CSV_IMPORT' }),
    ]
    // Chain anchor = 1300 (last imported), manual sum = 50 → total = 1350
    expect(resolveAccountBalance(1000, movements)).toBe(1350)
  })
})

// ── computeManualBalances ─────────────────────────────────────────────────────

describe('computeManualBalances', () => {
  it('returns empty array when no manual movements', () => {
    const movements = [
      mov({ id: 'a', date: d('2026-01-10'), amount: 100, balanceAfter: 1100, source: 'CSV_IMPORT' }),
    ]
    expect(computeManualBalances(1000, movements)).toEqual([])
  })

  it('assigns balanceAfter = bankAnchor + manualAmount for single manual', () => {
    const movements: MovementSnapshot[] = [
      mov({ id: 'a', date: d('2026-01-10'), amount: 100, balanceAfter: 1100, source: 'CSV_IMPORT' }),
      mov({ id: 'm', date: d('2026-01-11'), amount: 200, balanceAfter: null, source: 'MANUAL' }),
    ]
    const result = computeManualBalances(1000, movements)
    expect(result).toEqual([{ id: 'm', balanceAfter: 1300 }])
  })

  it('accumulates manual amounts across days without resetting', () => {
    // Day 10: bank ends at 1100. Manual +200 → 1300.
    // Day 15: bank ends at 1400. Manual +50 → 1450 (1400 + 200 + 50 = 1650? No.)
    // Actually: bankRunning resets to 1400, but manualCumulative stays at 200.
    // Second manual on day 15: manualCumulative = 200 + 50 = 250 → balanceAfter = 1400 + 250 = 1650
    const movements: MovementSnapshot[] = [
      mov({ id: 'a', date: d('2026-01-10'), amount: 100, balanceAfter: 1100, source: 'CSV_IMPORT' }),
      mov({ id: 'm1', date: d('2026-01-11'), amount: 200, balanceAfter: null, source: 'MANUAL' }),
      mov({ id: 'b', date: d('2026-01-15'), amount: 300, balanceAfter: 1400, source: 'CSV_IMPORT' }),
      mov({ id: 'm2', date: d('2026-01-16'), amount: 50, balanceAfter: null, source: 'MANUAL' }),
    ]
    const result = computeManualBalances(1000, movements)
    expect(result.find((r) => r.id === 'm1')?.balanceAfter).toBe(1300)  // 1100 + 200
    expect(result.find((r) => r.id === 'm2')?.balanceAfter).toBe(1650)  // 1400 + 200 + 50
  })

  it('uses tail detection to find correct bank anchor for CGD-style imports', () => {
    // CGD exports newest-first → chain members have reversed createdAt
    // Chain: 9001.22 → +100 → 9101.22; the "tail" is the movement ending at 9101.22
    // A manual movement of +100 on the same day should be based on tail (9101.22)
    const a = mov({ id: 'tfi', date: d('2026-02-18'), amount: 105.98, balanceAfter: 9001.22, source: 'CSV_IMPORT' })
    const b = mov({ id: 'compra', date: d('2026-02-18'), amount: -88.76, balanceAfter: 8895.24, source: 'CSV_IMPORT' })
    // tail detection: starting balances = { 9001.22-105.98=8895.24, 8895.24-(-88.76)=8984 }
    // b.balanceAfter=8895.24 IS in startingBalances (a's start) → not tail
    // a.balanceAfter=9001.22 → not in startingBalances → a is tail
    const manual = mov({ id: 'manual', date: d('2026-02-18'), amount: 100, balanceAfter: null, source: 'MANUAL' })
    const result = computeManualBalances(8000, [a, b, manual])
    // tail = a (balanceAfter=9001.22), manual = 100 → 9101.22
    expect(result.find((r) => r.id === 'manual')?.balanceAfter).toBeCloseTo(9101.22, 2)
  })
})
