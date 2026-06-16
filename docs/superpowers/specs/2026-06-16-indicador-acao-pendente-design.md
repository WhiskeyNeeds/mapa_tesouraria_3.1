# Indicador "!" de ação pendente nas linhas de Contas a Receber/Pagar

**Data:** 2026-06-16
**Estado:** Aprovado (brainstorming)

## Contexto

As réguas de cobrança podem agora criar ações planeadas (Tarefa/Chamada) que
materializam um `CALL_TASK` **pendente** na timeline da fatura, com `dueAt` =
`promisedPaymentDate − offsetDays` (ver [[project-dunning-planned-actions]]).
Tarefas também podem ser criadas à mão, com ou sem prazo.

Hoje, em **Contas a Pagar**, já existe um indicador `needsContact`: para os ids
locais da página atual, a `list()` procura `CALL_TASK PENDING` e o frontend
mostra um ícone de telefone âmbar ("Contatar Cliente") via `DocLabels`
([payables.service.ts](apps/api/src/modules/treasury/payables/payables.service.ts) ~L309-320). **Contas a Receber não tem nenhum indicador equivalente.**

## Objetivo

Mostrar na linha de cada documento (Contas a Receber e Contas a Pagar) um ícone
"!" quando o documento tem uma ação pendente com prazo, com cor que reflete a
urgência relativa ao prazo da ação.

## Decisões

- **Âmbito:** qualquer `CALL_TASK` pendente **com `dueAt`** (ações de régua e
  tarefas manuais). Tarefas sem `dueAt` não mostram "!".
- **Coexiste** com o ícone de telefone `needsContact` existente em Pagar — não o
  substitui. Podem aparecer os dois na mesma linha.
- **Regra da cor** (comparação só por data, ignora horas):
  - **Âmbar** quando hoje ≤ dia do `dueAt` (o próprio dia e antes).
  - **Vermelho** quando hoje > dia do `dueAt` (passou o dia).
- **Agregação:** se o documento tem várias tarefas pendentes com prazo, vence a
  mais urgente = o `dueAt` **mais antigo**.
- **Cor calculada no frontend** a partir do `dueAt` devolvido, para ficar sempre
  correta face ao "hoje" do utilizador (evita desvios de timezone servidor).

## Backend

Em `payables.service.ts` e `receivables.service.ts`, no fim de `list()`, para os
ids locais da página atual:

- Procurar `treasuryFollowup` com `kind: 'CALL_TASK'`, `status: 'PENDING'`,
  `dueAt: { not: null }`, do lado certo (`payableId`/`receivableId` ∈ ids locais).
  Selecionar `payableId`/`receivableId` e `dueAt`.
- Para cada documento, calcular o `dueAt` mais antigo entre as suas tarefas e
  anexar ao item o campo **`_pendingActionDueAt: string | null`** (ISO string ou
  `null`).

Notas:
- Só ids locais (cuid) têm follow-ups; itens TOC puros (`toc-…`) ficam sempre
  `null` — nunca casam (igual ao padrão `needsContact`).
- Em **payables**, manter o bloco `needsContact` atual intacto; adicionar a
  agregação de `dueAt` (pode reutilizar a mesma query, alargando o `select` com
  `dueAt`, em vez de duas queries).
- Em **receivables**, adicionar o bloco de raiz (não existe hoje). Os tipos de
  item da lista (`PayableListItem` / `ReceivableListItem`) ganham
  `_pendingActionDueAt?: string | null`.

## Frontend

- **`DocLabels`** ([DocLabels.tsx](apps/web/src/components/treasury/DocLabels.tsx)) ganha a prop
  `pendingActionDueAt?: string | null`. Quando não-nula, renderiza um ícone "!"
  (`CircleAlert` do lucide-react) com cor:
  - âmbar (`text-amber-500`) se hoje ≤ dia do `dueAt`,
  - vermelho (`text-red-600`) se hoje > dia do `dueAt`.
  - Tooltip: `Ação pendente — prazo {dd/mm/aaaa}` (âmbar) ou
    `Ação pendente — atrasada` (vermelho).
- Um helper local em DocLabels faz a comparação date-only (início do dia de hoje
  vs início do dia do `dueAt`).
- A condição de "não renderizar nada" passa a incluir também
  `!pendingActionDueAt`.
- Passar a prop `pendingActionDueAt={item._pendingActionDueAt}` em todas as
  utilizações de `DocLabels` nas linhas de [ReceivablesPage.tsx](apps/web/src/pages/ReceivablesPage.tsx) e
  [PayablesPage.tsx](apps/web/src/pages/PayablesPage.tsx) (linhas locais; filhos/recorrências não têm
  follow-ups próprios, ficam sem prop).
- Os tipos de item no frontend (`Receivable`/`Payable`) ganham
  `_pendingActionDueAt?: string | null`.
- O ícone não precisa de clique próprio — clicar na linha já abre o painel de
  follow-ups.

## Testes

- Backend (vitest, mock prisma): `list()` anexa `_pendingActionDueAt` = o `dueAt`
  mais antigo das `CALL_TASK PENDING` com prazo; `null` quando não há nenhuma ou
  só há tarefas sem `dueAt`. Um teste para receivables e outro para payables.
- Frontend: sem harness de componentes — verificação por `tsc` + manual (ver
  plano). O helper de cor date-only é trivial e coberto pela inspeção visual.

## Fora de âmbito (YAGNI)

- Contagem de tarefas no ícone.
- Filtro/ordenação da lista por estado da ação pendente.
- Indicador em linhas-filho (parcelas/recorrências).
- Substituir ou alterar o ícone `needsContact` existente.
