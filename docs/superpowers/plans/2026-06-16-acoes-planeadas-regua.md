# Ações planeadas (Tarefa/Chamada) nas réguas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma régua de cobrança contenha ações planeadas do tipo Tarefa e Chamada que, ao disparar para uma fatura, criam um lembrete pendente na timeline de follow-ups dessa fatura.

**Architecture:** Estende `TreasuryDunningRule` com um `actionType` (`EMAIL | TASK | CALL`) em vez de criar uma tabela nova. O motor de dunning existente (`execute()`) ganha um ramo que, para regras `TASK`/`CALL`, cria um `CALL_TASK` pendente via `FollowupsService.createCallTask` em vez de enviar email. O caminho de email fica inalterado (invariante de não-regressão). A idempotência reutiliza `TreasuryDunningExecution`.

**Tech Stack:** Fastify v5, Prisma, PostgreSQL, React + TanStack Query, Vitest (mock prisma), TypeScript.

**Spec:** [docs/superpowers/specs/2026-06-16-acoes-planeadas-regua-design.md](../specs/2026-06-16-acoes-planeadas-regua-design.md)

---

## File Structure

**Backend:**
- `apps/api/prisma/schema.prisma` — enum `TreasuryDunningActionType` + 4 colunas em `TreasuryDunningRule`.
- `apps/api/prisma/migrations/20260616120000_dunning_action_type/migration.sql` — migração (novo).
- `apps/api/src/modules/treasury/followups/followups.service.ts` — `createCallTask` aceita `plannedType` + `extraPayload`.
- `apps/api/src/modules/treasury/followups/followups.service.test.ts` — testa `createCallTask` payload (novo).
- `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts` — `DunningRuleInput` + validação em `create`/`update`; ramo `TASK`/`CALL` em `execute`; filtro de `autoImportTocSalesDocs`.
- `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.test.ts` — validação + ramo do motor (novo).
- `apps/api/src/modules/treasury/dunning-rules/dunning-rules.routes.ts` — **sem alterações** (o body type deriva de `Parameters<...>`).

**Frontend:**
- `apps/web/src/components/settings/DunningRulesTab.tsx` — seletor de tipo de ação, campos de tarefa, rendering na timeline da régua.
- `apps/web/src/components/followups/FollowupsPanel.tsx` — esconder "Registar" para `plannedType: 'TASK'`.

---

## Task 1: Schema Prisma — enum + colunas + migração

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enums junto à linha 90; modelo `TreasuryDunningRule` linhas 1004-1038)
- Create: `apps/api/prisma/migrations/20260616120000_dunning_action_type/migration.sql`

- [ ] **Step 1: Adicionar o enum ao schema**

Em `apps/api/prisma/schema.prisma`, imediatamente a seguir ao bloco `enum TreasuryFollowupDirection { ... }` (termina na linha ~114), adicionar:

```prisma
enum TreasuryDunningActionType {
  EMAIL
  TASK
  CALL
}
```

- [ ] **Step 2: Adicionar as colunas ao modelo `TreasuryDunningRule`**

Em `apps/api/prisma/schema.prisma`, no modelo `TreasuryDunningRule`, logo a seguir à linha `emailTemplateId String?` (linha ~1011), adicionar:

```prisma
  actionType      TreasuryDunningActionType @default(EMAIL)
  taskTitle       String?                   @db.VarChar(300)
  taskDescription String?
  taskImportance  TreasuryFollowupImportance @default(NORMAL)
```

- [ ] **Step 3: Escrever a migração SQL**

Criar `apps/api/prisma/migrations/20260616120000_dunning_action_type/migration.sql`:

```sql
-- Ações planeadas (Tarefa/Chamada) nas réguas de cobrança.
-- actionType default EMAIL garante que todas as regras existentes
-- mantêm exatamente o comportamento atual (não-regressão).

CREATE TYPE "TreasuryDunningActionType" AS ENUM ('EMAIL', 'TASK', 'CALL');

ALTER TABLE "treasury_dunning_rules"
  ADD COLUMN "actionType" "TreasuryDunningActionType" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "taskTitle" VARCHAR(300),
  ADD COLUMN "taskDescription" TEXT,
  ADD COLUMN "taskImportance" "TreasuryFollowupImportance" NOT NULL DEFAULT 'NORMAL';
```

- [ ] **Step 4: Parar a API e gerar o cliente Prisma**

> No Windows, o `npm run dev` da API bloqueia `query_engine.dll.node` e faz `prisma generate` falhar com EPERM. Parar o dev server da API antes de continuar.

Run (em `apps/api`):
```bash
npx prisma generate
```
Expected: "Generated Prisma Client" sem erros. O tipo `TreasuryDunningActionType` passa a existir em `@prisma/client`.

- [ ] **Step 5: Aplicar a migração**

Run (em `apps/api`):
```bash
npx prisma migrate deploy
```
Expected: aplica `20260616120000_dunning_action_type` sem erros.

- [ ] **Step 6: Compilar o backend**

Run (em `apps/api`):
```bash
npx tsc --noEmit
```
Expected: sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260616120000_dunning_action_type
git commit -m "feat(dunning): schema actionType (EMAIL/TASK/CALL) nas regras de cobranca"
```

---

## Task 2: `createCallTask` aceita `plannedType` + `extraPayload`

O motor vai precisar de marcar a tarefa criada com `plannedType` (discriminador Tarefa vs Chamada) e com metadados de dunning. Hoje `createCallTask` só guarda `{ phone }` no payload.

**Files:**
- Modify: `apps/api/src/modules/treasury/followups/followups.service.ts` (método `createCallTask`, linhas 227-258)
- Test: `apps/api/src/modules/treasury/followups/followups.service.test.ts` (novo)

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/modules/treasury/followups/followups.service.test.ts`:

```typescript
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
```

- [ ] **Step 2: Correr o teste — deve falhar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/followups/followups.service.test.ts
```
Expected: FAIL — `plannedType` não é aceite pelo tipo de input / payload não contém os campos.

- [ ] **Step 3: Implementar a alteração em `createCallTask`**

Em `apps/api/src/modules/treasury/followups/followups.service.ts`, substituir a assinatura e o corpo do método `createCallTask` (linhas 227-258). Adicionar dois campos opcionais ao input e construir o payload mesclado:

No bloco de input (a seguir a `phone?: string`), adicionar:
```typescript
    plannedType?: 'TASK' | 'CALL'
    extraPayload?: Record<string, unknown>
```

Substituir a linha:
```typescript
        payload: input.phone ? { phone: input.phone } : undefined,
```
por:
```typescript
        payload: (() => {
          const p = {
            ...(input.phone ? { phone: input.phone } : {}),
            ...(input.plannedType ? { plannedType: input.plannedType } : {}),
            ...(input.extraPayload ?? {}),
          }
          return Object.keys(p).length > 0 ? p : undefined
        })(),
```

- [ ] **Step 4: Correr o teste — deve passar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/followups/followups.service.test.ts
```
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/followups/followups.service.ts apps/api/src/modules/treasury/followups/followups.service.test.ts
git commit -m "feat(followups): createCallTask aceita plannedType e extraPayload"
```

---

## Task 3: Validação `create`/`update` por `actionType`

**Files:**
- Modify: `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts` (`DunningRuleInput` linhas 6-17; `create` linhas 57-82; `update` linhas 84-119)
- Test: `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.test.ts` (novo)

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.test.ts`:

```typescript
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
```

- [ ] **Step 2: Correr os testes — devem falhar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
```
Expected: FAIL — `actionType` não existe em `DunningRuleInput`; `create` ainda exige template para tudo.

- [ ] **Step 3: Estender `DunningRuleInput`**

Em `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts`, importar o tipo do enum e o de importância no topo (linha 1):

```typescript
import type { PrismaClient, Prisma, TreasuryFollowupDirection, TreasuryDunningActionType, TreasuryFollowupImportance } from '@prisma/client'
```

Adicionar à interface `DunningRuleInput` (a seguir a `emailTemplateId?: string | null`):
```typescript
  actionType?: TreasuryDunningActionType
  taskTitle?: string | null
  taskDescription?: string | null
  taskImportance?: TreasuryFollowupImportance
```

- [ ] **Step 4: Reescrever a validação e o `data` em `create`**

Substituir o corpo de `create` (linhas 57-82) por:

```typescript
  async create(clientId: string, data: DunningRuleInput) {
    if (!data.trackId) throw httpError(400, 'Régua (trackId) é obrigatória')
    if (!data.name?.trim()) throw httpError(400, 'Nome é obrigatório')
    if (typeof data.offsetDays !== 'number' || !Number.isFinite(data.offsetDays)) {
      throw httpError(400, 'Offset de dias inválido')
    }
    await this.assertTrackOwnership(clientId, data.trackId)

    const actionType = data.actionType ?? 'EMAIL'
    if (actionType === 'EMAIL') {
      if (!data.emailTemplateId) throw httpError(400, 'Template de email é obrigatório')
      await this.assertTemplateOwnership(clientId, data.emailTemplateId)
    } else {
      if (!data.taskTitle?.trim()) throw httpError(400, 'Título da tarefa é obrigatório')
    }

    return this.prisma.treasuryDunningRule.create({
      data: {
        clientId,
        trackId: data.trackId,
        name: data.name.trim(),
        offsetDays: Math.trunc(data.offsetDays),
        direction: data.direction ?? 'RECEIVABLE',
        actionType,
        emailTemplateId: actionType === 'EMAIL' ? data.emailTemplateId : null,
        taskTitle: actionType === 'EMAIL' ? null : data.taskTitle!.trim(),
        taskDescription: actionType === 'EMAIL' ? null : (data.taskDescription?.trim() || null),
        taskImportance: data.taskImportance ?? 'NORMAL',
        minAmount: data.minAmount ?? null,
        maxAmount: data.maxAmount ?? null,
        categoryId: data.categoryId ?? null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 100,
      },
    })
  }
```

- [ ] **Step 5: Correr os testes de `create` — devem passar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
```
Expected: PASS (3 testes).

- [ ] **Step 6: Atualizar `update` para suportar `actionType`**

Em `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts`, no método `update` (linhas 84-119), adicionar — a seguir ao bloco `if (data.sortOrder !== undefined) ...` (linha 99) e antes do bloco `if (data.categoryId !== undefined) ...`:

```typescript
    const effectiveActionType = data.actionType ?? rule.actionType
    if (data.actionType !== undefined) updateData.actionType = data.actionType

    if (effectiveActionType === 'EMAIL') {
      // emailTemplateId tratado no bloco existente mais abaixo.
      if (data.actionType === 'EMAIL') {
        updateData.taskTitle = null
        updateData.taskDescription = null
      }
    } else {
      const title = data.taskTitle ?? rule.taskTitle
      if (!title?.trim()) throw httpError(400, 'Título da tarefa é obrigatório')
      updateData.taskTitle = title.trim()
      if (data.taskDescription !== undefined) {
        updateData.taskDescription = data.taskDescription?.trim() || null
      }
      // Ao mudar de EMAIL para TASK/CALL, desliga o template.
      if (data.actionType !== undefined && data.actionType !== 'EMAIL') {
        updateData.emailTemplate = { disconnect: true }
      }
    }
    if (data.taskImportance !== undefined) updateData.taskImportance = data.taskImportance
```

Depois, ajustar o bloco existente do template (linhas 107-111) para não exigir template quando a regra não é de email. Substituir:

```typescript
    if (data.emailTemplateId !== undefined) {
      if (!data.emailTemplateId) throw httpError(400, 'Template de email é obrigatório')
      await this.assertTemplateOwnership(clientId, data.emailTemplateId)
      updateData.emailTemplate = { connect: { id: data.emailTemplateId } }
    }
```
por:
```typescript
    if (data.emailTemplateId !== undefined && effectiveActionType === 'EMAIL') {
      if (!data.emailTemplateId) throw httpError(400, 'Template de email é obrigatório')
      await this.assertTemplateOwnership(clientId, data.emailTemplateId)
      updateData.emailTemplate = { connect: { id: data.emailTemplateId } }
    }
```

- [ ] **Step 7: Escrever teste de `update` que muda EMAIL→TASK**

Adicionar ao ficheiro `dunning-rules.service.test.ts` um novo bloco describe:

```typescript
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
```

- [ ] **Step 8: Correr todos os testes do serviço — devem passar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
```
Expected: PASS (todos).

- [ ] **Step 9: Compilar e commit**

Run (em `apps/api`):
```bash
npx tsc --noEmit
```
Expected: sem erros.

```bash
git add apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
git commit -m "feat(dunning): validacao create/update por actionType"
```

---

## Task 4: Motor `execute()` — ramo TASK/CALL + filtro do auto-import

**Files:**
- Modify: `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts` (`execute` loop linhas 211-356; `autoImportTocSalesDocs` filtro linhas 376-378)
- Test: `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.test.ts` (acrescenta blocos)

- [ ] **Step 1: Escrever os testes do motor que falham**

Adicionar ao ficheiro `dunning-rules.service.test.ts`:

```typescript
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
    } as never
    const followups = {
      createCallTask: vi.fn().mockResolvedValue({ id: 'f1', status: 'PENDING' }),
      sendEmailFollowup: vi.fn().mockResolvedValue({ id: 'f1', status: 'DONE', payload: {} }),
    } as never
    const toconline = {
      getSalesDocuments: vi.fn().mockResolvedValue([]),
      getCustomerEmail: vi.fn().mockResolvedValue('cliente@acme.pt'),
    } as never
    return { prisma, followups, toconline }
  }

  it('regra TASK cria CALL_TASK pendente com plannedType e marca execução SENT', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'TASK' })
    const svc = new TreasuryDunningRulesService(prisma, followups, toconline)

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
    const svc = new TreasuryDunningRulesService(prisma, followups, toconline)
    await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })
    expect(followups.createCallTask.mock.calls[0][2].plannedType).toBe('CALL')
  })

  it('idempotência: execução SENT existente faz skip', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'TASK', existingExec: { id: 'exec1', status: 'SENT' } })
    const svc = new TreasuryDunningRulesService(prisma, followups, toconline)
    const res = await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })
    expect(followups.createCallTask).not.toHaveBeenCalled()
    expect(res.totalSkipped).toBe(1)
  })

  it('não-regressão: regra EMAIL continua a chamar sendEmailFollowup', async () => {
    const { prisma, followups, toconline } = makeEngine({ actionType: 'EMAIL' })
    const svc = new TreasuryDunningRulesService(prisma, followups, toconline)
    const res = await svc.execute('c1', { now: new Date('2026-06-16T10:00:00Z') })
    expect(followups.sendEmailFollowup).toHaveBeenCalledTimes(1)
    expect(followups.createCallTask).not.toHaveBeenCalled()
    expect(res.totalSent).toBe(1)
  })
})
```

- [ ] **Step 2: Correr — devem falhar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
```
Expected: FAIL nos novos testes — TASK ainda cai no guard `NO_TEMPLATE` e não chama `createCallTask`.

- [ ] **Step 3: Ajustar o guard `NO_TEMPLATE`**

Em `apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts`, dentro do loop `for (const rule of rules)`, substituir (linhas ~229-232):

```typescript
      if (!rule.emailTemplate) {
        ruleResults.push({ ...ruleSummary, reason: 'NO_TEMPLATE' })
        continue
      }
```
por:
```typescript
      if (rule.actionType === 'EMAIL' && !rule.emailTemplate) {
        ruleResults.push({ ...ruleSummary, reason: 'NO_TEMPLATE' })
        continue
      }
```

- [ ] **Step 4: Adicionar o ramo TASK/CALL no corpo por-fatura**

Em `dunning-rules.service.ts`, dentro do `for (const inv of invoices)`, o bloco `try { ... } catch` (linhas ~283-348) processa o email. Envolver a lógica de email num `else` e adicionar o ramo de ação à frente. Substituir a linha de abertura do `try`:

```typescript
        try {
          // Override de teste em dev — todos os emails vão para um endereço fixo.
          const overrideTo = process.env.DUNNING_TEST_RECIPIENT?.trim()
```
por:
```typescript
        try {
          if (rule.actionType === 'TASK' || rule.actionType === 'CALL') {
            if (!this.followups) throw new Error('FollowupsService não injetado no DunningRulesService')
            await this.followups.createCallTask(clientId, adminId, {
              receivableId: inv.id,
              direction: 'RECEIVABLE',
              title: rule.taskTitle ?? rule.name,
              description: rule.taskDescription ?? undefined,
              importance: rule.taskImportance,
              dueAt: targetDate,
              plannedType: rule.actionType === 'CALL' ? 'CALL' : 'TASK',
              extraPayload: { dunningRuleId: rule.id, executionId: exec.id, automatic: true },
            })
            await this.prisma.treasuryDunningExecution.update({
              where: { id: exec.id },
              data: { status: 'SENT', executedAt: now },
            })
            totalSent++
            ruleSummary.sentCount++
            ruleSummary.sent.push({
              receivableId: inv.id,
              reference: inv.reference,
              entityName: inv.entityName,
              totalAmount: inv.totalAmount?.toString() ?? null,
              promisedPaymentDate: inv.promisedPaymentDate ? inv.promisedPaymentDate.toISOString() : null,
            })
            continue
          }

          // Override de teste em dev — todos os emails vão para um endereço fixo.
          const overrideTo = process.env.DUNNING_TEST_RECIPIENT?.trim()
```

> Nota: o `continue` termina a iteração desta fatura sem tocar no código de email, que fica intacto a seguir. O bloco `catch` partilhado regista `FAILED` para ambos os ramos.

- [ ] **Step 5: Atualizar o filtro de `autoImportTocSalesDocs`**

Em `dunning-rules.service.ts`, no método `autoImportTocSalesDocs`, a assinatura do parâmetro `rules` (linha ~370) inclui `{ direction: string; offsetDays: number; emailTemplate: unknown }`. Alargar para incluir `actionType` e `taskTitle`:

```typescript
    rules: Array<{ direction: string; offsetDays: number; emailTemplate: unknown; actionType: string; taskTitle: string | null }>,
```

E substituir o filtro de offsets (linhas ~376-378):
```typescript
    const offsets = rules
      .filter((r) => r.direction !== 'PAYABLE' && r.emailTemplate)
      .map((r) => r.offsetDays)
```
por:
```typescript
    const offsets = rules
      .filter((r) => r.direction !== 'PAYABLE' && (r.actionType === 'EMAIL' ? !!r.emailTemplate : !!r.taskTitle))
      .map((r) => r.offsetDays)
```

- [ ] **Step 6: Correr todos os testes do serviço — devem passar**

Run (em `apps/api`):
```bash
npx vitest run src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
```
Expected: PASS (todos, incluindo os 4 do motor).

- [ ] **Step 7: Compilar e correr toda a suite da API**

Run (em `apps/api`):
```bash
npx tsc --noEmit && npx vitest run
```
Expected: sem erros de tipo; toda a suite passa.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.ts apps/api/src/modules/treasury/dunning-rules/dunning-rules.service.test.ts
git commit -m "feat(dunning): motor cria CALL_TASK para regras TASK/CALL"
```

---

## Task 5: Frontend — configuração na régua (`DunningRulesTab.tsx`)

**Files:**
- Modify: `apps/web/src/components/settings/DunningRulesTab.tsx`

- [ ] **Step 1: Estender a interface `DunningRule` e o estado do formulário**

Em `apps/web/src/components/settings/DunningRulesTab.tsx`, na interface `DunningRule` (linhas 16-32), adicionar:
```typescript
  actionType: 'EMAIL' | 'TASK' | 'CALL'
  taskTitle: string | null
  taskDescription: string | null
  taskImportance: 'LOW' | 'NORMAL' | 'HIGH'
```

Substituir `emptyRule` (linhas 38-43) por:
```typescript
const emptyRule = {
  name: '',
  offsetDays: 0,
  isActive: true,
  emailTemplateId: '',
  actionType: 'EMAIL' as 'EMAIL' | 'TASK' | 'CALL',
  taskTitle: '',
  taskDescription: '',
  taskImportance: 'NORMAL' as 'LOW' | 'NORMAL' | 'HIGH',
}
```

- [ ] **Step 2: Importar ícones e adicionar helpers de visual por tipo**

No import de `lucide-react` (linha 6), garantir que `Phone` e `NotebookPen` estão incluídos:
```typescript
import { Plus, Pencil, Trash2, Clock, AlertTriangle, Mail, X, Save, Phone, NotebookPen } from 'lucide-react'
```

A seguir a `formatOffset` (linha 49), adicionar:
```typescript
const ACTION_TYPES = [
  { key: 'EMAIL', label: 'Email', icon: Mail },
  { key: 'TASK', label: 'Tarefa', icon: NotebookPen },
  { key: 'CALL', label: 'Chamada', icon: Phone },
] as const

function actionVisual(t: 'EMAIL' | 'TASK' | 'CALL') {
  if (t === 'TASK') return { icon: NotebookPen, label: 'Tarefa' }
  if (t === 'CALL') return { icon: Phone, label: 'Chamada' }
  return { icon: Mail, label: 'Email' }
}
```

- [ ] **Step 3: Preencher o formulário ao editar (incluir novos campos)**

Em `openEditRule` (linhas 177-187), substituir o `setRuleForm({...})` por:
```typescript
    setRuleForm({
      name: r.name,
      offsetDays: r.offsetDays,
      isActive: r.isActive,
      emailTemplateId: r.emailTemplateId ?? '',
      actionType: r.actionType,
      taskTitle: r.taskTitle ?? '',
      taskDescription: r.taskDescription ?? '',
      taskImportance: r.taskImportance,
    })
```

- [ ] **Step 4: Construir o payload por tipo e ajustar `canSubmit`**

Substituir `submitRule` (linhas 189-199) por:
```typescript
  function submitRule() {
    const base = {
      trackId,
      name: ruleForm.name.trim(),
      offsetDays: Number(ruleForm.offsetDays),
      isActive: ruleForm.isActive,
      actionType: ruleForm.actionType,
    }
    const payload = ruleForm.actionType === 'EMAIL'
      ? { ...base, emailTemplateId: ruleForm.emailTemplateId }
      : { ...base, taskTitle: ruleForm.taskTitle.trim(), taskDescription: ruleForm.taskDescription.trim() || null, taskImportance: ruleForm.taskImportance }
    if (editingRule) updateRule.mutate({ id: editingRule.id, payload })
    else createRule.mutate(payload)
  }
```

Substituir `canSubmit` (linha 202) por:
```typescript
  const canSubmit = !!ruleForm.name.trim() && (
    ruleForm.actionType === 'EMAIL' ? !!ruleForm.emailTemplateId : !!ruleForm.taskTitle.trim()
  )
```

- [ ] **Step 5: Adicionar o seletor de tipo no topo do modal**

No modal, imediatamente a seguir à `<div className="space-y-4">` de abertura (linha 278) e antes do campo `Nome`, inserir:
```tsx
          <div>
            <label className="label">Tipo de ação</label>
            <div className="flex gap-2">
              {ACTION_TYPES.map((t) => {
                const Icon = t.icon
                const selected = ruleForm.actionType === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setRuleForm((f) => ({ ...f, actionType: t.key }))}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      selected ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
```

- [ ] **Step 6: Tornar a secção de template condicional e adicionar a secção de tarefa**

Envolver toda a secção de template de email (o `<div>` que começa em `<label className="label">Template de email ...` na linha 320 e termina no `</div>` da linha 457) numa condição `ruleForm.actionType === 'EMAIL'`. Logo a seguir, adicionar a secção de tarefa para `TASK`/`CALL`:

```tsx
          {ruleForm.actionType !== 'EMAIL' && (
            <>
              <div>
                <label className="label">Título <span className="text-red-500">*</span></label>
                <input
                  className="input"
                  value={ruleForm.taskTitle}
                  onChange={(e) => setRuleForm({ ...ruleForm, taskTitle: e.target.value })}
                  placeholder={ruleForm.actionType === 'CALL' ? 'Ex: Contactar cliente a confirmar pagamento' : 'Ex: Verificar no banco se o movimento caiu'}
                />
              </div>
              <div>
                <label className="label">Descrição</label>
                <textarea
                  className="input min-h-[80px] resize-y"
                  value={ruleForm.taskDescription}
                  onChange={(e) => setRuleForm({ ...ruleForm, taskDescription: e.target.value })}
                  placeholder="Detalhe opcional do lembrete"
                />
              </div>
              <div>
                <label className="label">Importância</label>
                <div className="flex gap-2">
                  {(['LOW', 'NORMAL', 'HIGH'] as const).map((imp) => {
                    const selected = ruleForm.taskImportance === imp
                    const txt = imp === 'LOW' ? 'Baixa' : imp === 'NORMAL' ? 'Normal' : 'Alta'
                    return (
                      <button
                        key={imp}
                        type="button"
                        onClick={() => setRuleForm({ ...ruleForm, taskImportance: imp })}
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                          selected ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {txt}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
```

> O `useEffect` que sugere o template por tom (linhas 86-93) continua a correr mas é inofensivo quando `actionType !== 'EMAIL'` (o `emailTemplateId` não é enviado no payload).

- [ ] **Step 7: Rendering do cartão na timeline por tipo de ação**

No `.map((r) => { ... })` da timeline (linhas 223-269), substituir o cálculo de `color` e o conteúdo do círculo + do corpo para refletir o tipo. Substituir o bloco do círculo (linhas 230-232):
```tsx
                <span className={`absolute left-0 top-2 w-8 h-8 rounded-full border-2 flex items-center justify-center ${color} z-10 bg-white`}>
                  {r.offsetDays > 0 ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                </span>
```
por:
```tsx
                <span className={`absolute left-0 top-2 w-8 h-8 rounded-full border-2 flex items-center justify-center ${color} z-10 bg-white`}>
                  {(() => { const Icon = actionVisual(r.actionType).icon; return <Icon className="w-4 h-4" /> })()}
                </span>
```

E substituir o bloco do subtítulo (linhas 238-244, o `<div>` com o ícone `Mail` e o nome do template) por:
```tsx
                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                        {r.actionType === 'EMAIL' ? (
                          <>
                            <Mail className="w-3 h-3 flex-shrink-0" />
                            {r.emailTemplate ? r.emailTemplate.name : <span className="italic text-amber-600">Sem template</span>}
                            {r.totalExecutions > 0 && (
                              <span className="ml-1 text-gray-400">· {r.totalExecutions} execução(ões)</span>
                            )}
                          </>
                        ) : (
                          <>
                            {(() => { const Icon = actionVisual(r.actionType).icon; return <Icon className="w-3 h-3 flex-shrink-0" /> })()}
                            <span className="truncate">{r.taskTitle}</span>
                            {r.taskImportance === 'HIGH' && <span className="text-red-600 font-medium">⚑</span>}
                          </>
                        )}
                      </div>
```

- [ ] **Step 8: Atualizar o título do modal**

Substituir o `title` do `<Modal>` (linha 276):
```tsx
        title={editingRule ? 'Editar Regra' : 'Nova Regra de Cobrança'}
```
por:
```tsx
        title={editingRule ? 'Editar ação' : 'Nova ação na régua'}
```

- [ ] **Step 9: Compilar o frontend**

Run (em `apps/web`):
```bash
npx tsc --noEmit
```
Expected: sem erros de tipo.

- [ ] **Step 10: Verificação manual**

Iniciar a app (API + web). Em Definições → Réguas → abrir uma régua → "Nova ação":
1. Selecionar "Tarefa", definir `Quando = -2`, `Título = "Verificar banco"`, `Importância = Alta` → Criar. Confirmar que aparece na timeline com ícone de bloco de notas e o título.
2. Selecionar "Chamada", `Título = "Confirmar pagamento"` → Criar. Confirmar ícone de telefone.
3. Confirmar que "Email" continua a mostrar o seletor de template e cria como antes.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/settings/DunningRulesTab.tsx
git commit -m "feat(web): tipos de acao Tarefa/Chamada na regua de cobranca"
```

---

## Task 6: Frontend — distinção na timeline da fatura (`FollowupsPanel.tsx`)

Tarefas com `plannedType: 'TASK'` não devem mostrar o botão "Registar"; `'CALL'` e tarefas manuais (sem `plannedType`) mantêm-no.

**Files:**
- Modify: `apps/web/src/components/followups/FollowupsPanel.tsx` (`TimelineItem`, linhas 415-451)

- [ ] **Step 1: Ler `plannedType` do payload e condicionar o botão "Registar"**

Em `apps/web/src/components/followups/FollowupsPanel.tsx`, dentro de `TimelineItem`, a seguir a `const isFollowup = ev.source === 'followup'` (linha 419), adicionar:
```typescript
  const plannedType = (ev.payload as Record<string, unknown> | null)?.plannedType
```

Substituir a condição do botão "Registar" (linha 443):
```tsx
            {isPending && ev.kind === 'CALL_TASK' && (
```
por:
```tsx
            {isPending && ev.kind === 'CALL_TASK' && plannedType !== 'TASK' && (
```

- [ ] **Step 2: Compilar o frontend**

Run (em `apps/web`):
```bash
npx tsc --noEmit
```
Expected: sem erros de tipo.

- [ ] **Step 3: Verificação manual**

Com uma régua que tenha uma ação Tarefa a `-2d` e outra Chamada a `0d`, e uma fatura receivable com `promisedPaymentDate` adequada, correr o motor ("Executar agora" na régua). Na timeline da fatura:
1. A Tarefa aparece pendente **sem** botão "Registar", só com o check "Concluir".
2. A Chamada aparece pendente **com** botão "Registar" (abre o LogCallModal).
3. Uma tarefa criada manualmente continua a mostrar ambos os botões.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/followups/FollowupsPanel.tsx
git commit -m "feat(web): esconder Registar para tarefas planeadas tipo TASK"
```

---

## Self-Review Notes

- **Spec coverage:** modelo de dados (Task 1), motor TASK/CALL + idempotência + auto-import (Task 4), validação por tipo (Task 3), UI da régua (Task 5), conclusão na fatura com `plannedType` (Task 6), não-regressão email (testes em Task 4). Todas as secções do spec têm tarefa.
- **Routes:** sem alterações — `dunning-rules.routes.ts` deriva o body de `Parameters<TreasuryDunningRulesService['create']>[1]`, que já reflete os campos novos.
- **Não-regressão:** o código de email no motor fica dentro do mesmo `try`, sem alterações lógicas; o teste "regra EMAIL continua a chamar sendEmailFollowup" cobre-o. O guard `NO_TEMPLATE` passa a aplicar-se só a EMAIL.
- **Consistência de tipos:** `actionType` (`EMAIL|TASK|CALL`), `plannedType` (`TASK|CALL`), `taskImportance` (`LOW|NORMAL|HIGH`) usados de forma consistente entre backend e frontend.
