# Timeline de Histórico (auditoria) no Budget

**Data:** 2026-06-19
**Estado:** Aprovado (design) — pendente plano de implementação

## Objetivo

Adicionar ao budget uma **timeline de histórico de atividade** (audit log): um registo
cronológico do que aconteceu ao budget — criação, edições, regras e associação de
transações — com o autor de cada ação. Hoje não existe qualquer registo de eventos.

## Âmbito

Eventos a registar (decidido com o utilizador):

- **Ciclo de vida do budget:** criado, editado (com diff dos campos), arquivado, reativado.
- **Regras:** regra de categoria adicionada / removida.
- **Transações (associação):** fatura atribuída automaticamente (TOC), confirmada, movida
  para/de outro budget, associação removida.

**Fora de âmbito:**

- Pagamentos/liquidações das faturas associadas (não geram evento).
- Evento de eliminação do budget — ao eliminar, o budget e o seu histórico desaparecem
  por *cascade* e o painel deixa de existir; o **arquivar** (reversível, fica visível) é a
  alternativa que regista evento.
- Reconstrução de histórico passado além de um evento inicial "criado" (ver Backfill).

## Arquitetura

Abordagem escolhida: **tabela dedicada + serviço central com chamadas explícitas**.
Cada ponto de mutação chama um helper que escreve um evento. Controlo total sobre a
metadata (diffs legíveis, nomes congelados, autor) e sobre o que é mostrado.

### Modelo de dados (Prisma)

Nova model `TreasuryBudgetEvent`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `clientId` | `String` | scoping/queries |
| `budgetId` | `String` | FK → `TreasuryBudget`, `onDelete: Cascade` |
| `type` | `TreasuryBudgetEventType` | enum (abaixo) |
| `actorUserId` | `String?` | FK → `User`; `null` = **Sistema** |
| `metadata` | `Json?` | payload específico do evento |
| `createdAt` | `DateTime @default(now())` | |

Índice: `@@index([budgetId, createdAt])`. Relação inversa em `TreasuryBudget`
(`events TreasuryBudgetEvent[]`) e, opcionalmente, em `User`.

Enum `TreasuryBudgetEventType`:

- `BUDGET_CREATED`, `BUDGET_UPDATED`, `BUDGET_ARCHIVED`, `BUDGET_REACTIVATED`
- `RULE_ADDED`, `RULE_REMOVED`
- `TXN_AUTO_ASSIGNED`, `TXN_CONFIRMED`, `TXN_MOVED_IN`, `TXN_MOVED_OUT`, `TXN_UNASSIGNED`

### `metadata` por tipo

- `BUDGET_UPDATED`: `{ changes: [{ field, from, to }] }` (apenas campos alterados:
  `name`, `totalAmount`, `startDate`, `endDate`, `color`, `description`).
- `BUDGET_ARCHIVED` / `BUDGET_REACTIVATED`: sem metadata (ou vazia).
- `RULE_ADDED` / `RULE_REMOVED`: `{ categoryName, textPattern }`.
- `TXN_*`: `{ docId, docType: 'receivable'|'payable', entityName, amount, fromBudgetName?, toBudgetName? }`.
  Os nomes (`entityName`, `*BudgetName`) são **congelados** no momento do evento, para o
  histórico continuar legível mesmo que a fatura/budget mude ou seja eliminado depois.

### Serviço central

Novo `apps/api/src/modules/treasury/budget-events/budget-events.service.ts` (ou módulo
equivalente) com:

- `recordBudgetEvent(prisma, { clientId, budgetId, type, actorUserId, metadata })` —
  escrita **best-effort**: envolvida em `try/catch`; se falhar, **não** quebra a operação
  principal (apenas regista no log do servidor). É auditoria, não deve bloquear
  pagamentos/edições.
- `listBudgetEvents(prisma, clientId, budgetId, { limit, before })` — leitura paginada
  por `(createdAt, id)` descendente.

## Pontos de registo (emissores)

| Origem | Evento(s) | Autor |
|---|---|---|
| `budgets.service.create` | `BUDGET_CREATED` | utilizador (`user.sub`, já disponível) |
| `budgets.service.update` | `BUDGET_UPDATED` (diff) e/ou `BUDGET_ARCHIVED` / `BUDGET_REACTIVATED` se `status` mudou | utilizador |
| `budget-rules.service.create` / `delete` | `RULE_ADDED` / `RULE_REMOVED` | utilizador (passar `user.sub` às rotas — hoje não recebem) |
| `receivables`/`payables` `update` + `bulkSetBudget` | transição de `budgetId`/`budgetAutoAssigned` (ver abaixo) | utilizador (já disponível) |
| auto-atribuição por regras (import/sync TOC) | `TXN_AUTO_ASSIGNED` | **Sistema** (`null`) |

### Transições de transação (estado antigo → novo no `update`/`bulkSetBudget`)

- `null → X` com `budgetAutoAssigned=true`: `TXN_AUTO_ASSIGNED` em X (autor Sistema).
- `null → X` manual: `TXN_MOVED_IN` em X (autor utilizador).
- `budgetAutoAssigned: true → false`, mesmo budget: `TXN_CONFIRMED`.
- `X → Y`: `TXN_MOVED_OUT` em X **e** `TXN_MOVED_IN` em Y (dois eventos coerentes).
- `X → null`: `TXN_UNASSIGNED` em X.

O cálculo da transição lê o estado anterior do documento antes do `update` (já há um
`findUnique`/leitura no fluxo; reutiliza-se). A mesma lógica serve `bulkSetBudget`
(itera os ids).

## API

Novo endpoint:

```
GET /treasury/:clientId/budgets/:id/events?limit=50&before=<cursor>
```

- `onRequest: [authenticate, requireClientAccess]` (igual às restantes rotas de budget).
- Devolve `{ events: BudgetEventDTO[], nextCursor: string | null }`.
- `BudgetEventDTO`: `{ id, type, createdAt, actor: { id, name } | null, metadata }`.
  O nome do autor é resolvido via join a `User` (ou `null` → Sistema no frontend).

O payload de `GET /budgets/:id` **não** muda (mantém-se pequeno; a tab carrega à parte).

## Frontend

Nova tab **"Histórico"** no `BudgetPanel.tsx`, ao lado de Transações / Regras / Para rever.

- Query lazy `['budget-events', clientId, budgetId]`, ativa só quando a tab está aberta
  (padrão idêntico ao da query de categorias).
- Render: timeline vertical. Cada item = ícone por tipo + texto em PT + autor
  (`por <nome>` ou `Sistema`) + data (absoluta; tooltip/relativa opcional).
- Formatador `formatBudgetEvent(type, metadata)` → string PT. Exemplos:
  - `BUDGET_CREATED` → "Budget criado"
  - `BUDGET_UPDATED` → "Valor alterado de 5.000 € para 7.000 €" (uma linha por campo, ou resumo)
  - `BUDGET_ARCHIVED` → "Budget arquivado"
  - `RULE_ADDED` → "Regra adicionada: categoria Marketing"
  - `TXN_AUTO_ASSIGNED` → "Fatura de ACME (123 €) atribuída automaticamente"
  - `TXN_MOVED_OUT` → "Fatura de ACME (123 €) movida para «Outro budget»"
- Botão "Carregar mais" usa `nextCursor`.

## Casos limite e erros

- **Best-effort:** falha a escrever evento ⇒ a operação principal continua; erro logado.
- **Backfill (migração):** semear um `BUDGET_CREATED` por cada budget existente, com
  `createdAt = budget.createdAt` e `actorUserId = null`. Histórico anterior (edições,
  associações) não é reconstruível.
- **Cascade:** `onDelete: Cascade` remove os eventos quando o budget é eliminado.
- **Mover fatura:** gera 2 eventos (out + in), um em cada budget.
- **Documento eliminado depois:** o evento mantém `entityName`/`amount` congelados.

## Testes

- `recordBudgetEvent`: escreve a linha correta; tolera falha sem propagar.
- `budgets.service`: `create` → `BUDGET_CREATED`; `update` com diff → `BUDGET_UPDATED`
  com os campos certos; mudança de `status` → `ARCHIVED`/`REACTIVATED`.
- `budget-rules.service`: `create`/`delete` → `RULE_ADDED`/`RULE_REMOVED` com categoria.
- `receivables`/`payables` `update`/`bulkSetBudget`: cada transição emite o(s) evento(s)
  correto(s) (auto-assign, confirm, move in/out, unassign).
- Endpoint `GET .../events`: paginação por cursor; resolve autor; Sistema quando `null`.

## Ficheiros afetados (estimativa)

- `apps/api/prisma/schema.prisma` — model + enum + relações; migração + backfill.
- `apps/api/src/modules/treasury/budget-events/budget-events.service.ts` — **novo**.
- `apps/api/src/modules/treasury/budgets/{budgets.service.ts, budgets.routes.ts}` — emitir + endpoint GET.
- `apps/api/src/modules/treasury/budget-rules/{budget-rules.service.ts, budget-rules.routes.ts}` — passar user + emitir.
- `apps/api/src/modules/treasury/{receivables,payables}/*.service.ts` — emitir nas transições.
- (auto-assign TOC) — emitir `TXN_AUTO_ASSIGNED`.
- `apps/web/src/components/budgets/BudgetPanel.tsx` — tab "Histórico" + formatador.
