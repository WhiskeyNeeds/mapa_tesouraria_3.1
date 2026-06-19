# Programadas locais: "Futuras → Comprometidas"

Data: 2026-06-19
Estado: aprovado para implementação (pendente revisão final do utilizador)

## Problema

Hoje, ao criar uma recorrência local, fixa-se logo **referência e valor**, e cada
instância gerada **auto-ativa-se** quando chega a data de vencimento
(`recurrenceId + parentId + dueDate > hoje` deixa de ser "futura" passando a contar
como em aberto). Na prática, o documento real (com o seu número e valor reais) muitas
vezes ainda não existe nessa altura. "Futura" é um estado **derivado** da data, não um
estado guardado — por isso uma futura não consegue "ficar futura" depois de a data
passar.

## Objetivo

Tratar uma recorrência como um **molde de previsão**: gera instâncias **futuras**
(estimadas, sem referência) que alimentam a previsão de cash flow, e que só passam a
faturas reais ("em aberto") através de uma ação explícita — **"Marcar como
Comprometido"** — onde se confirma **referência + valor + data**.

Aplica-se a **Contas a Receber e Contas a Pagar**.

## Decisões tomadas (brainstorming)

1. **Valor da programada (cash flow):** a instância futura tem um **valor estimado**
   que alimenta a série Programadas; ao comprometer confirma-se o valor real.
2. **Âmbito:** Receber **e** Pagar.
3. **Editar uma futura antes de comprometer:** permitir alterar **valor e categoria
   estimados**. A data continua a vir da cadência (só se confirma ao comprometer).
4. **Migração:** as recorrentes futuras já existentes (OPEN, por vencer) **migram para
   Programada (SCHEDULED)**.
5. **"Pronta para Pagar" (`readyToPay`, payables):** mantém-se — é outra fase
   (aprovar para a fila de pagamento uma fatura já real). Não se funde com este fluxo.

## Modelo de dados

- Novo valor no enum `TreasuryDocStatus`: **`SCHEDULED`** (rótulo UI: **"Programada"**).
  - Ficheiro: `apps/api/prisma/schema.prisma` (enum `TreasuryDocStatus`, ~linha 43).
- Instâncias de recorrência (raiz e filhas) passam a nascer com:
  - `status = SCHEDULED`
  - `reference = null` (a coluna já é nullable; `@@unique([clientId, reference])`
    permite múltiplos `null` no Postgres — sem alteração de índice necessária)
  - `totalAmount = pendingAmount = valor estimado`
  - `dueDate = data estimada da cadência`
- O model `TreasuryRecurrence` mantém-se (frequência/cadência/`startDate`/`endDate`/
  `occurrences`). O valor estimado vive nas instâncias (como hoje o valor vive nas
  faturas, não na recorrência).

## Criação de recorrência (frontend)

- `apps/web/src/pages/ReceivablesPage.tsx` e `PayablesPage.tsx` (formulário de criação).
- Quando "recorrente" está ligado:
  - **esconder o campo Referência**;
  - pedir **valor estimado** + **cadência** (frequência/intervalo);
  - `endDate`/`occurrences` continuam opcionais.
- O backend cria a recorrência + a primeira instância como `SCHEDULED`.

## Geração / materialização

- `apps/api/src/modules/treasury/recurrences/recurrences.service.ts` (`processForClient`,
  ~linha 75; criação de instância filha ~linha 158).
- Instâncias geradas passam a `status = SCHEDULED`, `reference = null`,
  `totalAmount = estimativa` (herdada da raiz), `dueDate = nextDate`.
- Mantém-se o horizonte/dedup atuais (`(recurrenceId, dueDate)`).

## Ação "Marcar como Comprometido" (SCHEDULED → OPEN)

- Novos endpoints:
  - `POST /treasury/:clientId/receivables/:id/commit`
  - `POST /treasury/:clientId/payables/:id/commit`
  - Ficheiros: `*.routes.ts` e `*.service.ts` de receivables/payables.
- Disponível **só** quando `status = SCHEDULED`.
- Payload obrigatório: `{ reference, amount, date }`.
- Resultado: `status → OPEN`, grava `reference`, `totalAmount = pendingAmount = amount`,
  `dueDate = date`. A partir daqui é uma fatura normal (pay/settle/split/etc.).
- Frontend: no painel lateral, formulário estilo "Liquidar" com `reference` +
  `amount` (pré-preenchido com a estimativa) + `date` (pré-preenchida com a estimada).

## Editar uma futura (SCHEDULED)

- Permitir alterar **valor estimado** e **categoria** (reutilizar o caminho de
  edição existente, restrito a estes campos quando `status = SCHEDULED`).
- A data **não** é editável na futura (vem da cadência; confirma-se ao comprometer).

## Gating de ações por estado

- **SCHEDULED (Programada):** apenas **Marcar como Comprometido**, **Anular/Eliminar**
  (saltar a ocorrência) e **editar estimativa** (valor/categoria).
- **Escondidas em SCHEDULED:** Marcar como Pago, Marcar como Liquidada, Dividir em
  parcelas, Pagamento parcial, Mudar data (promised-date).
- Ficheiros de gating: `*.service.ts` (validação 409 nos métodos `pay`, `settle`,
  `split`, `partialPayment`, `setPromisedDate` — rejeitar `SCHEDULED`) e frontend
  (mostrar/esconder botões consoante `status`).

## Cash flow

- `apps/api/src/modules/treasury/dashboard/dashboard.service.ts`.
- A série **Programadas** passa a ser definida por **`status = SCHEDULED`** (em vez de
  `recurrenceId != null`). **Em aberto** = `OPEN`/`PARTIAL`.
- As queries de pendentes (statement, semanal, previsão e o helper `netCashFlow`)
  passam a incluir `SCHEDULED` no filtro de status, classificando:
  `SCHEDULED → programmed`, `OPEN/PARTIAL → open`.
- Data efetiva: `SCHEDULED` usa `dueDate` (data estimada da cadência);
  `OPEN` (comprometida) usa `promisedPaymentDate ?? dueDate` (data confirmada),
  como já implementado.
- Resultado: uma recorrência aparece em **Programadas** até ser comprometida; ao
  comprometer, move-se para **Em aberto** pela data/valor confirmados.

## UI / listagem

- Etiqueta **"Programada"** na tabela (Receber e Pagar).
- No painel lateral de uma futura, a única ação principal é **Marcar como Comprometido**.
- As futuras ficam na mesma lista (como hoje). *(Opcional, fácil de juntar: um filtro
  rápido "Programadas".)*

## Migração de dados

- Migração Prisma:
  1. Adicionar valor `SCHEDULED` ao enum `TreasuryDocStatus`.
  2. `UPDATE` das recorrentes **futuras por pagar** para `SCHEDULED`:
     `recurrenceId IS NOT NULL AND status = 'OPEN' AND dueDate > now()` (receivables
     e payables). Limpar a `reference` auto-gerada destas (`reference = NULL`) para
     forçar a sua definição no commit.
  3. As já pagas/liquidadas/passadas ficam intactas.

## Ficheiros afetados (resumo)

- `apps/api/prisma/schema.prisma` — enum `TreasuryDocStatus`.
- `apps/api/prisma/migrations/<nova>/migration.sql` — enum + UPDATE de migração.
- `apps/api/src/modules/treasury/recurrences/recurrences.service.ts` — instâncias `SCHEDULED`.
- `apps/api/src/modules/treasury/receivables/{receivables.service.ts,receivables.routes.ts}` — `commit`, gating, editar estimativa.
- `apps/api/src/modules/treasury/payables/{payables.service.ts,payables.routes.ts}` — idem.
- `apps/api/src/modules/treasury/dashboard/dashboard.service.ts` — Programadas = `SCHEDULED`; queries incluem `SCHEDULED`.
- `apps/web/src/pages/{ReceivablesPage.tsx,PayablesPage.tsx}` — formulário de criação (sem referência, com estimativa), ação/forma "Marcar como Comprometido", etiqueta "Programada", gating de botões, editar estimativa.

## Verificação

- `tsc --noEmit` (API e Web) a 0.
- Migração aplicada; recorrentes futuras existentes ficam `SCHEDULED` sem referência.
- Fluxo E2E (via endpoints, à semelhança do que temos feito):
  1. Criar recorrência (sem referência, com estimativa) → instâncias `SCHEDULED`.
  2. Cash flow: aparecem em **Programadas** pelo valor estimado.
  3. `commit` (referência+valor+data) → `OPEN`; cash flow move para **Em aberto**.
  4. `pay`/`settle`/`split` continuam bloqueados em `SCHEDULED` (409) e disponíveis em `OPEN`.
- Reconciliação do cash flow (categorias+sem-categoria == total) mantém-se.

## Fora de âmbito

- Faturas avulsas (não recorrentes) — mantêm o comportamento atual.
- `readyToPay` / "Futuros Pagamentos" — inalterado.
- Filtro/tab dedicado "Programadas" — opcional, não incluído (pode juntar-se depois).
