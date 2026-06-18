# Programadas locais "Futuras → Comprometidas" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recorrências locais geram instâncias futuras estimadas (estado `SCHEDULED`, sem referência) que alimentam a previsão; uma ação "Marcar como Comprometido" promove-as a `OPEN` confirmando referência + valor + data. Aplica-se a Receber e Pagar.

**Architecture:** Novo valor de estado `SCHEDULED` no enum `TreasuryDocStatus`. A geração de recorrências passa a criar instâncias `SCHEDULED` (sem referência, valor estimado). Novos endpoints `commit` fazem `SCHEDULED → OPEN`. As ações pay/settle/split/partial/promised-date passam a rejeitar `SCHEDULED`. O dashboard classifica a série "Programadas" por `status = SCHEDULED` em vez de `recurrenceId`. O frontend esconde a referência ao criar recorrências, mostra a etiqueta "Programada" e a ação de comprometer.

**Tech Stack:** Fastify + Prisma + PostgreSQL (apps/api); React + Vite + TanStack Query (apps/web). Spec: `docs/superpowers/specs/2026-06-19-programadas-comprometido-design.md`.

**Nota de verificação (importante para este repo):** o `vitest` NÃO corre (Node 20.10 — falta `node:util.styleText`). A verificação de cada tarefa é:
1. `npx tsc --noEmit` em `apps/api` e/ou `apps/web` → `API=0`/`WEB=0`.
2. Scripts Node ESM (`apps/api/_q.mjs`, apagados no fim) que cunham um JWT HS256 (`type:'access'`) com `JWT_SECRET` e chamam os endpoints / fazem queries Prisma. Cliente de teste: `clientId='cmp10vpvg0000chy7qnotfy5b'`, user `cmp10uy7e0005zq06ttw6e9ke`.
3. O servidor de dev (`npm run dev`) recarrega a API a cada gravação (tsx watch); confirmar 200 nos endpoints.

Commits: terminar a mensagem com `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (usar `git commit -F d:\tmp\commitmsg.txt`, pois here-strings com acentos partem). Branch: `Test`.

---

## Estrutura de ficheiros

- `apps/api/prisma/schema.prisma` — adicionar `SCHEDULED` ao enum `TreasuryDocStatus`.
- `apps/api/prisma/migrations/<timestamp>_scheduled_status/migration.sql` — adicionar valor ao enum + migrar dados.
- `apps/api/src/modules/treasury/recurrences/recurrences.service.ts` — instâncias geradas com `status: 'SCHEDULED'`.
- `apps/api/src/modules/treasury/receivables/receivables.service.ts` — `commit()`; gating de `pay/settle/split/partialPayment/setPromisedDate`; criação de recorrência (`SCHEDULED`, sem referência); editar estimativa.
- `apps/api/src/modules/treasury/receivables/receivables.routes.ts` — rota `POST .../commit`.
- `apps/api/src/modules/treasury/payables/payables.service.ts` + `payables.routes.ts` — idem.
- `apps/api/src/modules/treasury/dashboard/dashboard.service.ts` — "Programadas" = `SCHEDULED`; incluir `SCHEDULED` nas queries de pendentes (statement, semanal, previsão, `netCashFlow`).
- `apps/web/src/pages/ReceivablesPage.tsx` + `apps/web/src/pages/PayablesPage.tsx` — formulário de criação (sem referência, com estimativa), ação/forma "Marcar como Comprometido", etiqueta "Programada", gating de botões, editar estimativa.

---

## Fase 1 — Schema e migração

### Task 1: Adicionar estado `SCHEDULED` ao enum

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `TreasuryDocStatus`, ~linha 43)
- Create: `apps/api/prisma/migrations/<timestamp>_scheduled_status/migration.sql`

- [ ] **Step 1: Parar o servidor de dev** (libertar o lock da DLL do Prisma antes de gerar).

Run (PowerShell): identificar e parar o processo `npm run dev` em background (ou `Get-Process node | Stop-Process`), confirmando portas 3001/5173 livres.

- [ ] **Step 2: Editar o enum no schema**

Em `apps/api/prisma/schema.prisma`, no enum `TreasuryDocStatus`:

```prisma
enum TreasuryDocStatus {
  SCHEDULED
  OPEN
  PARTIAL
  PAID
  SETTLED
  VOID
}
```

- [ ] **Step 3: Criar a migração SQL manualmente**

Criar `apps/api/prisma/migrations/20260619120000_scheduled_status/migration.sql`:

```sql
-- Novo estado: faturas programadas (recorrências futuras estimadas, ainda não comprometidas).
ALTER TYPE "TreasuryDocStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
```

> Nota: `ADD VALUE` não pode correr dentro da mesma transação que o usa; manter este `ALTER TYPE` SOZINHO neste ficheiro de migração. A migração de dados (Task 2) vai num ficheiro separado, posterior.

- [ ] **Step 4: Aplicar a migração e regenerar o client**

Run: `cd apps/api; npx prisma migrate deploy; npx prisma generate`
Expected: "migration(s) applied", "Generated Prisma Client". Sem EPERM (servidor parado no Step 1).

- [ ] **Step 5: Typecheck**

Run: `cd apps/api; npx tsc --noEmit`
Expected: `API=0` (o novo valor de enum não parte nada ainda).

- [ ] **Step 6: Commit**

```
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -F d:\tmp\commitmsg.txt   # "feat(schema): estado SCHEDULED (programadas)"
```

### Task 2: Migrar recorrentes futuras existentes para `SCHEDULED`

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp+1>_migrate_future_recurring_scheduled/migration.sql`

- [ ] **Step 1: Escrever a migração de dados**

Criar `apps/api/prisma/migrations/20260619120100_migrate_future_recurring_scheduled/migration.sql`:

```sql
-- Recorrentes futuras por pagar passam a Programadas (SCHEDULED) e perdem a
-- referência auto-gerada (será definida ao comprometer). Pagas/passadas ficam.
UPDATE "treasury_receivables"
SET "status" = 'SCHEDULED', "reference" = NULL, "updatedAt" = NOW()
WHERE "recurrenceId" IS NOT NULL
  AND "status" = 'OPEN'
  AND "deletedAt" IS NULL
  AND "dueDate" > NOW();

UPDATE "treasury_payables"
SET "status" = 'SCHEDULED', "reference" = NULL, "updatedAt" = NOW()
WHERE "recurrenceId" IS NOT NULL
  AND "status" = 'OPEN'
  AND "deletedAt" IS NULL
  AND "dueDate" > NOW();
```

- [ ] **Step 2: Aplicar a migração**

Run: `cd apps/api; npx prisma migrate deploy`
Expected: aplicada sem erros.

- [ ] **Step 3: Verificar via query**

Criar `apps/api/_q.mjs` que conta `treasuryReceivable`/`treasuryPayable` com `status='SCHEDULED'` para o cliente de teste e imprime alguns (deve mostrar `reference: null`, `dueDate` futura). Run: `node _q.mjs`. Apagar o ficheiro.
Expected: contagem ≥ 0 coerente; nenhum SCHEDULED com referência.

- [ ] **Step 4: Commit**

```
git add apps/api/prisma/migrations
git commit -F d:\tmp\commitmsg.txt   # "chore(db): migrar recorrentes futuras para SCHEDULED"
```

---

## Fase 2 — Geração de recorrências cria `SCHEDULED`

### Task 3: Instâncias geradas nascem `SCHEDULED`

**Files:**
- Modify: `apps/api/src/modules/treasury/recurrences/recurrences.service.ts:158-177` (receivables) e `:191-210` (payables)

- [ ] **Step 1: Adicionar `status: 'SCHEDULED'` na criação da instância (receivable)**

Em `recurrences.service.ts`, no `create` do receivable (~linha 158), adicionar ao objeto `data`:

```ts
              data: {
                clientId,
                createdById: root.createdById,
                origin: root.origin,
                status: 'SCHEDULED',
                categoryId: root.categoryId,
                entityName: root.entityName,
                entityNif: root.entityNif,
                reference: newRef,
                // ... resto inalterado
```

- [ ] **Step 2: Idem para o payable (~linha 191)**

Adicionar `status: 'SCHEDULED',` ao `data` da criação do `treasuryPayable`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/api; npx tsc --noEmit` → `API=0`.

- [ ] **Step 4: Verificar geração**

Reiniciar `npm run dev`. Criar `apps/api/_q.mjs` que chama `POST /treasury/:clientId/recurrences/process` (JWT cunhado) e depois conta instâncias `SCHEDULED` geradas. Run, confirmar 200 + instâncias `SCHEDULED`. Apagar.

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/treasury/recurrences/recurrences.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(recurrences): instâncias geradas como SCHEDULED"
```

---

## Fase 3 — Criação de recorrência (backend): SCHEDULED, sem referência, valor estimado

### Task 4: Ao criar uma recorrência, a raiz nasce `SCHEDULED` sem referência

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (método `create`)
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts` (método `create`)

- [ ] **Step 1: Localizar o ramo de criação recorrente**

No `create` de `receivables.service.ts`, localizar onde se cria a `TreasuryRecurrence` + a fatura-raiz (payload com `isRecurrent`/frequência). Confirmar os campos atuais (referência, totalAmount).

- [ ] **Step 2: Forçar `status: 'SCHEDULED'` e `reference: null` na raiz recorrente**

No ramo recorrente, ao criar a fatura-raiz, definir `status: 'SCHEDULED'` e `reference: null` (ignorar qualquer referência enviada). Manter `totalAmount`/`pendingAmount` = valor estimado (campo enviado pelo formulário). Validar que `totalAmount` (estimativa) é > 0 — senão `httpError(400, 'Valor estimado obrigatório na recorrência')`.

- [ ] **Step 3: Idem no `create` de `payables.service.ts`**

- [ ] **Step 4: Typecheck**

Run: `cd apps/api; npx tsc --noEmit` → `API=0`.

- [ ] **Step 5: Verificar**

`_q.mjs`: `POST /treasury/:clientId/receivables` com payload recorrente (sem referência, com `totalAmount` estimado) → 201; confirmar raiz `status SCHEDULED`, `reference null`. Repetir para payables. Apagar.

- [ ] **Step 6: Commit**

```
git add apps/api/src/modules/treasury/receivables/receivables.service.ts apps/api/src/modules/treasury/payables/payables.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(recurrences): raiz recorrente nasce SCHEDULED sem referência"
```

---

## Fase 4 — Ação "Marcar como Comprometido" (SCHEDULED → OPEN)

### Task 5: `commit()` no serviço de receivables

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (novo método, junto a `settle`/`pay`)

- [ ] **Step 1: Implementar `commit()`** (espelha a estrutura de `settle`/`pay`, ver `:947`/`:1010`)

```ts
  async commit(clientId: string, userId: string, id: string, opts: { reference: string; amount: number; date: string }) {
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status !== 'SCHEDULED') throw httpError(409, 'Só é possível comprometer uma fatura programada')
    const reference = opts.reference?.trim()
    if (!reference) throw httpError(400, 'A referência é obrigatória')
    if (!opts.date) throw httpError(400, 'A data é obrigatória')
    if (!(opts.amount > 0)) throw httpError(400, 'O valor é obrigatório')
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: {
        status: 'OPEN',
        reference,
        totalAmount: opts.amount,
        pendingAmount: opts.amount,
        receivedAmount: 0,
        dueDate: new Date(opts.date),
      },
    })
    await audit(this.prisma, { clientId, userId, action: 'receivable.commit', entityType: 'Receivable', entityId: id, payload: { reference, amount: opts.amount, date: opts.date } })
    return result
  }
```

- [ ] **Step 2: Typecheck** → `API=0`.

- [ ] **Step 3: Commit**

```
git add apps/api/src/modules/treasury/receivables/receivables.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(receivables): commit (SCHEDULED -> OPEN)"
```

### Task 6: Rota `POST .../receivables/:id/commit`

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.routes.ts` (junto à rota `/settle`, ~linha 233)

- [ ] **Step 1: Adicionar a rota** (espelhar a rota `/settle`):

```ts
  app.post('/treasury/:clientId/receivables/:id/commit', { onRequest: [app.authenticate] }, async (req) => {
    const { clientId, id } = req.params as { clientId: string; id: string }
    const body = req.body as { reference: string; amount: number; date: string }
    return svc.commit(clientId, req.user.sub, id, body)
  })
```

> Ajustar `svc`/`app.authenticate`/assinatura ao padrão exato das rotas vizinhas no ficheiro.

- [ ] **Step 2: Typecheck** → `API=0`.

- [ ] **Step 3: Verificar E2E**

`_q.mjs`: pegar num receivable `SCHEDULED` (ou criar um), `POST .../commit` com `{reference,amount,date}` → 200; confirmar `status OPEN`, `reference`/`totalAmount`/`dueDate` atualizados. Apagar.

- [ ] **Step 4: Commit**

```
git add apps/api/src/modules/treasury/receivables/receivables.routes.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(receivables): rota commit"
```

### Task 7: `commit()` + rota para payables

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts`
- Modify: `apps/api/src/modules/treasury/payables/payables.routes.ts` (junto a `/settle`, ~linha 209)

- [ ] **Step 1: Implementar `commit()` em payables** (igual ao Task 5, mas para payable: `paidAmount: 0` em vez de `receivedAmount`; usar os nomes de campo do model `TreasuryPayable`). Action de audit `payable.commit`.

- [ ] **Step 2: Adicionar a rota** `POST /treasury/:clientId/payables/:id/commit` (espelhar `/settle` de payables).

- [ ] **Step 3: Typecheck** → `API=0`.

- [ ] **Step 4: Verificar E2E** (igual ao Task 6, para payables).

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/treasury/payables/payables.service.ts apps/api/src/modules/treasury/payables/payables.routes.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(payables): commit (SCHEDULED -> OPEN)"
```

---

## Fase 5 — Gating: rejeitar `SCHEDULED` nas ações de fatura real

### Task 8: Bloquear pay/settle/split/partialPayment/setPromisedDate em `SCHEDULED` (receivables)

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (`pay:1010`, `settle:947`, `split:1230`, `partialPayment:1103`, `setPromisedDate:1209`)

- [ ] **Step 1: Adicionar guarda em cada método**

No início de cada um dos métodos `pay`, `settle`, `split`, `partialPayment`, `setPromisedDate`, logo após obter `item = await this.getById(...)`:

```ts
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
```

> Em `split` a guarda já existe parcialmente (`status !== 'OPEN'`); confirmar que `SCHEDULED` cai no 409 existente — se sim, basta a mensagem clara. Em `setPromisedDate`/`partialPayment` adicionar a guarda explícita.

- [ ] **Step 2: Typecheck** → `API=0`.

- [ ] **Step 3: Verificar**

`_q.mjs`: contra um receivable `SCHEDULED`, chamar `/pay`, `/settle`, `/split`, `/partial-payment`, `/promised-date` → todos **409**. Apagar.

- [ ] **Step 4: Commit**

```
git add apps/api/src/modules/treasury/receivables/receivables.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(receivables): bloquear ações em SCHEDULED"
```

### Task 9: Mesmo gating para payables

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts` (métodos equivalentes)

- [ ] **Step 1: Adicionar a mesma guarda `status === 'SCHEDULED' → 409`** nos métodos `pay`, `settle`, `split`, `partialPayment`, `setPromisedDate` (e `setReadyToPay` — uma programada não pode ser "pronta para pagar").

- [ ] **Step 2: Typecheck** → `API=0`.

- [ ] **Step 3: Verificar** (igual ao Task 8, para payables). Apagar `_q.mjs`.

- [ ] **Step 4: Commit**

```
git add apps/api/src/modules/treasury/payables/payables.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(payables): bloquear ações em SCHEDULED"
```

---

## Fase 6 — Editar estimativa (valor + categoria) em `SCHEDULED`

### Task 10: Permitir editar valor/categoria de uma futura

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (método `update`)
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts` (método `update`)

- [ ] **Step 1: Localizar o `update` e a sua validação por estado**

Confirmar o que o `update` atual permite e em que estados. Garantir que, com `status = SCHEDULED`, é permitido alterar **apenas** `totalAmount`/`pendingAmount` (mantê-los iguais entre si) e `categoryId`. Bloquear alteração de `dueDate`/`reference` em `SCHEDULED` (a data vem da cadência; a referência define-se no commit).

- [ ] **Step 2: Implementar a regra** (receivables e payables): se `item.status === 'SCHEDULED'`, ignorar/rejeitar `dueDate` e `reference` no payload e, ao mudar `totalAmount`, atualizar também `pendingAmount` para o mesmo valor.

- [ ] **Step 3: Typecheck** → `API=0`.

- [ ] **Step 4: Verificar**

`_q.mjs`: `PATCH` a um receivable `SCHEDULED` mudando `totalAmount` e `categoryId` → 200, valores atualizados, `pendingAmount == totalAmount`; tentar mudar `dueDate` → ignorado/409. Apagar.

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/treasury/receivables/receivables.service.ts apps/api/src/modules/treasury/payables/payables.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat: editar estimativa (valor/categoria) em SCHEDULED"
```

---

## Fase 7 — Cash flow: "Programadas" = `SCHEDULED`

### Task 11: Incluir `SCHEDULED` e classificar por estado no statement mensal

**Files:**
- Modify: `apps/api/src/modules/treasury/dashboard/dashboard.service.ts` (queries de `pendingRec`/`pendingPay` e respetivos loops; helper `netCashFlow`)

- [ ] **Step 1: Incluir `SCHEDULED` no filtro de status das queries de pendentes**

Em todas as queries de pendentes do `getCashflowStatement` (e no `netCashFlow`), trocar `status: { in: ['OPEN', 'PARTIAL'] }` por `status: { in: ['OPEN', 'PARTIAL', 'SCHEDULED'] }`. Adicionar `status: true` ao `select` de `pendingRec`/`pendingPay`.

- [ ] **Step 2: Classificar a série por estado (não por `recurrenceId`)**

Nos loops `for (const r of pendingRec)` e `for (const p of pendingPay)`, trocar a classificação:

```ts
      // antes: if (r.recurrenceId) monthlyProgrammedIncome[idx] += amt; else monthlyOpenIncome[idx] += amt
      if (r.status === 'SCHEDULED') monthlyProgrammedIncome[idx] += amt
      else monthlyOpenIncome[idx] += amt
```

(e análogo para `pendingPay` → `monthlyProgrammedExpense`/`monthlyOpenExpense`).

- [ ] **Step 3: Typecheck** → `API=0`.

- [ ] **Step 4: Verificar reconciliação + classificação**

`_q.mjs`: chamar `cashflow-statement?year=2026`; confirmar `incomeProgrammed`/`expenseProgrammed` refletem `SCHEDULED` e que `cat+sem-categoria == incomeTotal` (reconciliação) se mantém. Apagar.

- [ ] **Step 5: Commit**

```
git add apps/api/src/modules/treasury/dashboard/dashboard.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(dashboard): Programadas = SCHEDULED (mensal)"
```

### Task 12: Incluir `SCHEDULED` na vista semanal e na previsão

**Files:**
- Modify: `apps/api/src/modules/treasury/dashboard/dashboard.service.ts` (`getCashPositioning` queries ~linha 781; `getForecast` queries ~linha 907)

- [ ] **Step 1: Adicionar `SCHEDULED` ao filtro de status** das queries de pendentes do `getCashPositioning` e do `getForecast` (`status: { in: ['OPEN', 'PARTIAL', 'SCHEDULED'] }`).

- [ ] **Step 2: Typecheck** → `API=0`.

- [ ] **Step 3: Verificar** `cash-positioning` e `forecast` respondem 200 e incluem os SCHEDULED. Apagar `_q.mjs`.

- [ ] **Step 4: Commit**

```
git add apps/api/src/modules/treasury/dashboard/dashboard.service.ts
git commit -F d:\tmp\commitmsg.txt   # "feat(dashboard): SCHEDULED na semanal e previsão"
```

---

## Fase 8 — Frontend

### Task 13: Formulário de criação — esconder referência e pedir estimativa (recorrentes)

**Files:**
- Modify: `apps/web/src/pages/ReceivablesPage.tsx` (formulário de criação)
- Modify: `apps/web/src/pages/PayablesPage.tsx` (formulário de criação)

- [ ] **Step 1: Esconder o campo Referência quando "recorrente" está ligado**

No formulário de criação, quando o toggle de recorrência está ativo: não renderizar o input de Referência (e não enviar `reference`). Manter/realçar o input de valor como **"Valor estimado"** e a cadência. Validar valor estimado > 0 no submit.

- [ ] **Step 2: Idem em `PayablesPage.tsx`.**

- [ ] **Step 3: Typecheck** Run: `cd apps/web; npx tsc --noEmit` → `WEB=0`.

- [ ] **Step 4: Verificar (HMR)** Criar uma recorrência pela UI sem referência; confirmar que aparece como "Programada" (após Task 15) e que o backend a guarda `SCHEDULED`.

- [ ] **Step 5: Commit**

```
git add apps/web/src/pages/ReceivablesPage.tsx apps/web/src/pages/PayablesPage.tsx
git commit -F d:\tmp\commitmsg.txt   # "feat(web): criação de recorrência sem referência, com estimativa"
```

### Task 14: Ação + formulário "Marcar como Comprometido"

**Files:**
- Modify: `apps/web/src/pages/ReceivablesPage.tsx` (painel lateral; espelhar a secção/forma de "Liquidar" — `panelSection 'settle'`)
- Modify: `apps/web/src/pages/PayablesPage.tsx`
- Modify: `apps/web/src/lib/api.ts` (se necessário, nada — usar `api.post`)

- [ ] **Step 1: Adicionar a chamada à API** no handler (TanStack Query mutation): `api.post(`/treasury/${clientId}/receivables/${id}/commit`, { reference, amount, date })`, com invalidate das queries da lista + dashboard.

- [ ] **Step 2: Adicionar a forma no painel lateral** (espelhar a forma de "Liquidar"): inputs `reference`, `amount` (pré-preenchido com `totalAmount` estimado), `date` (pré-preenchido com `dueDate` estimada). Botão "Marcar como Comprometido" só visível quando `panelDoc.status === 'SCHEDULED'`.

- [ ] **Step 3: Idem em `PayablesPage.tsx`** (endpoint `/payables/.../commit`).

- [ ] **Step 4: Typecheck** → `WEB=0`.

- [ ] **Step 5: Verificar (HMR)** Comprometer uma futura → passa a OPEN, sai de "Programada", e o cash flow move de Programadas para Em aberto.

- [ ] **Step 6: Commit**

```
git add apps/web/src/pages/ReceivablesPage.tsx apps/web/src/pages/PayablesPage.tsx
git commit -F d:\tmp\commitmsg.txt   # "feat(web): ação Marcar como Comprometido"
```

### Task 15: Etiqueta "Programada" + gating de botões por estado

**Files:**
- Modify: `apps/web/src/pages/ReceivablesPage.tsx`
- Modify: `apps/web/src/pages/PayablesPage.tsx`

- [ ] **Step 1: Etiqueta "Programada"** na tabela e no painel quando `status === 'SCHEDULED'` (reutilizar o padrão de badges de estado existente — onde se mostram OPEN/PAID/etc.).

- [ ] **Step 2: Esconder botões** Pagar, Liquidar, Dividir (Scissors, ~linha 2832), Mudar data (Clock, ~linha 2780), Pagamento parcial quando `status === 'SCHEDULED'`. Substituir o bloco anterior de gating por data (`isFutureRec`, ~linha 2712) por gating por `status === 'SCHEDULED'`.

- [ ] **Step 3: Permitir editar valor/categoria** numa futura (manter os campos editáveis; bloquear edição de data/referência na UI quando `SCHEDULED`).

- [ ] **Step 4: Idem em `PayablesPage.tsx`.**

- [ ] **Step 5: Typecheck** → `WEB=0`.

- [ ] **Step 6: Verificar (HMR)** Uma futura mostra só "Marcar como Comprometido" + editar estimativa + eliminar; sem pagar/liquidar/dividir/mudar data.

- [ ] **Step 7: Commit**

```
git add apps/web/src/pages/ReceivablesPage.tsx apps/web/src/pages/PayablesPage.tsx
git commit -F d:\tmp\commitmsg.txt   # "feat(web): etiqueta Programada + gating por estado"
```

---

## Fase 9 — Verificação E2E e fecho

### Task 16: Verificação ponta-a-ponta

**Files:** nenhum (script temporário `apps/api/_q.mjs`)

- [ ] **Step 1: Script E2E**

`_q.mjs` (JWT cunhado) que executa o fluxo completo e imprime cada passo:
1. `POST /receivables` recorrente (sem referência, valor estimado) → 201; raiz `SCHEDULED`.
2. `POST /recurrences/process` → gera instâncias `SCHEDULED`.
3. `GET /cashflow-statement?year=<atual>` → instâncias aparecem em `incomeProgrammed`.
4. `POST /receivables/:id/commit` `{reference,amount,date}` → 200; `status OPEN`.
5. `GET /cashflow-statement` de novo → o valor moveu de `programmed` para `open`.
6. `POST /receivables/:id/pay` num `SCHEDULED` → 409; num `OPEN` (comprometido) → 200.
7. Repetir 1/4/6 para payables.
Apagar `_q.mjs` no fim.

Expected: todos os passos coerentes; reconciliação categorias==total mantém-se.

- [ ] **Step 2: Typecheck final** `apps/api` e `apps/web` → `API=0`, `WEB=0`.

- [ ] **Step 3: Push**

```
git push origin Test
```

---

## Self-review (cobertura do spec)

- Estado `SCHEDULED` → Task 1. ✓
- Migração de futuras existentes → Task 2. ✓
- Geração SCHEDULED → Task 3. ✓
- Criação sem referência + estimativa (backend) → Task 4; (frontend) → Task 13. ✓
- "Marcar como Comprometido" (R+P) → Tasks 5-7, 14. ✓
- Gating de ações em SCHEDULED (R+P) → Tasks 8-9, 15. ✓
- Editar valor/categoria estimados → Task 10, 15. ✓
- Cash flow Programadas=SCHEDULED (mensal/semanal/previsão/netCashFlow) → Tasks 11-12. ✓
- Etiqueta "Programada" → Task 15. ✓
- `readyToPay` inalterado (só bloqueado em SCHEDULED) → Task 9. ✓

Pontos a confirmar durante a execução (não bloqueiam o plano):
- Localizar o ramo exato de criação de recorrência no `create` (Task 4) — line numbers a confirmar no ficheiro.
- Confirmar nomes de campo do `TreasuryPayable` (paidAmount vs receivedAmount) no `commit` (Task 7).
- Eliminar/saltar uma ocorrência futura: como o dedup é por `(recurrenceId, dueDate)`, uma futura eliminada (soft-delete) não é recriada — comportamento desejado (saltar é permanente).
