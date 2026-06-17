import { describe, it, expect } from 'vitest'
import { findBalanceInconsistencies } from './balance-consistency.js'
import type { PreviewMovement } from './balance-consistency.js'

function mov(overrides: Partial<PreviewMovement> & { row: number }): PreviewMovement {
  return { date: '2026-02-19', amount: 0, balanceAfter: 0, ...overrides }
}

describe('findBalanceInconsistencies', () => {
  it('returns no issues for empty list', () => {
    expect(findBalanceInconsistencies([])).toEqual([])
  })

  it('returns no issues for a single movement', () => {
    expect(findBalanceInconsistencies([mov({ row: 1, amount: 100, balanceAfter: 1100 })])).toEqual([])
  })

  it('returns no issues for a consistent chain already in order', () => {
    // 1000 → +100 → 1100 → -50 → 1050
    const issues = findBalanceInconsistencies([
      mov({ row: 1, amount: 100, balanceAfter: 1100 }),
      mov({ row: 2, amount: -50, balanceAfter: 1050 }),
    ])
    expect(issues).toEqual([])
  })

  it('returns no issues for same-day movements in newest-first file order (the false-positive bug)', () => {
    // Real chain (oldest→newest):
    //   9001.22 → +110.36 → 9111.58 → +25.00 → 9136.58 → -45.00 → 9091.58 → -1625.44 → 7466.14
    // File comes newest-first, so rows are reversed. The old sort-by-balance-before
    // heuristic mis-ordered these and produced phantom gaps.
    const issues = findBalanceInconsistencies([
      mov({ row: 1, amount: -1625.44, balanceAfter: 7466.14 }),
      mov({ row: 2, amount: -45.00, balanceAfter: 9091.58 }),
      mov({ row: 3, amount: 25.00, balanceAfter: 9136.58 }),
      mov({ row: 4, amount: 110.36, balanceAfter: 9111.58 }),
    ])
    expect(issues).toEqual([])
  })

  it('returns no issues when a balance level recurs within a day (newest-first file)', () => {
    // Chronological: 100 → +50 → 150 → -50 → 100 → +30 → 130
    // Balance 100 occurs twice (opening and after the -50). Linking by balance
    // collides on the repeated level and used to fall back to a broken sort.
    // File arrives newest-first.
    const issues = findBalanceInconsistencies([
      mov({ row: 1, amount: 30, balanceAfter: 130 }),
      mov({ row: 2, amount: -50, balanceAfter: 100 }),
      mov({ row: 3, amount: 50, balanceAfter: 150 }),
    ])
    expect(issues).toEqual([])
  })

  it('returns no issues for a real newest-first cluster with duplicate closing balances', () => {
    // From a real statement (2026-01-05). r239 and r242 both close at 6055.11.
    // Chronological reverse-of-file order chains cleanly.
    const issues = findBalanceInconsistencies([
      mov({ row: 239, amount: -50, balanceAfter: 6055.11 }),
      mov({ row: 240, amount: -49.2, balanceAfter: 6105.11 }),
      mov({ row: 241, amount: 99.2, balanceAfter: 6154.31 }),
      mov({ row: 242, amount: 99.2, balanceAfter: 6055.11 }),
    ])
    expect(issues).toEqual([])
  })

  it('returns no issues for a full real newest-first trading day (regression)', () => {
    // Real statement day 2026-01-05 (file order = newest-first). 30 movements,
    // many round amounts that revisit the same balance levels. This produced
    // 26 phantom gaps with the balance-linking reconstruction.
    const day: Array<[number, number, number]> = [
      [231, 26.28, 6137.53], [232, 56.28, 6111.25], [233, 99.2, 6054.97],
      [234, 100.66, 5955.77], [235, -50, 5855.11], [236, -50, 5905.11],
      [237, -50, 5955.11], [238, -50, 6005.11], [239, -50, 6055.11],
      [240, -49.2, 6105.11], [241, 99.2, 6154.31], [242, 99.2, 6055.11],
      [243, 97.74, 5955.91], [244, 97.74, 5858.17], [245, 99.2, 5760.43],
      [246, 92.2, 5661.23], [247, 97.74, 5569.03], [248, 23.36, 5471.29],
      [249, 99.2, 5447.93], [250, 110.2, 5348.73], [251, -5.89, 5238.53],
      [252, -23.11, 5244.42], [253, 23.36, 5267.53], [254, 46.72, 5244.17],
      [255, 114.74, 5197.45], [256, 97.74, 5082.71], [257, -108.33, 4984.97],
      [258, -19.86, 5093.3], [259, 200.94, 5113.16], [260, 97.74, 4912.22],
    ]
    const issues = findBalanceInconsistencies(
      day.map(([row, amount, balanceAfter]) => mov({ row, amount, balanceAfter })),
    )
    expect(issues).toEqual([])
  })

  it('returns no issues across days when the file is reversed but consistent', () => {
    // day1: 100 → +10 → 110 ; day2: 110 → +20 → 130
    const issues = findBalanceInconsistencies([
      mov({ row: 1, date: '2026-02-19', amount: 20, balanceAfter: 130 }),
      mov({ row: 2, date: '2026-02-18', amount: 10, balanceAfter: 110 }),
    ])
    expect(issues).toEqual([])
  })

  it('flags a genuine within-day inconsistency', () => {
    // 1000 → +100 → 1100, then a movement that does not continue the chain:
    // 1150 → +50 → 1200 (expected start 1100, got 1150)
    const issues = findBalanceInconsistencies([
      mov({ row: 1, amount: 100, balanceAfter: 1100 }),
      mov({ row: 2, amount: 50, balanceAfter: 1200 }),
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].row).toBe(2)
    expect(issues[0].field).toBe('Saldo pós movimento')
    expect(issues[0].message).toContain('1150.00')
    expect(issues[0].message).toContain('1200.00')
    expect(issues[0].message).toContain('-50.00')
  })

  it('flags a genuine cross-day boundary mismatch', () => {
    // day1 closes at 1100; day2 opens as if from 1150
    const issues = findBalanceInconsistencies([
      mov({ row: 1, date: '2026-02-18', amount: 100, balanceAfter: 1100 }),
      mov({ row: 2, date: '2026-02-19', amount: 50, balanceAfter: 1200 }),
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].row).toBe(2)
  })

  it('ignores rounding noise below one cent', () => {
    // 1000 → +0.005 → 1000.005 rounds away; chain still consistent within tolerance
    const issues = findBalanceInconsistencies([
      mov({ row: 1, amount: 100, balanceAfter: 1100.004 }),
      mov({ row: 2, amount: 50, balanceAfter: 1150.005 }),
    ])
    expect(issues).toEqual([])
  })

  it('does not crash and reports nothing when balances are absent', () => {
    const issues = findBalanceInconsistencies([
      mov({ row: 1, amount: 100, balanceAfter: null }),
      mov({ row: 2, amount: 50, balanceAfter: undefined }),
    ])
    expect(issues).toEqual([])
  })
})
