# Coerência do painel de fatura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar o detalhe de fatura num único componente `DocDetailPanel` reutilizado no drawer de Contas a Pagar/Receber, no modal do Budget e no modal de Clientes/Fornecedores, e alinhar o visual do sidebar do Budget e da página de entidades.

**Architecture:** Promove-se o `DocDetailPanel` a fonte única, com um prop `variant` (`'drawer' | 'modal'`) que só troca a casca exterior. As páginas de Pagar/Receber passam a renderizá-lo dentro do seu shell de drawer, apagando ~1.200 linhas de painel inline duplicado. Clientes/Fornecedores ganham um endpoint backend de lookup `by-toc` para resolver documentos TOConline → id local antes de abrir o painel.

**Tech Stack:** React 18 + TypeScript + TanStack Query + TailwindCSS (apps/web); Fastify + Prisma + Vitest (apps/api).

## Global Constraints

- `apps/web` **não tem** harness de testes unitários. Verificação de tarefas de frontend = `cd apps/web && npm run build` (corre `tsc && vite build`) com 0 erros, + verificação visual no `npm run dev` quando indicado.
- `apps/api` usa Vitest: `cd apps/api && npm test`.
- Datas de operação só em dias úteis — usar os helpers existentes `isWeekend`/`shiftToWorkday` (`apps/web/src/lib/utils.ts`); não reinventar.
- Idioma de toda a UI e mensagens: Português (com acentuação correta).
- Mensagens de commit terminam com:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Não alterar o contrato dos endpoints existentes; apenas adicionar `by-toc`.
- Documentos com `tocPurchasesDocId`/`tocSalesDocId` têm os valores da fatura geridos no TOConline — não adicionar ações que editem esses campos.

---

## Visão geral das tarefas

1. **Backend:** método `findLocalIdByTocDoc` + rota `GET …/by-toc/:tocDocId` (payables e receivables) com testes Vitest.
2. **Frontend:** extrair `PaymentDetailModal` para componente partilhado.
3. **Frontend:** `DocDetailPanel` — adicionar prop `variant` + shell de drawer (sem ainda mudar capacidades).
4. **Frontend:** `DocDetailPanel` — paridade de capacidades (categoria, pré-visualização, entidade clicável, pagamentos associados, anular, comprometer, liquidar-com-referência, pronta-para-pagar, anexos).
5. **Frontend:** `PayablesPage` usa `<DocDetailPanel variant="drawer">`; remover painel inline.
6. **Frontend:** `ReceivablesPage` usa `<DocDetailPanel variant="drawer">`; remover painel inline.
7. **Frontend:** Budget — modal `size="lg"` + `variant="modal"`; alinhar estilos do `BudgetPanel`.
8. **Frontend:** `EntityDetailPage` — clique abre painel (local direto / TOC via `by-toc` / fallback) + alinhamento visual.

---

## Task 1: Endpoint backend `by-toc` (lookup puro)

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts` (adicionar método)
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (adicionar método)
- Modify: `apps/api/src/modules/treasury/payables/payables.routes.ts` (após a rota `GET ${prefix}/:id`, ~linha 96)
- Modify: `apps/api/src/modules/treasury/receivables/receivables.routes.ts` (após a rota `GET …/:id` equivalente)
- Test: `apps/api/src/modules/treasury/payables/payables.service.test.ts` (adicionar `describe`)
- Test: `apps/api/src/modules/treasury/receivables/receivables.service.test.ts` (adicionar `describe`)

**Interfaces:**
- Produces (payables): `TreasuryPayablesService.findLocalIdByTocDoc(clientId: string, tocDocId: string): Promise<{ id: string } | null>`
- Produces (receivables): `TreasuryReceivablesService.findLocalIdByTocDoc(clientId: string, tocDocId: string): Promise<{ id: string } | null>`
- Produces (HTTP): `GET /treasury/:clientId/payables/by-toc/:tocDocId` → `200 { id }` ou `404 { error }`
- Produces (HTTP): `GET /treasury/:clientId/receivables/by-toc/:tocDocId` → `200 { id }` ou `404 { error }`

> **Nota de ordenação de rotas Fastify:** registar `by-toc/:tocDocId` é seguro junto de `:id` porque o segmento literal `by-toc` é estático e não colide com `:id`. Confirmar que fica antes ou depois de `:id` indiferentemente (Fastify dá prioridade a rotas estáticas).

- [ ] **Step 1: Teste a falhar (payables)**

Adicionar ao fim de `apps/api/src/modules/treasury/payables/payables.service.test.ts`:

```ts
describe('findLocalIdByTocDoc', () => {
  function makeService() { return new TreasuryPayablesService({} as never, {} as never, {} as never) }

  it('devolve o id local quando existe ligação ao doc TOC', async () => {
    const svc = makeService()
    ;(svc as unknown as { prisma: { treasuryPayable: { findFirst: (a: unknown) => Promise<unknown> } } }).prisma = {
      treasuryPayable: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
    } as never
    await expect(svc.findLocalIdByTocDoc('c1', '123')).resolves.toEqual({ id: 'p1' })
  })

  it('devolve null quando não há registo local para o doc TOC', async () => {
    const svc = makeService()
    ;(svc as unknown as { prisma: { treasuryPayable: { findFirst: (a: unknown) => Promise<unknown> } } }).prisma = {
      treasuryPayable: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never
    await expect(svc.findLocalIdByTocDoc('c1', '999')).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Correr o teste e confirmar que falha**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables/payables.service.test.ts -t findLocalIdByTocDoc`
Expected: FAIL — `svc.findLocalIdByTocDoc is not a function`.

- [ ] **Step 3: Implementar o método (payables)**

Em `apps/api/src/modules/treasury/payables/payables.service.ts`, junto de `resolveLocalPayableId` (~linha 414), adicionar método público:

```ts
/**
 * Lookup puro (sem criar): id do payable local ligado a um doc de compras TOConline.
 * Devolve null quando ainda não existe ligação local — usado para decidir se a UI
 * abre o painel rico ou mantém o comportamento inline.
 */
async findLocalIdByTocDoc(clientId: string, tocDocId: string): Promise<{ id: string } | null> {
  const existing = await this.prisma.treasuryPayable.findFirst({
    where: { clientId, tocPurchasesDocId: tocDocId, deletedAt: null },
    select: { id: true },
  })
  return existing ? { id: existing.id } : null
}
```

- [ ] **Step 4: Implementar o método (receivables)**

Em `apps/api/src/modules/treasury/receivables/receivables.service.ts`, mesmo padrão, campo `tocSalesDocId`:

```ts
async findLocalIdByTocDoc(clientId: string, tocDocId: string): Promise<{ id: string } | null> {
  const existing = await this.prisma.treasuryReceivable.findFirst({
    where: { clientId, tocSalesDocId: tocDocId, deletedAt: null },
    select: { id: true },
  })
  return existing ? { id: existing.id } : null
}
```

- [ ] **Step 5: Teste a falhar (receivables) + implementação já feita**

Adicionar ao fim de `apps/api/src/modules/treasury/receivables/receivables.service.test.ts` o `describe` equivalente (trocar `TreasuryPayablesService`→`TreasuryReceivablesService`, `treasuryPayable`→`treasuryReceivable`). Confirmar a assinatura do construtor do serviço de receivables no topo desse ficheiro de teste e replicar o `makeService()` já usado lá.

- [ ] **Step 6: Adicionar as rotas**

Em `apps/api/src/modules/treasury/payables/payables.routes.ts`, logo a seguir à rota `GET ${prefix}/:id` (~linha 96):

```ts
fastify.get(`${prefix}/by-toc/:tocDocId`, { onRequest: auth }, async (request, reply) => {
  const { clientId, tocDocId } = request.params as { clientId: string; tocDocId: string }
  const found = await svc.findLocalIdByTocDoc(clientId, tocDocId)
  if (!found) return reply.status(404).send({ error: 'Sem registo local para este documento' })
  return reply.send(found)
})
```

Em `apps/api/src/modules/treasury/receivables/receivables.routes.ts`, rota equivalente (mesma estrutura, `svc` é o serviço de receivables).

- [ ] **Step 7: Correr os testes e o build**

Run: `cd apps/api && npm test`
Expected: PASS (incluindo os dois novos `describe`).
Run: `cd apps/api && npm run build`
Expected: 0 erros.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/treasury/payables apps/api/src/modules/treasury/receivables
git commit -m "feat(treasury): endpoint by-toc para resolver doc TOConline -> id local

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extrair `PaymentDetailModal` para componente partilhado

**Files:**
- Create: `apps/web/src/components/treasury/PaymentDetailModal.tsx`
- Modify: `apps/web/src/pages/PayablesPage.tsx` (remover a definição local `function PaymentDetailModal` ~linhas 145-262; importar a partilhada)
- Modify: `apps/web/src/pages/ReceivablesPage.tsx` (idem para a sua cópia local)

**Interfaces:**
- Produces: `export default function PaymentDetailModal(props: { open: boolean; onClose: () => void; payment: TocPayment | null; clientId: string; entityName: string; onInvoiceClick?: (payableId: string | number) => void }): JSX.Element | null`
- Produces: `export interface TocPayment { id: number | string; document_no: string; date: string; gross_total: number; net_total?: number; _paid_for_doc?: number | null; [key: string]: unknown }`
- Produces: `export interface PaymentLine { payable_id: number | string; paid_value: number; gross_total: number; net_total?: number; settlement_percentage?: number; settlement_amount?: number; retention_total?: number; document_no?: string; _doc_date?: string; _doc_due_date?: string; _doc_gross_total?: number; _doc_pending_total?: number; _doc_external_reference?: string; [key: string]: unknown }`

> O modal de Pagar usa `/toconline/${clientId}/purchase-payments/${id}/lines`; o de Receber usa `/toconline/${clientId}/sale-receipts/${id}/lines`. Para o componente servir os dois, acrescentar um prop `linesEndpoint: (clientId: string, paymentId: string | number) => string`. Confirmar o endpoint exato em `ReceivablesPage.tsx` (procurar `-payments/` ou `receipts/` na query `toc-payment-lines`) antes de generalizar.

- [ ] **Step 1: Criar o componente partilhado**

Copiar a definição de `PaymentDetailModal` de `apps/web/src/pages/PayablesPage.tsx:145-262` para o novo ficheiro, exportando `default` e as interfaces `TocPayment`/`PaymentLine`. Substituir a query hard-coded por:

```tsx
queryFn: () => api.get<PaymentLine[]>(linesEndpoint(clientId, payment!.id)),
```

e adicionar `linesEndpoint` à lista de props. Manter o markup tal e qual (cabeçalho, tabela de linhas, estados loading/empty).

- [ ] **Step 2: Importar na PayablesPage e remover a cópia local**

Em `PayablesPage.tsx`: apagar `function PaymentDetailModal(...)` (145-262) e as interfaces locais `TocPayment`/`PaymentLine` se duplicadas; importar:

```tsx
import PaymentDetailModal, { type TocPayment } from '@/components/treasury/PaymentDetailModal'
```

No uso do modal, passar `linesEndpoint={(c, id) => `/toconline/${c}/purchase-payments/${id}/lines`}`.

- [ ] **Step 3: Idem na ReceivablesPage**

Apagar a cópia local e importar a partilhada; `linesEndpoint` aponta para o endpoint de recibos de venda (confirmado no Step de interfaces).

- [ ] **Step 4: Build**

Run: `cd apps/web && npm run build`
Expected: 0 erros TypeScript, build OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/treasury/PaymentDetailModal.tsx apps/web/src/pages/PayablesPage.tsx apps/web/src/pages/ReceivablesPage.tsx
git commit -m "refactor(web): extrair PaymentDetailModal para componente partilhado

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `DocDetailPanel` — prop `variant` + shell de drawer

**Files:**
- Modify: `apps/web/src/components/treasury/DocDetailPanel.tsx`

**Interfaces:**
- Consumes: nada de novo.
- Produces (assinatura nova de `Props`):

```ts
interface Props {
  docId: string
  docType: 'payable' | 'receivable'
  variant?: 'drawer' | 'modal'          // default 'modal'
  onClose: () => void
  onMutated?: () => void
  onEdit?: (doc: Doc) => void
  onDelete?: (doc: Doc) => void
  entityNav?: { from: string; fromLabel: string }
}
```

Objetivo desta tarefa: introduzir `variant` e a casca, **sem** ainda adicionar capacidades novas (isso é a Task 4). No fim desta tarefa o `DocDetailPanel` continua a render igual em modal, e ganha a opção de render como coluna de drawer.

- [ ] **Step 1: Adicionar o prop e a casca**

No `DocDetailPanel.tsx`, mudar a assinatura para incluir `variant = 'modal'`, `onEdit`, `onDelete`, `entityNav`. Envolver o JSX de topo (atualmente `return (<div className="flex flex-col h-full">…`) num wrapper condicional:

```tsx
const shellClass = variant === 'drawer'
  ? 'fixed inset-0 z-50 w-full bg-white flex flex-col overflow-hidden lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:w-80 xl:w-96 lg:flex-shrink-0 lg:h-[calc(100vh-4rem)] lg:border-l lg:border-gray-200'
  : 'flex flex-col h-full'

return (
  <div className={shellClass}>
    {/* …conteúdo existente… */}
  </div>
)
```

O estado de loading (`if (isLoading || !doc)`) também deve usar `shellClass` em `variant === 'drawer'` para não “saltar” o layout; manter o atual `h-48` em modal:

```tsx
if (isLoading || !doc) {
  return (
    <div className={variant === 'drawer' ? shellClass + ' items-center justify-center' : 'flex items-center justify-center h-48'}>
      <span className="text-sm text-gray-400">A carregar...</span>
    </div>
  )
}
```

(Definir `shellClass` antes deste early-return, ou inline a string nos dois sítios.)

- [ ] **Step 2: Build**

Run: `cd apps/web && npm run build`
Expected: 0 erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/treasury/DocDetailPanel.tsx
git commit -m "feat(web): DocDetailPanel ganha prop variant (drawer|modal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `DocDetailPanel` — paridade de capacidades

**Files:**
- Modify: `apps/web/src/components/treasury/DocDetailPanel.tsx`

**Interfaces:**
- Consumes: `PaymentDetailModal` (Task 2), `InlineCategoryPicker`, `InvoiceAttachmentsButton`, `RemoveFromFuturePaymentsDialog` (já existentes).
- Produces: o painel passa a ter todas as ações do inline. Sem mudança de assinatura face à Task 3.

> **Fonte para portar (payables):** `apps/web/src/pages/PayablesPage.tsx`
> - cabeçalho rico com pré-visualização + entidade clicável + editar/anular/eliminar: linhas 2339-2435
> - pagamentos associados (TOC): 2438-2465
> - comprovativo interno: 2467-2482
> - secção Comprometer (SCHEDULED): 2560-2606
> - Marcar como Pago: 2608-2623
> - Marcar como Liquidada (referência+data): 2625-2660
> - Pronta para Pagar + diálogo: 2662-2696
> - Definir data pagamento: 2698-2736
> - Dividir Fatura (já existe versão no DocDetailPanel — usar a do inline com `distributeAmount`/`distributePct`): 2738-2937
> - Anexos: 2939-2947
>
> **Regras de transformação ao portar:** `panelDoc` → `doc`; mutações da página (`payPayable`, `settlePayable`, `commitPayable`, `unsettlePayable`, `setReadyToPay`, `setPromisedDate`, `splitPayable`, `voidPayable`, `classify`) → mutações internas do painel já existentes (`payDoc`, `settleDoc`, `unsettleDoc`, `splitDoc`, `setPromisedDateMut`, `setReadyToPayMut`) **acrescentando as que faltam** (commit, void, classify) com o mesmo padrão (`api.post`/`api.patch` para `/treasury/${selectedClientId}/${seg}/${currentId}/…`); `selectedClientId` já existe; `seg` já existe. As versões para receivables usam os mesmos paths (`/${seg}/…`), por isso o componente serve ambos via `seg`/`isExpense`.

- [ ] **Step 1: Estados e mutações em falta**

Adicionar ao `DocDetailPanel` os estados `settleRef`, `settleDate`, `commitRef`, `commitAmount`, `commitDate` e estender `Section` para `'promised' | 'split' | 'settle' | 'commit' | null`. Adicionar mutações internas:

```tsx
const commitDoc = useMutation({
  mutationFn: (vars: { reference: string; amount: number; date: string }) =>
    api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/commit`, vars),
  onSuccess: () => { invalidate(); setSection(null); toast.success('Fatura comprometida') },
  onError: (e: Error) => toast.error(e.message),
})
const voidDoc = useMutation({
  mutationFn: () => api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/void`, {}),
  onSuccess: () => { invalidate(); toast.success('Documento anulado') },
  onError: (e: Error) => toast.error(e.message),
})
const classifyDoc = useMutation({
  mutationFn: (categoryId: string | null) =>
    api.patch(`/treasury/${selectedClientId}/${seg}/${currentId}`, { categoryId }),
  onSuccess: () => { invalidate(); toast.success('Categoria atualizada') },
  onError: (e: Error) => toast.error(e.message),
})
```

> Para a liquidação com referência, o `settleDoc` atual chama `/settle` sem corpo. Substituir por:
> ```tsx
> const settleDoc = useMutation({
>   mutationFn: (vars: { paymentReference?: string; date?: string } = {}) =>
>     api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/settle`,
>       isExpense ? { paymentReference: vars.paymentReference, date: vars.date }
>                 : { receiptReference: vars.paymentReference, date: vars.date }),
>   onSuccess: () => { invalidate(); setSection(null); toast.success(isExpense ? 'Marcado como liquidado' : 'Marcado como recebido') },
>   onError: (e: Error) => toast.error(e.message),
> })
> ```
> Confirmar o nome do campo (`receiptReference`) na rota `/receivables/:id/settle` antes de finalizar.

- [ ] **Step 2: Queries extra (categorias + pagamentos TOC)**

Adicionar:

```tsx
const { data: categories = [] } = useQuery<{ id: string; name: string; color?: string | null }[]>({
  queryKey: [isExpense ? 'categories-expense' : 'categories-revenue', selectedClientId],
  queryFn: () => api.get(`/treasury/${selectedClientId}/categories?type=${isExpense ? 'EXPENSE' : 'REVENUE'}`),
  enabled: !!selectedClientId,
})

const tocDocId = isExpense ? doc?.tocPurchasesDocId : doc?.tocSalesDocId
const { data: tocPayments = [] } = useQuery<TocPayment[]>({
  queryKey: ['toc-doc-payments', selectedClientId, seg, tocDocId],
  queryFn: () => api.get(`/toconline/${selectedClientId}/${isExpense ? 'purchases' : 'sales'}/${tocDocId}/payments`),
  enabled: !!selectedClientId && !!tocDocId,
})
```

> Confirmar o endpoint de pagamentos para sales (`/sales/:id/receipts` vs `/payments`) em `ReceivablesPage.tsx` e ajustar.

Adicionar ao tipo `Doc` os campos `tocSalesDocId?: string | null`, `paymentReference?: string | null`, `paymentDate?: string | null`, `paymentAmount?: number | null`, `_tocRaw?: { public_link?: string } | null`, `settledVia` (já existe).

- [ ] **Step 3: Cabeçalho rico**

Substituir o cabeçalho atual (`DocDetailPanel.tsx:216-258`) por uma versão portada de `PayablesPage.tsx:2339-2435`, com as transformações:
- pré-visualização: usar `doc._tocRaw?.public_link`.
- entidade clicável: se `entityNav` e (`doc` tem `tocSupplierId`/`tocCustomerId`), renderizar `<button onClick={() => navigate('/empresa/' + (isExpense ? 'fornecedores' : 'clientes') + '/' + entityId, { state: entityNav })}>`. Importar `useNavigate`.
- editar/anular/eliminar: só renderizar se `onEdit`/`onDelete` forem passados e `!tocDocId`; `onEdit?.(doc)`, `onDelete?.(doc)`, anular → `voidDoc.mutate()`.
- `InlineCategoryPicker` com `categories` e `onSelect={(id) => classifyDoc.mutate(id)}`.

- [ ] **Step 4: Pagamentos associados + comprovativo**

Inserir, abaixo do cabeçalho e antes das tabs, os blocos portados de `PayablesPage.tsx:2438-2482` (lista `tocPayments` com clique → `setSelectedPayment(pm)`; comprovativo interno quando `doc.status === 'SETTLED' && doc.paymentReference`). Adicionar estado `const [selectedPayment, setSelectedPayment] = useState<TocPayment | null>(null)` e, no fim do componente, render `<PaymentDetailModal open=… payment={selectedPayment} … linesEndpoint=… />`.

- [ ] **Step 5: Secções de ação em falta (tab Detalhes)**

No corpo da tab `details`, acrescentar as secções Comprometer (2560-2606), Liquidar-com-referência (2625-2660), Pronta-para-Pagar (2662-2696) e Anexos (2939-2947), portadas com as regras de transformação. Manter as já existentes (pay, promised, split). A secção “Pronta para Pagar” e a coluna de “Futuros Pagamentos” só aparecem com `isExpense`.

- [ ] **Step 6: Build + revisão campo-a-campo**

Run: `cd apps/web && npm run build`
Expected: 0 erros.
Rever visualmente que nenhuma capacidade do inline ficou de fora (checklist do bloco "Fonte para portar").

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/treasury/DocDetailPanel.tsx
git commit -m "feat(web): DocDetailPanel atinge paridade com o painel inline de Pagar/Receber

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `PayablesPage` usa o painel partilhado (drawer)

**Files:**
- Modify: `apps/web/src/pages/PayablesPage.tsx`

**Interfaces:**
- Consumes: `<DocDetailPanel docId docType="payable" variant="drawer" onClose onEdit onDelete onMutated entityNav />` (Task 4).

- [ ] **Step 1: Substituir o bloco inline**

Substituir todo o bloco `{panelDoc && ( … )}` (`PayablesPage.tsx:2315`-fim do painel, ~2958+) por:

```tsx
{panelDoc && (
  <DocDetailPanel
    docId={panelDoc.id}
    docType="payable"
    variant="drawer"
    entityNav={{ from: '/contas-a-pagar', fromLabel: 'Contas a Pagar' }}
    onClose={() => { setPanelDoc(null); setPanelTocDoc(null) }}
    onMutated={() => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }) }}
    onEdit={(d) => { setEditId(d.id); setEditRow(panelDoc); setEditForm({
      categoryId: panelDoc.category?.id ?? '', entityName: panelDoc.entityName, reference: panelDoc.reference,
      documentDate: panelDoc.documentDate?.slice(0, 10) ?? '', dueDate: panelDoc.dueDate.slice(0, 10),
      totalAmount: String(panelDoc.totalAmount), description: panelDoc.description ?? '',
    }) }}
    onDelete={(d) => setDeleteRow(panelDoc)}
  />
)}
```

Importar `DocDetailPanel` no topo se ainda não estiver.

- [ ] **Step 2: Limpar estado/mutações órfãos**

Remover do `PayablesPage` os estados e mutações que só serviam o painel inline e deixaram de ser referenciados: `panelTab`, `panelSection`, `settleRef`, `settleDate`, `commitRef`, `commitAmount`, `commitDate`, `panelPromisedDate`, `removeReadyOpen`, `splitInstallments`, `splitCount`, `splitValueMode`, `detailPayment`, e as mutações `settlePayable`, `commitPayable`, `unsettlePayable`, `setPromisedDate`, `setReadyToPay`, `splitPayable`, `unsplitPayable`, `payPayable` **se** já não forem usadas noutro sítio da página (ex.: ações em linha na tabela). **Antes de remover cada uma**, procurar usos restantes com Grep; manter as que a tabela ainda usa. `panelDocDetail`/`panelPayments` queries: remover se já não referenciadas.

> O `setPanelDoc` e a deteção de coluna extra (`!panelDoc && <th>`, `colSpan={panelDoc ? 11 : 12}`) **mantêm-se** — a página continua a controlar qual doc está aberto.

- [ ] **Step 3: Build**

Run: `cd apps/web && npm run build`
Expected: 0 erros (resolver eventuais "declared but never used" removendo os órfãos).

- [ ] **Step 4: Verificação visual**

Run: `cd apps/web && npm run dev` → abrir Contas a Pagar, clicar numa fatura: confirmar que o drawer abre idêntico ao anterior, com todas as ações (pagar, liquidar, comprometer numa SCHEDULED, dividir, pronta para pagar, anular, editar, eliminar, categoria, pré-visualização, pagamentos associados).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PayablesPage.tsx
git commit -m "refactor(web): Contas a Pagar usa DocDetailPanel partilhado (drawer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `ReceivablesPage` usa o painel partilhado (drawer)

**Files:**
- Modify: `apps/web/src/pages/ReceivablesPage.tsx`

**Interfaces:**
- Consumes: `<DocDetailPanel docType="receivable" variant="drawer" … />`.

- [ ] **Step 1: Substituir o bloco inline**

Análogo à Task 5, com `docType="receivable"` e `entityNav={{ from: '/contas-a-receber', fromLabel: 'Contas a Receber' }}`. O `onEdit`/`onDelete` mapeiam para os estados de edição/eliminação próprios da ReceivablesPage (confirmar os nomes: `setEditId`/`setEditRow`/`setEditForm`/`setDeleteRow` — replicar o que a página já tem).

- [ ] **Step 2: Limpar estado/mutações órfãos**

Mesmo procedimento da Task 5 Step 2, para os equivalentes de receivables (`settleReceivable`, `commitReceivable`, `unsettleReceivable`, etc.). Grep antes de remover cada um.

- [ ] **Step 3: Build**

Run: `cd apps/web && npm run build`
Expected: 0 erros.

- [ ] **Step 4: Verificação visual**

Contas a Receber → clicar numa fatura: drawer idêntico, ações de receber/liquidar/dividir/etc. funcionais.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ReceivablesPage.tsx
git commit -m "refactor(web): Contas a Receber usa DocDetailPanel partilhado (drawer)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Budget — modal rico + alinhamento do sidebar

**Files:**
- Modify: `apps/web/src/pages/BudgetsPage.tsx`
- Modify: `apps/web/src/components/budgets/BudgetPanel.tsx`

**Interfaces:**
- Consumes: `<DocDetailPanel variant="modal" … />` (já usado; só muda o `Modal` à volta).

- [ ] **Step 1: Modal da fatura no BudgetPanel**

Em `BudgetPanel.tsx`, no `<Modal>` que envolve `DocDetailPanel` (linhas 405-421), mudar `size="sm"` → `size="lg"` e passar `variant="modal"` ao `DocDetailPanel` (default já é `modal`, mas explicitar). Manter `hideHeader` e `noPadding`. `onMutated={invalidate}` mantém-se.

- [ ] **Step 2: Alinhar a largura do sidebar**

Em `BudgetPanel.tsx:163`, trocar `w-[420px] flex-shrink-0` por `lg:w-80 xl:w-96 flex-shrink-0`.

- [ ] **Step 3: Alinhar a barra de tabs do sidebar**

Em `BudgetPanel.tsx:193-211`, trocar o contentor de tabs `flex border-b border-gray-200 bg-gray-50` por `flex border-b border-gray-100` e cada botão de `py-2 text-xs … border-primary-500 text-primary-600` para o padrão do DocDetailPanel: `flex-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors`, ativo `border-primary-600 text-primary-700`, inativo `border-transparent text-gray-500 hover:text-gray-700` (preservar o realce âmbar do separador "Para rever" quando `pendingCount > 0`).

- [ ] **Step 4: Build + verificação visual**

Run: `cd apps/web && npm run build`
Expected: 0 erros.
Visual: abrir um budget, clicar numa transação → modal rico (size lg) coerente com Pagar/Receber; sidebar com tabs e largura alinhadas.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/BudgetsPage.tsx apps/web/src/components/budgets/BudgetPanel.tsx
git commit -m "feat(web): Budget - modal de fatura rico e sidebar alinhado com Pagar/Receber

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `EntityDetailPage` — clique abre painel + visual

**Files:**
- Modify: `apps/web/src/pages/EntityDetailPage.tsx`

**Interfaces:**
- Consumes: `GET /treasury/:clientId/{payables|receivables}/by-toc/:tocDocId` (Task 1); `<DocDetailPanel variant="modal" />` (Task 4); `Modal` (existente).

- [ ] **Step 1: Estado do painel + handler de clique**

Adicionar:

```tsx
const [panelDocId, setPanelDocId] = useState<string | null>(null)
const docType = isSupplier ? 'payable' : 'receivable'
const seg = isSupplier ? 'payables' : 'receivables'

async function openDocPanel(doc: TocDoc) {
  if (doc.status === 0 || doc.status === 4) return            // rascunho/anulado: sem painel
  if (doc._local) {                                            // doc local: id directo
    setPanelDocId(String(doc.id).replace(/^local-/, ''))
    return
  }
  try {
    const r = await api.get<{ id: string }>(`/treasury/${clientId}/${seg}/by-toc/${doc.id}`)
    setPanelDocId(r.id)
  } catch {
    toggleExpand(String(doc.id))                               // fallback: comportamento atual (expandir)
  }
}
```

- [ ] **Step 2: Tornar a linha clicável**

Na `<tr>` de cada documento (`EntityDetailPage.tsx:467`), adicionar `onClick={() => openDocPanel(doc)}` e `className` com `cursor-pointer`. **Importante:** o botão de expandir recibos/pagamentos (`toggleExpand`, 474-483) deve continuar a funcionar isoladamente — manter o `onClick` desse botão com `e.stopPropagation()` para não disparar o painel.

- [ ] **Step 3: Render do modal**

Antes do fecho do componente, adicionar:

```tsx
<Modal open={panelDocId !== null} onClose={() => setPanelDocId(null)} title="" size="lg" hideHeader noPadding>
  {panelDocId && (
    <DocDetailPanel
      docId={panelDocId}
      docType={docType}
      variant="modal"
      onClose={() => setPanelDocId(null)}
      onMutated={() => {
        qc.invalidateQueries({ queryKey: isSupplier ? ['toc-purchases', clientId, tocId] : ['toc-sales', clientId, tocId] })
        qc.invalidateQueries({ queryKey: isSupplier ? ['toc-supplier-local-docs', clientId, tocId] : ['toc-customer-local-docs', clientId, tocId] })
      }}
    />
  )}
</Modal>
```

Importar `Modal` e `DocDetailPanel`.

- [ ] **Step 4: Alinhamento visual**

Rever a tabela e KPIs face ao resto do site:
- KPIs já usam `KpiCard` (coerente) — manter.
- Cabeçalhos de secção da coluna direita já usam `text-xs font-semibold text-gray-400 uppercase tracking-wider` — coerente.
- `Badge` de estado já é o partilhado — coerente.
Confirmar que o estilo de tabela (cabeçalho `bg-gray-50`, linhas `hover:bg-blue-50/30`) está alinhado com as tabelas de Pagar/Receber; ajustar tons divergentes se existirem. (Esta etapa é maioritariamente verificação; aplicar só correções pontuais.)

- [ ] **Step 5: Build + verificação visual**

Run: `cd apps/web && npm run build`
Expected: 0 erros.
Visual: em Fornecedores e Clientes — clicar numa fatura **com** registo local abre o modal rico; numa fatura TOC **sem** registo local, o clique mantém a expansão inline; rascunho/anulado não abrem nada.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/EntityDetailPage.tsx
git commit -m "feat(web): Clientes/Fornecedores - clicar numa fatura abre o painel rico

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (preenchido pelo autor do plano)

- **Cobertura do spec:** Secção 1 (componente único) → Tasks 3-6; Secção 2 (Budget) → Task 7; Secção 3 (Clientes/Fornecedores) → Tasks 1+8; backend `by-toc` → Task 1; `PaymentDetailModal` partilhado → Task 2. ✔
- **Áreas de risco assinaladas:** portar lógica fina (split €/%, commit, settle) — Task 4 com ranges exatos e regras de transformação; limpeza de órfãos — Tasks 5/6 com "Grep antes de remover".
- **Confirmações pendentes durante execução** (explícitas no plano): endpoint de linhas de recibos de venda (Task 2); campo `receiptReference` em `/receivables/:id/settle` (Task 4); endpoint de pagamentos de sales `/payments` vs `/receipts` (Task 4). Estes são lookups locais rápidos, não bloqueiam o desenho.
