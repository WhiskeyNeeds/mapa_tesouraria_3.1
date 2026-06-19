import { describe, it, expect, vi } from 'vitest'
import { TreasuryDunningRulesService } from './dunning-rules.service.js'
import type { FollowupsService } from '../followups/followups.service.js'
import type { ToconlineService } from '../../toconline/toconline.service.js'

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

describe('execute — ramo TASK/CALL', () => {
  function makeEngine(opts: { actionType: 'EMAIL' | 'TASK' | 'CALL'; existingExec?: Record<string, unknown> | null }) {
    const rule = {
      id: 'rule1', clientId: 'c1', trackId: 't1', name: 'R', offsetDays: -2,
      direction: 'RECEIVABLE', actionType: opts.actionType,
      taskTitle: 'Verificar banco', taskDescription: null, taskImportance: 'NORMAL',
      emailTemplate: opts.actionType === 'EMAIL'
        ? { id: 'tpl1', name: 'Tom amigável', subject: 'S', bodyHtml: '<p>B</p>' }
        : null,
      minAmount: null, maxAmount: null, categoryId: null,
      track: { id: 't1', name: 'Régua', isDefault: true },
    }
    const inv = {
      id: 'r1', reference: 'INT2026/1', entityName: 'ACME', totalAmount: { toString: () => '100' },
      promisedPaymentDate: new Date('2026-06-18'), pendingAmount: { toString: () => '100' }, tocCustomerId: 'cust1',
    }
    const execUpdate = vi.fn().mockResolvedValue({ id: 'exec1' })
    const prisma = {
      treasuryDunningRule: {
        findMany: vi.fn().mockResolvedValue([rule]),
        update: vi.fn().mockResolvedValue({}),
      },
      treasuryDunningTrackAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      treasuryDunningTrack: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
      user: { findFirst: vi.fn().mockResolvedValue({ id: 'admin1' }) },
      treasuryReceivable: { findMany: vi.fn().mockResolvedValue([inv]) },
      treasuryDunningExecution: {
        findUnique: vi.fn().mockResolvedValue(opts.existingExec ?? null),
        create: vi.fn().mockResolvedValue({ id: 'exec1' }),
        update: execUpdate,
      },
      treasuryFollowup: { update: vi.fn().mockResolvedValue({}) },
    }
    const followups = {
      createCallTask: vi.fn().mockResolvedValue({ id: 'f1', status: 'PENDING' }),
      sendEmailFollowup: vi.fn().mockResolvedValue({ id: 'f1', status: 'DONE', payload: {} }),
    }
    const toconline = {
      getSalesDocuments: vi.fn().mockResolvedValue([]),
      getCustomerEmail: vi.fn().mockResolvedValue('cliente@acme.pt'),
    }
    return { prisma: prisma as never, followups, toconline: toconline as unknown as ToconlineService }
  }

  it('regra TASK cria CALL_TASK pendente com plannedType e marca execução SENT', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'TASK' })
    const svc = new TreasuryDunningRulesService(prisma, followups as unknown as FollowupsService, toconline)

    const res = await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })

    expect(followups.createCallTask).toHaveBeenCalledTimes(1)
    const arg = followups.createCallTask.mock.calls[0][2]
    expect(arg.plannedType).toBe('TASK')
    expect(arg.title).toBe('Verificar banco')
    expect(followups.sendEmailFollowup).not.toHaveBeenCalled()
    expect(res.totalSent).toBe(1)
  })

  it('regra CALL passa plannedType CALL', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'CALL' })
    const svc = new TreasuryDunningRulesService(prisma, followups as unknown as FollowupsService, toconline)
    await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })
    expect(followups.createCallTask.mock.calls[0][2].plannedType).toBe('CALL')
  })

  it('idempotência: execução SENT existente faz skip', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'TASK', existingExec: { id: 'exec1', status: 'SENT' } })
    const svc = new TreasuryDunningRulesService(prisma, followups as unknown as FollowupsService, toconline)
    const res = await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })
    expect(followups.createCallTask).not.toHaveBeenCalled()
    expect(res.totalSkipped).toBe(1)
  })

  it('não-regressão: regra EMAIL continua a chamar sendEmailFollowup', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'EMAIL' })
    const svc = new TreasuryDunningRulesService(prisma, followups as unknown as FollowupsService, toconline)
    const res = await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })
    expect(followups.sendEmailFollowup).toHaveBeenCalledTimes(1)
    expect(followups.createCallTask).not.toHaveBeenCalled()
    expect(res.totalSent).toBe(1)
  })
})
