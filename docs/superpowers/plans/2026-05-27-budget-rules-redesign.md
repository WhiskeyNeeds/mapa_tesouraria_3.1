# Budget Rules & Detail Panel — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir TreasuryBudgetCategory por regras de associação (TreasuryBudgetRule) e adicionar painel lateral de detalhe na página de Budgets.

**Architecture:** Remove TreasuryBudgetCategory + TreasuryBudgetCategoryLink; adiciona TreasuryBudgetRule (categoryId + textPattern opcional → budgetId). A lógica de auto-associação de transações a budgets passa a usar estas regras — sugestão no formulário manual, aplicação automática no sync do TOConline (com flag `budgetAutoAssigned = true`). O frontend ganha painel lateral com 3 tabs: Transações · Regras · Para rever.

**Tech Stack:** Fastify, Prisma, TypeScript, React, TanStack Query, Tailwind CSS, PostgreSQL

---

## Estrutura de ficheiros

| Acção | Ficheiro |
|---|---|
| Criar | `apps/api/prisma/migrations/20260527000000_budget_rules_redesign/migration.sql` |
| Criar | `apps/api/src/modules/treasury/budget-rules/budget-rules.service.ts` |
| Criar | `apps/api/src/modules/treasury/budget-rules/budget-rules.routes.ts` |
| Criar | `apps/web/src/components/budgets/BudgetPanel.tsx` |
| Criar | `apps/web/src/components/settings/BudgetRulesTab.tsx` |
| Modificar | `apps/api/prisma/schema.prisma` |
| Modificar | `apps/api/src/modules/treasury/budgets/budgets.service.ts` |
| Modificar | `apps/api/src/modules/treasury/receivables/receivables.service.ts` |
| Modificar | `apps/api/src/modules/treasury/payables/payables.service.ts` |
| Modificar | `apps/api/src/server.ts` |
| Modificar | `apps/web/src/pages/BudgetsPage.tsx` |
| Modificar | `apps/web/src/pages/SettingsPage.tsx` |
| Modificar | `apps/web/src/pages/PayablesPage.tsx` |
| Modificar | `apps/web/src/pages/ReceivablesPage.tsx` |
| Eliminar | `apps/api/src/modules/treasury/budget-categories/budget-categories.service.ts` |
| Eliminar | `apps/api/src/modules/treasury/budget-categories/budget-categories.routes.ts` |
| Eliminar | `apps/web/src/components/settings/BudgetCategoriesTab.tsx` |

---

## Task 1: Migração SQL + Schema Prisma

**Files:**
- Create: `apps/api/prisma/migrations/20260527000000_budget_rules_redesign/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Criar ficheiro de migração SQL**

```sql
-- apps/api/prisma/migrations/20260527000000_budget_rules_redesign/migration.sql

-- 1. Criar nova tabela de regras de budget
CREATE TABLE "treasury_budget_rules" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "textPattern" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_budget_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "treasury_budget_rules_clientId_budgetId_idx" ON "treasury_budget_rules"("clientId", "budgetId");
CREATE INDEX "treasury_budget_rules_clientId_categoryId_idx" ON "treasury_budget_rules"("clientId", "categoryId");
ALTER TABLE "treasury_budget_rules" ADD CONSTRAINT "treasury_budget_rules_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_budget_rules" ADD CONSTRAINT "treasury_budget_rules_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "treasury_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_budget_rules" ADD CONSTRAINT "treasury_budget_rules_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "treasury_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Adicionar budgetAutoAssigned às tabelas de receivables e payables
ALTER TABLE "treasury_receivables" ADD COLUMN "budgetAutoAssigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "treasury_payables" ADD COLUMN "budgetAutoAssigned" BOOLEAN NOT NULL DEFAULT false;

-- 3. Remover índices sobre budgetCategoryId antes de remover colunas
DROP INDEX IF EXISTS "treasury_receivables_clientId_budgetCategoryId_idx";
DROP INDEX IF EXISTS "treasury_payables_clientId_budgetCategoryId_idx";

-- 4. Remover as foreign keys de budgetCategoryId
ALTER TABLE "treasury_receivables" DROP CONSTRAINT IF EXISTS "treasury_receivables_budgetCategoryId_fkey";
ALTER TABLE "treasury_payables" DROP CONSTRAINT IF EXISTS "treasury_payables_budgetCategoryId_fkey";

-- 5. Remover colunas budgetCategoryId
ALTER TABLE "treasury_receivables" DROP COLUMN IF EXISTS "budgetCategoryId";
ALTER TABLE "treasury_payables" DROP COLUMN IF EXISTS "budgetCategoryId";

-- 6. Remover tabelas antigas (a de links primeiro por causa da FK)
DROP TABLE IF EXISTS "treasury_budget_category_links";
DROP TABLE IF EXISTS "treasury_budget_categories";
```

- [ ] **Step 2: Aplicar migração**

```bash
cd apps/api
npx prisma migrate dev --name budget_rules_redesign
```

Se falhar por conflito de migração, usa `migrate deploy` ou cria o ficheiro manualmente e corre:
```bash
npx prisma migrate resolve --applied 20260527000000_budget_rules_redesign
npx prisma generate
```

- [ ] **Step 3: Actualizar schema.prisma**

Em `apps/api/prisma/schema.prisma`, faz as seguintes alterações:

**3a. Em `TreasuryCategory` (por volta da linha 282), adiciona a relação:**
```prisma
  rules    TreasuryBudgetRule[]
```
(após a linha `movements TreasuryBankMovement[]`)

**3b. Em `TreasuryBudget` (por volta da linha 823), substitui `categoryLinks` por `rules`:**
```prisma
  // REMOVER: categoryLinks TreasuryBudgetCategoryLink[]
  rules       TreasuryBudgetRule[]
```

**3c. Em `TreasuryReceivable` (por volta da linha 455-480), remove os campos e relação de budgetCategory e adiciona budgetAutoAssigned:**
```prisma
  // REMOVER estas linhas:
  //   budgetCategoryId String?
  //   budgetCategory   TreasuryBudgetCategory?  @relation(fields: [budgetCategoryId], references: [id], onDelete: SetNull)
  //   @@index([clientId, budgetCategoryId])

  // ADICIONAR (após budgetId):
  budgetAutoAssigned Boolean @default(false)
```

**3d. Em `TreasuryPayable` (por volta da linha 515-540), igual ao receivable:**
```prisma
  // REMOVER: budgetCategoryId, budgetCategory relation, index
  // ADICIONAR:
  budgetAutoAssigned Boolean @default(false)
```

**3e. REMOVER os modelos completos `TreasuryBudgetCategory` e `TreasuryBudgetCategoryLink` (linhas 857-893).**

**3f. ADICIONAR o novo modelo `TreasuryBudgetRule` no fim do ficheiro (antes do `}`  final se existir, ou simplesmente a seguir ao último modelo):**
```prisma
model TreasuryBudgetRule {
  id          String   @id @default(cuid())
  clientId    String
  budgetId    String
  categoryId  String
  textPattern String?  @db.VarChar(200)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  client   Client           @relation(fields: [clientId], references: [id], onDelete: Cascade)
  budget   TreasuryBudget   @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  category TreasuryCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([clientId, budgetId])
  @@index([clientId, categoryId])
  @@map("treasury_budget_rules")
}
```

- [ ] **Step 4: Regenerar o Prisma Client**

```bash
cd apps/api
npx prisma generate
```

Expected: `✔ Generated Prisma Client` sem erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: migração DB — budget rules redesign (remove TreasuryBudgetCategory, add TreasuryBudgetRule)"
```

---

## Task 2: BudgetRulesService

**Files:**
- Create: `apps/api/src/modules/treasury/budget-rules/budget-rules.service.ts`

- [ ] **Step 1: Criar o serviço**

```typescript
// apps/api/src/modules/treasury/budget-rules/budget-rules.service.ts
import type { PrismaClient, TreasuryCategoryType } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export interface BudgetSuggestion {
  budgetId: string
  budgetName: string
  ruleDescription: string
}

export class TreasuryBudgetRulesService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, budgetId?: string) {
    const rules = await this.prisma.treasuryBudgetRule.findMany({
      where: { clientId, ...(budgetId ? { budgetId } : {}) },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
      orderBy: [{ budgetId: 'asc' }, { createdAt: 'desc' }],
    })
    return rules
  }

  async create(clientId: string, data: { budgetId: string; categoryId: string; textPattern?: string }) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id: data.budgetId, clientId, deletedAt: null },
    })
    if (!budget) throw httpError(404, 'Budget não encontrado')

    const category = await this.prisma.treasuryCategory.findFirst({
      where: { id: data.categoryId, clientId, deletedAt: null },
    })
    if (!category) throw httpError(404, 'Categoria não encontrada')

    if (category.type !== budget.type) {
      throw httpError(400, `A categoria '${category.name}' é do tipo ${category.type === 'REVENUE' ? 'Receita' : 'Despesa'} e o budget é do tipo ${budget.type === 'REVENUE' ? 'Receita' : 'Despesa'}`)
    }

    return this.prisma.treasuryBudgetRule.create({
      data: {
        clientId,
        budgetId: data.budgetId,
        categoryId: data.categoryId,
        textPattern: data.textPattern?.trim() || null,
      },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    })
  }

  async update(clientId: string, id: string, data: { textPattern?: string | null }) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    return this.prisma.treasuryBudgetRule.update({
      where: { id },
      data: { textPattern: data.textPattern?.trim() || null },
      include: {
        budget: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true } },
      },
    })
  }

  async delete(clientId: string, id: string) {
    const rule = await this.prisma.treasuryBudgetRule.findFirst({ where: { id, clientId } })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    await this.prisma.treasuryBudgetRule.delete({ where: { id } })
  }

  /**
   * Dado um categoryId e um texto livre (descrição + nome de entidade),
   * devolve o melhor budget que corresponde a alguma regra.
   *
   * Prioridade: regras com textPattern que batem no texto > regras sem textPattern.
   * Em empate, a regra mais recente (createdAt DESC) prevalece.
   * O budget tem de estar ACTIVE e não deleted.
   */
  async suggest(
    clientId: string,
    categoryId: string | null | undefined,
    text?: string,
  ): Promise<BudgetSuggestion | null> {
    if (!categoryId) return null

    const rules = await this.prisma.treasuryBudgetRule.findMany({
      where: {
        clientId,
        categoryId,
        budget: { deletedAt: null, status: 'ACTIVE' },
      },
      include: {
        budget: { select: { id: true, name: true } },
        category: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (rules.length === 0) return null

    const textLower = (text ?? '').toLowerCase()

    const specific = rules.filter(
      (r) => r.textPattern && textLower.includes(r.textPattern.toLowerCase()),
    )
    const winner = specific[0] ?? rules.find((r) => !r.textPattern) ?? null

    if (!winner) return null

    return {
      budgetId: winner.budget.id,
      budgetName: winner.budget.name,
      ruleDescription: winner.textPattern
        ? `${winner.category.name} + "${winner.textPattern}"`
        : winner.category.name,
    }
  }
}
```

- [ ] **Step 2: Verificar que TypeScript compila**

```bash
cd apps/api
npx tsc --noEmit
```

Expected: sem erros em `budget-rules.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/treasury/budget-rules/budget-rules.service.ts
git commit -m "feat: TreasuryBudgetRulesService — CRUD + suggest"
```

---

## Task 3: BudgetRulesRoutes

**Files:**
- Create: `apps/api/src/modules/treasury/budget-rules/budget-rules.routes.ts`

- [ ] **Step 1: Criar as rotas**

```typescript
// apps/api/src/modules/treasury/budget-rules/budget-rules.routes.ts
import type { FastifyInstance } from 'fastify'
import { TreasuryBudgetRulesService } from './budget-rules.service.js'

export async function budgetRulesRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryBudgetRulesService(fastify.prisma)
  const prefix = '/treasury/:clientId/budget-rules'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  // GET /treasury/:clientId/budget-rules?budgetId=xxx  (opcional — filtra por budget)
  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { budgetId } = request.query as { budgetId?: string }
    return reply.send(await svc.list(clientId, budgetId))
  })

  // GET /treasury/:clientId/budget-rules/suggest?categoryId=xxx&text=yyy
  // Nota: rota estática "suggest" ANTES da rota dinâmica "/:id" — Fastify resolve estáticas primeiro.
  fastify.get(`${prefix}/suggest`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { categoryId, text } = request.query as { categoryId?: string; text?: string }
    return reply.send(await svc.suggest(clientId, categoryId, text))
  })

  fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const body = request.body as { budgetId: string; categoryId: string; textPattern?: string }
    return reply.status(201).send(await svc.create(clientId, body))
  })

  fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    const body = request.body as { textPattern?: string | null }
    return reply.send(await svc.update(clientId, id, body))
  })

  fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
    const { clientId, id } = request.params as { clientId: string; id: string }
    await svc.delete(clientId, id)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 2: Registar as rotas e remover as antigas em server.ts**

Em `apps/api/src/server.ts`:

Substitui:
```typescript
import { budgetCategoriesRoutes } from './modules/treasury/budget-categories/budget-categories.routes.js'
```
Por:
```typescript
import { budgetRulesRoutes } from './modules/treasury/budget-rules/budget-rules.routes.js'
```

Substitui (na secção de registo de rotas):
```typescript
await fastify.register(budgetCategoriesRoutes, { prefix: V1 })
```
Por:
```typescript
await fastify.register(budgetRulesRoutes, { prefix: V1 })
```

- [ ] **Step 3: Verificar compilação**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/treasury/budget-rules/ apps/api/src/server.ts
git commit -m "feat: budget-rules routes — CRUD + suggest endpoint"
```

---

## Task 4: Actualizar BudgetsService

**Files:**
- Modify: `apps/api/src/modules/treasury/budgets/budgets.service.ts`

- [ ] **Step 1: Remover lógica de budgetCategory e actualizar list + getById**

Substitui o ficheiro completo por este conteúdo:

```typescript
// apps/api/src/modules/treasury/budgets/budgets.service.ts
import type { PrismaClient, TreasuryCategoryType, TreasuryBudgetStatus, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { audit, diffEntity } from '../../../lib/audit.js'

export interface BudgetProgress {
  paidAmount: number
  expectedAmount: number
  availableAmount: number
  totalAllocated: number
  overrunAmount: number
}

export class TreasuryBudgetsService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, filters: { status?: TreasuryBudgetStatus; type?: TreasuryCategoryType } = {}) {
    const where: Prisma.TreasuryBudgetWhereInput = {
      clientId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    }

    const budgets = await this.prisma.treasuryBudget.findMany({
      where,
      include: {
        rules: {
          include: { category: { select: { id: true, name: true, color: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    })

    const withProgress = await Promise.all(
      budgets.map(async (b) => {
        const pendingReviewCount = await this.prisma[b.type === 'REVENUE' ? 'treasuryReceivable' : 'treasuryPayable'].count({
          where: { budgetId: b.id, budgetAutoAssigned: true, deletedAt: null },
        })
        return {
          ...b,
          totalAmount: Number(b.totalAmount.toString()),
          progress: await this.computeProgress(b.id, b.type, Number(b.totalAmount.toString())),
          pendingReviewCount,
        }
      }),
    )

    return withProgress
  }

  async getById(clientId: string, id: string) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        rules: {
          include: {
            category: { select: { id: true, name: true, color: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!budget) throw httpError(404, 'Budget not found')

    const totalAmount = Number(budget.totalAmount.toString())
    const progress = await this.computeProgress(budget.id, budget.type, totalAmount)

    const docWhere = { budgetId: id, deletedAt: null }
    const docInclude = { category: { select: { id: true, name: true, color: true } } }
    const docOrder = [{ dueDate: 'asc' as const }]

    const documents = budget.type === 'REVENUE'
      ? await this.prisma.treasuryReceivable.findMany({ where: docWhere, include: docInclude, orderBy: docOrder })
      : await this.prisma.treasuryPayable.findMany({ where: docWhere, include: docInclude, orderBy: docOrder })

    return {
      ...budget,
      totalAmount,
      progress,
      documents,
    }
  }

  private async computeProgress(budgetId: string, type: TreasuryCategoryType, totalAmount: number): Promise<BudgetProgress> {
    if (type === 'REVENUE') {
      const docs = await this.prisma.treasuryReceivable.findMany({
        where: { budgetId, deletedAt: null, status: { not: 'VOID' } },
        select: { receivedAmount: true, pendingAmount: true },
      })
      const paidAmount = docs.reduce((s, d) => s + Number(d.receivedAmount ?? 0), 0)
      const expectedAmount = docs.reduce((s, d) => s + Number(d.pendingAmount ?? 0), 0)
      const totalAllocated = paidAmount + expectedAmount
      const availableAmount = totalAmount - totalAllocated
      const overrunAmount = availableAmount < 0 ? -availableAmount : 0
      return { paidAmount, expectedAmount, availableAmount, totalAllocated, overrunAmount }
    }

    const docs = await this.prisma.treasuryPayable.findMany({
      where: { budgetId, deletedAt: null, status: { not: 'VOID' } },
      select: { paidAmount: true, pendingAmount: true },
    })
    const paidAmount = docs.reduce((s, d) => s + Number(d.paidAmount ?? 0), 0)
    const expectedAmount = docs.reduce((s, d) => s + Number(d.pendingAmount ?? 0), 0)
    const totalAllocated = paidAmount + expectedAmount
    const availableAmount = totalAmount - totalAllocated
    const overrunAmount = availableAmount < 0 ? -availableAmount : 0
    return { paidAmount, expectedAmount, availableAmount, totalAllocated, overrunAmount }
  }

  async create(clientId: string, userId: string, data: {
    name: string
    description?: string
    type: TreasuryCategoryType
    totalAmount: number
    startDate: string
    endDate: string
    currency?: string
    color?: string
    icon?: string
  }) {
    if (!data.name?.trim()) throw httpError(400, 'Nome é obrigatório')
    if (!(data.totalAmount > 0)) throw httpError(400, 'Valor do budget tem de ser positivo')
    const start = new Date(data.startDate)
    const end = new Date(data.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw httpError(400, 'Datas inválidas')
    if (end < start) throw httpError(400, 'Data de fim tem de ser igual ou posterior à data de início')

    const name = data.name.trim()
    const existing = await this.prisma.treasuryBudget.findFirst({
      where: { clientId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    })
    if (existing) throw httpError(409, `Já existe um budget com o nome "${name}"`)

    const created = await this.prisma.treasuryBudget.create({
      data: {
        clientId,
        createdById: userId,
        name,
        description: data.description?.trim() || null,
        type: data.type,
        totalAmount: data.totalAmount,
        currency: data.currency ?? 'EUR',
        startDate: start,
        endDate: end,
        color: data.color ?? null,
        icon: data.icon ?? null,
      },
    })

    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.create',
      entityType: 'Budget', entityId: created.id,
      payload: {
        name: created.name,
        type: created.type,
        totalAmount: Number(created.totalAmount.toString()),
        startDate: created.startDate.toISOString(),
        endDate: created.endDate.toISOString(),
      },
    })

    return created
  }

  async update(clientId: string, userId: string, id: string, data: Partial<{
    name: string
    description: string | null
    totalAmount: number
    startDate: string
    endDate: string
    color: string | null
    icon: string | null
    status: TreasuryBudgetStatus
  }>) {
    const budget = await this.prisma.treasuryBudget.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!budget) throw httpError(404, 'Budget not found')

    const updateData: Prisma.TreasuryBudgetUpdateInput = {}
    if (data.name !== undefined) {
      const newName = data.name.trim()
      if (!newName) throw httpError(400, 'Nome é obrigatório')
      const clash = await this.prisma.treasuryBudget.findFirst({
        where: { clientId, deletedAt: null, name: { equals: newName, mode: 'insensitive' }, NOT: { id } },
        select: { id: true },
      })
      if (clash) throw httpError(409, `Já existe um budget com o nome "${newName}"`)
      updateData.name = newName
    }
    if (data.description !== undefined) updateData.description = data.description?.trim() || null
    if (data.totalAmount !== undefined) {
      if (!(data.totalAmount > 0)) throw httpError(400, 'Valor do budget tem de ser positivo')
      updateData.totalAmount = data.totalAmount
    }
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate)
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate)
    if (data.color !== undefined) updateData.color = data.color
    if (data.icon !== undefined) updateData.icon = data.icon
    if (data.status !== undefined) updateData.status = data.status

    const updated = await this.prisma.treasuryBudget.update({ where: { id }, data: updateData })

    const changes = diffEntity(
      budget as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    )
    if (Object.keys(changes).length > 0) {
      await audit(this.prisma, {
        clientId, userId,
        action: 'budget.update',
        entityType: 'Budget', entityId: id,
        payload: { changes },
      })
    }

    return updated
  }

  async delete(clientId: string, userId: string, id: string) {
    const budget = await this.prisma.treasuryBudget.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!budget) throw httpError(404, 'Budget not found')
    await this.prisma.treasuryBudget.update({ where: { id }, data: { deletedAt: new Date() } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'budget.delete',
      entityType: 'Budget', entityId: id,
      payload: { name: budget.name, totalAmount: Number(budget.totalAmount.toString()) },
    })
  }

  async assertCompatible(clientId: string, budgetId: string, expectedType: TreasuryCategoryType) {
    const budget = await this.prisma.treasuryBudget.findFirst({
      where: { id: budgetId, clientId, deletedAt: null },
    })
    if (!budget) throw httpError(404, 'Budget não encontrado')
    if (budget.type !== expectedType) {
      throw httpError(400, `Budget '${budget.name}' é do tipo ${budget.type === 'REVENUE' ? 'Receitas' : 'Despesas'} e não pode ser associado a este documento`)
    }
    if (budget.status === 'ARCHIVED') {
      throw httpError(400, `Budget '${budget.name}' está arquivado`)
    }
  }
}
```

- [ ] **Step 2: Verificar compilação**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/treasury/budgets/budgets.service.ts
git commit -m "feat: BudgetsService — remover lógica de budgetCategory, adicionar pendingReviewCount e rules"
```

---

## Task 5: Actualizar ReceivablesService

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts`

- [ ] **Step 1: Remover budgetCategoryId do método create**

No método `create`, localiza o bloco que valida `budgetCategoryId` (aprox. linhas 162-179) e substitui por:

```typescript
    // Auto-associação por regra de budget
    let resolvedBudgetId = data.budgetId
    let budgetAutoAssigned = false
    if (data.budgetId) {
      await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'REVENUE')
    } else if (data.categoryId) {
      const suggestion = await this.budgetRulesSvc.suggest(
        clientId,
        data.categoryId,
        [data.entityName, data.description].filter(Boolean).join(' '),
      )
      if (suggestion) {
        resolvedBudgetId = suggestion.budgetId
        budgetAutoAssigned = true
      }
    }
```

E no bloco de criação do registo (onde usa `resolvedBudgetId`), adiciona `budgetAutoAssigned`:
```typescript
        ...(resolvedBudgetId ? { budgetId: resolvedBudgetId, budgetAutoAssigned } : {}),
```
(Remover a linha `...(data.budgetCategoryId ? { budgetCategoryId: data.budgetCategoryId } : {})`)

- [ ] **Step 2: Remover budgetCategoryId do método update**

No método `update`, remove o bloco que valida `budgetCategoryId` (aprox. linhas 284-299) e substitui `budgetId` handling por:

```typescript
    if (data.budgetId !== undefined) {
      if (data.budgetId === null) {
        updateData.budget = { disconnect: true }
        updateData.budgetAutoAssigned = false
      } else {
        await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'REVENUE')
        updateData.budget = { connect: { id: data.budgetId } }
        updateData.budgetAutoAssigned = false
      }
    }
    // Confirmar/mover/remover associação automática
    if (data.budgetAutoAssigned !== undefined) {
      updateData.budgetAutoAssigned = data.budgetAutoAssigned
    }
```

- [ ] **Step 3: Actualizar tipo de data no update**

No tipo do parâmetro `data` do método `update`, substitui `budgetCategoryId: string | null` por `budgetAutoAssigned?: boolean`.

- [ ] **Step 4: Injectar BudgetRulesService no constructor**

No início do ficheiro, adiciona o import:
```typescript
import { TreasuryBudgetRulesService } from '../budget-rules/budget-rules.service.js'
```

No constructor:
```typescript
  constructor(
    private prisma: PrismaClient,
    private budgetsSvc: TreasuryBudgetsService,
    private budgetRulesSvc: TreasuryBudgetRulesService,
  ) {}
```

- [ ] **Step 5: Actualizar instanciação em receivables.routes.ts**

Em `apps/api/src/modules/treasury/receivables/receivables.routes.ts`, adiciona:
```typescript
import { TreasuryBudgetRulesService } from '../budget-rules/budget-rules.service.js'
```
E actualiza a criação do serviço:
```typescript
  const budgetRulesSvc = new TreasuryBudgetRulesService(fastify.prisma)
  const svc = new TreasuryReceivablesService(fastify.prisma, budgetsSvc, budgetRulesSvc)
```

- [ ] **Step 6: Verificar compilação**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/treasury/receivables/
git commit -m "feat: ReceivablesService — substituir budgetCategoryId por budget rules auto-assign"
```

---

## Task 6: Actualizar PayablesService

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts`

- [ ] **Step 1: Aplicar as mesmas alterações que no Task 5, mas para EXPENSE**

Mesma estrutura que o Task 5 mas com `'EXPENSE'` em vez de `'REVENUE'`. Loca os mesmos blocos (`budgetCategoryId` em create e update) e aplica as mesmas substituições.

No `create`:
```typescript
    // Auto-associação por regra de budget
    let resolvedBudgetId = data.budgetId
    let budgetAutoAssigned = false
    if (data.budgetId) {
      await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'EXPENSE')
    } else if (data.categoryId) {
      const suggestion = await this.budgetRulesSvc.suggest(
        clientId,
        data.categoryId,
        [data.entityName, data.description].filter(Boolean).join(' '),
      )
      if (suggestion) {
        resolvedBudgetId = suggestion.budgetId
        budgetAutoAssigned = true
      }
    }
```

No bloco de persistência:
```typescript
        ...(resolvedBudgetId ? { budgetId: resolvedBudgetId, budgetAutoAssigned } : {}),
```

No `update`:
```typescript
    if (data.budgetId !== undefined) {
      if (data.budgetId === null) {
        updateData.budget = { disconnect: true }
        updateData.budgetAutoAssigned = false
      } else {
        await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'EXPENSE')
        updateData.budget = { connect: { id: data.budgetId } }
        updateData.budgetAutoAssigned = false
      }
    }
    if (data.budgetAutoAssigned !== undefined) {
      updateData.budgetAutoAssigned = data.budgetAutoAssigned
    }
```

Constructor e import iguais ao Task 5.

- [ ] **Step 2: Actualizar payables.routes.ts** — igual ao receivables.routes.ts do Task 5.

- [ ] **Step 3: Verificar compilação**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/treasury/payables/
git commit -m "feat: PayablesService — substituir budgetCategoryId por budget rules auto-assign"
```

---

## Task 7: Eliminar ficheiros obsoletos

**Files:**
- Delete: `apps/api/src/modules/treasury/budget-categories/budget-categories.service.ts`
- Delete: `apps/api/src/modules/treasury/budget-categories/budget-categories.routes.ts`
- Delete: `apps/web/src/components/settings/BudgetCategoriesTab.tsx`

- [ ] **Step 1: Eliminar ficheiros**

```bash
rm "apps/api/src/modules/treasury/budget-categories/budget-categories.service.ts"
rm "apps/api/src/modules/treasury/budget-categories/budget-categories.routes.ts"
rm "apps/web/src/components/settings/BudgetCategoriesTab.tsx"
```

Se a pasta `budget-categories` ficar vazia, elimina-a:
```bash
rmdir "apps/api/src/modules/treasury/budget-categories"
```

- [ ] **Step 2: Verificar compilação (garante que não ficaram imports pendurados)**

```bash
cd apps/api && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remover budget-categories (substituído por budget-rules)"
```

---

## Task 8: BudgetPanel — Componente frontend

**Files:**
- Create: `apps/web/src/components/budgets/BudgetPanel.tsx`

- [ ] **Step 1: Criar o componente**

```typescript
// apps/web/src/components/budgets/BudgetPanel.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { X, Pencil, Trash2, CheckCircle, MoveRight, XCircle, Plus } from 'lucide-react'

interface BudgetProgress { paidAmount: number; expectedAmount: number; availableAmount: number; totalAllocated: number; overrunAmount: number }
interface Rule { id: string; textPattern: string | null; budget: { id: string; name: string }; category: { id: string; name: string; color: string | null } }
interface Doc { id: string; entityName: string | null; description: string | null; dueDate: string; totalAmount: number; paidAmount?: number; receivedAmount?: number; pendingAmount: number; status: string; budgetAutoAssigned: boolean; category?: { id: string; name: string; color: string | null } | null }
interface BudgetDetail {
  id: string; name: string; type: 'REVENUE' | 'EXPENSE'; status: string
  startDate: string; endDate: string; totalAmount: number; color: string | null
  progress: BudgetProgress; rules: Rule[]; documents: Doc[]
}
interface Category { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; color: string | null }
interface Budget { id: string; name: string }

const STATUS_LABEL: Record<string, string> = { OPEN: 'Aberto', PARTIAL: 'Parcial', PAID: 'Pago', VOID: 'Anulado' }
const STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700',
  PARTIAL: 'bg-blue-50 text-blue-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  VOID: 'bg-gray-100 text-gray-500',
}

export default function BudgetPanel({
  budgetId,
  onClose,
  onEdit,
  onDelete,
}: {
  budgetId: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'transactions' | 'rules' | 'review'>('transactions')
  const [newRule, setNewRule] = useState({ categoryId: '', textPattern: '' })
  const [showNewRule, setShowNewRule] = useState(false)
  const [movingDocId, setMovingDocId] = useState<string | null>(null)
  const [moveTargetBudgetId, setMoveTargetBudgetId] = useState('')

  const { data: budget, isLoading } = useQuery<BudgetDetail>({
    queryKey: ['budget-detail', selectedClientId, budgetId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets/${budgetId}`),
    enabled: !!selectedClientId && !!budgetId,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories`),
    enabled: !!selectedClientId && activeTab === 'rules',
  })

  const { data: allBudgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets-active', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets?status=ACTIVE`),
    enabled: !!selectedClientId && movingDocId !== null,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budget-detail', selectedClientId, budgetId] })
    qc.invalidateQueries({ queryKey: ['budgets', selectedClientId] })
  }

  const createRule = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/budget-rules`, {
      budgetId,
      categoryId: newRule.categoryId,
      textPattern: newRule.textPattern || undefined,
    }),
    onSuccess: () => { invalidate(); setShowNewRule(false); setNewRule({ categoryId: '', textPattern: '' }); toast.success('Regra criada') },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => api.delete(`/treasury/${selectedClientId}/budget-rules/${ruleId}`),
    onSuccess: () => { invalidate(); toast.success('Regra eliminada') },
    onError: (e: Error) => toast.error(e.message),
  })

  function patchDoc(docId: string, payload: Record<string, unknown>) {
    const path = `/treasury/${selectedClientId}/${budget!.type === 'REVENUE' ? 'receivables' : 'payables'}/${docId}`
    return api.patch(path, payload)
  }

  const confirmDoc = useMutation({
    mutationFn: (docId: string) => patchDoc(docId, { budgetAutoAssigned: false }),
    onSuccess: () => { invalidate(); toast.success('Transação confirmada') },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeDoc = useMutation({
    mutationFn: (docId: string) => patchDoc(docId, { budgetId: null, budgetAutoAssigned: false }),
    onSuccess: () => { invalidate(); toast.success('Associação removida') },
    onError: (e: Error) => toast.error(e.message),
  })

  const moveDoc = useMutation({
    mutationFn: ({ docId, targetBudgetId }: { docId: string; targetBudgetId: string }) =>
      patchDoc(docId, { budgetId: targetBudgetId, budgetAutoAssigned: false }),
    onSuccess: () => { invalidate(); setMovingDocId(null); toast.success('Transação movida') },
    onError: (e: Error) => toast.error(e.message),
  })

  const confirmAll = useMutation({
    mutationFn: async () => {
      const pending = (budget?.documents ?? []).filter((d) => d.budgetAutoAssigned)
      await Promise.all(pending.map((d) => patchDoc(d.id, { budgetAutoAssigned: false })))
    },
    onSuccess: () => { invalidate(); toast.success('Todas confirmadas') },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading || !budget) {
    return (
      <div className="w-[400px] border-l border-gray-200 bg-white flex items-center justify-center">
        <span className="text-sm text-gray-400">A carregar...</span>
      </div>
    )
  }

  const pendingDocs = budget.documents.filter((d) => d.budgetAutoAssigned)
  const pendingCount = pendingDocs.length
  const color = budget.color ?? (budget.type === 'EXPENSE' ? '#3B82F6' : '#10B981')
  const { progress } = budget
  const paidPct = budget.totalAmount > 0 ? (progress.paidAmount / budget.totalAmount) * 100 : 0
  const expectedPct = budget.totalAmount > 0 ? (progress.expectedAmount / budget.totalAmount) * 100 : 0
  const overrun = progress.availableAmount < 0
  const availableCategories = categories.filter((c) => c.type === budget.type)

  return (
    <div className="w-[420px] flex-shrink-0 border-l border-gray-200 bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="font-semibold text-gray-900">{budget.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(budget.startDate)} → {formatDate(budget.endDate)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded ml-1"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Budget: {formatCurrency(budget.totalAmount)}</span>
          {overrun && <span className="text-rose-600 font-medium">Excedido {formatCurrency(progress.overrunAmount)}</span>}
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
          <div style={{ width: `${Math.min(100, paidPct)}%`, backgroundColor: color }} className="h-full" />
          <div style={{ width: `${Math.max(0, Math.min(100 - paidPct, expectedPct))}%`, backgroundColor: `${color}55` }} className="h-full" />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1.5">
          <span>Pago {formatCurrency(progress.paidAmount)}</span>
          <span>Previsto {formatCurrency(progress.expectedAmount)}</span>
          <span className={overrun ? 'text-rose-600' : ''}>{overrun ? 'Excedido' : 'Disponível'} {formatCurrency(Math.abs(progress.availableAmount))}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50 flex-shrink-0">
        {([
          { key: 'transactions', label: 'Transações' },
          { key: 'rules', label: 'Regras' },
          { key: 'review', label: `Para rever${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-primary-500 text-primary-600'
                : `border-transparent ${t.key === 'review' && pendingCount > 0 ? 'text-amber-600' : 'text-gray-500 hover:text-gray-700'}`
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo das tabs */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* Tab: Transações */}
        {activeTab === 'transactions' && (
          <div className="space-y-2">
            {budget.documents.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">Sem transações associadas a este budget.</p>
            ) : budget.documents.map((doc) => (
              <div key={doc.id} className="border border-gray-200 rounded-lg p-3">
                <div className="flex justify-between items-start">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.entityName ?? '—'}</p>
                    {doc.category && (
                      <p className="text-xs text-gray-500 mt-0.5">{doc.category.name}</p>
                    )}
                    <p className="text-xs text-gray-400">{formatDate(doc.dueDate)}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(doc.totalAmount)}</p>
                    <span className={`inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[doc.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[doc.status] ?? doc.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab: Regras */}
        {activeTab === 'rules' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">Transações que correspondam a estas regras são sugeridas/atribuídas a este budget.</p>

            {budget.rules.length === 0 && !showNewRule && (
              <p className="text-xs text-gray-400 italic text-center py-4">Sem regras. Adiciona uma abaixo.</p>
            )}

            {budget.rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 border border-gray-200 rounded-lg p-2.5">
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-blue-50 text-blue-700">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: rule.category.color ?? '#9CA3AF' }} />
                    {rule.category.name}
                  </span>
                  {rule.textPattern && (
                    <>
                      <span className="text-gray-400 text-xs">+</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">"{rule.textPattern}"</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => { if (confirm('Eliminar esta regra?')) deleteRule.mutate(rule.id) }}
                  className="p-1 text-gray-400 hover:text-rose-600 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {showNewRule && (
              <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Categoria *</label>
                  <select
                    className="input text-sm"
                    value={newRule.categoryId}
                    onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })}
                  >
                    <option value="">Seleccionar categoria...</option>
                    {availableCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Filtro de texto (opcional)</label>
                  <input
                    className="input text-sm"
                    placeholder='ex: "Meo", "EDP"'
                    value={newRule.textPattern}
                    onChange={(e) => setNewRule({ ...newRule, textPattern: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowNewRule(false)} className="btn-secondary flex-1 text-xs py-1.5">Cancelar</button>
                  <button
                    onClick={() => createRule.mutate()}
                    disabled={!newRule.categoryId || createRule.isPending}
                    className="btn-primary flex-1 text-xs py-1.5"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            )}

            {!showNewRule && (
              <button
                onClick={() => setShowNewRule(true)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-primary-600 border border-dashed border-primary-300 rounded-lg py-2 hover:bg-primary-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova regra
              </button>
            )}
          </div>
        )}

        {/* Tab: Para rever */}
        {activeTab === 'review' && (
          <div className="space-y-2">
            {pendingCount === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">Sem transações para rever.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">Atribuídas automaticamente pelo TOConline. Confirma ou redireciona.</p>
                {pendingDocs.map((doc) => (
                  <div key={doc.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{doc.entityName ?? '—'}</p>
                        <p className="text-xs text-gray-500">{formatDate(doc.dueDate)}</p>
                      </div>
                      <p className="text-sm font-semibold text-rose-700">{formatCurrency(doc.totalAmount)}</p>
                    </div>
                    {movingDocId === doc.id ? (
                      <div className="flex gap-1.5">
                        <select
                          className="input text-xs flex-1 py-1"
                          value={moveTargetBudgetId}
                          onChange={(e) => setMoveTargetBudgetId(e.target.value)}
                        >
                          <option value="">Escolher budget...</option>
                          {allBudgets.filter((b) => b.id !== budgetId).map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => moveDoc.mutate({ docId: doc.id, targetBudgetId: moveTargetBudgetId })}
                          disabled={!moveTargetBudgetId || moveDoc.isPending}
                          className="btn-primary text-xs px-2 py-1"
                        >
                          Mover
                        </button>
                        <button onClick={() => setMovingDocId(null)} className="btn-secondary text-xs px-2 py-1">✕</button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => confirmDoc.mutate(doc.id)}
                          className="flex-1 flex items-center justify-center gap-1 text-xs bg-emerald-600 text-white rounded py-1.5 hover:bg-emerald-700"
                        >
                          <CheckCircle className="w-3 h-3" /> Confirmar
                        </button>
                        <button
                          onClick={() => { setMovingDocId(doc.id); setMoveTargetBudgetId('') }}
                          className="flex-1 flex items-center justify-center gap-1 text-xs border border-gray-300 text-gray-700 rounded py-1.5 hover:bg-gray-50"
                        >
                          <MoveRight className="w-3 h-3" /> Mover
                        </button>
                        <button
                          onClick={() => removeDoc.mutate(doc.id)}
                          className="px-2 flex items-center justify-center text-xs border border-red-200 text-rose-600 rounded py-1.5 hover:bg-rose-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => confirmAll.mutate()}
                  disabled={confirmAll.isPending}
                  className="w-full text-xs border border-gray-200 text-gray-700 rounded-lg py-2 hover:bg-gray-50 mt-2"
                >
                  ✓ Confirmar todas ({pendingCount})
                </button>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar que TypeScript compila**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/budgets/BudgetPanel.tsx
git commit -m "feat: BudgetPanel — painel lateral com tabs Transações, Regras, Para rever"
```

---

## Task 9: Actualizar BudgetsPage

**Files:**
- Modify: `apps/web/src/pages/BudgetsPage.tsx`

- [ ] **Step 1: Adicionar estado e lógica do painel lateral**

No início do componente `BudgetsPage`, substitui as interfaces e estado atual pelo seguinte (mantém tudo o resto):

**Actualiza a interface `Budget`** — remove `categories: CategoryLite[]`, adiciona `pendingReviewCount`:
```typescript
interface Budget {
  id: string
  name: string
  description: string | null
  type: 'REVENUE' | 'EXPENSE'
  status: 'ACTIVE' | 'ARCHIVED'
  totalAmount: number
  currency: string
  startDate: string
  endDate: string
  color: string | null
  icon: string | null
  progress: BudgetProgress
  pendingReviewCount: number
}
```

**Adiciona estado do painel** (após as declarações de estado existentes):
```typescript
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null)
```

**Remove a query de `allBudgetCategories`** (apaga estas linhas):
```typescript
  const { data: allBudgetCategories = [] } = useQuery<Category[]>({
    queryKey: ['budget-categories', selectedClientId, false],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budget-categories`),
    enabled: !!selectedClientId,
  })

  const availableCategories = useMemo(
    () => allBudgetCategories.filter((c) => c.type === form.type),
    [allBudgetCategories, form.type],
  )
```

**Remove `categoryIds` do `emptyForm`** e do `form` em geral (era usado para budget categories).

**Remove a secção de categorias no modal** (o bloco que renderiza checkboxes de categorias — aprox. linhas 298-330 do original).

**Remove `budgetCategoryIds: form.categoryIds` do `submitForm`**.

- [ ] **Step 2: Adicionar o painel lateral e click no card**

**Importa o componente BudgetPanel** no início do ficheiro:
```typescript
import BudgetPanel from '@/components/budgets/BudgetPanel'
```

**Remove o import de `Tag`** (já não é necessário com a remoção das categorias do card).

**Envolve a lista + painel num flex container.** No JSX, substitui o wrapper `<div className="space-y-6">` na área dos cards por:

```tsx
      {/* Lista + Painel */}
      <div className="flex gap-0 -mx-0">
        <div className={`flex-1 min-w-0 space-y-3 ${selectedBudgetId ? 'pr-4' : ''}`}>
          {isLoading ? (
            <div className="text-center py-12 text-gray-500">A carregar...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
              <Wallet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Sem budgets {showArchived ? 'arquivados' : 'ativos'} para mostrar.</p>
            </div>
          ) : (
            filtered.map((b) => (
              <BudgetCard
                key={b.id}
                budget={b}
                selected={selectedBudgetId === b.id}
                onClick={() => setSelectedBudgetId(b.id === selectedBudgetId ? null : b.id)}
                onEdit={() => { startEdit(b); setSelectedBudgetId(null) }}
                onDelete={() => {
                  if (confirm(`Eliminar budget "${b.name}"?`)) {
                    deleteBudget.mutate(b.id)
                    setSelectedBudgetId(null)
                  }
                }}
                onToggleArchive={() => toggleArchive.mutate({ id: b.id, status: b.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' })}
              />
            ))
          )}
        </div>

        {selectedBudgetId && (
          <BudgetPanel
            budgetId={selectedBudgetId}
            onClose={() => setSelectedBudgetId(null)}
            onEdit={() => {
              const b = filtered.find((x) => x.id === selectedBudgetId)
              if (b) startEdit(b)
            }}
            onDelete={() => {
              const b = filtered.find((x) => x.id === selectedBudgetId)
              if (b && confirm(`Eliminar budget "${b.name}"?`)) {
                deleteBudget.mutate(b.id)
                setSelectedBudgetId(null)
              }
            }}
          />
        )}
      </div>
```

- [ ] **Step 3: Actualizar BudgetCard para aceitar `selected` e `onClick`**

Na função `BudgetCard`, adiciona as props:
```typescript
function BudgetCard({ budget, selected, onClick, onEdit, onDelete, onToggleArchive }: {
  budget: Budget
  selected: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleArchive: () => void
})
```

Envolve o card principal com `onClick` e adiciona anel de selecção:
```tsx
    <div
      className={`bg-white border rounded-xl p-5 cursor-pointer transition-all ${
        selected ? 'border-primary-400 ring-1 ring-primary-300' : overrun ? 'border-rose-300 bg-rose-50/30' : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={onClick}
    >
```

Para os botões de acção, adiciona `e.stopPropagation()` para não activar o `onClick` do card:
```tsx
      <button onClick={(e) => { e.stopPropagation(); onEdit() }} ...>
      <button onClick={(e) => { e.stopPropagation(); onToggleArchive() }} ...>
      <button onClick={(e) => { e.stopPropagation(); onDelete() }} ...>
```

Adiciona badge de "para rever" quando `pendingReviewCount > 0`:
```tsx
              {budget.pendingReviewCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                  {budget.pendingReviewCount} para rever
                </span>
              )}
```

Remove o bloco que renderizava `budget.categories.map(...)` (com o Tag icon) — já não existe.

- [ ] **Step 4: Verificar que TypeScript compila e a página funciona**

```bash
cd apps/web && npx tsc --noEmit
```

Abre http://localhost:5173/budgets e verifica:
- Clica num budget → painel aparece à direita
- Clica noutro budget → painel muda
- Clica no mesmo budget → painel fecha
- Botões de editar/arquivar/eliminar funcionam sem abrir o painel

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BudgetsPage.tsx
git commit -m "feat: BudgetsPage — painel lateral e remoção de budget categories"
```

---

## Task 10: BudgetRulesTab — Settings

**Files:**
- Create: `apps/web/src/components/settings/BudgetRulesTab.tsx`

- [ ] **Step 1: Criar o componente**

```typescript
// apps/web/src/components/settings/BudgetRulesTab.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, Trash2 } from 'lucide-react'

interface Rule {
  id: string
  textPattern: string | null
  budget: { id: string; name: string; type: 'REVENUE' | 'EXPENSE' }
  category: { id: string; name: string; color: string | null }
}
interface Budget { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; status: string }
interface Category { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; color: string | null }

export default function BudgetRulesTab() {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ budgetId: '', categoryId: '', textPattern: '' })

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ['budget-rules', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budget-rules`),
    enabled: !!selectedClientId,
  })

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets-active', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets?status=ACTIVE`),
    enabled: !!selectedClientId && showNew,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories`),
    enabled: !!selectedClientId && showNew,
  })

  const selectedBudget = budgets.find((b) => b.id === form.budgetId)
  const availableCategories = categories.filter((c) => !selectedBudget || c.type === selectedBudget.type)

  const createMut = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/budget-rules`, {
      budgetId: form.budgetId,
      categoryId: form.categoryId,
      textPattern: form.textPattern || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-rules', selectedClientId] })
      setShowNew(false)
      setForm({ budgetId: '', categoryId: '', textPattern: '' })
      toast.success('Regra criada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/budget-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-rules', selectedClientId] })
      toast.success('Regra eliminada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Associação automática de transações a budgets por categoria e filtro de texto.</p>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nova regra
        </button>
      </div>

      <div className="card overflow-hidden">
        {rules.length === 0 ? (
          <div className="px-5 py-8 text-xs text-gray-400 italic text-center">
            Sem regras de budget. Cria uma regra para associar automaticamente transações a budgets.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Budget</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">Filtro de texto</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{rule.budget.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-medium bg-blue-50 text-blue-700">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: rule.category.color ?? '#9CA3AF' }} />
                      {rule.category.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {rule.textPattern
                      ? <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">"{rule.textPattern}"</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { if (confirm('Eliminar esta regra?')) deleteMut.mutate(rule.id) }}
                      className="p-1 text-gray-400 hover:text-rose-600 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        💡 Regras com filtro de texto têm prioridade sobre regras só por categoria. Em empate, a regra mais recente prevalece.
      </p>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nova Regra de Budget">
        <div className="space-y-4">
          <div>
            <label className="label">Budget *</label>
            <select
              className="input"
              value={form.budgetId}
              onChange={(e) => setForm({ ...form, budgetId: e.target.value, categoryId: '' })}
            >
              <option value="">Seleccionar budget...</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.type === 'EXPENSE' ? 'Despesa' : 'Receita'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Categoria *</label>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              disabled={!form.budgetId}
            >
              <option value="">Seleccionar categoria...</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {form.budgetId && availableCategories.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Sem categorias do tipo compatível com este budget.</p>
            )}
          </div>
          <div>
            <label className="label">Filtro de texto (opcional)</label>
            <input
              className="input"
              placeholder='ex: "Meo", "NOS", "EDP"'
              value={form.textPattern}
              onChange={(e) => setForm({ ...form, textPattern: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">Verificado na descrição e no nome da contraparte (case-insensitive).</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowNew(false)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.budgetId || !form.categoryId || createMut.isPending}
              className="btn-primary flex-1"
            >
              Criar regra
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
```

- [ ] **Step 2: Verificar compilação**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/settings/BudgetRulesTab.tsx
git commit -m "feat: BudgetRulesTab — vista global de regras de budget em Definições"
```

---

## Task 11: Actualizar SettingsPage

**Files:**
- Modify: `apps/web/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Substituir BudgetCategoriesTab por BudgetRulesTab e adicionar tab "Regras de Budget"**

No topo do ficheiro, substitui:
```typescript
import BudgetCategoriesTab from '@/components/settings/BudgetCategoriesTab'
```
Por:
```typescript
import BudgetRulesTab from '@/components/settings/BudgetRulesTab'
```

No tipo do estado `categoriesSubTab`, substitui `'budgets'` por `'budget-rules'`:
```typescript
const [categoriesSubTab, setCategoriesSubTab] = useState<'movements' | 'budget-rules'>('movements')
```

No JSX, localiza a sub-tab "Budgets" e substitui a label e o key:
```tsx
// ANTES:
{ v: 'budgets', label: 'Budgets' }
// DEPOIS:
{ v: 'budget-rules', label: 'Regras de Budget' }
```

E o render condicional que mostrava `<BudgetCategoriesTab showArchived={showArchived} />`:
```tsx
{categoriesSubTab === 'budget-rules' && <BudgetRulesTab />}
```

- [ ] **Step 2: Verificar compilação**

```bash
cd apps/web && npx tsc --noEmit
```

Abre http://localhost:5173/definicoes → Categorias → separador "Regras de Budget" e verifica que a tabela de regras aparece.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/SettingsPage.tsx
git commit -m "feat: SettingsPage — substituir tab de categorias de budget por Regras de Budget"
```

---

## Task 12: Actualizar PayablesPage e ReceivablesPage

**Files:**
- Modify: `apps/web/src/pages/PayablesPage.tsx`
- Modify: `apps/web/src/pages/ReceivablesPage.tsx`

- [ ] **Step 1: Actualizar PayablesPage — remover budgetCategoryId e adicionar sugestão**

**1a. Remove a interface `BudgetCategory`** e a query `budgetCategories`.

**1b. Remove `budgetCategoryId` do `emptyForm`** e dos outros forms (`outrasForm`, etc.).

**1c. Remove a query de budget-categories:**
```typescript
// APAGAR:
const { data: budgetCategories = [] } = useQuery<BudgetCategory[]>({
  queryKey: ['budget-categories-expense', selectedClientId],
  queryFn: () => api.get(`/treasury/${selectedClientId}/budget-categories?type=EXPENSE`),
  enabled: !!selectedClientId,
})
```

**1d. Remove `budgetCategoryId` dos payloads de create/update:**
```typescript
// ANTES:
budgetId: form.budgetId || undefined,
budgetCategoryId: form.budgetCategoryId || undefined,
// DEPOIS:
budgetId: form.budgetId || undefined,
```

**1e. Adiciona estado para a sugestão:**
```typescript
const [budgetSuggestion, setBudgetSuggestion] = useState<{ budgetId: string; budgetName: string; ruleDescription: string } | null>(null)
```

**1f. Quando o utilizador altera a categoria no formulário**, dispara uma chamada ao endpoint de sugestão. Localiza o handler de mudança de `categoryId` no form e adiciona:

```typescript
  async function onCategoryChange(categoryId: string) {
    setForm((f) => ({ ...f, categoryId }))
    setBudgetSuggestion(null)
    if (!categoryId || !selectedClientId) return
    try {
      const suggestion = await api.get<{ budgetId: string; budgetName: string; ruleDescription: string } | null>(
        `/treasury/${selectedClientId}/budget-rules/suggest?categoryId=${categoryId}`,
      )
      if (suggestion) setBudgetSuggestion(suggestion)
    } catch { /* ignora erros */ }
  }
```

Substitui o `onChange` do campo de categoria (no form) por `onCategoryChange`.

**1g. No JSX do formulário, adiciona a caixa de sugestão** após o campo de categoria e antes do campo de budget:

```tsx
{budgetSuggestion && !form.budgetId && (
  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-xs font-semibold text-blue-700 mb-0.5">💡 Sugestão de budget</p>
        <p className="text-sm font-medium text-gray-900">{budgetSuggestion.budgetName}</p>
        <p className="text-xs text-gray-500">Regra: {budgetSuggestion.ruleDescription}</p>
      </div>
      <button onClick={() => setBudgetSuggestion(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
    </div>
    <button
      onClick={() => { setForm((f) => ({ ...f, budgetId: budgetSuggestion.budgetId })); setBudgetSuggestion(null) }}
      className="mt-2 w-full text-xs bg-blue-600 text-white rounded py-1.5 hover:bg-blue-700"
    >
      ✓ Aceitar — Budget "{budgetSuggestion.budgetName}"
    </button>
  </div>
)}
```

**1h. Remove o dropdown de `budgetCategoryId`** do formulário (localiza o campo que usava `budgetCategories` e elimina-o).

- [ ] **Step 2: Aplicar as mesmas alterações em ReceivablesPage.tsx**

As mesmas mudanças mas para REVENUE:
- Remove query `budget-categories-revenue`
- Remove `budgetCategoryId` dos payloads
- Adiciona `onCategoryChange` com chamada ao suggest
- Adiciona caixa de sugestão no JSX
- Remove o campo `budgetCategoryId` do formulário

- [ ] **Step 3: Verificar compilação**

```bash
cd apps/web && npx tsc --noEmit
```

Testa o fluxo manualmente:
1. Vai a Contas a Pagar → Criar nova conta
2. Selecciona uma categoria que tenha uma regra definida
3. Verifica que aparece a caixa de sugestão de budget
4. Clica "Aceitar" → budget fica preenchido no formulário

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PayablesPage.tsx apps/web/src/pages/ReceivablesPage.tsx
git commit -m "feat: PayablesPage + ReceivablesPage — remover budgetCategoryId, adicionar sugestão de budget por regra"
```

---

## Verificação Final

- [ ] **Compilação limpa**

```bash
cd apps/api && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```

- [ ] **Seed e smoke test**

```bash
cd apps/api && npm run db:seed
npm run dev
```

Verificar manualmente:
1. Definições → Regras de Budget: criar uma regra (ex: categoria "Telecomunicações" → budget "Energias")
2. Contas a Pagar → Nova conta: seleccionar "Telecomunicações" → aparece sugestão do budget "Energias"
3. Aceitar a sugestão → budget preenchido no form → criar
4. Budgets → clicar no card "Energias" → painel abre à direita com tab Transações mostrando a conta criada
5. Criar regra directamente no painel (tab Regras) → aparece na lista

- [ ] **Commit final de verificação**

```bash
git add -A
git commit -m "chore: verificação final — budget rules redesign completo"
```
