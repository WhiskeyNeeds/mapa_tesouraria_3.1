# Atribuição de estado em massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir atribuir estado (Pago, Liquidado, Reverter, Anular) em massa a documentos selecionados em Contas a Pagar e Contas a Receber, ao lado da atribuição de categoria já existente.

**Architecture:** Espelha o padrão `bulkSetCategory`: um método de serviço resiliente `bulkSetStatus` que percorre os ids e despacha para o método por-documento existente (`pay`/`settle`/`unsettle`/`void`), herdando todas as regras de negócio, cascatas e auditoria. Nova rota `PATCH /bulk-status`. UI: segundo seletor + botão "Aplicar" na barra de seleção.

**Tech Stack:** Fastify v5, Prisma, TypeScript, Vitest (API); React + @tanstack/react-query + Tailwind (web).

**Spec:** `docs/superpowers/specs/2026-06-03-bulk-status-assignment-design.md`

---

## File Structure

- `apps/api/src/modules/treasury/payables/payables.service.ts` — Modify: adicionar `bulkSetStatus`
- `apps/api/src/modules/treasury/payables/payables.service.test.ts` — Create: testes unitários de `bulkSetStatus`
- `apps/api/src/modules/treasury/payables/payables.routes.ts` — Modify: rota `PATCH /bulk-status`
- `apps/api/src/modules/treasury/receivables/receivables.service.ts` — Modify: adicionar `bulkSetStatus`
- `apps/api/src/modules/treasury/receivables/receivables.service.test.ts` — Create: testes unitários de `bulkSetStatus`
- `apps/api/src/modules/treasury/receivables/receivables.routes.ts` — Modify: rota `PATCH /bulk-status`
- `apps/web/src/pages/PayablesPage.tsx` — Modify: estado, mutação e UI de estado em massa
- `apps/web/src/pages/ReceivablesPage.tsx` — Modify: estado, mutação e UI de estado em massa

---

## Task 1: Backend — `bulkSetStatus` em Contas a Pagar (serviço)

**Files:**
- Create: `apps/api/src/modules/treasury/payables/payables.service.test.ts`
- Modify: `apps/api/src/modules/treasury/payables/payables.service.ts` (inserir após `bulkSetCategory`, que termina ~linha 731)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/treasury/payables/payables.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { TreasuryPayablesService } from './payables.service.js'

// O construtor apenas guarda dependências (e instancia RecurrencesService que
// também só guarda o prisma), por isso passamos stubs vazios e espiamos os
// métodos por-documento — bulkSetStatus é puro despacho + acumulação resiliente.
function makeService() {
  return new TreasuryPayablesService({} as never, {} as never, {} as never)
}

describe('bulkSetStatus', () => {
  it('despacha cada estado para o método por-documento correspondente', async () => {
    const svc = makeService()
    const pay = vi.spyOn(svc, 'pay').mockResolvedValue(undefined as never)
    const settle = vi.spyOn(svc, 'settle').mockResolvedValue(undefined as never)
    const unsettle = vi.spyOn(svc, 'unsettle').mockResolvedValue(undefined as never)
    const voidFn = vi.spyOn(svc, 'void').mockResolvedValue(undefined as never)

    await svc.bulkSetStatus('c1', 'u1', ['a', 'b'], 'PAID')
    expect(pay).toHaveBeenCalledTimes(2)
    expect(pay).toHaveBeenCalledWith('c1', 'u1', 'a')
    expect(pay).toHaveBeenCalledWith('c1', 'u1', 'b')

    await svc.bulkSetStatus('c1', 'u1', ['c'], 'SETTLED')
    expect(settle).toHaveBeenCalledWith('c1', 'u1', 'c')

    await svc.bulkSetStatus('c1', 'u1', ['d'], 'OPEN')
    expect(unsettle).toHaveBeenCalledWith('c1', 'u1', 'd')

    await svc.bulkSetStatus('c1', 'u1', ['e'], 'VOID')
    expect(voidFn).toHaveBeenCalledWith('c1', 'u1', 'e')
  })

  it('é resiliente: um documento que falha não aborta os restantes', async () => {
    const svc = makeService()
    vi.spyOn(svc, 'pay')
      .mockRejectedValueOnce(new Error('Already paid'))
      .mockResolvedValueOnce(undefined as never)

    const res = await svc.bulkSetStatus('c1', 'u1', ['bad', 'good'], 'PAID')
    expect(res).toEqual({ updated: 1, failed: 1, errors: [{ id: 'bad', error: 'Already paid' }] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables/payables.service.test.ts`
Expected: FAIL — `bulkSetStatus is not a function` (método ainda não existe).

- [ ] **Step 3: Write minimal implementation**

Em `apps/api/src/modules/treasury/payables/payables.service.ts`, imediatamente após o fecho do método `bulkSetCategory` (a chaveta `}` na ~linha 731) e antes de `private async syncParentStatus`, inserir:

```ts
  /** Atribuição de estado em massa. Despacha cada documento para o método
   *  por-documento correspondente (`pay`/`settle`/`unsettle`/`void`), herdando
   *  todas as regras de negócio, cascatas às parcelas e auditoria. Resiliente:
   *  documentos que não possam transitar (ex.: liquidar fatura TOConline, anular
   *  já liquidado) são apanhados e não abortam os restantes. */
  async bulkSetStatus(clientId: string, userId: string, ids: string[], status: 'PAID' | 'SETTLED' | 'OPEN' | 'VOID') {
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        if (status === 'PAID') await this.pay(clientId, userId, id)
        else if (status === 'SETTLED') await this.settle(clientId, userId, id)
        else if (status === 'OPEN') await this.unsettle(clientId, userId, id)
        else await this.void(clientId, userId, id)
        updated++
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { updated, failed: errors.length, errors }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/modules/treasury/payables/payables.service.test.ts`
Expected: PASS (2 testes verdes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/treasury/payables/payables.service.ts apps/api/src/modules/treasury/payables/payables.service.test.ts
git commit -m "feat(payables): bulkSetStatus para atribuição de estado em massa"
```

---

## Task 2: Backend — rota `PATCH /bulk-status` em Contas a Pagar

**Files:**
- Modify: `apps/api/src/modules/treasury/payables/payables.routes.ts` (inserir após a rota `bulk-category`, que termina na ~linha 163, antes da rota `:id` na ~linha 165)

- [ ] **Step 1: Add the route**

Em `apps/api/src/modules/treasury/payables/payables.routes.ts`, imediatamente após o bloco da rota `bulk-category` (fecho `})` ~linha 163) e antes de `fastify.patch(\`${prefix}/:id\`, ...)`, inserir:

```ts
  fastify.patch(`${prefix}/bulk-status`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { ids, status } = request.body as { ids: string[]; status: 'PAID' | 'SETTLED' | 'OPEN' | 'VOID' }
    if (!Array.isArray(ids) || ids.length === 0) return reply.status(400).send({ message: 'Nenhum documento selecionado' })
    if (!['PAID', 'SETTLED', 'OPEN', 'VOID'].includes(status)) return reply.status(400).send({ message: 'Estado inválido' })
    return reply.send(await svc.bulkSetStatus(clientId, request.user.sub, ids, status))
  })
```

> Nota: tem de ficar **antes** da rota `${prefix}/:id` para que `bulk-status` não seja capturado como um `:id`.

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/treasury/payables/payables.routes.ts
git commit -m "feat(payables): rota PATCH /bulk-status"
```

---

## Task 3: Backend — `bulkSetStatus` + rota em Contas a Receber (espelho)

**Files:**
- Create: `apps/api/src/modules/treasury/receivables/receivables.service.test.ts`
- Modify: `apps/api/src/modules/treasury/receivables/receivables.service.ts` (após `bulkSetCategory`, ~linha 735)
- Modify: `apps/api/src/modules/treasury/receivables/receivables.routes.ts` (após rota `bulk-category`, ~linha 183, antes de `:id` ~linha 185)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/treasury/receivables/receivables.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { TreasuryReceivablesService } from './receivables.service.js'

function makeService() {
  return new TreasuryReceivablesService({} as never, {} as never, {} as never)
}

describe('bulkSetStatus', () => {
  it('despacha cada estado para o método por-documento correspondente', async () => {
    const svc = makeService()
    const pay = vi.spyOn(svc, 'pay').mockResolvedValue(undefined as never)
    const settle = vi.spyOn(svc, 'settle').mockResolvedValue(undefined as never)
    const unsettle = vi.spyOn(svc, 'unsettle').mockResolvedValue(undefined as never)
    const voidFn = vi.spyOn(svc, 'void').mockResolvedValue(undefined as never)

    await svc.bulkSetStatus('c1', 'u1', ['a', 'b'], 'PAID')
    expect(pay).toHaveBeenCalledTimes(2)
    expect(pay).toHaveBeenCalledWith('c1', 'u1', 'a')

    await svc.bulkSetStatus('c1', 'u1', ['c'], 'SETTLED')
    expect(settle).toHaveBeenCalledWith('c1', 'u1', 'c')

    await svc.bulkSetStatus('c1', 'u1', ['d'], 'OPEN')
    expect(unsettle).toHaveBeenCalledWith('c1', 'u1', 'd')

    await svc.bulkSetStatus('c1', 'u1', ['e'], 'VOID')
    expect(voidFn).toHaveBeenCalledWith('c1', 'u1', 'e')
  })

  it('é resiliente: um documento que falha não aborta os restantes', async () => {
    const svc = makeService()
    vi.spyOn(svc, 'pay')
      .mockRejectedValueOnce(new Error('Already paid'))
      .mockResolvedValueOnce(undefined as never)

    const res = await svc.bulkSetStatus('c1', 'u1', ['bad', 'good'], 'PAID')
    expect(res).toEqual({ updated: 1, failed: 1, errors: [{ id: 'bad', error: 'Already paid' }] })
  })
})
```

> Verificar o nome real da classe exportada (`TreasuryReceivablesService`) e o número de argumentos do construtor no topo de `receivables.service.ts`; se o construtor tiver um número diferente de dependências, ajustar os `{} as never` em conformidade.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/modules/treasury/receivables/receivables.service.test.ts`
Expected: FAIL — `bulkSetStatus is not a function`.

- [ ] **Step 3: Add the service method**

Em `apps/api/src/modules/treasury/receivables/receivables.service.ts`, logo após o fecho de `bulkSetCategory`, inserir:

```ts
  /** Atribuição de estado em massa. Despacha cada documento para o método
   *  por-documento correspondente (`pay`/`settle`/`unsettle`/`void`), herdando
   *  todas as regras de negócio, cascatas às parcelas e auditoria. Resiliente:
   *  documentos que não possam transitar (ex.: liquidar fatura TOConline, anular
   *  já liquidado) são apanhados e não abortam os restantes. */
  async bulkSetStatus(clientId: string, userId: string, ids: string[], status: 'PAID' | 'SETTLED' | 'OPEN' | 'VOID') {
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        if (status === 'PAID') await this.pay(clientId, userId, id)
        else if (status === 'SETTLED') await this.settle(clientId, userId, id)
        else if (status === 'OPEN') await this.unsettle(clientId, userId, id)
        else await this.void(clientId, userId, id)
        updated++
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { updated, failed: errors.length, errors }
  }
```

- [ ] **Step 4: Add the route**

Em `apps/api/src/modules/treasury/receivables/receivables.routes.ts`, após o bloco da rota `bulk-category` (~linha 183) e antes de `fastify.patch(\`${prefix}/:id\`, ...)`:

```ts
  fastify.patch(`${prefix}/bulk-status`, { onRequest: auth }, async (request, reply) => {
    const { clientId } = request.params as { clientId: string }
    const { ids, status } = request.body as { ids: string[]; status: 'PAID' | 'SETTLED' | 'OPEN' | 'VOID' }
    if (!Array.isArray(ids) || ids.length === 0) return reply.status(400).send({ message: 'Nenhum documento selecionado' })
    if (!['PAID', 'SETTLED', 'OPEN', 'VOID'].includes(status)) return reply.status(400).send({ message: 'Estado inválido' })
    return reply.send(await svc.bulkSetStatus(clientId, request.user.sub, ids, status))
  })
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd apps/api && npx vitest run src/modules/treasury/receivables/receivables.service.test.ts && npx tsc --noEmit`
Expected: testes PASS e sem erros de tipos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/treasury/receivables/receivables.service.ts apps/api/src/modules/treasury/receivables/receivables.service.test.ts apps/api/src/modules/treasury/receivables/receivables.routes.ts
git commit -m "feat(receivables): bulkSetStatus + rota PATCH /bulk-status"
```

---

## Task 4: Frontend — estado em massa em `PayablesPage.tsx`

**Files:**
- Modify: `apps/web/src/pages/PayablesPage.tsx`

Não há infraestrutura de testes no `apps/web`; a verificação é por `tsc` e manual.

- [ ] **Step 1: Add the `bulkStatus` state**

Em `apps/web/src/pages/PayablesPage.tsx`, junto à linha `const [bulkCategoryId, setBulkCategoryId] = useState('')` (~linha 326), adicionar logo a seguir:

```tsx
  const [bulkStatus, setBulkStatus] = useState('')
```

- [ ] **Step 2: Add the `bulkStatusMut` mutation**

Imediatamente após o bloco da mutação `bulkCategory` (que termina em `onError: (e) => toast.error((e as Error).message),\n  })`, ~linha 522, adicionar:

```tsx
  const bulkStatusMut = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/payables/bulk-status`, { ids, status }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      toast.success(res.failed > 0
        ? `Estado aplicado a ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `Estado aplicado a ${res.updated} documento(s).`)
      setSelectedIds(new Set()); setBulkStatus('')
    },
    onError: (e) => toast.error((e as Error).message),
  })
```

- [ ] **Step 3: Clear `bulkStatus` together with `bulkCategoryId`**

Na linha do `useEffect` (~linha 544):

```tsx
  useEffect(() => { setSelectedIds(new Set()); setBulkCategoryId('') }, [activeTab, outrasSubTab, page])
```

substituir por:

```tsx
  useEffect(() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkStatus('') }, [activeTab, outrasSubTab, page])
```

- [ ] **Step 4: Add the status selector + Apply button + clear in the bulk bar**

Em `renderBulkBar` (~linhas 785-801), substituir o botão "Limpar seleção" existente:

```tsx
      <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedIds(new Set()); setBulkCategoryId('') }}>Limpar seleção</button>
```

por (seletor de estado + Aplicar, e limpar também `bulkStatus`):

```tsx
      <select className="input w-auto text-sm py-1" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
        <option value="">Atribuir estado…</option>
        <option value="PAID">Pago</option>
        <option value="SETTLED">Liquidado</option>
        <option value="OPEN">Reverter p/ Em aberto</option>
        <option value="VOID">Anulado</option>
      </select>
      <button
        className="btn-primary text-sm py-1.5 px-3"
        disabled={!bulkStatus || bulkStatusMut.isPending}
        onClick={() => bulkStatusMut.mutate({ ids: [...selectedIds], status: bulkStatus })}
      >
        {bulkStatusMut.isPending ? 'A aplicar…' : 'Aplicar'}
      </button>
      <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkStatus('') }}>Limpar seleção</button>
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/PayablesPage.tsx
git commit -m "feat(web): atribuição de estado em massa em Contas a Pagar"
```

---

## Task 5: Frontend — estado em massa em `ReceivablesPage.tsx` (espelho)

**Files:**
- Modify: `apps/web/src/pages/ReceivablesPage.tsx`

- [ ] **Step 1: Add the `bulkStatus` state**

Junto a `const [bulkCategoryId, setBulkCategoryId] = useState('')` (~linha 336), adicionar:

```tsx
  const [bulkStatus, setBulkStatus] = useState('')
```

- [ ] **Step 2: Add the `bulkStatusMut` mutation**

Após o bloco da mutação `bulkCategory` (termina ~linha 555), adicionar:

```tsx
  const bulkStatusMut = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/receivables/bulk-status`, { ids, status }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      toast.success(res.failed > 0
        ? `Estado aplicado a ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `Estado aplicado a ${res.updated} documento(s).`)
      setSelectedIds(new Set()); setBulkStatus('')
    },
    onError: (e) => toast.error((e as Error).message),
  })
```

- [ ] **Step 3: Clear `bulkStatus` together with `bulkCategoryId`**

Na linha do `useEffect` (~linha 577):

```tsx
  useEffect(() => { setSelectedIds(new Set()); setBulkCategoryId('') }, [activeTab, outrasSubTab, page])
```

substituir por:

```tsx
  useEffect(() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkStatus('') }, [activeTab, outrasSubTab, page])
```

- [ ] **Step 4: Add the status selector + Apply button + clear in the bulk bar**

Em `renderBulkBar` (~linhas 886-902), substituir o botão "Limpar seleção" existente:

```tsx
      <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedIds(new Set()); setBulkCategoryId('') }}>Limpar seleção</button>
```

por:

```tsx
      <select className="input w-auto text-sm py-1" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
        <option value="">Atribuir estado…</option>
        <option value="PAID">Pago</option>
        <option value="SETTLED">Liquidado</option>
        <option value="OPEN">Reverter p/ Em aberto</option>
        <option value="VOID">Anulado</option>
      </select>
      <button
        className="btn-primary text-sm py-1.5 px-3"
        disabled={!bulkStatus || bulkStatusMut.isPending}
        onClick={() => bulkStatusMut.mutate({ ids: [...selectedIds], status: bulkStatus })}
      >
        {bulkStatusMut.isPending ? 'A aplicar…' : 'Aplicar'}
      </button>
      <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkStatus('') }}>Limpar seleção</button>
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ReceivablesPage.tsx
git commit -m "feat(web): atribuição de estado em massa em Contas a Receber"
```

---

## Verificação manual final (após Task 5)

1. Arrancar API e web (`npm run dev` em cada app).
2. Em **Contas a Pagar → Fornecedores**, selecionar 2-3 faturas TOC, escolher **Liquidado**, Aplicar → toast deve indicar 0 aplicados (liquidação TOC é gerida pelo TOConline); escolher **Pago** → toast deve indicar os aplicados com sucesso.
3. Em **Outras Operações**, selecionar documentos locais em aberto, aplicar **Pago** e depois **Reverter p/ Em aberto** → estados mudam e a lista/KPIs atualizam.
4. Selecionar um documento já Liquidado e aplicar **Anulado** → contabilizado como falha (anular liquidado é bloqueado).
5. Repetir o fluxo equivalente em **Contas a Receber**.
6. Confirmar que o seletor de **categoria** continua a funcionar lado a lado e que trocar de separador/página limpa a seleção e ambos os seletores.
