import { describe, it, expect, vi } from 'vitest'
import { TreasuryDunningRulesService } from './dunning-rules.service.js'

function makePrisma() {
  return {
    treasuryDunningTrack: {
      findFirst: vi.fn().mockResolvedValue({ id: 't1' }),
    },
    treasuryEmailTemplate: {
      findFirst: vi.fn().mockResolvedValue({ id: 'tpl1' }),
    },
    treasuryDunningRule: {
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'rule1', ...data })),
    },
  } as never
}

describe('create — validação por actionType', () => {
  it('rejeita TASK sem taskTitle', async () => {
    const svc = new TreasuryDunningRulesService(makePrisma())
    await expect(svc.create('c1', {
      trackId: 't1', name: 'Verificar banco', offsetDays: -2, actionType: 'TASK',
    })).rejects.toThrow(/[Tt]ítulo/)
  })

  it('rejeita EMAIL sem template', async () => {
    const svc = new TreasuryDunningRulesService(makePrisma())
    await expect(svc.create('c1', {
      trackId: 't1', name: 'Lembrete', offsetDays: -7, actionType: 'EMAIL',
    })).rejects.toThrow(/[Tt]emplate/)
  })

  it('cria uma regra TASK com taskTitle e sem template', async () => {
    const svc = new TreasuryDunningRulesService(makePrisma())
    const rule = await svc.create('c1', {
      trackId: 't1', name: 'Verificar banco', offsetDays: -2,
      actionType: 'TASK', taskTitle: 'Confirmar movimento no banco', taskImportance: 'HIGH',
    }) as Record<string, unknown>
    expect(rule.actionType).toBe('TASK')
    expect(rule.taskTitle).toBe('Confirmar movimento no banco')
    expect(rule.taskImportance).toBe('HIGH')
    expect(rule.emailTemplateId).toBeNull()
  })
})

describe('update — mudança de actionType', () => {
  function makeUpdatePrisma(rule: Record<string, unknown>) {
    return {
      treasuryDunningRule: {
        findFirst: vi.fn().mockResolvedValue(rule),
        update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...rule, ...data })),
      },
    } as never
  }

  it('muda EMAIL→TASK exige taskTitle e desliga o template', async () => {
    const prisma = makeUpdatePrisma({
      id: 'rule1', clientId: 'c1', trackId: 't1', actionType: 'EMAIL',
      taskTitle: null, emailTemplateId: 'tpl1',
    })
    const svc = new TreasuryDunningRulesService(prisma)

    await expect(svc.update('c1', 'rule1', { actionType: 'TASK' }))
      .rejects.toThrow(/[Tt]ítulo/)

    const ok = await svc.update('c1', 'rule1', { actionType: 'TASK', taskTitle: 'Verificar banco' }) as Record<string, unknown>
    expect(ok.actionType).toBe('TASK')
    expect(ok.taskTitle).toBe('Verificar banco')
  })
})
