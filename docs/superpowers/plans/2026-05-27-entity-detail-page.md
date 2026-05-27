# Entity Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma página de detalhe por fornecedor/cliente que agrega dados TOConline, historial de faturas locais, e uma configuração de categoria automática por entidade.

**Architecture:** Nova tabela `TreasuryEntityConfig` no Prisma com endpoints REST (GET/PUT/DELETE). A categoria da config entra na cadeia de auto-categorização de payables/receivables entre regras de classificação e lookup histórico. A página frontend tem layout split: lista de faturas à esquerda (tabs "Atuais"/"Histórico"), painel de info + configuração à direita. Navegação a partir de EmpresaPage, PayablesPage e ReceivablesPage.

**Tech Stack:** Prisma 5, Fastify 5, TypeScript, React 18, React Router v6, TanStack Query, Tailwind CSS.

---

## File Map

| Acção   | Ficheiro |
|---------|----------|
| Create  | `apps/api/prisma/migrations/20260527000000_treasury_entity_configs/migration.sql` |
| Modify  | `apps/api/prisma/schema.prisma` |
| Create  | `apps/api/src/modules/treasury/entity-configs/entity-configs.service.ts` |
| Create  | `apps/api/src/modules/treasury/entity-configs/entity-configs.routes.ts` |
| Modify  | `apps/api/src/server.ts` |
| Modify  | `apps/api/src/modules/treasury/payables/payables.service.ts` |
| Modify  | `apps/api/src/modules/treasury/receivables/receivables.service.ts` |
| Create  | `apps/web/src/pages/EntityDetailPage.tsx` |
| Modify  | `apps/web/src/App.tsx` |
| Modify  | `apps/web/src/pages/EmpresaPage.tsx` |
| Modify  | `apps/web/src/pages/PayablesPage.tsx` |
| Modify  | `apps/web/src/pages/ReceivablesPage.tsx` |

---

## Task 1: DB Migration + Prisma Schema

**Files:**
- Create: `apps/api/prisma/migrations/20260527000000_treasury_entity_configs/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:304-315` (TreasuryCategory) e final do ficheiro (novo model)

- [ ] **Step 1: Criar ficheiro de migração SQL**

Criar o directório e ficheiro:
`apps/api/prisma/migrations/20260527000000_treasury_entity_configs/migration.sql`

```sql
CREATE TABLE "treasury_entity_configs" (
  "id"                TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "entityType"        TEXT NOT NULL,
  "tocEntityId"       TEXT NOT NULL,
  "defaultCategoryId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "treasury_entity_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_entity_configs_clientId_entityType_tocEntityId_key"
    UNIQUE ("clientId", "entityType", "tocEntityId"),
  CONSTRAINT "treasury_entity_configs_defaultCategoryId_fkey"
    FOREIGN KEY ("defaultCategoryId") REFERENCES "treasury_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
```

- [ ] **Step 2: Adicionar relação inversa em TreasuryCategory no schema.prisma**

No ficheiro `apps/api/prisma/schema.prisma`, localizar o model `TreasuryCategory` (linha 282). Adicionar `entityConfigs TreasuryEntityConfig[]` à lista de relações (após `rules TreasuryBudgetRule[]`, linha 309):

Antes:
```prisma
  client              Client                       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  receivables         TreasuryReceivable[]
  payables            TreasuryPayable[]
  movements           TreasuryBankMovement[]
  classificationRules TreasuryClassificationRule[]
  rules               TreasuryBudgetRule[]

  @@unique([clientId, name, type])
```

Depois:
```prisma
  client              Client                       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  receivables         TreasuryReceivable[]
  payables            TreasuryPayable[]
  movements           TreasuryBankMovement[]
  classificationRules TreasuryClassificationRule[]
  rules               TreasuryBudgetRule[]
  entityConfigs       TreasuryEntityConfig[]

  @@unique([clientId, name, type])
```

- [ ] **Step 3: Adicionar model TreasuryEntityConfig no final do schema.prisma**

Adicionar antes do último `}` (ou no final do ficheiro, após o último model):

```prisma
model TreasuryEntityConfig {
  id                String            @id @default(cuid())
  clientId          String
  entityType        String
  tocEntityId       String
  defaultCategoryId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  category TreasuryCategory? @relation(fields: [defaultCategoryId], references: [id], onDelete: SetNull)

  @@unique([clientId, entityType, tocEntityId])
  @@map("treasury_entity_configs")
}
```

- [ ] **Step 4: Aplicar migração e gerar cliente Prisma**

```bash
cd apps/api
npx prisma migrate dev --name treasury_entity_configs
npx prisma generate
```

Resultado esperado: `Your database is now in sync with your schema.` e Prisma Client gerado.

- [ ] **Step 5: Verificar TypeScript**

```bash
cd apps/api
npx tsc --noEmit
```

Resultado esperado: sem erros novos (os 4 erros pré-existentes em `audit.ts`, `bank-accounts.routes.ts`, `payables.routes.ts`, `receivables.routes.ts` são anteriores a esta tarefa).

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/migrations/20260527000000_treasury_entity_configs/migration.sql apps/api/prisma/schema.prisma
git commit -m "feat: adicionar TreasuryEntityConfig — migração e schema Prisma"
```

---

## Task 2: Backend entity-configs Module

**Files:**
- Create: `apps/api/src/modules/treasury/entity-configs/entity-configs.service.ts`
- Create: `apps/api/src/modules/treasury/entity-configs/entity-configs.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar entity-configs.service.ts**

```typescript
// apps/api/src/modules/treasury/entity-configs/entity-configs.service.ts
import type { PrismaClient } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'

export class TreasuryEntityConfigsService {
  constructor(private prisma: PrismaClient) {}

  async get(clientId: string, entityType: string, tocEntityId: string) {
    this.validateEntityType(entityType)
    return this.prisma.treasuryEntityConfig.findUnique({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
      include: { category: { select: { id: true, name: true, color: true } } },
    })
  }

  async upsert(
    clientId: string,
    entityType: string,
    tocEntityId: string,
    data: { defaultCategoryId: string | null },
  ) {
    this.validateEntityType(entityType)

    if (data.defaultCategoryId) {
      const expectedType = entityType === 'supplier' ? 'EXPENSE' : 'REVENUE'
      const category = await this.prisma.treasuryCategory.findFirst({
        where: { id: data.defaultCategoryId, clientId, deletedAt: null },
      })
      if (!category) throw httpError(404, 'Categoria não encontrada')
      if (category.type !== expectedType) {
        const typeLabel = expectedType === 'EXPENSE' ? 'Despesa' : 'Receita'
        throw httpError(400, `A categoria deve ser do tipo ${typeLabel} para este tipo de entidade`)
      }
    }

    return this.prisma.treasuryEntityConfig.upsert({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
      create: {
        clientId,
        entityType,
        tocEntityId,
        defaultCategoryId: data.defaultCategoryId,
      },
      update: { defaultCategoryId: data.defaultCategoryId },
      include: { category: { select: { id: true, name: true, color: true } } },
    })
  }

  async delete(clientId: string, entityType: string, tocEntityId: string) {
    this.validateEntityType(entityType)
    const existing = await this.prisma.treasuryEntityConfig.findUnique({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
    })
    if (!existing) throw httpError(404, 'Configuração não encontrada')
    await this.prisma.treasuryEntityConfig.delete({
      where: { clientId_entityType_tocEntityId: { clientId, entityType, tocEntityId } },
    })
  }

  private validateEntityType(entityType: string) {
    if (entityType !== 'supplier' && entityType !== 'customer') {
      throw httpError(400, 'entityType deve ser "supplier" ou "customer"')
    }
  }
}
```

- [ ] **Step 2: Criar entity-configs.routes.ts**

```typescript
// apps/api/src/modules/treasury/entity-configs/entity-configs.routes.ts
import type { FastifyInstance } from 'fastify'
import { TreasuryEntityConfigsService } from './entity-configs.service.js'

export async function entityConfigsRoutes(fastify: FastifyInstance) {
  const svc = new TreasuryEntityConfigsService(fastify.prisma)
  const prefix = '/treasury/:clientId/entity-configs/:type/:tocId'
  const auth = [fastify.authenticate, fastify.requireClientAccess]

  fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId, type, tocId } = request.params as { clientId: string; type: string; tocId: string }
    const config = await svc.get(clientId, type, tocId)
    return reply.send(config ?? null)
  })

  fastify.put(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId, type, tocId } = request.params as { clientId: string; type: string; tocId: string }
    const body = request.body as { defaultCategoryId: string | null }
    return reply.send(await svc.upsert(clientId, type, tocId, body))
  })

  fastify.delete(prefix, { onRequest: auth }, async (request, reply) => {
    const { clientId, type, tocId } = request.params as { clientId: string; type: string; tocId: string }
    await svc.delete(clientId, type, tocId)
    return reply.status(204).send()
  })
}
```

- [ ] **Step 3: Registar rotas em server.ts**

No ficheiro `apps/api/src/server.ts`, adicionar o import (após o import de `budgetRulesRoutes`, linha 27):

```typescript
import { entityConfigsRoutes } from './modules/treasury/entity-configs/entity-configs.routes.js'
```

E registar a rota (após `await fastify.register(budgetRulesRoutes, { prefix: V1 })`, linha 79):

```typescript
await fastify.register(entityConfigsRoutes, { prefix: V1 })
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd apps/api
npx tsc --noEmit
```

Resultado esperado: sem erros novos além dos 4 pré-existentes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/entity-configs/ apps/api/src/server.ts
git commit -m "feat: adicionar módulo entity-configs (GET/PUT/DELETE) com validação de tipo de categoria"
```

---

## Task 3: Auto-categoria em payables.service.ts create()

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts:138-154`

O bloco actual (linhas 138–154) é:

```typescript
      if (matched) {
        data.categoryId = matched.categoryId
      } else if (data.entityName || data.tocSupplierId) {
        const last = await this.prisma.treasuryPayable.findFirst({
          where: {
            clientId, deletedAt: null,
            categoryId: { not: null },
            OR: [
              ...(data.tocSupplierId ? [{ tocSupplierId: data.tocSupplierId }] : []),
              ...(data.entityName ? [{ entityName: data.entityName }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: { categoryId: true },
        })
        if (last?.categoryId) data.categoryId = last.categoryId
      }
```

- [ ] **Step 1: Substituir o bloco de auto-categorização em payables.service.ts**

Substituir o bloco acima por:

```typescript
      if (matched) {
        data.categoryId = matched.categoryId
      } else if (data.entityName || data.tocSupplierId) {
        // Entity config tem prioridade sobre lookup histórico
        if (data.tocSupplierId) {
          const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({
            where: {
              clientId_entityType_tocEntityId: {
                clientId,
                entityType: 'supplier',
                tocEntityId: String(data.tocSupplierId),
              },
            },
            select: { defaultCategoryId: true },
          })
          if (entityConfig?.defaultCategoryId) {
            data.categoryId = entityConfig.defaultCategoryId
          }
        }
        // Histórico: só corre se a config de entidade não forneceu categoria
        if (!data.categoryId) {
          const last = await this.prisma.treasuryPayable.findFirst({
            where: {
              clientId, deletedAt: null,
              categoryId: { not: null },
              OR: [
                ...(data.tocSupplierId ? [{ tocSupplierId: data.tocSupplierId }] : []),
                ...(data.entityName ? [{ entityName: data.entityName }] : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
            select: { categoryId: true },
          })
          if (last?.categoryId) data.categoryId = last.categoryId
        }
      }
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api
npx tsc --noEmit
```

Resultado esperado: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/treasury/payables/payables.service.ts
git commit -m "feat: auto-categoria em payables — entity config tem prioridade sobre histórico"
```

---

## Task 4: Auto-categoria em receivables.service.ts create()

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts:138-154`

O bloco actual (linhas 138–154) é idêntico ao de payables mas com `tocCustomerId` e `TreasuryReceivable`.

- [ ] **Step 1: Substituir o bloco de auto-categorização em receivables.service.ts**

Substituir o bloco:
```typescript
      if (matched) {
        data.categoryId = matched.categoryId
      } else if (data.entityName || data.tocCustomerId) {
        const last = await this.prisma.treasuryReceivable.findFirst({
          where: {
            clientId, deletedAt: null,
            categoryId: { not: null },
            OR: [
              ...(data.tocCustomerId ? [{ tocCustomerId: data.tocCustomerId }] : []),
              ...(data.entityName ? [{ entityName: data.entityName }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: { categoryId: true },
        })
        if (last?.categoryId) data.categoryId = last.categoryId
      }
```

Por:
```typescript
      if (matched) {
        data.categoryId = matched.categoryId
      } else if (data.entityName || data.tocCustomerId) {
        // Entity config tem prioridade sobre lookup histórico
        if (data.tocCustomerId) {
          const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({
            where: {
              clientId_entityType_tocEntityId: {
                clientId,
                entityType: 'customer',
                tocEntityId: String(data.tocCustomerId),
              },
            },
            select: { defaultCategoryId: true },
          })
          if (entityConfig?.defaultCategoryId) {
            data.categoryId = entityConfig.defaultCategoryId
          }
        }
        // Histórico: só corre se a config de entidade não forneceu categoria
        if (!data.categoryId) {
          const last = await this.prisma.treasuryReceivable.findFirst({
            where: {
              clientId, deletedAt: null,
              categoryId: { not: null },
              OR: [
                ...(data.tocCustomerId ? [{ tocCustomerId: data.tocCustomerId }] : []),
                ...(data.entityName ? [{ entityName: data.entityName }] : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
            select: { categoryId: true },
          })
          if (last?.categoryId) data.categoryId = last.categoryId
        }
      }
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api
npx tsc --noEmit
```

Resultado esperado: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/treasury/receivables/receivables.service.ts
git commit -m "feat: auto-categoria em receivables — entity config tem prioridade sobre histórico"
```

---

## Task 5: EntityDetailPage.tsx

**Files:**
- Create: `apps/web/src/pages/EntityDetailPage.tsx`

- [ ] **Step 1: Criar o componente EntityDetailPage**

```typescript
// apps/web/src/pages/EntityDetailPage.tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import Badge from '@/components/ui/Badge'

interface Props {
  entityType: 'supplier' | 'customer'
}

interface EntityConfig {
  id: string
  defaultCategoryId: string | null
  category: { id: string; name: string; color: string } | null
}

interface LocalDoc {
  id: string
  reference: string
  entityName: string
  documentDate: string | null
  dueDate: string
  totalAmount: number
  pendingAmount: number
  status: string
  category?: { id: string; name: string; color: string } | null
}

interface Category {
  id: string
  name: string
  type: string
  color?: string | null
}

export default function EntityDetailPage({ entityType }: Props) {
  const { tocId } = useParams<{ tocId: string }>()
  const navigate = useNavigate()
  const { selectedClientId: clientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'current' | 'history'>('current')

  const isSupplier = entityType === 'supplier'
  const typeParam = isSupplier ? 'supplier' : 'customer'

  const entityQuery = useQuery<Record<string, unknown>>({
    queryKey: isSupplier
      ? ['toc-supplier-detail', clientId, tocId]
      : ['toc-customer-detail', clientId, tocId],
    queryFn: () =>
      api.get(
        isSupplier
          ? `/toconline/${clientId}/suppliers/${tocId}`
          : `/toconline/${clientId}/customers/${tocId}`,
      ),
    enabled: !!clientId && !!tocId,
    retry: 1,
  })

  const docsQuery = useQuery<{ items: LocalDoc[]; total: number }>({
    queryKey: isSupplier
      ? ['payables', clientId, 'entity-detail', tocId]
      : ['receivables', clientId, 'entity-detail', tocId],
    queryFn: () =>
      api.get(
        isSupplier
          ? `/treasury/${clientId}/payables?tocSupplierId=${tocId}&limit=500`
          : `/treasury/${clientId}/receivables?tocCustomerId=${tocId}&limit=500`,
      ),
    enabled: !!clientId && !!tocId,
  })

  const configQuery = useQuery<EntityConfig | null>({
    queryKey: ['entity-config', clientId, typeParam, tocId],
    queryFn: async () => {
      try {
        return await api.get<EntityConfig>(
          `/treasury/${clientId}/entity-configs/${typeParam}/${tocId}`,
        )
      } catch {
        return null
      }
    },
    enabled: !!clientId && !!tocId,
  })

  const categoriesQuery = useQuery<Category[]>({
    queryKey: isSupplier
      ? ['categories-expense', clientId]
      : ['categories-revenue', clientId],
    queryFn: () =>
      api.get(
        `/treasury/${clientId}/categories?type=${isSupplier ? 'EXPENSE' : 'REVENUE'}`,
      ),
    enabled: !!clientId,
  })

  const updateConfig = useMutation({
    mutationFn: (defaultCategoryId: string | null) =>
      api.put(`/treasury/${clientId}/entity-configs/${typeParam}/${tocId}`, {
        defaultCategoryId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entity-config', clientId, typeParam, tocId] })
      toast.success('Configuração guardada.')
    },
    onError: () => toast.error('Erro ao guardar a configuração.'),
  })

  const entity = entityQuery.data ?? {}
  const entityName = String(entity.business_name ?? entity.name ?? '—')
  const entityNif = String(entity.tax_registration_number ?? entity.fiscal_id ?? '—')
  const entityEmail = String(entity.email ?? '—')
  const entityPhone = String(entity.phone ?? entity.mobile_phone ?? '—')
  const entityAddress = String(entity.address ?? entity.billing_address ?? '—')

  const allDocs = docsQuery.data?.items ?? []
  const currentDocs = allDocs.filter((d) => ['OPEN', 'PARTIAL'].includes(d.status))
  const historyDocs = allDocs.filter((d) => ['SETTLED', 'VOID'].includes(d.status))
  const displayDocs = tab === 'current' ? currentDocs : historyDocs

  const pendingAmount = currentDocs.reduce((s, d) => s + Number(d.pendingAmount), 0)
  const settledAmount = historyDocs.reduce((s, d) => s + Number(d.totalAmount), 0)

  const categories = categoriesQuery.data ?? []
  const currentCategoryId = configQuery.data?.defaultCategoryId ?? ''

  if (entityQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-600 text-sm">Entidade não encontrada no TOConline.</p>
        <button
          onClick={() => navigate('/empresa')}
          className="text-primary-600 hover:underline text-sm"
        >
          ← Voltar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/empresa')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {isSupplier ? 'Fornecedores' : 'Clientes'}
        </button>
        <span className="text-gray-300">/</span>
        <span className="font-semibold text-gray-900 text-sm">
          {entityQuery.isLoading ? 'A carregar...' : entityName}
        </span>
        <span className="ml-auto text-xs text-gray-500 font-mono">NIF: {entityNif}</span>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: invoice list */}
        <div className="flex-[3] flex flex-col min-w-0 border-r border-gray-200">

          {/* Tabs */}
          <div className="flex border-b border-gray-200 flex-shrink-0 bg-white">
            {(['current', 'history'] as const).map((t) => {
              const count = t === 'current' ? currentDocs.length : historyDocs.length
              const label = t === 'current' ? 'Atuais' : 'Histórico'
              const active = tab === t
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    active
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                  <span
                    className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                      active
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {docsQuery.isLoading ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                A carregar...
              </div>
            ) : displayDocs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                {tab === 'current'
                  ? `Sem ${isSupplier ? 'faturas' : 'recebimentos'} em aberto.`
                  : `Sem histórico de ${isSupplier ? 'faturas' : 'recebimentos'}.`}
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-100 bg-gray-50">
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Documento</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vencimento</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Total</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Pendente</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayDocs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">
                        {doc.reference || '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {doc.documentDate ? formatDate(doc.documentDate) : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {formatDate(doc.dueDate)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-800">
                        {formatCurrency(doc.totalAmount)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-semibold ${
                          Number(doc.pendingAmount) > 0 ? 'text-red-600' : 'text-gray-400'
                        }`}
                      >
                        {Number(doc.pendingAmount) > 0
                          ? formatCurrency(doc.pendingAmount)
                          : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={statusVariant(doc.status)}>
                          {statusLabel(doc.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: info + config */}
        <div className="flex-[2] overflow-y-auto bg-gray-50 flex flex-col gap-0">

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 p-4 border-b border-gray-200">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {isSupplier ? 'A pagar' : 'A receber'}
              </div>
              <div
                className={`text-xl font-bold mt-1 ${
                  pendingAmount > 0 ? 'text-red-600' : 'text-gray-400'
                }`}
              >
                {formatCurrency(pendingAmount)}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {isSupplier ? 'Pago (histórico)' : 'Recebido (histórico)'}
              </div>
              <div className="text-xl font-bold mt-1 text-green-600">
                {formatCurrency(settledAmount)}
              </div>
            </div>
          </div>

          {/* TOC entity data */}
          <div className="p-4 border-b border-gray-200">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Dados TOConline
            </div>
            {entityQuery.isLoading ? (
              <div className="text-sm text-gray-400">A carregar...</div>
            ) : (
              <div className="space-y-2 text-sm">
                {(
                  [
                    ['Nome', entityName],
                    ['NIF', entityNif],
                    ['Email', entityEmail],
                    ['Telefone', entityPhone],
                    ['Morada', entityAddress],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <span className="text-gray-400 w-20 flex-shrink-0 text-xs">{label}</span>
                    <span className="text-gray-700 text-xs break-all">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Config */}
          <div className="p-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Configurações
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Categoria automática
              </label>
              <select
                value={currentCategoryId}
                onChange={(e) => updateConfig.mutate(e.target.value || null)}
                disabled={updateConfig.isPending || categoriesQuery.isLoading}
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
              >
                <option value="">— Sem categoria —</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {updateConfig.isPending && (
                <p className="text-xs text-gray-400 mt-1">A guardar...</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar TypeScript no web**

```bash
cd apps/web
npx tsc --noEmit
```

Resultado esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/EntityDetailPage.tsx
git commit -m "feat: adicionar EntityDetailPage — lista de faturas + dados TOC + configuração de categoria"
```

---

## Task 6: Routing + Navigation

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/EmpresaPage.tsx`
- Modify: `apps/web/src/pages/PayablesPage.tsx`
- Modify: `apps/web/src/pages/ReceivablesPage.tsx`

### App.tsx — novas rotas

- [ ] **Step 1: Adicionar import de EntityDetailPage em App.tsx**

Adicionar após `import EmpresaPage from '@/pages/EmpresaPage'` (linha 15):

```typescript
import EntityDetailPage from '@/pages/EntityDetailPage'
```

- [ ] **Step 2: Adicionar rotas em App.tsx**

Adicionar após `<Route path="empresa" element={<EmpresaPage />} />` (linha 52):

```tsx
<Route path="empresa/fornecedores/:tocId" element={<EntityDetailPage entityType="supplier" />} />
<Route path="empresa/clientes/:tocId" element={<EntityDetailPage entityType="customer" />} />
```

### EmpresaPage.tsx — clicar numa linha de fornecedor/cliente navega para detalhe

- [ ] **Step 3: Adicionar useNavigate em EmpresaPage**

No início do ficheiro `apps/web/src/pages/EmpresaPage.tsx`, a linha 1 tem:
```typescript
import { useState, useEffect, useRef } from 'react'
```

Adicionar após essa linha:
```typescript
import { useNavigate } from 'react-router-dom'
```

- [ ] **Step 4: Instanciar useNavigate no componente principal de EmpresaPage**

Localizar a função principal do componente (onde estão as chamadas a `useQuery`, `useState`, etc.). Adicionar após a linha de `const { selectedClientId ... } = useAuth()`:

```typescript
const navigate = useNavigate()
```

- [ ] **Step 5: Modificar onClick das linhas de fornecedores/clientes em EmpresaPage**

Localizar o `onClick` da `<tr>` na tabela (linha ~2753):

```tsx
  onClick={() => setDetalheRow(row)}
```

Substituir por:

```tsx
  onClick={() => {
    if ((tab === 'fornecedores' || tab === 'clientes') && row.id != null) {
      navigate(`/empresa/${tab === 'fornecedores' ? 'fornecedores' : 'clientes'}/${row.id}`)
    } else {
      setDetalheRow(row)
    }
  }}
```

### PayablesPage.tsx — entityName clicável

- [ ] **Step 6: Adicionar tocSupplierId à interface Payable em PayablesPage.tsx**

Localizar a interface `Payable` (linha 62):

```typescript
interface Payable {
  id: string; reference: string; entityName: string; documentDate: string; dueDate: string
  totalAmount: number; pendingAmount: number; paidAmount: number; status: string; origin: string
  description?: string | null
  tocPurchasesDocId?: string
```

Adicionar `tocSupplierId?: string | null` à interface:

```typescript
interface Payable {
  id: string; reference: string; entityName: string; documentDate: string; dueDate: string
  totalAmount: number; pendingAmount: number; paidAmount: number; status: string; origin: string
  description?: string | null
  tocPurchasesDocId?: string
  tocSupplierId?: string | null
```

- [ ] **Step 7: Adicionar useNavigate em PayablesPage.tsx**

Na linha 1 de PayablesPage.tsx:
```typescript
import { Fragment, useState, useMemo } from 'react'
```

Adicionar o import de `useNavigate`:
```typescript
import { Fragment, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
```

- [ ] **Step 8: Instanciar useNavigate em PayablesPage**

Localizar onde são instanciados hooks no componente principal (próximo de `const { selectedClientId, isTocEnabled } = useAuth()`). Adicionar:

```typescript
const navigate = useNavigate()
```

- [ ] **Step 9: Tornar entityName clicável em PayablesPage (tab Fornecedores)**

Localizar a célula de entityName na tabela principal (linha ~1059):

```tsx
<td className="px-5 py-3 text-gray-700">{p.entityName}</td>
```

Substituir por:

```tsx
<td className="px-5 py-3 text-gray-700">
  {p.tocSupplierId ? (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/fornecedores/${p.tocSupplierId}`) }}
      className="text-primary-600 hover:underline text-left"
    >
      {p.entityName}
    </button>
  ) : (
    p.entityName
  )}
</td>
```

- [ ] **Step 10: Tornar entityName clicável em PayablesPage (tab Outros)**

Localizar a segunda ocorrência da célula entityName (linha ~1388, tab "Outras Operações"):

```tsx
<td className="px-5 py-3 text-gray-700">{p.entityName || '—'}</td>
```

Substituir por:

```tsx
<td className="px-5 py-3 text-gray-700">
  {p.tocSupplierId ? (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/fornecedores/${p.tocSupplierId}`) }}
      className="text-primary-600 hover:underline text-left"
    >
      {p.entityName || '—'}
    </button>
  ) : (
    p.entityName || '—'
  )}
</td>
```

### ReceivablesPage.tsx — entityName clicável

- [ ] **Step 11: Adicionar tocCustomerId à interface Receivable em ReceivablesPage.tsx**

Localizar a interface `Receivable` no início do ficheiro e adicionar `tocCustomerId?: string | null`. O padrão é idêntico ao da interface `Payable`.

- [ ] **Step 12: Adicionar useNavigate em ReceivablesPage.tsx e instanciar**

No ficheiro `apps/web/src/pages/ReceivablesPage.tsx`, adicionar:

```typescript
import { useNavigate } from 'react-router-dom'
```

E no corpo do componente:

```typescript
const navigate = useNavigate()
```

- [ ] **Step 13: Tornar entityName clicável em ReceivablesPage (linha ~1088)**

Localizar:

```tsx
<td className="px-5 py-3 text-gray-700">{r.entityName}</td>
```

Substituir por:

```tsx
<td className="px-5 py-3 text-gray-700">
  {r.tocCustomerId ? (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/clientes/${r.tocCustomerId}`) }}
      className="text-primary-600 hover:underline text-left"
    >
      {r.entityName}
    </button>
  ) : (
    r.entityName
  )}
</td>
```

- [ ] **Step 14: Verificar TypeScript em web**

```bash
cd apps/web
npx tsc --noEmit
```

Resultado esperado: sem erros.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/pages/EmpresaPage.tsx apps/web/src/pages/PayablesPage.tsx apps/web/src/pages/ReceivablesPage.tsx
git commit -m "feat: routing e navegação para EntityDetailPage — EmpresaPage, PayablesPage, ReceivablesPage"
```

---

## Self-Review

### Cobertura da spec

| Requisito spec | Coberto em |
|---|---|
| TreasuryEntityConfig DB + migração | Task 1 |
| GET/PUT/DELETE `/treasury/:clientId/entity-configs/:type/:tocId` | Task 2 |
| Validação entityType supplier/customer | Task 2 (service.validateEntityType) |
| Validação compatibilidade categoria (EXPENSE/REVENUE) | Task 2 (service.upsert) |
| Auto-categoria payables create() | Task 3 |
| Auto-categoria receivables create() | Task 4 |
| EntityDetailPage — layout split | Task 5 |
| Tabs Atuais/Histórico (OPEN+PARTIAL / SETTLED+VOID) | Task 5 |
| KPIs pendente + pago | Task 5 |
| Dados TOConline read-only | Task 5 |
| Configuração categoria automática (select + PUT) | Task 5 |
| Toast de sucesso/erro na configuração | Task 5 |
| Rotas `/empresa/fornecedores/:tocId` e `/empresa/clientes/:tocId` | Task 6 |
| EmpresaPage — linhas clicáveis (navigate) | Task 6 |
| PayablesPage — entityName clicável | Task 6 |
| ReceivablesPage — entityName clicável | Task 6 |

### Potenciais issues

- A interface `Receivable` em ReceivablesPage.tsx não foi inspeccionada directamente. O Step 11 diz para localizar a interface — confirmar que existe e adicionar `tocCustomerId`. Se não existir, declarar a interface mínima necessária.
- A `EmpresaPage` usa `selectedClientId` de `useAuth()`. Confirmar que o componente principal que contém o `onClick` da `<tr>` é o mesmo que tem acesso ao `tab` e ao `navigate`.
- A linha ~2753 do EmpresaPage pode ter mudado de número. Usar a string `onClick={() => setDetalheRow(row)}` como referência de busca.
