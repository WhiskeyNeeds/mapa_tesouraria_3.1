# Origem da Liquidação das Parcelas + Parcelas na Reconciliação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registar *como* cada fatura ficou paga/liquidada (`LOCAL`, `INSTALLMENTS`, `RECONCILIATION`), bloquear a reversão da mãe dividida (reverter só parcela a parcela) e mostrar as parcelas — não a mãe — na reconciliação.

**Architecture:** Novo enum + coluna `settledVia` em receivables/payables. A lógica de derivação do estado da mãe a partir das parcelas é extraída para um helper partilhado (`lib/parent-status.ts`) usado pelos serviços de receivables, payables e reconciliação, garantindo a invariante única "a mãe nunca é liquidada diretamente — deriva sempre dos filhos". A reversão é gateada por `settledVia`. A lista ganha um modo `reconcilable` que troca mães por parcelas.

**Tech Stack:** Fastify v5, Prisma (PostgreSQL), React + React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-installment-settlement-source-and-reconciliation-design.md`

---

## File Structure

- Create `apps/api/src/lib/parent-status.ts` — helper `syncParentDocStatus` partilhado (deriva estado/montantes/`settledVia` da mãe a partir das parcelas).
- Create `apps/api/src/lib/parent-status.test.ts` — testes unitários do helper.
- Modify `apps/api/prisma/schema.prisma` — enum `TreasurySettlementSource` + coluna `settledVia` nos dois modelos.
- Create migration `apps/api/prisma/migrations/<ts>_settled_via/migration.sql` — colunas + backfill.
- Modify `apps/api/src/modules/treasury/receivables/receivables.service.ts` — delega no helper, define `settledVia` em `pay`/`settle`, gateia `unsettle`, expõe `settledVia` no list item e no filtro `reconcilable`.
- Modify `apps/api/src/modules/treasury/payables/payables.service.ts` — espelho do anterior.
- Modify `apps/api/src/modules/treasury/receivables/receivables.routes.ts` e `payables.routes.ts` — parse da query `reconcilable`.
- Modify `apps/api/src/modules/treasury/reconciliations/reconciliations.service.ts` — define `settledVia=RECONCILIATION` na confirmação total, limpa no reverse, e sincroniza a mãe de qualquer parcela afetada.
- Modify `apps/web/src/pages/ReconciliationPage.tsx` — acrescenta `&reconcilable=true` às duas queries.
- Modify `apps/web/src/components/treasury/DocDetailPanel.tsx` — gateia o botão "Anular" por `settledVia`.
- Modify `apps/web/src/components/followups/auditLabels.ts` — labels para o campo `via`.

---

## Task 1: Schema + migração + backfill

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_settled_via/migration.sql`

- [ ] **Step 1: Adicionar o enum ao schema**

Em `apps/api/prisma/schema.prisma`, imediatamente a seguir ao enum `TreasuryDocStatus` (linha ~49), acrescentar:

```prisma
enum TreasurySettlementSource {
  LOCAL
  INSTALLMENTS
  RECONCILIATION
}
```

- [ ] **Step 2: Adicionar a coluna aos dois modelos**

Em `TreasuryReceivable`, a seguir à linha `settledAt           DateTime?` (~477):

```prisma
  // Como o documento ficou pago/liquidado. null quando OPEN/PARTIAL/VOID.
  // LOCAL = marcado manualmente; INSTALLMENTS = mãe derivada das parcelas;
  // RECONCILIATION = reconciliado pelo valor total. Gateia a reversão.
  settledVia          TreasurySettlementSource?
```

Em `TreasuryPayable`, a seguir à linha `readyToPay          Boolean   @default(false)` (~546):

```prisma
  // Como o documento ficou pago/liquidado. Ver TreasuryReceivable.settledVia.
  settledVia          TreasurySettlementSource?
```

- [ ] **Step 3: Parar a API e gerar a migração**

> Nota Windows: o dev server mantém `query_engine.dll.node` bloqueado — parar a API antes de gerar.

Run:
```bash
cd apps/api && npx prisma migrate dev --name settled_via --create-only
```
Expected: cria a pasta `prisma/migrations/<ts>_settled_via/` com `migration.sql` contendo o `CREATE TYPE` e os dois `ALTER TABLE ... ADD COLUMN "settledVia"`.

- [ ] **Step 4: Acrescentar o backfill ao fim do `migration.sql` gerado**

No fim do ficheiro `migration.sql`, acrescentar:

```sql
-- Backfill: mães divididas (têm filhos não-recorrentes) -> INSTALLMENTS
UPDATE "treasury_receivables" p SET "settledVia" = 'INSTALLMENTS'
WHERE p."status" IN ('PAID','SETTLED') AND EXISTS (
  SELECT 1 FROM "treasury_receivables" c
  WHERE c."parentId" = p."id" AND c."recurrenceId" IS NULL AND c."deletedAt" IS NULL
);
UPDATE "treasury_payables" p SET "settledVia" = 'INSTALLMENTS'
WHERE p."status" IN ('PAID','SETTLED') AND EXISTS (
  SELECT 1 FROM "treasury_payables" c
  WHERE c."parentId" = p."id" AND c."recurrenceId" IS NULL AND c."deletedAt" IS NULL
);

-- Backfill: docs fechados com reconciliação confirmada -> RECONCILIATION
UPDATE "treasury_receivables" r SET "settledVia" = 'RECONCILIATION'
WHERE r."status" IN ('PAID','SETTLED') AND r."settledVia" IS NULL AND EXISTS (
  SELECT 1 FROM "treasury_reconciliation_receivables" l
  JOIN "treasury_reconciliations" rec ON rec."id" = l."reconciliationId"
  WHERE l."receivableId" = r."id" AND rec."status" = 'CONFIRMED'
);
UPDATE "treasury_payables" pay SET "settledVia" = 'RECONCILIATION'
WHERE pay."status" IN ('PAID','SETTLED') AND pay."settledVia" IS NULL AND EXISTS (
  SELECT 1 FROM "treasury_reconciliation_payables" l
  JOIN "treasury_reconciliations" rec ON rec."id" = l."reconciliationId"
  WHERE l."payableId" = pay."id" AND rec."status" = 'CONFIRMED'
);

-- Backfill: restantes fechados -> LOCAL
UPDATE "treasury_receivables" SET "settledVia" = 'LOCAL'
WHERE "status" IN ('PAID','SETTLED') AND "settledVia" IS NULL;
UPDATE "treasury_payables" SET "settledVia" = 'LOCAL'
WHERE "status" IN ('PAID','SETTLED') AND "settledVia" IS NULL;
```

> Verificar os nomes reais das tabelas/colunas de junção em `schema.prisma` (`@@map` / `@relation`) antes de correr; ajustar se diferirem de `treasury_reconciliation_receivables`/`treasury_reconciliation_payables` e do enum de estado `CONFIRMED`.

- [ ] **Step 5: Aplicar a migração e gerar o client**

Run:
```bash
cd apps/api && npx prisma migrate dev && npx prisma generate
```
Expected: migração aplicada sem erro; `TreasurySettlementSource` disponível em `@prisma/client`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): coluna settledVia (origem da liquidação) + backfill"
```

---

## Task 2: Helper partilhado `syncParentDocStatus`

**Files:**
- Create: `apps/api/src/lib/parent-status.ts`
- Test: `apps/api/src/lib/parent-status.test.ts`

- [ ] **Step 1: Escrever os testes a falhar**

Criar `apps/api/src/lib/parent-status.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { syncParentDocStatus } from './parent-status.js'

function fakeDb(children: Array<{ status: string; receivedAmount?: number; pendingAmount?: number; promisedPaymentDate?: Date | null; dueDate?: Date | null }>) {
  const update = vi.fn().mockResolvedValue({})
  const delegate = {
    findMany: vi.fn().mockResolvedValue(children),
    findUnique: vi.fn().mockResolvedValue({ settledAt: null }),
    update,
  }
  return { db: { treasuryReceivable: delegate, treasuryPayable: delegate }, update }
}

describe('syncParentDocStatus (receivable)', () => {
  it('todas as parcelas SETTLED -> mãe SETTLED via INSTALLMENTS', async () => {
    const { db, update } = fakeDb([{ status: 'SETTLED', receivedAmount: 50, pendingAmount: 0 }, { status: 'SETTLED', receivedAmount: 50, pendingAmount: 0 }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ status: 'SETTLED', settledVia: 'INSTALLMENTS', settledAt: expect.any(Date) }),
    }))
  })

  it('uma parcela PAID e outra OPEN -> mãe PARTIAL sem settledVia', async () => {
    const { db, update } = fakeDb([{ status: 'PAID', receivedAmount: 50, pendingAmount: 0 }, { status: 'OPEN', receivedAmount: 0, pendingAmount: 50, promisedPaymentDate: new Date('2026-07-01') }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PARTIAL', settledVia: null, settledAt: null }),
    }))
  })

  it('todas OPEN -> mãe OPEN sem settledVia', async () => {
    const { db, update } = fakeDb([{ status: 'OPEN', receivedAmount: 0, pendingAmount: 50 }, { status: 'OPEN', receivedAmount: 0, pendingAmount: 50 }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'OPEN', settledVia: null }),
    }))
  })

  it('todas PAID -> mãe PAID via INSTALLMENTS', async () => {
    const { db, update } = fakeDb([{ status: 'PAID', receivedAmount: 50, pendingAmount: 0 }, { status: 'PAID', receivedAmount: 50, pendingAmount: 0 }])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAID', settledVia: 'INSTALLMENTS' }),
    }))
  })

  it('sem parcelas -> não faz update', async () => {
    const { db, update } = fakeDb([])
    await syncParentDocStatus(db as never, 'c1', 'receivable', 'p1')
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr os testes para confirmar que falham**

Run: `cd apps/api && npx vitest run src/lib/parent-status.test.ts`
Expected: FAIL com "Cannot find module './parent-status.js'".

- [ ] **Step 3: Implementar o helper**

Criar `apps/api/src/lib/parent-status.ts`:

```ts
import type { Prisma, PrismaClient, TreasuryDocStatus, TreasurySettlementSource } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient
type Kind = 'receivable' | 'payable'

type ChildLite = { status: TreasuryDocStatus; promisedPaymentDate: Date | null; dueDate: Date | null }

/** Deriva estado, origem de liquidação e próxima data prometida de uma mãe a
 *  partir das suas parcelas (filhos não-recorrentes, não anulados). */
function deriveParent(children: ChildLite[]): {
  status: TreasuryDocStatus
  settledVia: TreasurySettlementSource | null
  promisedPaymentDate: Date | null
} {
  const active = children.filter((c) => c.status !== 'VOID')
  const allSettled = active.length > 0 && active.every((c) => c.status === 'SETTLED')
  const allClosed = active.length > 0 && active.every((c) => c.status === 'SETTLED' || c.status === 'PAID')
  const someProgress = active.some((c) => c.status === 'SETTLED' || c.status === 'PAID' || c.status === 'PARTIAL')
  const status: TreasuryDocStatus = allSettled ? 'SETTLED' : allClosed ? 'PAID' : someProgress ? 'PARTIAL' : 'OPEN'
  // A mãe nunca é liquidada diretamente: quando fechada, a origem é sempre INSTALLMENTS.
  const settledVia: TreasurySettlementSource | null = (status === 'SETTLED' || status === 'PAID') ? 'INSTALLMENTS' : null

  const pendingDates = children
    .filter((c) => c.status !== 'PAID' && c.status !== 'SETTLED' && c.status !== 'VOID')
    .map((c) => c.promisedPaymentDate ?? c.dueDate)
    .filter((d): d is Date => d != null)
  const promisedPaymentDate = pendingDates.length > 0
    ? pendingDates.reduce((min, d) => (d < min ? d : min), pendingDates[0])
    : null

  return { status, settledVia, promisedPaymentDate }
}

/** Recalcula a mãe a partir das parcelas. Partilhado por receivables, payables
 *  e reconciliação. Só receivables têm `settledAt`. */
export async function syncParentDocStatus(db: Db, _clientId: string, kind: Kind, parentId: string): Promise<void> {
  if (kind === 'receivable') {
    const children = await db.treasuryReceivable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, receivedAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
    })
    if (children.length === 0) return
    const receivedAmount = children.reduce((s, c) => s + Number(c.receivedAmount ?? 0), 0)
    const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
    const { status, settledVia, promisedPaymentDate } = deriveParent(children)
    const parent = await db.treasuryReceivable.findUnique({ where: { id: parentId }, select: { settledAt: true } })
    const settledAt = (status === 'SETTLED' || status === 'PAID') ? (parent?.settledAt ?? new Date()) : null
    await db.treasuryReceivable.update({
      where: { id: parentId },
      data: { status, receivedAmount, pendingAmount, promisedPaymentDate, settledAt, settledVia },
    })
    return
  }

  const children = await db.treasuryPayable.findMany({
    where: { parentId, deletedAt: null, recurrenceId: null },
    select: { status: true, paidAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
  })
  if (children.length === 0) return
  const paidAmount = children.reduce((s, c) => s + Number(c.paidAmount ?? 0), 0)
  const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
  const { status, settledVia, promisedPaymentDate } = deriveParent(children)
  await db.treasuryPayable.update({
    where: { id: parentId },
    data: { status, paidAmount, pendingAmount, promisedPaymentDate, settledVia },
  })
}
```

- [ ] **Step 4: Correr os testes para confirmar que passam**

Run: `cd apps/api && npx vitest run src/lib/parent-status.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/parent-status.ts apps/api/src/lib/parent-status.test.ts
git commit -m "feat(api): helper syncParentDocStatus partilhado com settledVia"
```

---

## Task 3: Receivables service — settledVia, gating e delegação

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts`
- Test: `apps/api/src/modules/treasury/receivables/receivables.service.test.ts` (criar se não existir)

- [ ] **Step 1: Importar o helper e delegar `syncParentStatus`**

No topo do ficheiro, junto aos restantes imports:

```ts
import { syncParentDocStatus } from '../../../lib/parent-status.js'
```

Substituir o corpo do método privado `syncParentStatus` (linhas ~839-872) por uma delegação fina, mantendo a assinatura e todos os call sites:

```ts
  private syncParentStatus(clientId: string, parentId: string) {
    return syncParentDocStatus(this.prisma, clientId, 'receivable', parentId)
  }
```

- [ ] **Step 2: Expor `settledVia` no list item**

Na interface `ReceivableListItem` (~linha 19-41), acrescentar a seguir a `status`:

```ts
  settledVia: import('@prisma/client').TreasurySettlementSource | null
```

Em `mapTocSalesToReceivable` (objeto devolvido ~62-85), acrescentar `settledVia: null,`. Nas duas branches de `overlayLocalWithToc` (~104-127 e ~134-157), acrescentar `settledVia: local.settledVia,`.

- [ ] **Step 3: Escrever o teste a falhar (gating de unsettle)**

Em `apps/api/src/modules/treasury/receivables/receivables.service.test.ts` acrescentar (criar o ficheiro com o cabeçalho de imports se ainda não existir — `import { describe, it, expect, vi } from 'vitest'` e `import { TreasuryReceivablesService } from './receivables.service.js'`):

```ts
describe('unsettle gating por settledVia', () => {
  function makeService() {
    return new TreasuryReceivablesService({} as never, {} as never, {} as never)
  }

  it('bloqueia reverter a mãe paga pelas parcelas (INSTALLMENTS)', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'PAID', settledVia: 'INSTALLMENTS', tocSalesDocId: null, _tocOverlay: null, children: [] } as never)
    await expect(svc.unsettle('c1', 'u1', 'p1')).rejects.toThrow(/parcela a parcela/)
  })

  it('bloqueia reverter um doc reconciliado pelo botão genérico (RECONCILIATION)', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalReceivableId: () => Promise<string> }, 'resolveLocalReceivableId').mockResolvedValue('r1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'r1', status: 'PAID', settledVia: 'RECONCILIATION', tocSalesDocId: null, _tocOverlay: null, children: [] } as never)
    await expect(svc.unsettle('c1', 'u1', 'r1')).rejects.toThrow(/reconcilia/i)
  })
})
```

- [ ] **Step 4: Correr o teste para confirmar que falha**

Run: `cd apps/api && npx vitest run src/modules/treasury/receivables/receivables.service.test.ts -t "gating"`
Expected: FAIL (não lança o erro esperado — o método ainda não gateia).

- [ ] **Step 5: Adicionar o gating ao `unsettle` e remover a cascata da mãe**

No método `unsettle` (~974), a seguir à verificação `if (item.status !== 'SETTLED' && item.status !== 'PAID')`, acrescentar:

```ts
    if (item.settledVia === 'INSTALLMENTS') throw httpError(409, 'Esta fatura ficou paga pelas parcelas — reverta parcela a parcela.')
    if (item.settledVia === 'RECONCILIATION') throw httpError(409, 'Esta fatura ficou paga por reconciliação — reverta anulando a reconciliação correspondente.')
```

Remover o bloco da cascata `settledChildren` (a `const settledChildren = ...` e o `if (settledChildren.length > 0) { await tx.$executeRaw\`...\` }`), bem como o termo `cascadedChildren: settledChildren.length` no payload de auditoria (passa a `via: item.settledVia`). A reversão deixa de ser em cascata. No `update` do parent, acrescentar `settledVia: null` ao `data`.

- [ ] **Step 6: Definir `settledVia` em `pay` e `settle`**

No `settle` (~874) e `pay` (~926), o comportamento passa a distinguir mãe dividida de folha. Substituir o corpo do `$transaction` + sync de `pay` por:

```ts
    const nonRecurChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    const isSplitParent = nonRecurChildren.length > 0

    const result = await this.prisma.$transaction(async (tx) => {
      if (isSplitParent) {
        // Mãe dividida: não se paga diretamente. Pagam-se as parcelas (LOCAL) e a
        // mãe deriva para INSTALLMENTS via syncParentStatus.
        await tx.$executeRaw`
          UPDATE "treasury_receivables"
          SET "status" = 'PAID', "pendingAmount" = 0, "receivedAmount" = "totalAmount", "settledAt" = NOW(), "settledVia" = 'LOCAL', "updatedAt" = NOW()
          WHERE "parentId" = ${id} AND "recurrenceId" IS NULL AND "deletedAt" IS NULL AND "status" NOT IN ('PAID','SETTLED','VOID')
        `
        await audit(tx, { clientId, userId, action: 'receivable.pay', entityType: 'Receivable', entityId: id, payload: { from: item.status, to: 'PAID', via: 'INSTALLMENTS', cascadedChildren: nonRecurChildren.length } })
        return null
      }
      const parent = await tx.treasuryReceivable.update({
        where: { id },
        data: {
          status: 'PAID',
          pendingAmount: item.tocSalesDocId ? null : 0,
          receivedAmount: item.tocSalesDocId ? null : item.totalAmount,
          promisedPaymentDate: null,
          settledAt: new Date(),
          settledVia: 'LOCAL',
        },
      })
      await audit(tx, { clientId, userId, action: 'receivable.pay', entityType: 'Receivable', entityId: id, payload: { from: item.status, to: 'PAID', via: 'LOCAL' } })
      return parent
    })

    if (isSplitParent) await this.syncParentStatus(clientId, id)
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result ?? this.prisma.treasuryReceivable.findUnique({ where: { id } })
```

Aplicar a mesma transformação ao `settle` (estado `'SETTLED'` em vez de `'PAID'`, `action: 'receivable.settle'`, e `SET "status" = 'SETTLED'` no SQL).

- [ ] **Step 7: Correr os testes**

Run: `cd apps/api && npx vitest run src/modules/treasury/receivables`
Expected: PASS (incluindo os dois novos testes de gating).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/treasury/receivables
git commit -m "feat(receivables): settledVia em pay/settle, gating de unsettle, sem cascata de reversão"
```

---

## Task 4: Payables service — espelho

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts`
- Test: `apps/api/src/modules/treasury/payables/payables.service.test.ts`

- [ ] **Step 1: Importar o helper e delegar `syncParentStatus`**

No topo, acrescentar `import { syncParentDocStatus } from '../../../lib/parent-status.js'`. Substituir o corpo de `syncParentStatus` (~809-833) por:

```ts
  private syncParentStatus(clientId: string, parentId: string) {
    return syncParentDocStatus(this.prisma, clientId, 'payable', parentId)
  }
```

- [ ] **Step 2: Expor `settledVia` no list item de payables**

Localizar a interface do list item de payables e a(s) função(ões) de overlay equivalente(s) (espelho de `overlayLocalWithToc`/`mapTocSalesToReceivable` para purchases) e acrescentar `settledVia` (do local; `null` para docs só-TOC), tal como na Task 3 Step 2.

- [ ] **Step 3: Escrever o teste a falhar (gating)**

Em `payables.service.test.ts`, acrescentar:

```ts
describe('unsettle gating por settledVia (payables)', () => {
  function makeService() { return new TreasuryPayablesService({} as never, {} as never, {} as never) }

  it('bloqueia reverter a mãe paga pelas parcelas (INSTALLMENTS)', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('p1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'p1', status: 'PAID', settledVia: 'INSTALLMENTS', tocPurchasesDocId: null, _tocOverlay: null, children: [] } as never)
    await expect(svc.unsettle('c1', 'u1', 'p1')).rejects.toThrow(/parcela a parcela/)
  })

  it('bloqueia reverter um doc reconciliado pelo botão genérico (RECONCILIATION)', async () => {
    const svc = makeService()
    vi.spyOn(svc as never as { resolveLocalPayableId: () => Promise<string> }, 'resolveLocalPayableId').mockResolvedValue('q1')
    vi.spyOn(svc, 'getById').mockResolvedValue({ id: 'q1', status: 'PAID', settledVia: 'RECONCILIATION', tocPurchasesDocId: null, _tocOverlay: null, children: [] } as never)
    await expect(svc.unsettle('c1', 'u1', 'q1')).rejects.toThrow(/reconcilia/i)
  })
})
```

- [ ] **Step 4: Correr o teste para confirmar que falha**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables/payables.service.test.ts -t "gating"`
Expected: FAIL.

- [ ] **Step 5: Aplicar gating, remover cascata e definir settledVia**

No `unsettle` de payables (~933), a seguir a `if (item.status !== 'SETTLED' && item.status !== 'PAID')`:

```ts
    if (item.settledVia === 'INSTALLMENTS') throw httpError(409, 'Esta fatura ficou paga pelas parcelas — reverta parcela a parcela.')
    if (item.settledVia === 'RECONCILIATION') throw httpError(409, 'Esta fatura ficou paga por reconciliação — reverta anulando a reconciliação correspondente.')
```

Remover o bloco `settledChildren` e a sua cascata `$executeRaw`; acrescentar `settledVia: null` ao `data` do update do parent; no payload trocar `cascadedChildren` por `via: item.settledVia`.

No `pay` (~885) e `settle` (~835), aplicar a mesma estrutura mãe-vs-folha da Task 3 Step 6, adaptada a payables (tabela `treasury_payables`, campo `paidAmount` em vez de `receivedAmount`, `readyToPay = false`, **sem** `settledAt`, e `action: 'payable.pay'`/`'payable.settle'`). Folha leva `settledVia: 'LOCAL'`; SQL das parcelas inclui `"settledVia" = 'LOCAL'`.

- [ ] **Step 6: Correr os testes**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/treasury/payables
git commit -m "feat(payables): settledVia em pay/settle, gating de unsettle, sem cascata de reversão"
```

---

## Task 5: Reconciliação — settledVia + sync da mãe

**Files:**
- Modify: `apps/api/src/modules/treasury/reconciliations/reconciliations.service.ts`
- Test: `apps/api/src/modules/treasury/reconciliations/reconciliations.service.test.ts`

- [ ] **Step 1: Importar o helper**

No topo, acrescentar `import { syncParentDocStatus } from '../../../lib/parent-status.js'`.

- [ ] **Step 2: Escrever o teste a falhar**

Em `reconciliations.service.test.ts`, acrescentar um teste que confirma que ao reconciliar totalmente um receivable o update inclui `settledVia: 'RECONCILIATION'`. Espelhar o padrão dos testes existentes (mock de `treasuryReceivable.update`, `resolveDocAmountsFromDb` a devolver `{ total: 100, settled: 0 }`, alocação de 100):

```ts
it('marca settledVia=RECONCILIATION quando o receivable fica totalmente pago', async () => {
  // ... montar o serviço e mocks como nos testes existentes deste ficheiro,
  // com uma alocação receivable de 100 sobre total 100 ...
  expect(receivableUpdate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PAID', settledVia: 'RECONCILIATION' }),
  }))
})
```

- [ ] **Step 3: Correr o teste para confirmar que falha**

Run: `cd apps/api && npx vitest run src/modules/treasury/reconciliations/reconciliations.service.test.ts -t "RECONCILIATION"`
Expected: FAIL.

- [ ] **Step 4: Definir settledVia na confirmação e limpar no reverse**

No bloco de confirmação dos receivables (~263-273), no `data` do update acrescentar:

```ts
                settledVia: newPending <= 0.01 ? 'RECONCILIATION' : null,
```

Repetir no bloco dos payables (~313-322). No bloco de **reverse** dos receivables (~384-392) e payables (~411-418), no `data` acrescentar `settledVia: null,`.

- [ ] **Step 5: Sincronizar a mãe das parcelas afetadas**

Tanto na confirmação como no reverse, depois de atualizar cada doc `alloc.id`/`link.receivableId`/`link.payableId`, recolher os docs cujo `parentId` não seja nulo e `recurrenceId` nulo e, ainda dentro da `tx`, chamar:

```ts
            if (rec.parentId && !rec.recurrenceId) await syncParentDocStatus(tx, clientId, 'receivable', rec.parentId)
```

(`rec`/`pay` já são lidos por `findUnique` nesses blocos; usar `select`/include para garantir `parentId` e `recurrenceId` disponíveis — acrescentar ao `findUnique` se necessário.) Equivalente para payables com `'payable'`.

- [ ] **Step 6: Correr os testes**

Run: `cd apps/api && npx vitest run src/modules/treasury/reconciliations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/treasury/reconciliations
git commit -m "feat(reconciliation): settledVia=RECONCILIATION e sync da mãe das parcelas"
```

---

## Task 6: Filtro `reconcilable` (mãe → parcelas)

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts`
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts`
- Modify: `apps/api/src/modules/treasury/receivables/receivables.routes.ts`
- Modify: `apps/api/src/modules/treasury/payables/payables.routes.ts`

- [ ] **Step 1: Aceitar a flag no tipo de filtros e aplicar o where invertido (receivables)**

No tipo `ReceivableListFilters`, acrescentar `reconcilable?: boolean`. No `localWhere` (~269), substituir a linha do `NOT` por uma condicional:

```ts
      ...(filters.reconcilable
        ? { NOT: { children: { some: { recurrenceId: null, deletedAt: null } } } }
        : { NOT: { parentId: { not: null }, recurrenceId: null } }),
```

Assim, em modo `reconcilable` excluem-se as mães divididas e incluem-se as parcelas; fora desse modo mantém-se o comportamento atual.

- [ ] **Step 2: Mesmo no payables service**

Aplicar a alteração equivalente em `payables.service.ts` (~206) e no respetivo tipo de filtros.

- [ ] **Step 3: Parse da query nas rotas**

Na rota de listagem de receivables (`receivables.routes.ts`) e payables (`payables.routes.ts`), ler `reconcilable` da query e passá-lo ao serviço:

```ts
    reconcilable: (request.query as { reconcilable?: string }).reconcilable === 'true',
```

(Adicionar ao objeto de filtros já montado a partir de `request.query`.)

- [ ] **Step 4: Verificação manual rápida**

Run (com a API a correr e um doc dividido): `GET /treasury/<clientId>/receivables?status=OPEN,PARTIAL,SETTLED&reconcilable=true`
Expected: a resposta inclui as parcelas (com `parentId` preenchido) e **não** inclui a mãe dividida; docs autónomos continuam presentes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/receivables apps/api/src/modules/treasury/payables
git commit -m "feat(api): modo reconcilable lista parcelas em vez da mãe dividida"
```

---

## Task 7: Reconciliação no frontend usa parcelas

**Files:**
- Modify: `apps/web/src/pages/ReconciliationPage.tsx`

- [ ] **Step 1: Acrescentar a flag às duas queries**

Na query dos receivables (~153) e payables (~160), acrescentar `&reconcilable=true` à URL:

```tsx
    queryFn: () => api.get<{ items: Document[]; total: number }>(`/treasury/${selectedClientId}/receivables?status=OPEN,PARTIAL,SETTLED&reconcilable=true&limit=500&sortBy=dueDate&sortDir=asc`),
```
```tsx
    queryFn: () => api.get<{ items: Document[]; total: number }>(`/treasury/${selectedClientId}/payables?status=OPEN,PARTIAL,SETTLED&reconcilable=true&limit=500&sortBy=dueDate&sortDir=asc`),
```

- [ ] **Step 2: Build do frontend para confirmar que compila**

Run: `cd apps/web && npm run build`
Expected: build sem erros de tipo.

- [ ] **Step 3: Verificação manual**

Abrir a página de Reconciliação com um cliente que tenha uma fatura dividida.
Expected: aparecem as parcelas (cada uma com o seu valor/data); a fatura mãe não aparece.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ReconciliationPage.tsx
git commit -m "feat(web): reconciliação lista parcelas em vez da fatura mãe"
```

---

## Task 8: Gating do botão "Anular" no DocDetailPanel

**Files:**
- Modify: `apps/web/src/components/treasury/DocDetailPanel.tsx`

- [ ] **Step 1: Acrescentar `settledVia` ao tipo do doc**

No tipo do `doc` usado pelo painel, acrescentar `settledVia?: 'LOCAL' | 'INSTALLMENTS' | 'RECONCILIATION' | null`. (Os dados já chegam via `getById`, que faz spread do registo completo — basta tipar.)

- [ ] **Step 2: Gatear os banners PAID/SETTLED**

Substituir os dois botões "Anular" dos banners SETTLED (~288-294) e PAID (~308-314) por uma renderização condicional baseada em `doc.settledVia`. Acrescentar antes do JSX dos banners:

```tsx
  const via = doc.settledVia ?? 'LOCAL'
  const revertBlockedMsg =
    via === 'INSTALLMENTS' ? 'Reverta parcela a parcela'
    : via === 'RECONCILIATION' ? 'Reverta anulando a reconciliação' : null
```

Para cada banner, o botão passa a:

```tsx
                {via === 'RECONCILIATION' ? null : (
                  <button
                    onClick={() => revertBlockedMsg ? undefined : unsettleDoc.mutate()}
                    disabled={unsettleDoc.isPending || !!revertBlockedMsg}
                    title={revertBlockedMsg ?? undefined}
                    className="text-xs text-green-700 hover:text-red-700 border border-green-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {unsettleDoc.isPending ? '...' : 'Anular'}
                  </button>
                )}
```

(No banner PAID usar as cores teal já existentes.) Resultado: `INSTALLMENTS` → botão desativado com tooltip "Reverta parcela a parcela"; `RECONCILIATION` → sem botão; `LOCAL` → comportamento atual.

- [ ] **Step 3: (Opcional) Subtítulo do banner reflete a origem**

Trocar o subtítulo fixo "Registado nesta plataforma" / "Registado — aguarda liquidação" por um derivado de `via`: `INSTALLMENTS` → "Liquidado pelas parcelas"; `RECONCILIATION` → "Liquidado por reconciliação"; `LOCAL` → texto atual.

- [ ] **Step 4: Build**

Run: `cd apps/web && npm run build`
Expected: build sem erros.

- [ ] **Step 5: Verificação manual**

Dividir uma fatura, pagar todas as parcelas → mãe fica paga; o botão "Anular" da mãe está desativado com tooltip. Abrir uma parcela paga localmente → "Anular" funciona e a mãe regressa a "Parcialmente Liquidada".

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/treasury/DocDetailPanel.tsx
git commit -m "feat(web): gating do botao Anular por origem da liquidacao"
```

---

## Task 9: Labels de auditoria para `via`

**Files:**
- Modify: `apps/web/src/components/followups/auditLabels.ts`

- [ ] **Step 1: Acrescentar tradução do campo `via`**

Em `auditLabels.ts`, onde os payloads de `pay`/`settle`/`unsettle`/`reconcile` são formatados para a timeline, acrescentar a tradução dos valores de `via`:

```ts
const SETTLEMENT_SOURCE_LABEL: Record<string, string> = {
  LOCAL: 'manualmente',
  INSTALLMENTS: 'pelas parcelas',
  RECONCILIATION: 'por reconciliação',
}
```

E incluir, quando `payload.via` existir, um sufixo como "liquidado {SETTLEMENT_SOURCE_LABEL[payload.via]}" na descrição da entrada.

- [ ] **Step 2: Build**

Run: `cd apps/web && npm run build`
Expected: build sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/followups/auditLabels.ts
git commit -m "feat(web): labels de auditoria para a origem da liquidacao"
```

---

## Verificação final

- [ ] `cd apps/api && npx vitest run` — toda a suite passa.
- [ ] `cd apps/web && npm run build` — build limpo.
- [ ] Fluxo manual ponta-a-ponta:
  1. Dividir uma fatura em 3 parcelas → mãe mostra as parcelas; na reconciliação aparecem as 3 parcelas e não a mãe.
  2. Pagar parcela a parcela → ao fechar a última, a mãe fica PAID (`settledVia=INSTALLMENTS`), botão "Anular" da mãe desativado.
  3. Reverter uma parcela → mãe volta a PARTIAL; reverter as restantes → mãe volta a OPEN.
  4. Reconciliar uma parcela pelo valor total → fica PAID com `settledVia=RECONCILIATION`; o botão genérico "Anular" não aparece; reverter a reconciliação repõe-a.
