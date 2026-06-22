import { describe, it, expect, vi } from 'vitest'
import { TreasuryBudgetRulesService } from './budget-rules.service.js'

describe('budget-rules audit', () => {
  it('create regista budget.rule_add com a categoria', async () => {
    const create = vi.fn().mockResolvedValue({})
    const prisma = {
      treasuryBudget: { findFirst: vi.fn().mockResolvedValue({ id: 'b1', status: 'ACTIVE', type: 'EXPENSE' }) },
      treasuryCategory: { findFirst: vi.fn().mockResolvedValue({ id: 'cat1', name: 'Marketing', type: 'EXPENSE' }) },
      treasuryBudgetRule: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'r1', budgetId: 'b1' }),
      },
      treasuryAuditLog: { create },
    } as never
    const svc = new TreasuryBudgetRulesService(prisma)
    await svc.create('c1', 'u1', { budgetId: 'b1', categoryId: 'cat1', textPattern: 'Meo' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'budget.rule_add', entityType: 'Budget', entityId: 'b1', userId: 'u1', payload: expect.objectContaining({ categoryName: 'Marketing', textPattern: 'Meo' }) }),
    }))
  })

  it('delete regista budget.rule_remove', async () => {
    const create = vi.fn().mockResolvedValue({})
    const prisma = {
      treasuryBudgetRule: {
        findFirst: vi.fn().mockResolvedValue({ id: 'r1', budgetId: 'b1', textPattern: 'Meo', category: { name: 'Marketing' } }),
        delete: vi.fn().mockResolvedValue({}),
      },
      treasuryAuditLog: { create },
    } as never
    const svc = new TreasuryBudgetRulesService(prisma)
    await svc.delete('c1', 'u1', 'r1')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'budget.rule_remove', entityType: 'Budget', entityId: 'b1', userId: 'u1' }),
    }))
  })
})
