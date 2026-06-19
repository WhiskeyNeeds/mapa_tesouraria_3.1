# Timeline de Histórico (auditoria) no Budget

**Data:** 2026-06-19
**Estado:** Aprovado (design revisto) — pendente plano de implementação

## Objetivo

Adicionar ao budget uma **timeline de histórico de atividade**: um registo cronológico do
que aconteceu ao budget — criação, edições, regras e associação de transações — com o
autor de cada ação, num novo separador "Histórico" do painel do budget.

## Decisão de arquitetura (revista)

A app **já tem** um sistema de auditoria genérico que vamos **reutilizar** (não se cria
tabela nova):

- Tabela `TreasuryAuditLog` (`prisma/schema.prisma`): `id, clientId, userId?, action,
  entityType, entityId?, payload Json?, createdAt`, com índices `[entityType, entityId]` e
  `[clientId, createdAt desc]`, e relação `user`.
- Helper `audit(prisma, { clientId, userId?, action, entityType, entityId, payload })` em
  `src/lib/audit.ts` — escrita **best-effort** (try/catch, não quebra a operação).
- `diffEntity(before, after)` em `src/lib/audit.ts` — produz `{ campo: { from, to } }`.
- O `budgets.service` **já regista** `budget.create`, `budget.update` (com diff via
  `diffEntity`) e `budget.delete`. Budgets são **soft-delete** (sobrevivem).
- Já existe padrão de leitura (`treasuryAuditLog.findMany` com `include: { user }`) em
  `bank-movements.routes.ts` e `followups.service.ts`.

Todos os eventos do budget usam `entityType: 'Budget'` e `entityId: <budgetId>`. A leitura
da timeline filtra por esses dois campos.

## Âmbito

Eventos (decidido com o utilizador): ciclo de vida do budget, regras, e associação de
transações. **Fora:** pagamentos/liquidações das faturas. Sem backfill/migração (os logs
existentes mantêm-se; novos eventos acumulam).

### Ações (`action`) e `payload`

| `action` | Quando | `payload` | Estado |
|---|---|---|---|
| `budget.create` | criar budget | `{ name, type, totalAmount, startDate, endDate }` | **já existe** |
| `budget.update` | editar (inclui arquivar/reativar via `status`) | `{ changes: { campo: { from, to } } }` | **já existe** |
| `budget.delete` | eliminar (soft) | `{ name, totalAmount }` | **já existe** |
| `budget.rule_add` | regra criada | `{ ruleId, categoryName, textPattern }` | **novo** |
| `budget.rule_remove` | regra removida | `{ ruleId, categoryName, textPattern }` | **novo** |
| `budget.txn_auto_assign` | fatura atribuída por regra/TOC | `{ docId, docType, entityName, amount }` | **novo** (autor Sistema) |
| `budget.txn_confirm` | auto-atribuição confirmada | `{ docId, docType, entityName, amount }` | **novo** |
| `budget.txn_move_in` | fatura associada/movida PARA este budget | `{ docId, docType, entityName, amount, fromBudgetName? }` | **novo** |
| `budget.txn_move_out` | fatura movida DESTE budget | `{ docId, docType, entityName, amount, toBudgetName? }` | **novo** |
| `budget.txn_unassign` | associação removida | `{ docId, docType, entityName, amount }` | **novo** |

`entityName`/`*BudgetName` são **congelados** no payload (legíveis mesmo que mudem depois).

## Pontos de registo (backend)

| Origem | Ação(ões) | Autor |
|---|---|---|
| `budgets.service.create/update/delete` | já registadas | utilizador (já passado) |
| `budget-rules.service.create/delete` | `budget.rule_add` / `budget.rule_remove` | utilizador (passar `userId` às rotas — hoje não recebem) |
| `receivables`/`payables` `update` + `bulkSetBudget` | transição de `budgetId`/`budgetAutoAssigned` (ver abaixo) | utilizador (já passado) |
| auto-atribuição por regras (caminho que põe `budgetAutoAssigned=true`) | `budget.txn_auto_assign` | **Sistema** (`userId` null) |

### Transições de transação (lê estado antigo antes do update)

Antes de gravar o update, lê-se o `budgetId`/`budgetAutoAssigned` atuais do documento:

- `null → X` com `budgetAutoAssigned=true`: `budget.txn_auto_assign` em X (Sistema).
- `null → X` manual: `budget.txn_move_in` em X (sem `fromBudgetName`).
- `budgetAutoAssigned: true → false`, mesmo budget: `budget.txn_confirm`.
- `X → Y`: `budget.txn_move_out` em X **e** `budget.txn_move_in` em Y (`from/toBudgetName`).
- `X → null`: `budget.txn_unassign` em X.

`bulkSetBudget` aplica a mesma lógica por cada id.

## API

Novo endpoint, seguindo o padrão de leitura existente:

```
GET /treasury/:clientId/budgets/:id/events?limit=50&before=<ISO createdAt cursor>
```

- `onRequest: [authenticate, requireClientAccess]`.
- Lê `treasuryAuditLog.findMany({ where: { clientId, entityType: 'Budget', entityId: id,
  ...(before ? { createdAt: { lt: new Date(before) } } : {}) }, include: { user: { select:
  { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: limit + 1 })`.
- Devolve `{ events: BudgetEventDTO[], nextCursor: string | null }` onde
  `BudgetEventDTO = { id, action, createdAt, actor: { id, name } | null, payload }`.
  `nextCursor` = `createdAt` do último item quando há mais (take+1).
- O payload de `GET /budgets/:id` **não** muda.

## Frontend

Nova tab **"Histórico"** no `BudgetPanel.tsx` (junto a Transações / Regras / Para rever).

- Query lazy `['budget-events', clientId, budgetId]`, ativa só quando a tab abre (padrão
  igual ao da query de categorias). Paginação "Carregar mais" via `nextCursor`.
- Timeline vertical: ícone por `action` + texto PT + autor (`por <nome>` ou `Sistema`) +
  data (`formatDate`/hora).
- Formatador `formatBudgetEvent(action, payload)` → string PT. Casos:
  - `budget.create` → "Budget criado"
  - `budget.update` → uma linha por campo em `payload.changes`
    (ex.: "Valor: 5.000 € → 7.000 €"); `status: ACTIVE→ARCHIVED` → "Budget arquivado";
    `ARCHIVED→ACTIVE` → "Budget reativado"
  - `budget.delete` → "Budget eliminado"
  - `budget.rule_add` → "Regra adicionada: «Categoria»" (+ filtro de texto se houver)
  - `budget.rule_remove` → "Regra removida: «Categoria»"
  - `budget.txn_auto_assign` → "Fatura de ACME (123 €) atribuída automaticamente"
  - `budget.txn_confirm` → "Fatura de ACME (123 €) confirmada"
  - `budget.txn_move_in` → "Fatura de ACME (123 €) adicionada" / "… movida de «Y»"
  - `budget.txn_move_out` → "Fatura de ACME (123 €) movida para «Z»"
  - `budget.txn_unassign` → "Fatura de ACME (123 €) removida do budget"

## Casos limite e erros

- **Best-effort:** `audit()` já não propaga falhas; mantém-se.
- **Soft-delete:** o budget e os seus logs sobrevivem; o evento de eliminação é registado.
- **Mover fatura:** 2 eventos (out + in), coerentes em ambos os budgets.
- **Documento eliminado depois:** o evento mantém `entityName`/`amount` congelados.
- **Sem backfill:** budgets antigos sem `budget.create` mostram só eventos futuros.

## Testes (vitest)

- `budget-rules.service`: `create`/`delete` chamam `audit()` com a ação e payload certos
  (mock do prisma, à imagem de `bank-movements.service.test.ts`).
- `receivables`/`payables` `update`/`bulkSetBudget`: cada transição emite a(s) ação(ões)
  correta(s) — auto_assign (userId null), confirm, move_in/out (2 logs), unassign.
- Endpoint `GET .../events`: filtra por `entityType='Budget'`+`entityId`; paginação por
  `before`; resolve autor; `actor=null` → Sistema.

## Ficheiros afetados

- `apps/api/src/modules/treasury/budget-rules/{budget-rules.service.ts, budget-rules.routes.ts}`
  — passar `userId` + `audit()` em create/delete.
- `apps/api/src/modules/treasury/{receivables,payables}/*.service.ts` — `audit()` scoped ao
  budget nas transições de `update`/`bulkSetBudget`; idem no caminho de auto-atribuição.
- `apps/api/src/modules/treasury/budgets/budgets.routes.ts` — endpoint `GET .../:id/events`.
- `apps/web/src/components/budgets/BudgetPanel.tsx` — tab "Histórico" + `formatBudgetEvent`.
- **Sem** alterações ao `schema.prisma` (reutiliza `TreasuryAuditLog`).
