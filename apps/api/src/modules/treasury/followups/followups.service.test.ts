import { describe, it, expect, vi } from 'vitest'
import { FollowupsService } from './followups.service.js'

function makePrisma() {
  const create = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: 'f1',
    ...data,
  }))
  return { prisma: { treasuryFollowup: { create } } as never, create }
}

describe('createCallTask — payload', () => {
  it('grava plannedType e extraPayload no payload', async () => {
    const { prisma, create } = makePrisma()
    const svc = new FollowupsService(prisma, {} as never)

    await svc.createCallTask('c1', 'u1', {
      receivableId: 'r1',
      direction: 'RECEIVABLE',
      title: 'Verificar banco',
      plannedType: 'TASK',
      extraPayload: { dunningRuleId: 'rule1', automatic: true },
    })

    const data = create.mock.calls[0][0].data
    expect(data.kind).toBe('CALL_TASK')
    expect(data.status).toBe('PENDING')
    expect(data.payload).toMatchObject({
      plannedType: 'TASK',
      dunningRuleId: 'rule1',
      automatic: true,
    })
  })

  it('mantém payload undefined quando não há phone/plannedType/extraPayload', async () => {
    const { prisma, create } = makePrisma()
    const svc = new FollowupsService(prisma, {} as never)

    await svc.createCallTask('c1', 'u1', {
      receivableId: 'r1',
      direction: 'RECEIVABLE',
      title: 'Tarefa simples',
    })

    const data = create.mock.calls[0][0].data
    expect(data.payload).toBeUndefined()
  })
})
