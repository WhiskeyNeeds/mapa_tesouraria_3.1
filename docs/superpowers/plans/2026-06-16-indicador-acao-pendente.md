# Indicador "!" de ação pendente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar um ícone "!" (âmbar/vermelho por urgência do prazo) na linha de cada documento em Contas a Receber e Contas a Pagar quando tem uma ação (CALL_TASK) pendente com `dueAt`.

**Architecture:** O backend, no fim de `list()` de receivables e payables, agrega o `dueAt` mais antigo das `CALL_TASK PENDING` da página atual (via um helper puro partilhado `earliestPendingDueAt`) e anexa `_pendingActionDueAt` a cada item. O frontend renderiza o "!" em `DocLabels`, calculando a cor por comparação date-only com o "hoje" do utilizador.

**Tech Stack:** Fastify v5, Prisma, React + TanStack Query, Tailwind, lucide-react, Vitest (mock prisma).

**Spec:** [docs/superpowers/specs/2026-06-16-indicador-acao-pendente-design.md](../specs/2026-06-16-indicador-acao-pendente-design.md)

---

## File Structure

**Backend:**
- `apps/api/src/lib/pending-action.ts` — helper puro `earliestPendingDueAt` (novo).
- `apps/api/src/lib/pending-action.test.ts` — testes do helper (novo).
- `apps/api/src/modules/treasury/payables/payables.service.ts` — `PayableListItem` ganha `_pendingActionDueAt`; bloco do `needsContact` em `list()` passa a calcular também o due mais antigo.
- `apps/api/src/modules/treasury/receivables/receivables.service.ts` — `ReceivableListItem` ganha `_pendingActionDueAt`; novo bloco no fim de `list()`.

**Frontend:**
- `apps/web/src/components/treasury/DocLabels.tsx` — nova prop `pendingActionDueAt` + ícone "!" com cor.
- `apps/web/src/pages/ReceivablesPage.tsx` — tipo do item + passar a prop nas linhas.
- `apps/web/src/pages/PayablesPage.tsx` — tipo do item + passar a prop nas linhas.

---

## Task 1: Helper puro `earliestPendingDueAt`

**Files:**
- Create: `apps/api/src/lib/pending-action.ts`
- Test: `apps/api/src/lib/pending-action.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/lib/pending-action.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { earliestPendingDueAt } from './pending-action.js'

describe('earliestPendingDueAt', () => {
  it('devolve o dueAt mais antigo (ISO) por documento', () => {
    const map = earliestPendingDueAt([
      { docId: 'a', dueAt: new Date('2026-06-20T00:00:00Z') },
      { docId: 'a', dueAt: new Date('2026-06-18T00:00:00Z') },
      { docId: 'b', dueAt: new Date('2026-06-25T00:00:00Z') },
    ])
    expect(map.get('a')).toBe('2026-06-18T00:00:00.000Z')
    expect(map.get('b')).toBe('2026-06-25T00:00:00.000Z')
  })

  it('ignora tarefas sem docId ou sem dueAt', () => {
    const map = earliestPendingDueAt([
      { docId: null, dueAt: new Date('2026-06-18T00:00:00Z') },
      { docId: 'c', dueAt: null },
    ])
    expect(map.size).toBe(0)
  })

  it('devolve mapa vazio para input vazio', () => {
    expect(earliestPendingDueAt([]).size).toBe(0)
  })
})
```

- [ ] **Step 2: Correr o teste — deve falhar**

Run (em `apps/api`): `npx vitest run src/lib/pending-action.test.ts`
Expected: FAIL — módulo `./pending-action.js` não existe.

- [ ] **Step 3: Implementar o helper**

Criar `apps/api/src/lib/pending-action.ts`:

```typescript
/**
 * Para um conjunto de tarefas pendentes (cada uma ligada a um documento via
 * `docId` e com um prazo `dueAt`), devolve um mapa `docId → dueAt mais antigo`
 * (em ISO string). Tarefas sem `docId` ou sem `dueAt` são ignoradas.
 *
 * As ISO strings têm formato fixo, por isso a comparação lexicográfica (`<`)
 * coincide com a ordem cronológica — o mais "antigo" é o menor.
 */
export function earliestPendingDueAt(
  tasks: Array<{ docId: string | null; dueAt: Date | null }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of tasks) {
    if (!t.docId || !t.dueAt) continue
    const iso = t.dueAt.toISOString()
    const current = map.get(t.docId)
    if (!current || iso < current) map.set(t.docId, iso)
  }
  return map
}
```

- [ ] **Step 4: Correr o teste — deve passar**

Run (em `apps/api`): `npx vitest run src/lib/pending-action.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pending-action.ts apps/api/src/lib/pending-action.test.ts
git commit -m "feat(treasury): helper earliestPendingDueAt"
```

---

## Task 2: Backend payables — anexar `_pendingActionDueAt`

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts` (interface `PayableListItem` ~L14-38; bloco `needsContact` em `list()` ~L309-320)

- [ ] **Step 1: Importar o helper**

No topo de `payables.service.ts`, junto aos outros imports de `../../../lib/...`, adicionar:
```typescript
import { earliestPendingDueAt } from '../../../lib/pending-action.js'
```

- [ ] **Step 2: Adicionar o campo ao tipo `PayableListItem`**

Na interface `PayableListItem`, a seguir à linha:
```typescript
  /** Tem tarefa de contacto pendente (CALL_TASK PENDING) — mostra ícone "Contatar Cliente". */
  needsContact?: boolean
```
adicionar:
```typescript
  /** dueAt (ISO) mais antigo das CALL_TASK PENDING com prazo — alimenta o "!" de ação pendente. null se não houver. */
  _pendingActionDueAt?: string | null
```

- [ ] **Step 3: Estender o bloco do `needsContact` em `list()`**

Substituir o bloco existente:
```typescript
    const localIds = items.map((i) => i.id).filter((id) => !id.startsWith('toc-'))
    if (localIds.length > 0) {
      const pendingTasks = await this.prisma.treasuryFollowup.findMany({
        where: { clientId, payableId: { in: localIds }, kind: 'CALL_TASK', status: 'PENDING' },
        select: { payableId: true },
      })
      const needsContactIds = new Set(pendingTasks.map((t) => t.payableId))
      for (const item of items) item.needsContact = needsContactIds.has(item.id)
    }
```
por:
```typescript
    const localIds = items.map((i) => i.id).filter((id) => !id.startsWith('toc-'))
    if (localIds.length > 0) {
      const pendingTasks = await this.prisma.treasuryFollowup.findMany({
        where: { clientId, payableId: { in: localIds }, kind: 'CALL_TASK', status: 'PENDING' },
        select: { payableId: true, dueAt: true },
      })
      const needsContactIds = new Set(pendingTasks.map((t) => t.payableId))
      const dueByDoc = earliestPendingDueAt(pendingTasks.map((t) => ({ docId: t.payableId, dueAt: t.dueAt })))
      for (const item of items) {
        item.needsContact = needsContactIds.has(item.id)
        item._pendingActionDueAt = dueByDoc.get(item.id) ?? null
      }
    }
```

- [ ] **Step 4: Compilar**

Run (em `apps/api`): `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/payables/payables.service.ts
git commit -m "feat(payables): list anexa _pendingActionDueAt"
```

---

## Task 3: Backend receivables — anexar `_pendingActionDueAt`

**Files:**
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (interface `ReceivableListItem` ~L14-41; fim de `list()` ~L228-245)

- [ ] **Step 1: Importar o helper**

No topo de `receivables.service.ts`, junto aos outros imports de `../../../lib/...`, adicionar:
```typescript
import { earliestPendingDueAt } from '../../../lib/pending-action.js'
```

- [ ] **Step 2: Adicionar o campo ao tipo `ReceivableListItem`**

Na interface `ReceivableListItem`, a seguir à linha `_statusDiffersFromToc: boolean` e antes de `[key: string]: unknown`, adicionar:
```typescript
  /** dueAt (ISO) mais antigo das CALL_TASK PENDING com prazo — alimenta o "!" de ação pendente. null se não houver. */
  _pendingActionDueAt?: string | null
```

- [ ] **Step 3: Anexar no fim de `list()`**

Em `list()`, o método termina assim:
```typescript
    if (pageTocIds.length) {
      const raws = await this.prisma.tocSalesDocument.findMany({
        where: { clientId, tocId: { in: pageTocIds } },
        select: { tocId: true, raw: true },
      })
      const rawById = new Map(raws.map((r) => [r.tocId, r.raw]))
      for (const it of items) {
        if (it.tocSalesDocId) {
          const r = rawById.get(Number(it.tocSalesDocId))
          if (r !== undefined) it._tocRaw = r
        }
      }
    }

    return { total, page, limit, items }
```
Inserir, imediatamente antes do `return { total, page, limit, items }`:
```typescript
    // Sinaliza as faturas (da página atual) com ação pendente com prazo
    // (CALL_TASK PENDING com dueAt) — o frontend mostra o "!" âmbar/vermelho.
    // Só ids locais (cuid) têm follow-ups; itens TOC puros (id `toc-…`) nunca casam.
    const localIds = items.map((i) => i.id).filter((id) => !id.startsWith('toc-'))
    if (localIds.length > 0) {
      const pendingTasks = await this.prisma.treasuryFollowup.findMany({
        where: { clientId, receivableId: { in: localIds }, kind: 'CALL_TASK', status: 'PENDING' },
        select: { receivableId: true, dueAt: true },
      })
      const dueByDoc = earliestPendingDueAt(pendingTasks.map((t) => ({ docId: t.receivableId, dueAt: t.dueAt })))
      for (const item of items) item._pendingActionDueAt = dueByDoc.get(item.id) ?? null
    }

```

- [ ] **Step 4: Compilar**

Run (em `apps/api`): `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/receivables/receivables.service.ts
git commit -m "feat(receivables): list anexa _pendingActionDueAt"
```

---

## Task 4: Frontend `DocLabels` — ícone "!" com cor

**Files:**
- Modify: `apps/web/src/components/treasury/DocLabels.tsx`

- [ ] **Step 1: Atualizar o import de ícones**

A primeira linha é:
```typescript
import { Scissors, AlertTriangle, Wallet, Phone } from 'lucide-react'
```
Mudar para:
```typescript
import { Scissors, AlertTriangle, Wallet, Phone, AlertCircle } from 'lucide-react'
```

- [ ] **Step 2: Adicionar a prop e o helper de cor**

Na interface `DocLabelsProps`, a seguir a `needsContact?: boolean`, adicionar:
```typescript
  /** dueAt (ISO) da ação pendente mais urgente; mostra "!" âmbar (hoje ≤ prazo) ou vermelho (passou). null = sem ícone. */
  pendingActionDueAt?: string | null
```

Antes da função `DocLabels`, adicionar o helper date-only:
```typescript
/** Compara só a data (ignora horas): âmbar se o prazo é hoje ou no futuro,
 *  vermelho se já passou. */
function pendingActionTone(iso: string): { color: string; title: string } {
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const today = startOfDay(new Date())
  const due = startOfDay(new Date(iso))
  if (due.getTime() >= today.getTime()) {
    return { color: 'text-amber-500', title: `Ação pendente — prazo ${due.toLocaleDateString('pt-PT')}` }
  }
  return { color: 'text-red-600', title: 'Ação pendente — atrasada' }
}
```

- [ ] **Step 3: Renderizar o ícone**

Mudar a assinatura da função:
```typescript
export function DocLabels({ splitCount, awaitingReceipt, readyToPay, needsContact }: DocLabelsProps) {
  if (splitCount <= 0 && !awaitingReceipt && !readyToPay && !needsContact) return null
```
para:
```typescript
export function DocLabels({ splitCount, awaitingReceipt, readyToPay, needsContact, pendingActionDueAt }: DocLabelsProps) {
  if (splitCount <= 0 && !awaitingReceipt && !readyToPay && !needsContact && !pendingActionDueAt) return null
```

Dentro do `<span className="inline-flex items-center gap-1">`, a seguir ao bloco `{needsContact && (...)}` e antes do bloco `{awaitingReceipt && (...)}`, adicionar:
```tsx
      {pendingActionDueAt && (() => {
        const tone = pendingActionTone(pendingActionDueAt)
        return (
          <span title={tone.title}>
            <AlertCircle className={`w-3.5 h-3.5 ${tone.color}`} />
          </span>
        )
      })()}
```

- [ ] **Step 4: Compilar**

Run (em `apps/web`): `npx tsc --noEmit`
Expected: sem erros novos em `DocLabels.tsx` (podem existir erros pré-existentes noutros ficheiros do trabalho em curso do utilizador — ignorar esses).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/treasury/DocLabels.tsx
git commit -m "feat(web): DocLabels mostra ! de acao pendente com cor por prazo"
```

---

## Task 5: Frontend — passar a prop nas linhas de Receber/Pagar

**Files:**
- Modify: `apps/web/src/pages/ReceivablesPage.tsx` (tipo do item ~L82-96; usos de `DocLabels` ~L1334, ~L1527)
- Modify: `apps/web/src/pages/PayablesPage.tsx` (tipo do item ~L82-110; usos de `DocLabels` ~L1277, ~L1467, ~L1752)

- [ ] **Step 1: Adicionar o campo ao tipo do item (Receber)**

Em `apps/web/src/pages/ReceivablesPage.tsx`, no tipo do item que tem `_statusDiffersFromToc?: boolean` (~L96), adicionar na mesma interface:
```typescript
  _pendingActionDueAt?: string | null
```

- [ ] **Step 2: Passar a prop nos usos de `DocLabels` (Receber)**

Há dois usos de `<DocLabels ... />` em linhas locais (à volta de L1334 e L1527). Em cada um, acrescentar a prop. Por exemplo, mudar:
```tsx
<DocLabels splitCount={(r.children ?? []).filter((c) => !c.recurrenceId).length} awaitingReceipt={r.origin === 'TOCONLINE' && r.status === 'PAID'} />
```
para:
```tsx
<DocLabels splitCount={(r.children ?? []).filter((c) => !c.recurrenceId).length} awaitingReceipt={r.origin === 'TOCONLINE' && r.status === 'PAID'} pendingActionDueAt={r._pendingActionDueAt} />
```
E o uso equivalente que usa `row.item` em vez de `r`: acrescentar `pendingActionDueAt={row.item._pendingActionDueAt}`. (Ler o ficheiro para casar o texto exato de cada uso; o nome da variável muda entre `r` e `row.item`.)

- [ ] **Step 3: Adicionar o campo ao tipo do item (Pagar)**

Em `apps/web/src/pages/PayablesPage.tsx`, no tipo do item (junto a `needsContact?: boolean` ~L102 e `_statusDiffersFromToc?: boolean` ~L110), adicionar:
```typescript
  _pendingActionDueAt?: string | null
```

- [ ] **Step 4: Passar a prop nos usos de `DocLabels` (Pagar)**

Há três usos (~L1277, ~L1467, ~L1752). Dois usam `p` e um usa `row.item`. Em cada um, acrescentar a prop `pendingActionDueAt`. Por exemplo, mudar:
```tsx
<DocLabels splitCount={(p.children ?? []).filter((c) => !c.recurrenceId).length} readyToPay={p.readyToPay} needsContact={p.needsContact} />
```
para:
```tsx
<DocLabels splitCount={(p.children ?? []).filter((c) => !c.recurrenceId).length} readyToPay={p.readyToPay} needsContact={p.needsContact} pendingActionDueAt={p._pendingActionDueAt} />
```
E no uso com `row.item`: `pendingActionDueAt={row.item._pendingActionDueAt}`. (Ler o ficheiro para casar o texto exato de cada uso.)

- [ ] **Step 5: Compilar**

Run (em `apps/web`): `npx tsc --noEmit`
Expected: sem erros novos em `ReceivablesPage.tsx` / `PayablesPage.tsx` introduzidos por esta tarefa. (Há erros pré-existentes em `ReceivablesPage.tsx` do trabalho em curso do utilizador — confirmar que não foram introduzidos novos pela alteração; os campos adicionados são opcionais e não devem gerar erros.)

- [ ] **Step 6: Verificação manual**

Reiniciar a app (API + web). Pré-requisito: ter uma régua com uma ação Tarefa/Chamada e correr "Executar agora" (ou criar à mão uma tarefa com prazo numa fatura). Depois:
1. Em Contas a Receber, a linha da fatura com tarefa pendente cujo prazo é hoje/futuro mostra um "!" âmbar; tooltip com a data do prazo.
2. Com uma tarefa cujo prazo já passou (ex.: criar tarefa com prazo de ontem), a mesma linha mostra "!" vermelho; tooltip "atrasada".
3. Em Contas a Pagar, o mesmo "!" aparece ao lado do telefone "Contatar Cliente" (ambos coexistem).
4. Faturas sem tarefa pendente com prazo não mostram "!".

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ReceivablesPage.tsx apps/web/src/pages/PayablesPage.tsx
git commit -m "feat(web): ! de acao pendente nas linhas de Receber e Pagar"
```

---

## Self-Review Notes

- **Spec coverage:** helper de agregação (Task 1), backend payables com `needsContact` intacto + novo campo (Task 2), backend receivables novo (Task 3), ícone "!" com cor date-only e tooltip (Task 4), wiring nas linhas locais das duas páginas (Task 5). Todas as secções do spec têm tarefa.
- **Regra da cor:** `due >= today → âmbar`, `due < today → vermelho`, comparação date-only — corresponde a "o próprio dia fica sempre amarelo, depois fica vermelho".
- **Agregação:** dueAt mais antigo por documento (`earliestPendingDueAt`) — a tarefa mais urgente vence.
- **Não-regressão:** o bloco `needsContact` de payables mantém o comportamento (reutiliza a mesma query, só alarga o `select` com `dueAt`). Linhas-filho/parcelas e docs TOC puros não recebem a prop / ficam `null`.
- **Consistência de tipos:** `_pendingActionDueAt?: string | null` (backend e frontend), prop `pendingActionDueAt?: string | null` em `DocLabels`.
- **Commits:** sempre `git add` só dos ficheiros da tarefa (a working tree tem trabalho não-commitado do utilizador em PayablesPage/ReceivablesPage; staging seletivo por ficheiro é seguro, mas estes dois ficheiros já têm alterações do utilizador — ver nota de execução abaixo).

## Nota de execução importante — ficheiros com trabalho não-commitado do utilizador

Vários ficheiros que este plano modifica **já têm alterações não-commitadas do utilizador** na working tree (estado no início):
- `apps/api/src/modules/treasury/payables/payables.service.ts` (Task 2)
- `apps/api/src/modules/treasury/receivables/receivables.service.ts` (Task 3)
- `apps/web/src/components/treasury/DocLabels.tsx` (Task 4)
- `apps/web/src/pages/PayablesPage.tsx` (Task 5)
- `apps/web/src/pages/ReceivablesPage.tsx` (Task 5)

(Só a Task 1 cria ficheiros novos e está livre deste problema.)

`git add <ficheiro>` nessas tarefas apanharia o trabalho do utilizador junto com o nosso, como aconteceu antes com `FollowupsPanel.tsx`. **Antes de executar, decidir a estratégia com o utilizador** — opções: (a) o utilizador commita ou faz `git stash` do trabalho em curso, deixando estes 5 ficheiros limpos para os nossos commits; (b) executamos e, em cada tarefa, separamos a nossa alteração via `git stash` (mais frágil, repetido); (c) aceitamos o bundling. Recomendado: (a).
