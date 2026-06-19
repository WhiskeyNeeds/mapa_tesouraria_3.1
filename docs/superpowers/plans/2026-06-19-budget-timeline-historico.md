# Budget Timeline (Histórico) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um separador "Histórico" ao painel do budget que mostra a timeline de atividade (criação, edições, regras, associação de transações), reutilizando o audit log existente.

**Architecture:** Reutiliza a tabela `TreasuryAuditLog` e o helper `audit()` (best-effort) já existentes. Eventos do budget usam `entityType: 'Budget'`, `entityId: <budgetId>`. Adiciona-se um helper central para os eventos de associação de transações, chamadas `audit()` nas regras, um endpoint de leitura paginado, e a UI da tab.

**Tech Stack:** Fastify + Prisma (PostgreSQL) no backend; React + TanStack Query no frontend; Vitest para testes.

## Global Constraints

- Sem alterações ao `prisma/schema.prisma` (reutiliza `TreasuryAuditLog`).
- `audit()` é best-effort (try/catch interno) — nunca quebrar a operação principal.
- `entityType` dos eventos de budget = `'Budget'`; `entityId` = `budgetId`.
- Auto-atribuição por regra → `userId: null` (mostrado como "Sistema").
- Respostas e textos da UI em Português (acentuação correta).
- Comandos de teste correm a partir de `apps/api` (`npm test`) e `apps/web` (`npx tsc --noEmit`).

---

### Task 1: Helper central de eventos de transação do budget

**Files:**
- Create: `apps/api/src/lib/budget-events.ts`
- Test: `apps/api/src/lib/budget-events.test.ts`

**Interfaces:**
- Consumes: `audit()` de `apps/api/src/lib/audit.ts`.
- Produces:
  - `auditBudgetTxnTransition(prisma, args): Promise<void>` onde
    `args = { clientId: string; userId: string | null; docType: 'receivable' | 'payable'; docId: string; entityName: string | null; amount: number; beforeBudgetId: string | null; beforeAuto: boolean; afterBudgetId: string | null; afterAuto: boolean }`
  - Ações emitidas: `budget.txn_auto_assign`, `budget.txn_move_in`, `budget.txn_move_out`, `budget.txn_unassign`, `budget.txn_confirm`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/budget-events.test.ts
import { describe, it, expect, vi } from 'vitest'
import { auditBudgetTxnTransition } from './budget-events.js'

function mkPrisma() {
  return {
    treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    treasuryBudget: { findMany: vi.fn().mockResolvedValue([
      { id: 'bA', name: 'Budget A' },
      { id: 'bB', name: 'Budget B' },
    ]) },
  } as never
}
const base = { clientId: 'c1', docType: 'payable' as const, docId: 'd1', entityName: 'ACME', amount: 123 }

describe('auditBudgetTxnTransition', () => {
  it('null -> X auto: regista budget.txn_auto_assign com userId null', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: null, beforeAuto: false, afterBudgetId: 'bA', afterAuto: true })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'budget.txn_auto_assign', entityType: 'Budget', entityId: 'bA', userId: null }),
    }))
  })

  it('null -> X manual: regista budget.txn_move_in com userId', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: null, beforeAuto: false, afterBudgetId: 'bA', afterAuto: false })
    const create = (p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_move_in', entityId: 'bA', userId: 'u1' }) }))
  })

  it('X -> Y: regista move_out em X e move_in em Y com nomes', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: false, afterBudgetId: 'bB', afterAuto: false })
    const create = (p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_move_out', entityId: 'bA', payload: expect.objectContaining({ toBudgetName: 'Budget B' }) }) }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_move_in', entityId: 'bB', payload: expect.objectContaining({ fromBudgetName: 'Budget A' }) }) }))
  })

  it('X -> null: regista budget.txn_unassign em X', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: false, afterBudgetId: null, afterAuto: false })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_unassign', entityId: 'bA' }) }))
  })

  it('mesmo budget, auto true->false: regista budget.txn_confirm', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: true, afterBudgetId: 'bA', afterAuto: false })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'budget.txn_confirm', entityId: 'bA' }) }))
  })

  it('sem mudança relevante: não regista nada', async () => {
    const p = mkPrisma()
    await auditBudgetTxnTransition(p, { ...base, userId: 'u1', beforeBudgetId: 'bA', beforeAuto: false, afterBudgetId: 'bA', afterAuto: false })
    expect((p as never as { treasuryAuditLog: { create: ReturnType<typeof vi.fn> } }).treasuryAuditLog.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/budget-events.test.ts`
Expected: FAIL — `auditBudgetTxnTransition` não existe (módulo não encontrado).

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/lib/budget-events.ts
import type { PrismaClient, Prisma } from '@prisma/client'
import { audit } from './audit.js'

interface TxnTransitionArgs {
  clientId: string
  userId: string | null
  docType: 'receivable' | 'payable'
  docId: string
  entityName: string | null
  amount: number
  beforeBudgetId: string | null
  beforeAuto: boolean
  afterBudgetId: string | null
  afterAuto: boolean
}

/**
 * Regista no audit log (entityType='Budget') a transição de associação de uma
 * fatura a um budget. Best-effort via audit(). Nomes de budget congelados no payload.
 */
export async function auditBudgetTxnTransition(
  prisma: PrismaClient | Prisma.TransactionClient,
  a: TxnTransitionArgs,
): Promise<void> {
  const base = { docId: a.docId, docType: a.docType, entityName: a.entityName, amount: a.amount }

  if (a.beforeBudgetId === a.afterBudgetId) {
    // Mesmo budget: só interessa a confirmação de uma auto-atribuição.
    if (a.afterBudgetId && a.beforeAuto && !a.afterAuto) {
      await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_confirm', entityType: 'Budget', entityId: a.afterBudgetId, payload: base })
    }
    return
  }

  // Resolve nomes dos budgets envolvidos (para congelar no payload).
  const ids = [a.beforeBudgetId, a.afterBudgetId].filter((x): x is string => !!x)
  const rows = ids.length ? await prisma.treasuryBudget.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const nameOf = (id: string | null) => (id ? rows.find((r) => r.id === id)?.name ?? null : null)

  if (!a.beforeBudgetId && a.afterBudgetId) {
    if (a.afterAuto) {
      await audit(prisma, { clientId: a.clientId, userId: null, action: 'budget.txn_auto_assign', entityType: 'Budget', entityId: a.afterBudgetId, payload: base })
    } else {
      await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_move_in', entityType: 'Budget', entityId: a.afterBudgetId, payload: base })
    }
    return
  }
  if (a.beforeBudgetId && !a.afterBudgetId) {
    await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_unassign', entityType: 'Budget', entityId: a.beforeBudgetId, payload: base })
    return
  }
  // X -> Y
  await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_move_out', entityType: 'Budget', entityId: a.beforeBudgetId!, payload: { ...base, toBudgetName: nameOf(a.afterBudgetId) } })
  await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_move_in', entityType: 'Budget', entityId: a.afterBudgetId!, payload: { ...base, fromBudgetName: nameOf(a.beforeBudgetId) } })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/lib/budget-events.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/budget-events.ts apps/api/src/lib/budget-events.test.ts
git commit -m "feat(budget): helper de audit para transicoes de associacao de transacao"
```

---

### Task 2: Audit nas regras de budget

**Files:**
- Modify: `apps/api/src/modules/treasury/budget-rules/budget-rules.service.ts`
- Modify: `apps/api/src/modules/treasury/budget-rules/budget-rules.routes.ts`
- Test: `apps/api/src/modules/treasury/budget-rules/budget-rules.service.test.ts`

**Interfaces:**
- Consumes: `audit()` de `src/lib/audit.ts`.
- Produces:
  - `create(clientId, userId, data)` — assinatura passa a incluir `userId: string` como 2.º parâmetro.
  - `delete(clientId, userId, id)` — idem.
  - Ações: `budget.rule_add`, `budget.rule_remove` (entityType `'Budget'`, entityId = `budgetId`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/treasury/budget-rules/budget-rules.service.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/treasury/budget-rules/budget-rules.service.test.ts`
Expected: FAIL — `create`/`delete` ainda não aceitam `userId` / não chamam `treasuryAuditLog.create`.

- [ ] **Step 3: Write minimal implementation**

No topo do serviço, garantir o import:

```ts
import { audit } from '../../../lib/audit.js'
```

Alterar `create` para receber `userId` e, no fim (depois do `create` da regra, usando os
objetos `budget`/`category` já carregados acima na função), registar o evento:

```ts
  async create(clientId: string, userId: string, data: { budgetId: string; categoryId: string; textPattern?: string }) {
    // ... (validações existentes que carregam `budget` e `category` mantêm-se) ...
    const rule = await this.prisma.treasuryBudgetRule.create({
      data: {
        clientId,
        budgetId: data.budgetId,
        categoryId: data.categoryId,
        textPattern: data.textPattern?.trim() || null,
      },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.rule_add',
      entityType: 'Budget', entityId: data.budgetId,
      payload: { ruleId: rule.id, categoryName: category.name, textPattern: rule.textPattern },
    })
    return rule
  }
```

Alterar `delete` para receber `userId`. Carregar a regra com a categoria e registar:

```ts
  async delete(clientId: string, userId: string, id: string) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({
      where: { id, clientId },
      include: { category: { select: { name: true } } },
    })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    await this.prisma.treasuryBudgetRule.delete({ where: { id } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.rule_remove',
      entityType: 'Budget', entityId: rule.budgetId,
      payload: { ruleId: rule.id, categoryName: rule.category?.name ?? null, textPattern: rule.textPattern },
    })
  }
```

(Nota: o `findFirst` do `delete` já existia — acrescenta-se o `include` da categoria.)

Nas rotas, passar o utilizador:

```ts
// budget-rules.routes.ts
  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as { budgetId: string; categoryId: string; textPattern?: string }
    return reply.status(201).send(await svc.create(clientId, request.user.sub, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, request.user.sub, id)
    return reply.status(204).send()
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/treasury/budget-rules/budget-rules.service.test.ts`
Expected: PASS (2 testes).
Run também o type-check: `cd apps/api && npx tsc --noEmit` → sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/budget-rules/
git commit -m "feat(budget): regista budget.rule_add/remove no audit log"
```

---

### Task 3: Audit de associação de transação — payables

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts`
- Test: `apps/api/src/modules/treasury/payables/payables-budget-audit.test.ts`

**Interfaces:**
- Consumes: `auditBudgetTxnTransition` (Task 1).
- Produces: chamadas a `auditBudgetTxnTransition` em `create` (auto-assign) e `update` (transições). `bulkSetBudget` herda via `update`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/treasury/payables/payables-budget-audit.test.ts
import { describe, it, expect, vi } from 'vitest'
import * as budgetEvents from '../../../lib/budget-events.js'
import { TreasuryPayablesService } from './payables.service.js'

function svcWith(prismaOverrides: Record<string, unknown>) {
  const prisma = {
    treasuryPayable: { update: vi.fn().mockResolvedValue({ id: 'd1', budgetId: 'bB', budgetAutoAssigned: false }) },
    treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    ...prismaOverrides,
  } as never
  const budgetsSvc = { assertCompatible: vi.fn().mockResolvedValue(undefined) } as never
  return new TreasuryPayablesService(prisma, budgetsSvc, {} as never)
}

describe('payables.update — eventos de budget', () => {
  it('mover X -> Y chama auditBudgetTxnTransition com before/after corretos', async () => {
    const spy = vi.spyOn(budgetEvents, 'auditBudgetTxnTransition').mockResolvedValue()
    const svc = svcWith({})
    // getById e resolveLocalPayableId são internos; substituímos via prototype.
    vi.spyOn(svc as never as { resolveLocalPayableId: (...a: unknown[]) => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('d1' as never)
    vi.spyOn(svc as never as { getById: (...a: unknown[]) => Promise<unknown> }, 'getById').mockResolvedValue({
      id: 'd1', status: 'OPEN', tocPurchasesDocId: null, recurrenceId: null, parentId: null,
      budgetId: 'bA', budgetAutoAssigned: false, entityName: 'ACME', totalAmount: 123, categoryId: 'c',
    } as never)
    await svc.update('c1', 'u1', 'd1', { budgetId: 'bB' })
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      docType: 'payable', docId: 'd1', beforeBudgetId: 'bA', afterBudgetId: 'bB', afterAuto: false, userId: 'u1',
    }))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables/payables-budget-audit.test.ts`
Expected: FAIL — `auditBudgetTxnTransition` não é chamado.

- [ ] **Step 3: Write minimal implementation**

No topo do ficheiro:

```ts
import { auditBudgetTxnTransition } from '../../../lib/budget-events.js'
```

No `update`, depois de `const updated = await this.prisma.treasuryPayable.update(...)` e
antes do `return updated`, calcular o estado depois e emitir a transição:

```ts
    // Eventos de associação ao budget (entityType='Budget').
    const afterBudgetId = data.budgetId !== undefined ? data.budgetId : item.budgetId
    const afterAuto = data.budgetAutoAssigned !== undefined
      ? data.budgetAutoAssigned
      : data.budgetId !== undefined ? false : item.budgetAutoAssigned
    await auditBudgetTxnTransition(this.prisma, {
      clientId, userId, docType: 'payable', docId: id,
      entityName: item.entityName ?? null, amount: Number(item.totalAmount ?? 0),
      beforeBudgetId: item.budgetId ?? null, beforeAuto: !!item.budgetAutoAssigned,
      afterBudgetId: afterBudgetId ?? null, afterAuto: !!afterAuto,
    })
```

No `create`, depois de `await audit(this.prisma, { action: 'payable.create', ... })` (a
variável do registo criado chama-se `created`) e quando `budgetAutoAssigned === true`,
emitir auto-assign:

```ts
    if (resolvedBudgetId && budgetAutoAssigned) {
      await auditBudgetTxnTransition(this.prisma, {
        clientId, userId, docType: 'payable', docId: created.id,
        entityName: created.entityName ?? null, amount: Number(created.totalAmount ?? 0),
        beforeBudgetId: null, beforeAuto: false,
        afterBudgetId: resolvedBudgetId, afterAuto: true,
      })
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables/payables-budget-audit.test.ts`
Expected: PASS.
Run: `cd apps/api && npx tsc --noEmit` → sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/payables/
git commit -m "feat(budget): regista eventos de associacao de transacao (payables)"
```

---

### Task 4: Audit de associação de transação — receivables

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts`
- Test: `apps/api/src/modules/treasury/receivables/receivables-budget-audit.test.ts`

**Interfaces:**
- Consumes: `auditBudgetTxnTransition` (Task 1). `docType: 'receivable'`, `assertCompatible(..., 'REVENUE')`.
- Produces: chamadas em `create` (auto-assign) e `update`. Espelha a Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/treasury/receivables/receivables-budget-audit.test.ts
import { describe, it, expect, vi } from 'vitest'
import * as budgetEvents from '../../../lib/budget-events.js'
import { TreasuryReceivablesService } from './receivables.service.js'

describe('receivables.update — eventos de budget', () => {
  it('remover budget (X -> null) emite transição com afterBudgetId null', async () => {
    const prisma = {
      treasuryReceivable: { update: vi.fn().mockResolvedValue({ id: 'd1' }) },
      treasuryAuditLog: { create: vi.fn().mockResolvedValue({}) },
    } as never
    const budgetsSvc = { assertCompatible: vi.fn().mockResolvedValue(undefined) } as never
    const svc = new TreasuryReceivablesService(prisma, budgetsSvc, {} as never)
    vi.spyOn(svc as never as { resolveLocalReceivableId: (...a: unknown[]) => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('d1' as never)
    vi.spyOn(svc as never as { getById: (...a: unknown[]) => Promise<unknown> }, 'getById').mockResolvedValue({
      id: 'd1', status: 'OPEN', tocSalesDocId: null, recurrenceId: null, parentId: null,
      budgetId: 'bA', budgetAutoAssigned: false, entityName: 'Cliente X', totalAmount: 50, categoryId: 'c',
    } as never)
    const spy = vi.spyOn(budgetEvents, 'auditBudgetTxnTransition').mockResolvedValue()
    await svc.update('c1', 'u1', 'd1', { budgetId: null })
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      docType: 'receivable', beforeBudgetId: 'bA', afterBudgetId: null,
    }))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/treasury/receivables/receivables-budget-audit.test.ts`
Expected: FAIL — sem chamada a `auditBudgetTxnTransition`.

- [ ] **Step 3: Write minimal implementation**

No topo:

```ts
import { auditBudgetTxnTransition } from '../../../lib/budget-events.js'
```

No `update`, depois do `const updated = await this.prisma.treasuryReceivable.update(...)`,
antes do `return`:

```ts
    const afterBudgetId = data.budgetId !== undefined ? data.budgetId : item.budgetId
    const afterAuto = data.budgetAutoAssigned !== undefined
      ? data.budgetAutoAssigned
      : data.budgetId !== undefined ? false : item.budgetAutoAssigned
    await auditBudgetTxnTransition(this.prisma, {
      clientId, userId, docType: 'receivable', docId: id,
      entityName: item.entityName ?? null, amount: Number(item.totalAmount ?? 0),
      beforeBudgetId: item.budgetId ?? null, beforeAuto: !!item.budgetAutoAssigned,
      afterBudgetId: afterBudgetId ?? null, afterAuto: !!afterAuto,
    })
```

No `create`, quando a auto-atribuição ocorre (`budgetAutoAssigned === true` e existe
`resolvedBudgetId`), emitir auto-assign logo após o `await audit({ action:
'receivable.create', ... })` (a variável do registo criado chama-se `created`):

```ts
    if (resolvedBudgetId && budgetAutoAssigned) {
      await auditBudgetTxnTransition(this.prisma, {
        clientId, userId, docType: 'receivable', docId: created.id,
        entityName: created.entityName ?? null, amount: Number(created.totalAmount ?? 0),
        beforeBudgetId: null, beforeAuto: false,
        afterBudgetId: resolvedBudgetId, afterAuto: true,
      })
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/treasury/receivables/receivables-budget-audit.test.ts`
Expected: PASS.
Run: `cd apps/api && npx tsc --noEmit` → sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/receivables/
git commit -m "feat(budget): regista eventos de associacao de transacao (receivables)"
```

---

### Task 5: Endpoint GET /budgets/:id/events

**Files:**
- Modify: `apps/api/src/modules/treasury/budgets/budgets.service.ts`
- Modify: `apps/api/src/modules/treasury/budgets/budgets.routes.ts`
- Test: `apps/api/src/modules/treasury/budgets/budgets-events.service.test.ts`

**Interfaces:**
- Produces: `listEvents(clientId, budgetId, opts): Promise<{ events: BudgetEventDTO[]; nextCursor: string | null }>`
  onde `opts = { limit?: number; before?: string }` e
  `BudgetEventDTO = { id: string; action: string; createdAt: string; actor: { id: string; name: string } | null; payload: unknown }`.
- Rota: `GET /treasury/:clientId/budgets/:id/events?limit&before`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/treasury/budgets/budgets-events.service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { TreasuryBudgetsService } from './budgets.service.js'

describe('budgets.listEvents', () => {
  it('lê audit logs do budget e devolve DTOs + nextCursor', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `e${i}`, action: 'budget.create', createdAt: new Date(`2026-06-1${i}T00:00:00Z`),
      payload: { name: 'X' }, user: i === 0 ? { id: 'u1', name: 'João' } : null,
    }))
    const findMany = vi.fn().mockResolvedValue(rows)
    const prisma = { treasuryAuditLog: { findMany } } as never
    const svc = new TreasuryBudgetsService(prisma)
    const res = await svc.listEvents('c1', 'b1', { limit: 2 })
    // pediu limit+1=3, recebeu 3 => há mais; devolve 2 e nextCursor = createdAt do 2.º
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: 'c1', entityType: 'Budget', entityId: 'b1' }),
      orderBy: { createdAt: 'desc' }, take: 3,
    }))
    expect(res.events).toHaveLength(2)
    expect(res.events[0].actor).toEqual({ id: 'u1', name: 'João' })
    expect(res.events[1].actor).toBeNull()
    expect(res.nextCursor).toBe(rows[1].createdAt.toISOString())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/treasury/budgets/budgets-events.service.test.ts`
Expected: FAIL — `listEvents` não existe.

- [ ] **Step 3: Write minimal implementation**

Adicionar ao `TreasuryBudgetsService`:

```ts
  async listEvents(clientId: string, budgetId: string, opts: { limit?: number; before?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
    const rows = await this.prisma.treasuryAuditLog.findMany({
      where: {
        clientId,
        entityType: 'Budget',
        entityId: budgetId,
        ...(opts.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    return {
      events: page.map((r) => ({
        id: r.id,
        action: r.action,
        createdAt: r.createdAt.toISOString(),
        actor: r.user ? { id: r.user.id, name: r.user.name } : null,
        payload: r.payload ?? null,
      })),
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    }
  }
```

Adicionar a rota em `budgets.routes.ts`:

```ts
  fastify.get(`${prefix}/:id/events`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const q = request.query as { limit?: string; before?: string }
    return reply.send(await svc.listEvents(clientId, id, {
      limit: q.limit ? Number(q.limit) : undefined,
      before: q.before,
    }))
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/treasury/budgets/budgets-events.service.test.ts`
Expected: PASS.
Run: `cd apps/api && npx tsc --noEmit` → sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/budgets/
git commit -m "feat(budget): endpoint GET /budgets/:id/events (timeline)"
```

---

### Task 6: Frontend — tab "Histórico" no BudgetPanel

**Files:**
- Modify: `apps/web/src/components/budgets/BudgetPanel.tsx`

**Interfaces:**
- Consumes: `GET /treasury/:clientId/budgets/:id/events` (Task 5). DTO:
  `{ id, action, createdAt, actor: { id, name } | null, payload }`.

- [ ] **Step 1: Adicionar tipos e o formatador de eventos**

No topo do componente (após os interfaces existentes), adicionar:

```tsx
interface BudgetEvent { id: string; action: string; createdAt: string; actor: { id: string; name: string } | null; payload: Record<string, unknown> | null }
interface BudgetEventsPage { events: BudgetEvent[]; nextCursor: string | null }

function fmtAmount(v: unknown): string {
  const n = Number(v ?? 0)
  return formatCurrency(Number.isFinite(n) ? n : 0)
}

function formatBudgetEvent(action: string, payload: Record<string, unknown> | null): string {
  const p = payload ?? {}
  const ent = (p.entityName as string) ?? '—'
  const amt = fmtAmount(p.amount)
  switch (action) {
    case 'budget.create': return 'Budget criado'
    case 'budget.delete': return 'Budget eliminado'
    case 'budget.update': {
      const changes = (p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>
      if (changes.status) {
        return changes.status.to === 'ARCHIVED' ? 'Budget arquivado' : 'Budget reativado'
      }
      const labels: Record<string, string> = { name: 'Nome', totalAmount: 'Valor', startDate: 'Início', endDate: 'Fim', color: 'Cor', description: 'Descrição' }
      const parts = Object.keys(changes).map((k) => labels[k] ?? k)
      return parts.length ? `Editado: ${parts.join(', ')}` : 'Budget editado'
    }
    case 'budget.rule_add': return `Regra adicionada: «${(p.categoryName as string) ?? '—'}»${p.textPattern ? ` (${p.textPattern})` : ''}`
    case 'budget.rule_remove': return `Regra removida: «${(p.categoryName as string) ?? '—'}»`
    case 'budget.txn_auto_assign': return `Fatura de ${ent} (${amt}) atribuída automaticamente`
    case 'budget.txn_confirm': return `Fatura de ${ent} (${amt}) confirmada`
    case 'budget.txn_move_in': return p.fromBudgetName ? `Fatura de ${ent} (${amt}) movida de «${p.fromBudgetName}»` : `Fatura de ${ent} (${amt}) adicionada`
    case 'budget.txn_move_out': return `Fatura de ${ent} (${amt}) movida para «${(p.toBudgetName as string) ?? '—'}»`
    case 'budget.txn_unassign': return `Fatura de ${ent} (${amt}) removida do budget`
    default: return action
  }
}
```

- [ ] **Step 2: Adicionar a tab e a query (lazy)**

No `useState` do `activeTab`, incluir `'history'` na união de tipos:

```tsx
  const [activeTab, setActiveTab] = useState<'transactions' | 'rules' | 'review' | 'history'>('transactions')
```

Adicionar a query (após as queries existentes):

```tsx
  const { data: eventsPage, isLoading: eventsLoading } = useQuery<BudgetEventsPage>({
    queryKey: ['budget-events', selectedClientId, budgetId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets/${budgetId}/events?limit=100`),
    enabled: !!selectedClientId && !!budgetId && activeTab === 'history',
  })
```

Na lista de tabs, acrescentar a entrada `{ key: 'history', label: 'Histórico' }`.

- [ ] **Step 3: Renderizar a timeline**

No corpo das tabs (a seguir ao bloco `activeTab === 'review'`), adicionar:

```tsx
        {/* Tab: Histórico */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {eventsLoading ? (
              <p className="text-xs text-gray-400 italic text-center py-8">A carregar…</p>
            ) : (eventsPage?.events.length ?? 0) === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">Sem histórico para este budget.</p>
            ) : (
              <ol className="relative border-l border-gray-200 ml-1.5 space-y-4">
                {eventsPage!.events.map((ev) => (
                  <li key={ev.id} className="ml-4">
                    <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-gray-300 border-2 border-white" />
                    <p className="text-sm text-gray-800">{formatBudgetEvent(ev.action, ev.payload)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(ev.createdAt).toLocaleString('pt-PT')} · {ev.actor ? `por ${ev.actor.name}` : 'Sistema'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
```

- [ ] **Step 4: Verificar tipos e build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erros em `BudgetPanel.tsx`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/budgets/BudgetPanel.tsx
git commit -m "feat(budget): tab Historico (timeline de atividade) no painel"
```

---

## Notas de verificação manual (após implementação)

Com o backend a correr e um cliente com dados:
1. Editar um budget (valor) → tab Histórico mostra "Editado: Valor" por <utilizador>.
2. Arquivar → "Budget arquivado".
3. Adicionar/remover regra → eventos correspondentes.
4. Numa fatura, associar a um budget, mover para outro, remover → `move_in`/`move_out`/`unassign`.
5. Confirmar uma auto-atribuição na tab "Para rever" → "confirmada".
