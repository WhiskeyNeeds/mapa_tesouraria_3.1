# Etiquetas dos documentos numa coluna própria + triângulo de aviso "Aguarda Recibo"

**Data:** 2026-06-05
**Estado:** Aprovado (desenho)

## Objetivo

Duas alterações de UI nas tabelas de documentos:

1. **Triângulo de aviso "Aguarda Recibo"** — faturas de origem TOConline com estado
   "Pago" (`PAID`) em **Contas a Receber** mostram um triângulo de aviso. Significam
   que foram marcadas como pagas localmente mas ainda não foram liquidadas no
   TOConline (falta emitir o recibo). Tooltip ao passar o rato: **"Aguarda Recibo"**.

2. **Slot de etiquetas dedicado** — as etiquetas dos documentos (badge da tesoura da
   divisão + o novo triângulo) passam para um slot próprio **à esquerda da referência,
   imediatamente a seguir ao checkbox**. Aplica-se às **duas páginas** (Contas a Receber
   e Contas a Pagar). Em Contas a Pagar o slot mostra apenas a tesoura.

## Decisões

- **Âmbito do triângulo:** apenas Contas a Receber, apenas docs de origem TOConline
  (`origin === 'TOCONLINE'`) com `status === 'PAID'`. Documentos locais nunca o mostram
  (não aguardam recibo no TOC).
- **Âmbito do slot de etiquetas:** ambas as páginas, todas as variantes de linha
  (linhas locais e linhas TOC).
- **Tooltip:** `"Aguarda Recibo"`.
- **Ícone de recorrência (`Repeat2`):** mantém-se junto à referência — **não** move
  para o slot de etiquetas.
- **Layout escolhido:** o checkbox mantém-se encostado à referência; o slot de etiquetas
  fica entre o checkbox e a referência. **Não** é uma coluna `<th>` separada (sem
  cabeçalho próprio nem alteração de `colSpan`) — é um slot dentro da célula "Documento".

## Desenho

### Componente partilhado `DocLabels`

Novo ficheiro `apps/web/src/components/treasury/DocLabels.tsx`.

Props:

```ts
interface DocLabelsProps {
  splitCount: number          // nº de parcelas da divisão (0 = não dividido)
  awaitingReceipt?: boolean   // TOC + PAID em Contas a Receber
}
```

Renderiza um contentor `inline-flex items-center gap-1` com:

- **Badge da tesoura** (quando `splitCount > 0`): mesmo estilo atual —
  `inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[11px] font-semibold whitespace-nowrap`,
  com `<Scissors className="w-3 h-3" />` + `{splitCount}` e `title={`Dividida em ${splitCount} parcelas`}`.
- **Triângulo de aviso** (quando `awaitingReceipt`):
  `<span title="Aguarda Recibo"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span>`.

Se não houver nada a mostrar (`splitCount === 0` e `!awaitingReceipt`), não renderiza nada
— a referência fica encostada ao checkbox, como hoje.

### Layout da célula "Documento"

Em ambas as páginas e em todas as variantes de linha, a ordem dentro da célula passa a:

```
[checkbox] [chevron de expandir (só linhas TOC)] [<DocLabels …/>] [referência + data/descrição]
```

Os badges de tesoura renderizados inline atualmente (3 sítios por página) são removidos
e substituídos pelo `<DocLabels>`. O bloco da referência (`reference` + linha de
data/descrição + ícone `Repeat2`) mantém-se igual.

### Cálculo de `awaitingReceipt`

- **ReceivablesPage:** `awaitingReceipt = (origin === 'TOCONLINE') && status === 'PAID'`
  para cada linha (usar o `status` da linha já mostrado no badge de Estado, e o `origin`
  / presença de `tocSalesDocId`).
- **PayablesPage:** não passa `awaitingReceipt` (sempre indefinido/`false`).

## Locais afetados

- **Novo:** `apps/web/src/components/treasury/DocLabels.tsx`.
- **`apps/web/src/pages/ReceivablesPage.tsx`:** import do `DocLabels`; substituir os
  3 badges de tesoura inline pelas chamadas a `DocLabels` no slot, com `awaitingReceipt`
  calculado. (Linhas atuais de referência: ~1108–1119 linha local, ~1308–1318 linha TOC,
  ~1571–1578 segunda tabela.)
- **`apps/web/src/pages/PayablesPage.tsx`:** import do `DocLabels`; substituir os
  3 badges de tesoura inline pelas chamadas a `DocLabels` no slot, sem `awaitingReceipt`.
  (Linhas atuais de referência: ~1045–1052, ~1245–1251, ~1507–1512.)

## Fora de âmbito

- Sem alterações de schema, migrações ou backend — usa dados já serializados
  (`status`, `origin`, `children`/contagem de parcelas).
- O ícone de recorrência não muda de sítio.
- Sem coluna de tabela nova (sem cabeçalho/`colSpan`).

## Testes / verificação

Mudança puramente visual em React. Verificação manual:

- Contas a Receber: fatura TOC marcada como "Pago" mostra o triângulo âmbar com tooltip
  "Aguarda Recibo"; fatura local "Paga" **não** mostra triângulo; fatura TOC "Emitida"
  não mostra triângulo.
- Documento dividido (local e TOC, ambas as páginas) mostra o badge da tesoura no slot,
  à esquerda da referência, a seguir ao checkbox.
- Documento sem etiquetas mantém a referência encostada ao checkbox.
