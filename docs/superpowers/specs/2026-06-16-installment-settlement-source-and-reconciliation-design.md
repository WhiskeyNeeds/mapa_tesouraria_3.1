# Origem da liquidação das parcelas + parcelas na reconciliação

Data: 2026-06-16
Estado: aprovado (brainstorming), pendente de plano de implementação

## Contexto e problema

As faturas (a receber e a pagar) podem ser divididas em parcelas. Cada parcela é
um `TreasuryReceivable`/`TreasuryPayable` filho (`parentId` definido,
`recurrenceId` nulo). A fatura mãe agrega o estado dos filhos via
`syncParentStatus`.

Há **três formas** de uma fatura ficar paga/liquidada:

1. **Marcada localmente** como paga/liquidada pelo utilizador.
2. **Todas as parcelas pagas** — a mãe fica automaticamente paga por agregação.
3. **Totalmente reconciliada** pelo valor total contra movimentos bancários.

Problemas atuais:

- **Não existe** nenhum campo que registe *como* uma fatura ficou paga. Sem isso,
  não é possível saber se a reversão é permitida nem por que caminho deve passar.
- A reversão de uma mãe dividida faz **cascata** e reverte todas as parcelas de
  uma vez (`unsettle`). O comportamento desejado é reverter **parcela a parcela**.
- A lista que alimenta a reconciliação esconde as parcelas e mostra a mãe
  (`NOT: { parentId: { not: null }, recurrenceId: null }` em
  `receivables.service.ts:272` e `payables.service.ts:206`). A reconciliação usa
  esse mesmo endpoint (`ReconciliationPage.tsx:153/160`). Ou seja, **hoje a mãe
  aparece na reconciliação e as parcelas não** — o oposto do pretendido.

O que **já existe**: `syncParentStatus` já deriva o estado da mãe a partir dos
filhos (todos SETTLED → SETTLED; todos fechados → PAID; algum progresso →
PARTIAL; nenhum → OPEN). A regra "uma parcela deixa de estar paga → mãe
Parcialmente Liquidada; todas emitidas → mãe Emitida" já funciona por aqui.

## Decisões de design (validadas)

- Reversão de fatura paga por **reconciliação**: só pela reversão da
  reconciliação. O botão genérico "Anular" fica escondido nesse caso.
- Reversão de **mãe paga pelas parcelas**: botão "Anular" **desativado** com
  tooltip "Reverta parcela a parcela". Não há reversão direta da mãe.
- A troca mãe→parcelas aplica-se **só à reconciliação**. As páginas Contas a
  Receber / Contas a Pagar mantêm a mãe com as parcelas aninhadas.
- A "origem da liquidação" é guardada num **campo enum persistido**, não derivada
  em tempo de leitura (deriva não distingue LOCAL de RECONCILIATION após o facto).

## Design

### 1. Modelo de dados

- Novo enum Prisma `TreasurySettlementSource { LOCAL, INSTALLMENTS, RECONCILIATION }`.
- Nova coluna anulável `settledVia TreasurySettlementSource?` em
  `TreasuryReceivable` e `TreasuryPayable`. `null` quando o doc está
  `OPEN`/`PARTIAL`/`VOID`; preenchida quando chega a `PAID`/`SETTLED`. Acompanha
  sempre o `settledAt`.
- Migração faz backfill dos docs já fechados:
  - mães com filhos não-recorrentes → `INSTALLMENTS`;
  - docs com links de reconciliação confirmados a cobrir o valor total →
    `RECONCILIATION`;
  - restantes fechados → `LOCAL`.

### 2. Transições de estado e de origem

Definição: **folha** = doc autónomo ou uma parcela individual (sem filhos).

- `pay()` / `settle()` numa **folha** → `PAID`/`SETTLED`, `settledVia = LOCAL`.
- `pay()` / `settle()` numa **mãe dividida** → mantém a cascata como conveniência,
  mas agora marca cada **parcela** aberta como `LOCAL` (não a mãe). De seguida
  `syncParentStatus` deriva a mãe. "Pagar a fatura toda" continua a funcionar num
  clique, mas cada parcela detém um pagamento `LOCAL` reversível.
- Reconciliação total de uma folha (pendente chega a 0) → `PAID`,
  `settledVia = RECONCILIATION`. Reconciliação parcial mantém `PARTIAL`,
  `settledVia = null`.
- `syncParentStatus` (a mãe) — lógica de estado inalterada, mais: ao aterrar em
  `PAID`/`SETTLED` define `settledVia = INSTALLMENTS`; ao voltar a `PARTIAL`/`OPEN`
  limpa `settledVia = null`.

### 3. Bloqueio de reversão

Determinado inteiramente por `settledVia`:

- **`INSTALLMENTS` (mãe dividida)** → reversão direta bloqueada. `unsettle()`
  devolve `409 "Reverta parcela a parcela"`. UI: botão "Anular" no banner
  PAID/SETTLED da mãe aparece **desativado** com esse tooltip
  (`DocDetailPanel.tsx:288/308`). Reverte-se abrindo cada parcela e revertendo;
  `syncParentStatus` re-deriva a mãe.
- **`RECONCILIATION`** → "Anular" genérico escondido (tanto em docs autónomos como
  em parcelas pagas assim). `unsettle()` devolve `409` a apontar para a
  reconciliação. Reverte-se pelo histórico de reconciliação (o fluxo de reverse
  existente já repõe o doc em `OPEN`/`PARTIAL` e limpa `settledAt`; passa também a
  limpar `settledVia`).
- **`LOCAL`** → "Anular" genérico funciona como hoje; volta a `OPEN`, limpa
  `settledAt`/`settledVia` e (segurança) continua a fazer detach de qualquer
  reconciliação parcial pendente. Se for uma parcela, `syncParentStatus` re-deriva
  a mãe a seguir.

Consequência: a cascata de reversão da mãe (reverter todos os filhos de uma vez)
**deixa de existir** — a reversão é estritamente parcela a parcela.

### 4. Lista da reconciliação (mãe → parcelas)

- Os endpoints de lista de receivables/payables ganham uma flag de query, ex.
  `?reconcilable=true`. Nesse modo o filtro inverte-se: em vez de
  `NOT { parentId not null, recurrenceId null }` (que esconde parcelas e mostra
  mães), passa a **excluir as mães divididas**
  (`NOT { children: { some: { recurrenceId: null, deletedAt: null } } }`) e a
  **incluir as parcelas**. Docs autónomos e recorrências ficam inalterados.
- A página de reconciliação acrescenta a flag às duas queries
  (`ReconciliationPage.tsx:153/160`). Resultado: uma fatura dividida mostra as
  parcelas (cada uma com o seu valor/data) como unidades reconciliáveis, e a mãe
  deixa de aparecer.
- As páginas Contas a Receber / Contas a Pagar mantêm o comportamento atual.

### Caveat (fora de âmbito, registado)

`split()` copia o `tocSalesDocId` da mãe para cada parcela
(`receivables.service.ts:1191`). Dividir uma fatura **ligada ao TOConline** faria
cada parcela ler o valor total do espelho TOC via overlay. As divisões usam-se na
prática em docs locais/manuais, por isso isto é pré-existente e fica fora de
âmbito — assinalado, não resolvido.

### 5. Auditoria, labels e testes

- Payloads de auditoria de `pay`/`settle`/`reconcile`/`unsettle` ganham um campo
  `via` (`LOCAL`/`INSTALLMENTS`/`RECONCILIATION`) para a timeline mostrar *como*
  foi liquidado e revertido. Labels em `auditLabels.ts`.
- Opcional: o subtítulo do banner PAID/SETTLED reflete a origem ("Registado nesta
  plataforma" → "Liquidado pelas parcelas" / "Liquidado por reconciliação") para o
  utilizador perceber porque o botão de reverter está ou não disponível.
- Testes:
  - `syncParentStatus` a conduzir `settledVia` na mãe ao longo das transições
    reverter-uma-parcela / reverter-todas;
  - `unsettle` a devolver 409 para `INSTALLMENTS` e `RECONCILIATION`;
  - filtro `reconcilable=true` a devolver parcelas e a esconder a mãe.
  - Espelhar em receivables e payables.

## Critérios de aceitação

1. Mãe fica `PAID`/`SETTLED` com `settledVia = INSTALLMENTS` quando todas as
   parcelas fecham; não é reversível diretamente (409 + botão desativado).
2. Reverter uma parcela faz a mãe regredir para `PARTIAL`; reverter todas faz a
   mãe voltar a `OPEN`.
3. As três origens de liquidação ficam registadas em `settledVia` e gateiam a
   reversão: `LOCAL` (botão genérico), `RECONCILIATION` (só via reconciliação),
   `INSTALLMENTS` (só parcela a parcela).
4. Na reconciliação, uma fatura dividida mostra as parcelas e não a mãe.
