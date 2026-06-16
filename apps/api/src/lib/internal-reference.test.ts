import { describe, it, expect } from 'vitest'
import { computeNextInternalReference } from './internal-reference.js'

describe('computeNextInternalReference', () => {
  it('começa em 1 quando não há referências do ano', () => {
    expect(computeNextInternalReference([], 2026)).toBe('INT 2026/1')
  })

  it('incrementa a partir do maior número existente do ano', () => {
    expect(computeNextInternalReference(['INT 2026/1', 'INT 2026/2', 'INT 2026/3'], 2026)).toBe('INT 2026/4')
  })

  it('usa o maior, não a contagem (resiste a buracos por eliminação)', () => {
    expect(computeNextInternalReference(['INT 2026/1', 'INT 2026/5'], 2026)).toBe('INT 2026/6')
  })

  it('ignora referências de outros anos e formatos não-INT', () => {
    expect(computeNextInternalReference(['INT 2025/9', 'FT 2026/3', 'OP-abc', null, 'INT 2026/2'], 2026)).toBe('INT 2026/3')
  })
})
