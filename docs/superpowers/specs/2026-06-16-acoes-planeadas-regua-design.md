# Ações planeadas (Tarefa/Chamada) nas réguas de cobrança

**Data:** 2026-06-16
**Estado:** Aprovado (brainstorming)

## Contexto

Uma "régua de cobrança" (`TreasuryDunningTrack`) contém uma lista de regras
(`TreasuryDunningRule`). Hoje **toda a regra é uma regra de email**: tem
`offsetDays` (relativo a `promisedPaymentDate`), um `emailTemplateId`
obrigatório e filtros opcionais (min/max/categoria). Quando o motor de dunning
corre (cron diário + botão "Executar agora"), encontra as faturas cuja
`promisedPaymentDate` cai em `today − offsetDays` e cria um follow-up
`EMAIL_SENT` na timeline de cada fatura. A idempotência é garantida por
`TreasuryDunningExecution` (único por `(ruleId, receivableId)`).

A timeline de follow-ups da fatura já suporta `CALL_TASK` — um lembrete de
tarefa/chamada **pendente** com `dueAt`, `importance`, `assignedTo`, concluído
manualmente. Hoje estes só são criados à mão a partir do painel da fatura.

## Objetivo

Permitir que uma régua contenha também **ações planeadas** que não são email
nem nota — **Tarefa** e **Chamada**. Quando uma destas ações dispara para uma
fatura, deixa um **lembrete pendente** na timeline de follow-ups dessa fatura.

Exemplos do utilizador:
- "2 dias antes vou verificar ao banco se já caiu o movimento" → **Tarefa**.
- "contactar cliente a confirmar data de pagamento" → **Chamada**.

O conceito é um lembrete a confirmar que fiz a ação "x", que surge no menu de
follow-up dessa fatura.

## Requisito central de não-regressão

**O comportamento atual das regras de email automático NÃO pode mudar.** Isto é
uma invariante do design, não um efeito colateral:

- `actionType` tem `@default(EMAIL)`; a migração marca todas as regras
  existentes como `EMAIL`.
- O ramo de email no motor `execute()` fica literalmente inalterado; o código
  novo é um ramo `if (actionType === 'TASK' | 'CALL')` adicionado **antes** do
  ramo de email.
- A validação atual ("Template de email é obrigatório") mantém-se para
  `actionType = EMAIL`; só é relaxada para os tipos novos.
- Teste de não-regressão confirma que uma regra de email pré-existente produz
  exatamente o mesmo `EMAIL_SENT` de antes.

## Decisões de design

- **Abordagem A (escolhida):** estender `TreasuryDunningRule` com um
  `actionType`, em vez de criar uma tabela separada. O motor de dunning já é
  genérico (a `TreasuryDunningExecution` não assume email) e a UI da régua já é
  uma timeline por `offsetDays`. Menor superfície de mudança, timeline única.
- **Comportamento ao disparar:** cria uma tarefa **pendente** (manual). Nada é
  enviado automaticamente; o utilizador marca como feita depois de confirmar.
- **Tarefa vs Chamada — diferença no fluxo de conclusão:**
  - **Tarefa** → concluída com um check ("Concluir"), marca `DONE`.
  - **Chamada** → concluída via o fluxo "Registar chamada" existente
    (resultado: contactado / sem resposta / prometeu pagar / disputa; duração;
    telefone). Cria `CALL_LOGGED` e fecha a tarefa.
- **Campos configuráveis por ação:** `Quando` (offset dias), `Título`
  (obrigatório) + `Descrição`, `Importância`. **Sem** responsável atribuído ao
  nível da regra.
- **Direção:** receivable-only (réguas = cobrança; o sistema de
  tracks/assignments é keyed em `tocCustomerId`). Igual às regras de email.

## 1. Modelo de dados

`TreasuryDunningRule` ganha:

- `actionType TreasuryDunningActionType @default(EMAIL)` — novo enum
  `EMAIL | TASK | CALL`.
- `taskTitle String? @db.VarChar(300)` — título do lembrete (obrigatório para
  `TASK` e `CALL`).
- `taskDescription String?` — descrição opcional.
- `taskImportance TreasuryFollowupImportance @default(NORMAL)`.
- `emailTemplateId` mantém-se `String?`; a obrigatoriedade passa a ser
  condicional (validada no serviço por `actionType`).

Novo enum:

```prisma
enum TreasuryDunningActionType {
  EMAIL
  TASK
  CALL
}
```

`TreasuryDunningExecution` mantém-se igual — a idempotência `(ruleId,
receivableId)` já é agnóstica ao tipo de ação. **Nenhuma tabela nova.**

Migração: adiciona o enum e as colunas; `actionType` default `EMAIL` cobre as
linhas existentes.

## 2. Motor de execução (`dunning-rules.service.ts`)

No loop de `execute()`, a janela-alvo (`promisedPaymentDate − offsetDays`), os
filtros (min/max/categoria), a resolução de régua por cliente e a idempotência
via `TreasuryDunningExecution` são **partilhados** por todos os tipos de ação.

Bifurcação por `actionType`:

- **`EMAIL`** → ramo atual, intocado (`sendEmailFollowup`, marca execução
  `SENT`, escreve `payload.dunningRuleId`).
- **`TASK` | `CALL`** → em vez de enviar email, chama
  `followups.createCallTask(...)` criando um `CALL_TASK` **PENDENTE** na fatura:
  - `title = rule.taskTitle`
  - `description = rule.taskDescription`
  - `importance = rule.taskImportance`
  - `dueAt =` o dia em que dispara (dia-alvo)
  - `payload.plannedType = 'CALL' | 'TASK'` (discriminador)
  - `payload.dunningRuleId`, `payload.executionId`, `payload.automatic = true`
  - regista/atualiza `TreasuryDunningExecution` com `status: 'SENT'` (reutiliza
    o estado como "materializado") para não duplicar em execuções seguintes.

Validação no serviço:
- `actionType === 'EMAIL'` → `emailTemplateId` obrigatório (como hoje).
- `actionType === 'TASK' | 'CALL'` → `taskTitle` obrigatório; `emailTemplateId`
  ignorado/nulo.

`autoImportTocSalesDocs` e o resto do fluxo mantêm-se. (As ações TASK/CALL
beneficiam do mesmo auto-import porque partilham a janela de offset.)

`direction === 'PAYABLE'` continua a devolver `PAYABLE_NOT_SUPPORTED` para
todos os tipos.

## 3. Frontend — configuração na régua (`DunningRulesTab.tsx`)

A timeline da régua lista os **3 tipos** ordenados por `offsetDays`, cada um com
ícone próprio:

- Email → `Mail` (atual)
- Tarefa → `NotebookPen` (âmbar)
- Chamada → `Phone` (esmeralda)

O botão "Nova Regra" abre o modal com um **seletor de tipo de ação** (Email /
Tarefa / Chamada) no topo:

- **Email** → formulário atual (template + presets de tom) — inalterado.
- **Tarefa / Chamada** → campos: `Quando` (offset dias, mesmos presets),
  `Título*`, `Descrição`, `Importância` (Baixa/Normal/Alta). Sem secção de
  template.

No cartão da timeline, as ações Tarefa/Chamada mostram o título e a importância
(em vez de "template / N execuções"). Toggle ativo/inativo, editar e eliminar
funcionam igual às regras de email.

O `DunningRule` interface no frontend ganha os campos `actionType`, `taskTitle`,
`taskDescription`, `taskImportance`.

## 4. Conclusão na fatura (`FollowupsPanel.tsx`)

A ação disparada surge na timeline como `CALL_TASK` pendente (e na secção
"Próximas tarefas" se tiver prazo). A distinção usa `payload.plannedType`:

- **`plannedType: 'TASK'`** → botão "Concluir" (check → `DONE`); esconde
  "Registar chamada".
- **`plannedType: 'CALL'`** → botão primário "Registar chamada" abre o
  `LogCallModal` existente com `sourceTaskId`. Ao registar: cria `CALL_LOGGED`,
  fecha a tarefa (`DONE`).

Itens criados **manualmente** (sem `plannedType`) mantêm os dois botões como
hoje — **sem regressão**. A única mudança no rendering é condicional a
`plannedType`.

## 5. Testes / não-regressão

- Regra de email pré-existente continua a produzir `EMAIL_SENT` idêntico
  (não-regressão).
- Regra `TASK` cria `CALL_TASK` pendente; 2ª execução não duplica
  (idempotência via `TreasuryDunningExecution`).
- Regra `CALL` cria tarefa concluível via `logCall` com `sourceTaskId` →
  `CALL_LOGGED` + tarefa `DONE`.
- Validação: rejeita `TASK`/`CALL` sem `taskTitle`; rejeita `EMAIL` sem
  template.

## Fora de âmbito (YAGNI)

- Responsável atribuído (`assignedTo`) ao nível da regra.
- Notificações/alertas ao responsável.
- Ações planeadas em payables (direção PAYABLE).
- Tipos de ação além de Tarefa/Chamada (ex.: SMS).
