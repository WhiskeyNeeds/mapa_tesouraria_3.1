# TOConline Local Mirror — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar dados TOConline para a BD local (PostgreSQL via Prisma), substituindo todas as chamadas on-demand por consultas ao espelho local, com scheduler em-processo e trigger manual.

**Architecture:** 9 novas tabelas Prisma armazenam dados TOConline (campos normalizados + coluna `raw Json`). Uma classe `TocScheduler` corre dois `setTimeout` loops por cliente activo: transaccional (5 min) e mestre (30 min). Os endpoints `entity-sub-docs`, `entity-payment-timing`, `customers` e `suppliers` são migrados para consultar Prisma. O scheduler arranca no `onReady` do Fastify.

**Tech Stack:** Fastify · Prisma ORM · PostgreSQL · TypeScript · TanStack Query · Vitest

---

## File Structure

**New files (API):**
- `apps/api/src/lib/toc-sync/sync-entities.ts` — funções puras de extracção de campos + sync por tipo de entidade
- `apps/api/src/lib/toc-sync/sync-entities.test.ts` — testes das funções de extracção
- `apps/api/src/lib/toc-sync/sync-client.ts` — orquestra o sync de 1 cliente, actualiza `toc_sync_state`
- `apps/api/src/lib/toc-sync/scheduler.ts` — `TocScheduler`: gere os loops por cliente

**New files (Web):**
- `apps/web/src/components/ui/TocSyncStatus.tsx` — botão "↻ Actualizar" + "actualizado há X min"

**Modified files (API):**
- `apps/api/prisma/schema.prisma` — +9 modelos (`TocCustomer`, `TocSupplier`, `TocProduct`, `TocService`, `TocSalesDocument`, `TocPurchaseDocument`, `TocSalesReceipt`, `TocPurchasePayment`, `TocSyncState`)
- `apps/api/src/modules/toconline/toconline.service.ts` — +4 métodos públicos flat (`getAllSalesDocumentsFlat`, `getAllPurchaseDocumentsFlat`, `getAllSalesReceiptsFlat`, `getAllPurchasePaymentsFlat`); migrar `getEntityPaymentTiming` para Prisma
- `apps/api/src/modules/toconline/toconline.routes.ts` — migrar `entity-sub-docs`, `customers`, `suppliers`; +2 endpoints (`POST /sync`, `GET /sync-status`); chamar `registerClient` após OAuth callback
- `apps/api/src/server.ts` — registar `TocScheduler` no `onReady`; decorar `fastify.tocScheduler`

**Modified files (Web):**
- `apps/web/src/pages/EmpresaPage.tsx` — adicionar `<TocSyncStatus />`
- `apps/web/src/pages/EntityDetailPage.tsx` — adicionar `<TocSyncStatus />`; handle `syncing: true`

---

## Task 1: Prisma Schema — 9 novos modelos

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Adicionar os 9 modelos ao schema.prisma**

No fim de `apps/api/prisma/schema.prisma`, depois de todos os modelos existentes, adicionar:

```prisma
// ─── TOConline Mirror ────────────────────────────────────────────────────────

model TocCustomer {
  id        String   @id @default(cuid())
  clientId  String
  tocId     Int
  name      String
  nif       String?
  email     String?
  phone     String?
  raw       Json
  syncedAt  DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId])
  @@map("toc_customers")
}

model TocSupplier {
  id        String   @id @default(cuid())
  clientId  String
  tocId     Int
  name      String
  nif       String?
  email     String?
  phone     String?
  raw       Json
  syncedAt  DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId])
  @@map("toc_suppliers")
}

model TocProduct {
  id         String  @id @default(cuid())
  clientId   String
  tocId      Int
  name       String
  unitPrice  Float?
  taxRate    Float?
  raw        Json
  syncedAt   DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId])
  @@map("toc_products")
}

model TocService {
  id         String  @id @default(cuid())
  clientId   String
  tocId      Int
  name       String
  unitPrice  Float?
  taxRate    Float?
  raw        Json
  syncedAt   DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId])
  @@map("toc_services")
}

model TocSalesDocument {
  id           String   @id @default(cuid())
  clientId     String
  tocId        Int
  customerId   Int?
  date         String?
  dueDate      String?
  status       Int?
  grossTotal   Float?
  pendingTotal Float?
  receiptsIds  Int[]
  raw          Json
  syncedAt     DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId, customerId])
  @@index([clientId, date])
  @@map("toc_sales_documents")
}

model TocPurchaseDocument {
  id           String   @id @default(cuid())
  clientId     String
  tocId        Int
  supplierId   Int?
  date         String?
  dueDate      String?
  status       Int?
  grossTotal   Float?
  pendingTotal Float?
  paymentsIds  Int[]
  raw          Json
  syncedAt     DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId, supplierId])
  @@index([clientId, date])
  @@map("toc_purchase_documents")
}

model TocSalesReceipt {
  id         String   @id @default(cuid())
  clientId   String
  tocId      Int
  customerId Int?
  date       String?
  grossTotal Float?
  raw        Json
  syncedAt   DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId, customerId])
  @@map("toc_sales_receipts")
}

model TocPurchasePayment {
  id         String   @id @default(cuid())
  clientId   String
  tocId      Int
  supplierId Int?
  date       String?
  grossTotal Float?
  raw        Json
  syncedAt   DateTime @default(now())

  @@unique([clientId, tocId])
  @@index([clientId, supplierId])
  @@map("toc_purchase_payments")
}

model TocSyncState {
  id          String    @id @default(cuid())
  clientId    String
  entityType  String
  lastSyncAt  DateTime?
  lastError   String?
  recordCount Int?

  @@unique([clientId, entityType])
  @@map("toc_sync_state")
}
```

- [ ] **Step 2: Gerar e aplicar a migração**

```bash
cd apps/api
npx prisma migrate dev --name toc_mirror
```

Saída esperada:
```
The following migration(s) have been created and applied from new schema changes:

migrations/
  └─ 20260528XXXXXX_toc_mirror/
    └─ migration.sql

Your database is now in sync with your schema.
```

- [ ] **Step 3: Verificar o Prisma client gerado**

```bash
npx prisma generate
```

Confirmar que `prisma.tocCustomer`, `prisma.tocSalesDocument`, etc. existem no tipo gerado:
```bash
node -e "const { PrismaClient } = require('./generated/client'); const p = new PrismaClient(); console.log(typeof p.tocCustomer, typeof p.tocSyncState)"
```
Saída esperada: `object object`

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat: adicionar modelos Prisma para espelho TOConline (toc_*)"
```

---

## Task 2: ToconlineService — 4 novos métodos flat

**Files:**
- Modify: `apps/api/src/modules/toconline/toconline.service.ts`

O scheduler precisa de buscar TODOS os documentos/recibos/pagamentos (sem filtro, com paginação). Os métodos existentes (`getSalesDocuments`, etc.) usam `apiGet` + `unwrapArray` (uma página). Adicionamos versões flat que usam `apiGetFlat` (segue paginação automática).

- [ ] **Step 1: Adicionar os 4 métodos após `getPurchaseDocuments`**

Localizar a linha com `async getSalesDocuments(clientId` (≈ linha 593 no ficheiro actual) e adicionar logo abaixo dos dois métodos existentes:

```typescript
  async getAllSalesDocumentsFlat(clientId: string) {
    return this.apiGetFlat(clientId, '/api/v1/commercial_sales_documents')
  }

  async getAllPurchaseDocumentsFlat(clientId: string) {
    return this.apiGetFlat(clientId, '/api/v1/commercial_purchases_documents')
  }

  async getAllSalesReceiptsFlat(clientId: string) {
    return this.apiGetFlat(clientId, '/api/v1/commercial_sales_receipts')
  }

  async getAllPurchasePaymentsFlat(clientId: string) {
    return this.apiGetFlat(clientId, '/api/v1/commercial_purchases_payments')
  }
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep toconline.service
```

Saída esperada: nenhum erro relativo a `toconline.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/toconline/toconline.service.ts
git commit -m "feat: adicionar métodos getAllXxxFlat ao ToconlineService para sync"
```

---

## Task 3: sync-entities.ts — extracção de campos + sync por entidade

**Files:**
- Create: `apps/api/src/lib/toc-sync/sync-entities.ts`
- Create: `apps/api/src/lib/toc-sync/sync-entities.test.ts`

- [ ] **Step 1: Criar o ficheiro de testes primeiro (TDD)**

Criar `apps/api/src/lib/toc-sync/sync-entities.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  extractCustomerFields,
  extractSupplierFields,
  extractSalesDocFields,
  extractPurchaseDocFields,
  extractSalesReceiptFields,
  extractPurchasePaymentFields,
  extractProductFields,
  extractServiceFields,
} from './sync-entities.js'

describe('extractCustomerFields', () => {
  it('mapeia fiscal_id para nif', () => {
    const raw = { id: 23, name: 'Acme Lda', fiscal_id: '501234567', email: 'a@b.com', mobile: '912345678' }
    const result = extractCustomerFields('client1', raw)
    expect(result.tocId).toBe(23)
    expect(result.clientId).toBe('client1')
    expect(result.name).toBe('Acme Lda')
    expect(result.nif).toBe('501234567')
    expect(result.email).toBe('a@b.com')
    expect(result.phone).toBe('912345678')
  })

  it('aceita campos opcionais em falta', () => {
    const raw = { id: 5, name: 'Test' }
    const result = extractCustomerFields('c1', raw)
    expect(result.nif).toBeNull()
    expect(result.email).toBeNull()
    expect(result.phone).toBeNull()
  })
})

describe('extractSalesDocFields', () => {
  it('extrai receipts_ids como array de inteiros', () => {
    const raw = {
      id: 88, customer_id: 23, date: '2026-01-15', due_date: '2026-02-15',
      status: 3, gross_total: 1230.50, pending_total: 0, receipts_ids: [100, 101],
    }
    const result = extractSalesDocFields('c1', raw)
    expect(result.tocId).toBe(88)
    expect(result.customerId).toBe(23)
    expect(result.status).toBe(3)
    expect(result.grossTotal).toBeCloseTo(1230.50, 2)
    expect(result.receiptsIds).toEqual([100, 101])
  })

  it('trata receipts_ids ausente como array vazio', () => {
    const raw = { id: 1, customer_id: 5, date: '2026-01-01' }
    const result = extractSalesDocFields('c1', raw)
    expect(result.receiptsIds).toEqual([])
  })
})

describe('extractSalesReceiptFields', () => {
  it('extrai campos básicos do recibo', () => {
    const raw = { id: 100, customer_id: 23, date: '2026-01-20', gross_total: 1230 }
    const result = extractSalesReceiptFields('c1', raw)
    expect(result.tocId).toBe(100)
    expect(result.customerId).toBe(23)
    expect(result.date).toBe('2026-01-20')
    expect(result.grossTotal).toBe(1230)
  })
})

describe('extractPurchaseDocFields', () => {
  it('extrai payments_ids', () => {
    const raw = { id: 55, supplier_id: 10, date: '2026-03-01', payments_ids: [200, 201] }
    const result = extractPurchaseDocFields('c1', raw)
    expect(result.paymentsIds).toEqual([200, 201])
    expect(result.supplierId).toBe(10)
  })
})
```

- [ ] **Step 2: Correr os testes — devem falhar**

```bash
cd apps/api && npx vitest run src/lib/toc-sync/sync-entities.test.ts
```

Saída esperada: `FAIL` com "Cannot find module './sync-entities.js'"

- [ ] **Step 3: Criar sync-entities.ts**

Criar `apps/api/src/lib/toc-sync/sync-entities.ts`:

```typescript
import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'

type Raw = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function intArr(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map(Number).filter(n => Number.isFinite(n) && n > 0)
}

export function extractCustomerFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    name: str(item.name) ?? '',
    nif: str(item.fiscal_id) ?? str(item.nif),
    email: str(item.email),
    phone: str(item.mobile) ?? str(item.phone),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractSupplierFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    name: str(item.name) ?? '',
    nif: str(item.fiscal_id) ?? str(item.nif),
    email: str(item.email),
    phone: str(item.mobile) ?? str(item.phone),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractProductFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    name: str(item.name) ?? '',
    unitPrice: num(item.price) ?? num(item.unit_price),
    taxRate: num(item.tax_rate),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractServiceFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    name: str(item.name) ?? '',
    unitPrice: num(item.price) ?? num(item.unit_price),
    taxRate: num(item.tax_rate),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractSalesDocFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    customerId: num(item.customer_id) !== null ? Math.round(num(item.customer_id)!) : null,
    date: str(item.date),
    dueDate: str(item.due_date),
    status: num(item.status) !== null ? Math.round(num(item.status)!) : null,
    grossTotal: num(item.gross_total),
    pendingTotal: num(item.pending_total),
    receiptsIds: intArr(item.receipts_ids),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractPurchaseDocFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    supplierId: num(item.supplier_id) !== null ? Math.round(num(item.supplier_id)!) : null,
    date: str(item.date),
    dueDate: str(item.due_date),
    status: num(item.status) !== null ? Math.round(num(item.status)!) : null,
    grossTotal: num(item.gross_total),
    pendingTotal: num(item.pending_total),
    paymentsIds: intArr(item.payments_ids),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractSalesReceiptFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    customerId: num(item.customer_id) !== null ? Math.round(num(item.customer_id)!) : null,
    date: str(item.date),
    grossTotal: num(item.gross_total),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractPurchasePaymentFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
    supplierId: num(item.supplier_id) !== null ? Math.round(num(item.supplier_id)!) : null,
    date: str(item.date),
    grossTotal: num(item.gross_total),
    raw: item as object,
    syncedAt: new Date(),
  }
}

async function upsertAll<T extends { clientId: string; tocId: number }>(
  items: T[],
  upsertOne: (item: T) => Promise<unknown>,
): Promise<number> {
  for (const item of items) await upsertOne(item)
  return items.length
}

export async function syncCustomers(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getCustomers(clientId)
  return upsertAll(
    items.map(i => extractCustomerFields(clientId, i as Raw)),
    item => prisma.tocCustomer.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncSuppliers(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getSuppliers(clientId)
  return upsertAll(
    items.map(i => extractSupplierFields(clientId, i as Raw)),
    item => prisma.tocSupplier.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncProducts(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getItems(clientId)
  return upsertAll(
    items.map(i => extractProductFields(clientId, i as Raw)),
    item => prisma.tocProduct.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncServices(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getServices(clientId)
  return upsertAll(
    items.map(i => extractServiceFields(clientId, i as Raw)),
    item => prisma.tocService.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncSalesDocuments(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getAllSalesDocumentsFlat(clientId)
  return upsertAll(
    items.map(i => extractSalesDocFields(clientId, i as Raw)),
    item => prisma.tocSalesDocument.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncPurchaseDocuments(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getAllPurchaseDocumentsFlat(clientId)
  return upsertAll(
    items.map(i => extractPurchaseDocFields(clientId, i as Raw)),
    item => prisma.tocPurchaseDocument.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncSalesReceipts(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getAllSalesReceiptsFlat(clientId)
  return upsertAll(
    items.map(i => extractSalesReceiptFields(clientId, i as Raw)),
    item => prisma.tocSalesReceipt.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncPurchasePayments(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const items = await svc.getAllPurchasePaymentsFlat(clientId)
  return upsertAll(
    items.map(i => extractPurchasePaymentFields(clientId, i as Raw)),
    item => prisma.tocPurchasePayment.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}
```

- [ ] **Step 4: Correr os testes — devem passar**

```bash
cd apps/api && npx vitest run src/lib/toc-sync/sync-entities.test.ts
```

Saída esperada:
```
✓ extractCustomerFields > mapeia fiscal_id para nif
✓ extractCustomerFields > aceita campos opcionais em falta
✓ extractSalesDocFields > extrai receipts_ids como array de inteiros
✓ extractSalesDocFields > trata receipts_ids ausente como array vazio
✓ extractSalesReceiptFields > extrai campos básicos do recibo
✓ extractPurchaseDocFields > extrai payments_ids

Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 5: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "toc-sync"
```

Saída esperada: nenhum erro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/toc-sync/
git commit -m "feat: sync-entities — extracção de campos e upsert por tipo de entidade TOConline"
```

---

## Task 4: sync-client.ts — orquestrador por cliente

**Files:**
- Create: `apps/api/src/lib/toc-sync/sync-client.ts`

- [ ] **Step 1: Criar sync-client.ts**

```typescript
import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'
import {
  syncCustomers, syncSuppliers, syncProducts, syncServices,
  syncSalesDocuments, syncPurchaseDocuments, syncSalesReceipts, syncPurchasePayments,
} from './sync-entities.js'

export type EntityType =
  | 'customers' | 'suppliers' | 'products' | 'services'
  | 'salesDocuments' | 'purchaseDocuments' | 'salesReceipts' | 'purchasePayments'

export const MASTER_ENTITIES: EntityType[] = ['customers', 'suppliers', 'products', 'services']
export const TRANSACTIONAL_ENTITIES: EntityType[] = [
  'salesDocuments', 'purchaseDocuments', 'salesReceipts', 'purchasePayments',
]

export interface SyncResult {
  counts: Partial<Record<EntityType, number>>
  errors: Partial<Record<EntityType, string>>
  syncedAt: string
}

async function runEntity(
  entityType: EntityType,
  prisma: PrismaClient,
  svc: ToconlineService,
  clientId: string,
): Promise<number> {
  switch (entityType) {
    case 'customers':         return syncCustomers(prisma, svc, clientId)
    case 'suppliers':         return syncSuppliers(prisma, svc, clientId)
    case 'products':          return syncProducts(prisma, svc, clientId)
    case 'services':          return syncServices(prisma, svc, clientId)
    case 'salesDocuments':    return syncSalesDocuments(prisma, svc, clientId)
    case 'purchaseDocuments': return syncPurchaseDocuments(prisma, svc, clientId)
    case 'salesReceipts':     return syncSalesReceipts(prisma, svc, clientId)
    case 'purchasePayments':  return syncPurchasePayments(prisma, svc, clientId)
  }
}

export async function syncClientGroup(
  prisma: PrismaClient,
  svc: ToconlineService,
  clientId: string,
  group: 'master' | 'transactional',
): Promise<SyncResult> {
  const entities = group === 'master' ? MASTER_ENTITIES : TRANSACTIONAL_ENTITIES
  const counts: Partial<Record<EntityType, number>> = {}
  const errors: Partial<Record<EntityType, string>> = {}

  for (const entityType of entities) {
    try {
      const count = await runEntity(entityType, prisma, svc, clientId)
      counts[entityType] = count
      await prisma.tocSyncState.upsert({
        where: { clientId_entityType: { clientId, entityType } },
        create: { clientId, entityType, lastSyncAt: new Date(), recordCount: count, lastError: null },
        update: { lastSyncAt: new Date(), recordCount: count, lastError: null },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors[entityType] = msg
      console.error(`[TocSync] ${clientId}/${entityType} failed:`, msg)
      await prisma.tocSyncState.upsert({
        where: { clientId_entityType: { clientId, entityType } },
        create: { clientId, entityType, lastSyncAt: null, recordCount: null, lastError: msg },
        update: { lastError: msg },
      })
    }
  }

  return { counts, errors, syncedAt: new Date().toISOString() }
}

export async function syncClientFull(
  prisma: PrismaClient,
  svc: ToconlineService,
  clientId: string,
): Promise<SyncResult> {
  const [transactional, master] = await Promise.all([
    syncClientGroup(prisma, svc, clientId, 'transactional'),
    syncClientGroup(prisma, svc, clientId, 'master'),
  ])
  return {
    counts: { ...transactional.counts, ...master.counts },
    errors: { ...transactional.errors, ...master.errors },
    syncedAt: new Date().toISOString(),
  }
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "toc-sync"
```

Saída esperada: nenhum erro.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/toc-sync/sync-client.ts
git commit -m "feat: sync-client — orquestrador de sync por grupo de entidades"
```

---

## Task 5: scheduler.ts — loops por cliente

**Files:**
- Create: `apps/api/src/lib/toc-sync/scheduler.ts`

- [ ] **Step 1: Criar scheduler.ts**

```typescript
import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'
import {
  syncClientGroup, syncClientFull,
  TRANSACTIONAL_ENTITIES, MASTER_ENTITIES,
  type SyncResult,
} from './sync-client.js'

const TRANSACTIONAL_INTERVAL = 5 * 60 * 1000   // 5 min
const MASTER_INTERVAL = 30 * 60 * 1000           // 30 min

interface ClientTimers {
  transactional: ReturnType<typeof setTimeout> | null
  master: ReturnType<typeof setTimeout> | null
}

export class TocScheduler {
  private timers = new Map<string, ClientTimers>()

  constructor(
    private prisma: PrismaClient,
    private svc: ToconlineService,
  ) {}

  async start() {
    const configs = await this.prisma.toconlineConfig.findMany({
      where: { status: 'ACTIVE' },
      select: { clientId: true },
    })
    for (const { clientId } of configs) {
      await this.registerClient(clientId)
    }
    console.info(`[TocScheduler] started for ${configs.length} client(s)`)
  }

  async registerClient(clientId: string) {
    if (this.timers.has(clientId)) return
    const timers: ClientTimers = { transactional: null, master: null }
    this.timers.set(clientId, timers)
    await this._scheduleLoop(clientId, 'transactional', TRANSACTIONAL_ENTITIES, TRANSACTIONAL_INTERVAL, timers)
    await this._scheduleLoop(clientId, 'master', MASTER_ENTITIES, MASTER_INTERVAL, timers)
    console.info(`[TocScheduler] registered client ${clientId}`)
  }

  unregisterClient(clientId: string) {
    const timers = this.timers.get(clientId)
    if (!timers) return
    if (timers.transactional) clearTimeout(timers.transactional)
    if (timers.master) clearTimeout(timers.master)
    this.timers.delete(clientId)
    console.info(`[TocScheduler] unregistered client ${clientId}`)
  }

  async triggerSync(clientId: string): Promise<SyncResult> {
    return syncClientFull(this.prisma, this.svc, clientId)
  }

  private async _scheduleLoop(
    clientId: string,
    group: 'master' | 'transactional',
    entities: string[],
    interval: number,
    timers: ClientTimers,
  ) {
    // Check staleness — avoid hammering TOConline on every restart
    const states = await this.prisma.tocSyncState.findMany({
      where: { clientId, entityType: { in: entities } },
    })
    const oldestMs = states.length === entities.length
      ? Math.min(...states.map(s => s.lastSyncAt?.getTime() ?? 0))
      : 0
    const elapsed = Date.now() - oldestMs
    const delay = elapsed >= interval ? 0 : interval - elapsed

    const run = async () => {
      try {
        await syncClientGroup(this.prisma, this.svc, clientId, group)
      } catch (err) {
        console.error(`[TocScheduler] ${clientId}/${group} unhandled:`, err)
      }
      // Use setTimeout (not setInterval) so overlapping runs are impossible
      const t = setTimeout(run, interval)
      if (group === 'transactional') timers.transactional = t
      else timers.master = t
    }

    const t = setTimeout(run, delay)
    if (group === 'transactional') timers.transactional = t
    else timers.master = t
  }
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep "toc-sync"
```

Saída esperada: nenhum erro.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/toc-sync/scheduler.ts
git commit -m "feat: TocScheduler — loops em-processo por cliente (5 min transaccional, 30 min mestre)"
```

---

## Task 6: server.ts — registar scheduler no onReady

**Files:**
- Modify: `apps/api/src/server.ts`

O scheduler precisa de arrancar depois de todos os plugins (Prisma, auth) estarem prontos. O hook `onReady` corre exactamente depois de todos os plugins e antes de o servidor aceitar pedidos.

- [ ] **Step 1: Adicionar imports no topo de server.ts**

Após `import { HttpError } from './lib/errors.js'` (linha 29), adicionar:

```typescript
import { TocScheduler } from './lib/toc-sync/scheduler.js'
import { ToconlineService } from './modules/toconline/toconline.service.js'
```

- [ ] **Step 2: Adicionar declaração de tipo para o decorator**

Após os imports, antes de `const fastify = Fastify(...)`, adicionar:

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    tocScheduler: TocScheduler
  }
}
```

- [ ] **Step 3: Registar o hook onReady antes da secção "Start"**

Após o bloco de routes (depois da linha `fastify.get('/health', ...)`, linha 83) e antes da secção `// ── Start`, adicionar:

```typescript
// ── TOConline Sync Scheduler ───────────────────────────────────────────────

fastify.addHook('onReady', async () => {
  const tocSvc = new ToconlineService(fastify.prisma)
  const scheduler = new TocScheduler(fastify.prisma, tocSvc)
  await scheduler.start()
  fastify.decorate('tocScheduler', scheduler)
})
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep -E "server\.ts|toc-sync"
```

Saída esperada: nenhum erro nestes ficheiros.

- [ ] **Step 5: Arrancar o servidor em modo dev e verificar log**

```bash
cd apps/api && npx tsx src/server.ts 2>&1 | head -20
```

Saída esperada (exemplo com 1 cliente activo):
```
[TocScheduler] started for 1 client(s)
[TocScheduler] registered client clxxxxxxxx
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: registar TocScheduler no onReady do Fastify"
```

---

## Task 7: Novos endpoints — POST /sync e GET /sync-status

**Files:**
- Modify: `apps/api/src/modules/toconline/toconline.routes.ts`

- [ ] **Step 1: Adicionar os dois endpoints no fim do ficheiro de routes, antes do `}`**

Localizar a última linha do ficheiro (`}`, linha 304) e inserir antes dela:

```typescript
  fastify.post('/toconline/:clientId/sync', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const result = await fastify.tocScheduler.triggerSync(clientId)
    return reply.send(result)
  })

  fastify.get('/toconline/:clientId/sync-status', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const states = await fastify.prisma.tocSyncState.findMany({ where: { clientId } })
    return reply.send(states)
  })
```

- [ ] **Step 2: Chamar registerClient após OAuth callback**

Localizar o handler do callback OAuth em `toconline.routes.ts` (procurar por `handleCallback`). Após o `await svc.handleCallback(...)`, adicionar:

```typescript
    // Registar o scheduler para o novo cliente
    void fastify.tocScheduler?.registerClient(clientId)
```

(O `?` é seguro: no arranque o scheduler pode ainda não estar decorado no momento da primeira request, embora seja improvável.)

- [ ] **Step 3: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep toconline.routes
```

Saída esperada: nenhum erro.

- [ ] **Step 4: Testar os endpoints manualmente**

Com o servidor a correr:
```bash
# Obter sync-status (substituir CLIENT_ID e TOKEN)
curl -H "Authorization: Bearer TOKEN" http://localhost:3001/api/v1/toconline/CLIENT_ID/sync-status
```

Saída esperada: array JSON com estados por entityType, ex:
```json
[{"id":"...","clientId":"...","entityType":"customers","lastSyncAt":"2026-05-28T...","recordCount":45,"lastError":null}]
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/toconline/toconline.routes.ts
git commit -m "feat: endpoints POST /sync e GET /sync-status para controlo do espelho TOConline"
```

---

## Task 8: Migrar entity-sub-docs para Prisma

**Files:**
- Modify: `apps/api/src/modules/toconline/toconline.routes.ts`

O endpoint `GET /toconline/:clientId/entity-sub-docs` actualmente chama `svc.getEntityAllSubDocs(...)` que faz N chamadas individuais à API TOConline. Passa a consultar `toc_sales_receipts` / `toc_purchase_payments` localmente.

- [ ] **Step 1: Substituir o handler de entity-sub-docs**

Localizar (≈ linha 285):
```typescript
  fastify.get('/toconline/:clientId/entity-sub-docs', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { entityType, ids } = request.query as { entityType?: string; ids?: string }
    if (!entityType || !ids) return reply.status(400).send({ error: 'entityType and ids required' })
    const parsedIds = ids.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
    if (parsedIds.length === 0) return reply.send([])
    return reply.send(await svc.getEntityAllSubDocs(clientId, parsedIds, entityType as 'customer' | 'supplier'))
  })
```

Substituir por:

```typescript
  fastify.get('/toconline/:clientId/entity-sub-docs', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { entityType, ids } = request.query as { entityType?: string; ids?: string }
    if (!entityType || !ids) return reply.status(400).send({ error: 'entityType and ids required' })
    const parsedIds = ids.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
    if (parsedIds.length === 0) return reply.send([])

    // Check if mirror has data; if not, return syncing state
    const syncState = await fastify.prisma.tocSyncState.findFirst({
      where: { clientId, entityType: entityType === 'customer' ? 'salesReceipts' : 'purchasePayments' },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send({ syncing: true, data: [] })
    }

    const items = entityType === 'customer'
      ? await fastify.prisma.tocSalesReceipt.findMany({
          where: { clientId, tocId: { in: parsedIds } },
        })
      : await fastify.prisma.tocPurchasePayment.findMany({
          where: { clientId, tocId: { in: parsedIds } },
        })

    return reply.send(items.map(item => item.raw))
  })
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep toconline.routes
```

Saída esperada: nenhum erro.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/toconline/toconline.routes.ts
git commit -m "feat: entity-sub-docs consulta BD local em vez de API TOConline"
```

---

## Task 9: Migrar entity-payment-timing para Prisma

**Files:**
- Modify: `apps/api/src/modules/toconline/toconline.service.ts`

O método `getEntityPaymentTiming` actualmente faz um loop com N chamadas individuais por documento. Passa a consultar `toc_sales_documents` + `toc_sales_receipts` localmente.

O `ToconlineService` já tem `this.prisma` disponível (injectado no constructor).

- [ ] **Step 1: Substituir o método getEntityPaymentTiming**

Localizar `async getEntityPaymentTiming(` (≈ linha 1026). Substituir o método completo por:

```typescript
  async getEntityPaymentTiming(
    clientId: string,
    entityType: 'customer' | 'supplier',
    tocEntityId: string,
  ): Promise<EntityPaymentTiming> {
    const thisYear = new Date().getFullYear()
    const lastYear = thisYear - 1
    const cutoff = `${lastYear - 1}-01-01`
    const entityIdNum = parseInt(tocEntityId, 10)

    // Check if mirror has data
    const syncKey = entityType === 'customer' ? 'salesDocuments' : 'purchaseDocuments'
    const syncState = await this.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: syncKey } },
    })
    if (!syncState?.lastSyncAt) {
      return { thisYear: null, lastYear: null, delayThisYear: null, delayLastYear: null }
    }

    // 1. Settled docs from local mirror
    const isSettled = {
      OR: [
        { status: 3 },
        { status: { notIn: [0, 4] }, pendingTotal: 0.0 },
      ],
    }

    const settledDocs = entityType === 'customer'
      ? await this.prisma.tocSalesDocument.findMany({
          where: { clientId, customerId: entityIdNum, date: { gte: cutoff }, ...isSettled },
          take: 50,
          orderBy: { date: 'desc' },
        })
      : await this.prisma.tocPurchaseDocument.findMany({
          where: { clientId, supplierId: entityIdNum, date: { gte: cutoff }, ...isSettled },
          take: 50,
          orderBy: { date: 'desc' },
        })

    if (settledDocs.length === 0) {
      return { thisYear: null, lastYear: null, delayThisYear: null, delayLastYear: null }
    }

    // 2. Collect all sub-doc IDs
    const allSubIds = [...new Set(
      settledDocs.flatMap(d => entityType === 'customer' ? d.receiptsIds : d.paymentsIds),
    )]
    if (allSubIds.length === 0) {
      return { thisYear: null, lastYear: null, delayThisYear: null, delayLastYear: null }
    }

    // 3. Fetch sub-docs from local mirror
    const subDocs = entityType === 'customer'
      ? await this.prisma.tocSalesReceipt.findMany({
          where: { clientId, tocId: { in: allSubIds } },
          select: { tocId: true, date: true },
        })
      : await this.prisma.tocPurchasePayment.findMany({
          where: { clientId, tocId: { in: allSubIds } },
          select: { tocId: true, date: true },
        })

    const subDateMap = new Map(subDocs.map(d => [d.tocId, d.date]))

    // 4. Compute timing per invoice
    const invoicePayments: Array<{ invoiceDate: string; dueDate: string; lastPaymentDate: string }> = []
    for (const doc of settledDocs) {
      const ids = entityType === 'customer' ? doc.receiptsIds : doc.paymentsIds
      const dates = ids
        .map(id => subDateMap.get(id))
        .filter((d): d is string => typeof d === 'string' && d.length > 0)
        .sort()
      if (!dates.length) continue
      const invoiceDate = doc.date ?? ''
      const dueDate = doc.dueDate ?? doc.date ?? ''
      if (invoiceDate) invoicePayments.push({ invoiceDate, dueDate, lastPaymentDate: dates[dates.length - 1] })
    }

    const DAY_MS = 86_400_000
    const calcAvg = (year: number): number | null => {
      const rel = invoicePayments.filter(p => p.lastPaymentDate.startsWith(String(year)))
      if (!rel.length) return null
      const days = rel
        .map(p => Math.round((new Date(p.lastPaymentDate).getTime() - new Date(p.invoiceDate).getTime()) / DAY_MS))
        .filter(d => d >= 0)
      return days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null
    }

    const calcDelay = (year: number): number | null => {
      const rel = invoicePayments.filter(p => p.lastPaymentDate.startsWith(String(year)) && p.dueDate)
      if (!rel.length) return null
      const delays = rel.map(p =>
        Math.round((new Date(p.lastPaymentDate).getTime() - new Date(p.dueDate).getTime()) / DAY_MS),
      )
      return Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
    }

    return {
      thisYear: calcAvg(thisYear),
      lastYear: calcAvg(lastYear),
      delayThisYear: calcDelay(thisYear),
      delayLastYear: calcDelay(lastYear),
    }
  }
```

- [ ] **Step 2: Remover os console.info de debug do método (já que não existe loop)**

Verificar que não restam `console.info('[paymentTiming]'...` no método substituído. Se existirem, removê-los.

- [ ] **Step 3: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep toconline.service
```

Saída esperada: nenhum erro relativo a `toconline.service.ts` (os erros pré-existentes noutros ficheiros são irrelevantes).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/toconline/toconline.service.ts
git commit -m "feat: getEntityPaymentTiming consulta BD local — elimina loop de N chamadas TOConline"
```

---

## Task 10: Migrar customers e suppliers para Prisma

**Files:**
- Modify: `apps/api/src/modules/toconline/toconline.routes.ts`

Os endpoints `GET /customers` e `GET /suppliers` actualmente chamam `svc.getCustomers(clientId)` / `svc.getSuppliers(clientId)` que fazem um pedido paginado à API TOConline. Passam a consultar `toc_customers` / `toc_suppliers`.

A resposta mantém o mesmo formato: array de objectos TOConline tal como vinham da API (campo `raw` de cada registo).

- [ ] **Step 1: Substituir o handler GET /customers**

Localizar (≈ linha 143):
```typescript
  fastify.get('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getCustomers(clientId))
  })
```

Substituir por:

```typescript
  fastify.get('/toconline/:clientId/customers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const syncState = await fastify.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: 'customers' } },
    })
    if (!syncState?.lastSyncAt) {
      // Mirror not yet ready — fall through to live API
      return reply.send(await svc.getCustomers(clientId))
    }
    const rows = await fastify.prisma.tocCustomer.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
    })
    return reply.send(rows.map(r => r.raw))
  })
```

- [ ] **Step 2: Substituir o handler GET /suppliers**

Localizar (≈ linha 182):
```typescript
  fastify.get('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    return reply.send(await svc.getSuppliers(clientId))
  })
```

Substituir por:

```typescript
  fastify.get('/toconline/:clientId/suppliers', { onRequest: [fastify.authenticate, fastify.requireClientAccess] }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const syncState = await fastify.prisma.tocSyncState.findUnique({
      where: { clientId_entityType: { clientId, entityType: 'suppliers' } },
    })
    if (!syncState?.lastSyncAt) {
      return reply.send(await svc.getSuppliers(clientId))
    }
    const rows = await fastify.prisma.tocSupplier.findMany({
      where: { clientId },
      orderBy: { name: 'asc' },
    })
    return reply.send(rows.map(r => r.raw))
  })
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | grep toconline.routes
```

Saída esperada: nenhum erro.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/toconline/toconline.routes.ts
git commit -m "feat: customers e suppliers consultam BD local (fallback para API se mirror vazio)"
```

---

## Task 11: Frontend — TocSyncStatus component

**Files:**
- Create: `apps/web/src/components/ui/TocSyncStatus.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface SyncStateRow {
  entityType: string
  lastSyncAt: string | null
  lastError: string | null
  recordCount: number | null
}

export default function TocSyncStatus({ invalidateKeys = [] }: { invalidateKeys?: string[][] }) {
  const { selectedClientId } = useAuth()
  const queryClient = useQueryClient()

  const { data: states = [] } = useQuery<SyncStateRow[]>({
    queryKey: ['toc-sync-status', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/sync-status`),
    enabled: !!selectedClientId,
    refetchInterval: 60_000,
  })

  const { mutate: triggerSync, isPending } = useMutation({
    mutationFn: () => api.post(`/toconline/${selectedClientId}/sync`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['toc-sync-status', selectedClientId] })
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const hasError = states.some(s => s.lastError)
  const lastSyncDate = states
    .filter(s => s.lastSyncAt)
    .map(s => new Date(s.lastSyncAt!).getTime())
    .sort((a, b) => b - a)[0]

  const minutesAgo = lastSyncDate
    ? Math.round((Date.now() - lastSyncDate) / 60_000)
    : null

  return (
    <div className="flex items-center gap-2">
      {hasError && (
        <span className="text-xs text-amber-600 font-medium">Erro no sync</span>
      )}
      {minutesAgo !== null && !hasError && (
        <span className="text-xs text-gray-400">
          Actualizado há {minutesAgo < 1 ? '<1' : minutesAgo} min
        </span>
      )}
      <button
        onClick={() => triggerSync()}
        disabled={isPending}
        title="Actualizar dados TOConline"
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isPending ? 'animate-spin' : ''}`} />
        <span>Actualizar</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep TocSyncStatus
```

Saída esperada: nenhum erro.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/TocSyncStatus.tsx
git commit -m "feat: componente TocSyncStatus com botão Actualizar e timestamp do último sync"
```

---

## Task 12: Frontend — integrar TocSyncStatus em EmpresaPage e EntityDetailPage

**Files:**
- Modify: `apps/web/src/pages/EmpresaPage.tsx`
- Modify: `apps/web/src/pages/EntityDetailPage.tsx`

- [ ] **Step 1: Adicionar TocSyncStatus à EmpresaPage**

Em `apps/web/src/pages/EmpresaPage.tsx`, localizar o cabeçalho da página (o `<div>` com o título "Empresa" ou equivalente). Adicionar o import e o componente:

```tsx
import TocSyncStatus from '@/components/ui/TocSyncStatus'
```

No cabeçalho da página, à direita do título:
```tsx
<div className="flex items-center justify-between mb-6">
  <h1 className="text-xl font-semibold text-gray-900">Empresa</h1>
  <TocSyncStatus invalidateKeys={[
    ['toc-customers', selectedClientId],
    ['toc-suppliers', selectedClientId],
  ]} />
</div>
```

(Adaptar ao markup existente — o objectivo é colocar o `<TocSyncStatus>` no canto superior direito do cabeçalho da página.)

- [ ] **Step 2: Adicionar TocSyncStatus à EntityDetailPage**

Em `apps/web/src/pages/EntityDetailPage.tsx`, localizar o cabeçalho da página (onde está o nome da entidade e os tabs). Adicionar o import:

```tsx
import TocSyncStatus from '@/components/ui/TocSyncStatus'
```

No cabeçalho da página, antes ou depois do nome da entidade:
```tsx
<TocSyncStatus invalidateKeys={[
  ['toc-customer-all-receipts', clientId, tocId],
  ['toc-supplier-all-payments', clientId, tocId],
  ['toc-entity-timing', clientId, tocId],
]} />
```

- [ ] **Step 3: Lidar com syncing: true em EntityDetailPage**

Em `EntityDetailPage.tsx`, localizar a query `allSubDocsQuery`. Se a resposta for `{ syncing: true, data: [] }`, mostrar mensagem:

```tsx
// No componente DocSubRows ou no local que renderiza os recibos:
if (allSubDocsQuery.data && 'syncing' in (allSubDocsQuery.data as object)) {
  return (
    <tr>
      <td colSpan={5} className="py-3 px-4 text-sm text-gray-400 text-center italic">
        A sincronizar dados TOConline…
      </td>
    </tr>
  )
}
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep -E "EmpresaPage|EntityDetailPage"
```

Saída esperada: nenhum erro.

- [ ] **Step 5: Commit final**

```bash
git add apps/web/src/pages/EmpresaPage.tsx apps/web/src/pages/EntityDetailPage.tsx
git commit -m "feat: integrar TocSyncStatus em EmpresaPage e EntityDetailPage"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ 9 tabelas Prisma (Task 1)
- ✅ Scheduler em-processo, 2 loops por cliente (Tasks 4, 5, 6)
- ✅ 5 min transaccional / 30 min mestre (Task 5)
- ✅ Trigger manual POST /sync (Task 7)
- ✅ GET /sync-status (Task 7)
- ✅ registerClient após OAuth (Task 7)
- ✅ entity-sub-docs migrado (Task 8)
- ✅ entity-payment-timing migrado (Task 9)
- ✅ customers/suppliers migrados (Task 10)
- ✅ Estado vazio → `{ syncing: true }` (Tasks 8, 10)
- ✅ Fallback para API viva em customers/suppliers (Task 10)
- ✅ TocSyncStatus component (Task 11)
- ✅ Integração frontend (Task 12)
- ✅ getAllXxxFlat métodos (Task 2)
- ✅ Testes das funções de extracção (Task 3)

**Consistência de tipos:** `EntityType` definido em `sync-client.ts`, exportado e usado em `scheduler.ts`. `SyncResult` definido em `sync-client.ts`, usado em `scheduler.ts` e routes. `extractXxxFields` retornam objectos compatíveis com os modelos Prisma gerados.
