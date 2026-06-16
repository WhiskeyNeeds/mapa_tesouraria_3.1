import { describe, it, expect } from 'vitest'
import { earliestPendingDueAt } from './pending-action.js'

describe('earliestPendingDueAt', () => {
  it('devolve o dueAt mais antigo (ISO) por documento', () => {
    const map = earliestPendingDueAt([
      { docId: 'a', dueAt: new Date('2026-06-20T00:00:00Z') },
      { docId: 'a', dueAt: new Date('2026-06-18T00:00:00Z') },
      { docId: 'b', dueAt: new Date('2026-06-25T00:00:00Z') },
    ])
    expect(map.get('a')).toBe('2026-06-18T00:00:00.000Z')
    expect(map.get('b')).toBe('2026-06-25T00:00:00.000Z')
  })

  it('ignora tarefas sem docId ou sem dueAt', () => {
    const map = earliestPendingDueAt([
      { docId: null, dueAt: new Date('2026-06-18T00:00:00Z') },
      { docId: 'c', dueAt: null },
    ])
    expect(map.size).toBe(0)
  })

  it('devolve mapa vazio para input vazio', () => {
    expect(earliestPendingDueAt([]).size).toBe(0)
  })
})
