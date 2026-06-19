# Coerência das páginas Budget, Clientes/Fornecedores e do painel de fatura

**Data:** 2026-06-19
**Estado:** Aprovado (design)

## Contexto e problema

Três áreas da aplicação mostram o "detalhe de uma fatura" (payable/receivable) com
graus de coerência diferentes:

1. **Contas a Pagar** (`apps/web/src/pages/PayablesPage.tsx`, ~linha 2315) — painel
   lateral rico, escrito *inline* (~640 linhas): cabeçalho com valor, pré-visualização,
   editar/anular/eliminar, entidade clicável, `Badge`, `InlineCategoryPicker`,
   pagamentos associados, e secções Comprometer / Liquidar / Pronta para Pagar /
   Definir data / Dividir / Anexos. Tabs **Parcelas · Detalhes · Follow-ups**.
2. **Contas a Receber** (`apps/web/src/pages/ReceivablesPage.tsx`) — espelho do painel
   de Pagar (mesmos estados `promised/split/settle/commit`, mesmas mutações).
3. **`DocDetailPanel`** (`apps/web/src/components/treasury/DocDetailPanel.tsx`) — cópia
   **reduzida** do painel, usada apenas no Budget dentro de um `Modal`. Faltam-lhe:
   picker de categoria, pré-visualização, editar/anular/eliminar, entidade clicável,
   pagamentos associados, secções Comprometer / Liquidar-com-referência / Pronta para
   Pagar / Anexos.

Além disso:
- O **sidebar do Budget** (`apps/web/src/components/budgets/BudgetPanel.tsx`) diverge no
  estilo (largura `420px`, tabs com fundo cinza `text-xs`) face aos painéis de
  Pagar/Receber (`lg:w-80 xl:w-96`, tabs lisas `text-sm`).
- A página de **Clientes/Fornecedores** (`apps/web/src/pages/EntityDetailPage.tsx`) é a
  mais "à parte": clicar numa fatura **não abre nada** (só expande recibos/pagamentos
  inline) e trabalha com documentos crus do TOConline.

## Objetivo

Coerência visual e funcional: uma única representação rica do detalhe de fatura,
reutilizada no drawer de Pagar/Receber, no modal do Budget e no modal de
Clientes/Fornecedores; e alinhamento visual do sidebar do Budget e da página de
Clientes/Fornecedores com o resto do site.

## Decisões tomadas (com o utilizador)

- Ao clicar numa fatura do Budget abre um **modal rico**, igual ao painel das outras páginas.
- Eliminar a duplicação **extraindo um componente único** partilhado.
- Clientes/Fornecedores recebe **coerência visual + abrir o painel ao clicar** (quando
  existir documento local correspondente).
- Editar/eliminar ficam **por callback** (a página continua a possuir esses formulários).

## Arquitetura

### Componente único: `DocDetailPanel` enriquecido

Promove-se o `DocDetailPanel` a **fonte única** do detalhe de fatura. Ganha um prop
`variant`:

| `variant` | Onde é usado | Casca (shell) |
|-----------|--------------|---------------|
| `'drawer'` | Pagar / Receber | coluna fixa à direita: `fixed inset-0 z-50 w-full ... lg:sticky lg:w-80 xl:w-96 lg:border-l lg:h-[calc(100vh-4rem)]` |
| `'modal'` | Budget / Clientes-Fornecedores | conteúdo dentro de `<Modal size="lg" hideHeader noPadding>` |

O **conteúdo** (cabeçalho, tabs, secções de ação) é idêntico nas duas variantes; apenas
a casca exterior muda. A variante `drawer` inclui o seu próprio cabeçalho com botão de
fechar; a variante `modal` usa o cabeçalho próprio do painel (o `Modal` vai com
`hideHeader`).

#### Props

```ts
interface Props {
  docId: string
  docType: 'payable' | 'receivable'
  variant?: 'drawer' | 'modal'   // default 'modal'
  onClose: () => void
  onMutated?: () => void
  onEdit?: (doc: Doc) => void     // página abre o seu formulário de edição
  onDelete?: (doc: Doc) => void   // página abre o seu diálogo de eliminação
  /** contexto de navegação para a entidade (from/fromLabel) */
  entityNav?: { from: string; fromLabel: string }
}
```

Quando `onEdit`/`onDelete` não são passados (ex.: contexto de modal onde não faz sentido),
os respetivos botões não aparecem.

#### Capacidades a acrescentar ao `DocDetailPanel` (paridade com o inline)

- `InlineCategoryPicker` no cabeçalho.
- Link de pré-visualização (ícone olho) quando há `public_link` no doc TOC.
- Nome da entidade clicável → navega para `/empresa/{fornecedores|clientes}/:tocEntityId`
  com `state` de `entityNav`.
- Lista de **pagamentos associados** (TOC) com clique para o `PaymentDetailModal`.
- Secção **Comprometer** (status `SCHEDULED`).
- Secção **Liquidar com referência** (a partir de `PAID`).
- Toggle **Pronta para Pagar** (só payables, status `OPEN`) + `RemoveFromFuturePaymentsDialog`.
- Botão **Anular** (`void`).
- `InvoiceAttachmentsButton`.

Estas capacidades já existem como mutações/queries no `DocDetailPanel` ou são copiáveis
do inline. `PaymentDetailModal` é hoje definido em `PayablesPage`/`ReceivablesPage`;
move-se para um componente partilhado (ex.: `apps/web/src/components/treasury/PaymentDetailModal.tsx`).

### Substituição nas páginas

- `PayablesPage`: o bloco inline `{panelDoc && (…)}` é substituído por
  `<DocDetailPanel docId={panelDoc.id} docType="payable" variant="drawer" onClose=… onEdit=… onDelete=… onMutated=… entityNav={{from:'/contas-a-pagar', fromLabel:'Contas a Pagar'}} />`.
  Remove-se o markup e os estados/mutações que migram para o componente (mantendo os que
  servem a lista, ex.: bulk, filtros, edição/eliminação por callback).
- `ReceivablesPage`: igual, `docType="receivable"`, `entityNav` para `/contas-a-receber`.
- A largura da tabela depende de `panelDoc` (`colSpan`, coluna extra). Esse comportamento
  mantém-se: a página continua a controlar `panelDoc` (o "qual está aberto"); só delega o
  *render* do painel.

### Budget

- `BudgetPanel` mantém função própria (progresso + tabs Transações/Regras/Para rever),
  mas alinha visualmente:
  - largura `w-[420px]` → `lg:w-80 xl:w-96`;
  - barra de tabs sem fundo cinza: `border-b border-gray-100`, `text-sm`, sublinhado ativo
    `border-primary-600 text-primary-700` (igual ao `DocDetailPanel`);
  - harmonizar espaçamentos/tipografia do cabeçalho.
- O modal de fatura: `<Modal size="sm">` → `size="lg"`, e `DocDetailPanel` com
  `variant="modal"`. `onMutated` continua a invalidar o budget.

### Clientes / Fornecedores (`EntityDetailPage`)

- **Visual:** alinhar tabelas, KPIs, tipografia de cabeçalhos de secção e `Badge` com o
  resto do site, sem alterar a estrutura de 2 colunas (lista + info da entidade).
- **Clique numa fatura abre o painel rico** (`<Modal variant="modal">`):
  - Documentos **locais** (`id: "local-<uuid>"`, `_local: true`): abrir direto — id sem o
    prefixo `local-`, `docType` conforme `entityType`.
  - Documentos **TOConline**: resolver via **novo endpoint**
    `GET /treasury/:clientId/{payables|receivables}/by-toc/:tocDocId` → `{ id }` local ou
    `404`. Em `404`, **mantém o comportamento atual** (expande recibos/pagamentos inline;
    sem painel).
  - Documentos **rascunho/anulado** (status `0`/`4`): não abrem painel.

## Backend

Novo endpoint de resolução (em `payables.routes`/`receivables.routes` ou
`toconline.routes`):

```
GET /treasury/:clientId/payables/by-toc/:tocDocId   → { id } | 404
GET /treasury/:clientId/receivables/by-toc/:tocDocId → { id } | 404
```

Lookup: `treasuryPayable.findFirst({ where: { clientId, tocPurchasesDocId: tocDocId } })`
(e equivalente `tocSalesDocId` para receivables). Devolve só o `id`.

## Componentes e isolamento

- `DocDetailPanel` — única fonte do detalhe de fatura; testável isoladamente por
  `docId`+`docType`; depende de `api`, `useAuth`, queries de detalhe e mutações.
- `PaymentDetailModal` — extraído para componente partilhado, usado pelo painel e pelas
  páginas.
- `BudgetPanel` — inalterado em responsabilidade; apenas estilos.
- Páginas (`Payables`/`Receivables`/`EntityDetail`/`Budgets`) — passam a orquestrar
  (qual doc está aberto, edição/eliminação) e delegam o render do detalhe.

## Plano de execução (fases)

1. **Enriquecer `DocDetailPanel`** até à paridade + `variant` + props de callback.
   Extrair `PaymentDetailModal` para componente partilhado.
2. **Substituir** o painel inline em `PayablesPage` e `ReceivablesPage` por
   `<DocDetailPanel variant="drawer" />`; remover markup/estado duplicado.
3. **Budget:** `Modal size="lg"` + `variant="modal"`; alinhar estilos do `BudgetPanel`.
4. **Backend:** endpoints `by-toc`.
5. **`EntityDetailPage`:** clique abre painel (local direto / TOC via `by-toc` / fallback)
   + alinhamento visual.

## Riscos

- O painel inline de Pagar tem lógica fina (split €/%, commit, settle com referência,
  estados TOC vs local). A migração tem de preservar exatamente esses comportamentos —
  verificar contra o inline original campo a campo.
- A coluna extra/`colSpan` das tabelas depende de `panelDoc`; garantir que o layout do
  drawer continua idêntico após a extração.
- Resolução TOC→local pode devolver documentos em estados que o painel não esperava
  (ex.: já liquidado); o painel já trata `SETTLED`/`PAID`, mas confirmar.

## Critérios de sucesso

- As três entradas (drawer Pagar, drawer Receber, modal Budget) renderizam o **mesmo**
  componente, visualmente idênticas (salvo a casca).
- Nenhuma capacidade do painel inline se perde em Pagar/Receber.
- Budget: clicar numa fatura abre o painel rico; sidebar alinhado.
- Clientes/Fornecedores: visual alinhado; clicar numa fatura com registo local abre o
  painel; sem registo local mantém o comportamento atual.
- Remoção líquida significativa de código duplicado (~1.000+ linhas).
