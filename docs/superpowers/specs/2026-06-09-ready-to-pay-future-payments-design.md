# Pronta para Pagar + separador Futuros Pagamentos (Contas a Pagar)

**Data:** 2026-06-09
**Âmbito:** Contas a Pagar (PayablesPage + painel de detalhe + backend payables)

## Objetivo

Permitir marcar uma fatura de Contas a Pagar como "Pronta para Pagar" a partir
da ação em *Detalhes*, e reunir todas as faturas assim marcadas num novo
separador "Futuros Pagamentos". A marcação é **não destrutiva**: a fatura
mantém-se no seu separador de origem (Fornecedores ou Outras Operações) **e**
aparece em Futuros Pagamentos.

## Decisões (confirmadas com o utilizador)

1. A ação é um **toggle** — marca e desmarca (remove de Futuros Pagamentos).
2. Quando a fatura é marcada como **Paga/Liquidada**, a flag é limpa
   automaticamente e a fatura sai de Futuros Pagamentos.
3. O separador junta faturas marcadas de **Fornecedores E Outras Operações**.

## Modelo de dados

Adicionar um campo booleano ao modelo `TreasuryPayable`:

```prisma
readyToPay Boolean @default(false)
```

- Migração Prisma dedicada (sem alterações a `TreasuryReceivable`).
- Espelha o padrão de `promisedPaymentDate`: anotação local sobre o documento,
  válida tanto para payables locais como para os ligados a TOConline.
- Para faturas puramente-TOC (sem linha local), a marcação cria a linha de
  ligação local on-demand através do mecanismo existente
  `resolveLocalPayableId` (igual a `setPromisedDate`/`split`).

## Backend

### Endpoint

```
PATCH /treasury/:clientId/payables/:id/ready-to-pay
body: { ready: boolean }
```

- Rota em `payables.routes.ts`, a seguir a `promised-date`.
- `svc.setReadyToPay(clientId, userId, id, ready)`:
  - Resolve `id` (`toc-{tocId}` → linha local) via `resolveLocalPayableId`.
  - `update` do campo `readyToPay`.
  - Regista em activity log no mesmo formato das outras mutações.
  - Devolve o payable atualizado.

### Filtro em `list()`

- Novo parâmetro `readyToPay?: boolean` em `filters`.
- Quando `readyToPay === true`:
  - **Ignora a restrição de bucket** (não força `tocPurchasesDocId` null/não-null),
    devolvendo itens de ambos os universos.
  - Mantém os restantes filtros (estado, pesquisa, datas) aplicáveis.
- O overlay (`overlayLocalPayableWithToc` / `mapTocPurchaseToPayable`) propaga
  `readyToPay` para cada `PayableListItem`. Os itens puramente-TOC sem linha
  local têm `readyToPay = false` por omissão, logo nunca entram neste filtro.
- A função `matches()` passa a filtrar `if (readyToPay && !item.readyToPay) return false`.

### Auto-clear ao pagar/liquidar

- `pay()` e `settle()` incluem `readyToPay: false` no mesmo `update` que altera
  o `status`. Garante que faturas pagas/liquidadas saem de Futuros Pagamentos.

## Frontend

### Tipo `Payable`

Adicionar `readyToPay?: boolean` à interface `Payable` em `PayablesPage.tsx`
(e ao `Doc` em `DocDetailPanel.tsx`).

### Mutação

```ts
const setReadyToPay = useMutation({
  mutationFn: ({ id, ready }) =>
    api.patch(`/treasury/${selectedClientId}/payables/${id}/ready-to-pay`, { ready }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['payables'] })
    // atualização otimista do panelDoc
  },
})
```

### Ação "Pronta para Pagar" em *Detalhes*

- Localização: painel inline em `PayablesPage.tsx` (bloco `panelTab === 'details'`),
  junto às ações existentes (após "Marcar como Liquidada").
- Visível apenas quando `status` é `OPEN` ou `PARTIAL`.
- Toggle baseado em `panelDoc.readyToPay`:
  - **Não marcada:** título "Pronta para Pagar", subtítulo "Adicionar a Futuros
    Pagamentos", estilo neutro (borda cinza, ícone wallet/calendar).
  - **Marcada:** estado ativo (ex.: fundo/realce âmbar ou verde), título
    "Remover de Futuros Pagamentos".
- A mesma ação é adicionada ao painel partilhado `DocDetailPanel.tsx` (apenas
  para `docType === 'payable'`).

### Separador "Futuros Pagamentos"

- `activeTab` passa de `'fornecedores' | 'outras'` para
  `'fornecedores' | 'outras' | 'futuros'`.
- Barra de separadores:

  ```
  Fornecedores   Outras Operações   |   Futuros Pagamentos
  ```

  Divisória `|` = `<span className="w-px h-5 bg-gray-200 self-center mx-1" />`
  inserida entre "Outras Operações" e "Futuros Pagamentos".
- Query: quando `activeTab === 'futuros'`, os parâmetros incluem
  `readyToPay=true` e **não** enviam `bucket`; restantes filtros da página
  (estado/pesquisa/datas) continuam disponíveis.
- Tabela: reutiliza o layout/colunas da tabela de Fornecedores (a lista é
  mista). As linhas abrem o mesmo painel de detalhe.
- Estado vazio: "Sem faturas marcadas como prontas para pagar."
- A seleção em massa limpa ao trocar para/deste separador (já coberto pelo
  `useEffect` existente sobre `activeTab`).

### Indicador visual nos separadores de origem

- Nas tabelas Fornecedores e Outras Operações, uma fatura marcada
  (`readyToPay === true`) mostra um indicador subtil (badge pequeno / etiqueta,
  reutilizando o estilo `DocLabels`) a sinalizar que também consta de Futuros
  Pagamentos.

## Fora de âmbito

- Contas a Receber (sem alterações).
- Ações em massa de "Pronta para Pagar" (marcação é unitária via painel).
- Integração com o dashboard / KPIs.
