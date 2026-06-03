# Atribuição de estado em massa — Design

**Data:** 2026-06-03
**Âmbito:** Contas a Pagar e Contas a Receber (backend + frontend)

## Contexto

A plataforma já permite **atribuir categoria em massa** a documentos de tesouraria
selecionados na página visível (`bulk-category` / `bulkSetCategory`), presente em
pagar e receber. As transições de **estado**, porém, só existem por documento
individual (`pay`, `settle`, `unsettle`, `void`).

Confirmado por pesquisa que **não existe** qualquer atribuição de estado em massa
(`bulk-status` / `bulkSetStatus` sem resultados em `apps/`).

Objetivo: replicar o padrão da atribuição de categoria em massa, mas para o
**estado** do documento, ao lado do seletor de categoria já existente na barra de
seleção.

## Decisões (validadas com o utilizador)

- **Estados suportados:** Pago (PAID), Liquidado (SETTLED), Reverter para Em aberto
  (OPEN), Anulado (VOID) — os quatro.
- **Páginas:** ambas (Contas a Pagar e Contas a Receber), para consistência com a
  atribuição de categoria.
- **UI:** seletor de categoria e seletor de estado **lado a lado** na barra de
  seleção, cada um com o seu próprio botão "Aplicar". O seletor de categoria
  mantém-se inalterado.

## Backend

Espelha a estrutura de `bulkSetCategory`, que é resiliente e reaproveita o método
por-documento (resolução do id local, validação, cascata às parcelas,
`syncParentStatus`, auditoria).

### `bulkSetStatus(clientId, userId, ids, status)`

Adicionado a `payables.service.ts` e `receivables.service.ts`.

```
async bulkSetStatus(clientId, userId, ids: string[], status: 'PAID' | 'SETTLED' | 'OPEN' | 'VOID') {
  let updated = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const id of ids) {
    try {
      if (status === 'PAID')    await this.pay(clientId, userId, id)
      else if (status === 'SETTLED') await this.settle(clientId, userId, id)
      else if (status === 'OPEN')    await this.unsettle(clientId, userId, id)
      else if (status === 'VOID')    await this.void(clientId, userId, id)
      updated++
    } catch (err) {
      errors.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { updated, failed: errors.length, errors }
}
```

Não há regras de negócio novas: cada método por-documento já valida o que pode ou
não transitar. Documentos que não possam transitar são apanhados no `catch` e
contabilizados em `failed`.

### Rota `PATCH ${prefix}/bulk-status`

Adicionada a `payables.routes.ts` e `receivables.routes.ts`, antes da rota
`:id` (tal como `bulk-category`):

```
fastify.patch(`${prefix}/bulk-status`, { onRequest: auth }, async (request, reply) => {
  const { clientId } = request.params
  const { ids, status } = request.body
  if (!Array.isArray(ids) || ids.length === 0) return reply.status(400).send({ message: 'Nenhum documento selecionado' })
  if (!['PAID', 'SETTLED', 'OPEN', 'VOID'].includes(status)) return reply.status(400).send({ message: 'Estado inválido' })
  return reply.send(await svc.bulkSetStatus(clientId, request.user.sub, ids, status))
})
```

## Frontend

`PayablesPage.tsx` e `ReceivablesPage.tsx` (simétricos: mesma `renderBulkBar`,
estado `selectedIds`, `bulkCategoryId`).

- Novo estado `const [bulkStatus, setBulkStatus] = useState('')`.
- Nova mutação `bulkStatusMut` → `PATCH /treasury/${clientId}/{payables|receivables}/bulk-status`,
  com `onSuccess` a invalidar as mesmas queries que `bulkCategory`, limpar
  seleção/`bulkStatus`, e toast a reportar `updated`/`failed`:
  - sucesso parcial: *"Estado aplicado a X de Y documentos (Z falharam)."*
  - sucesso total: *"Estado aplicado a X documento(s)."*
- Em `renderBulkBar`, após o bloco do seletor de categoria, acrescentar:
  - `<select>` "Atribuir estado…" com opções: Pago (`PAID`), Liquidado (`SETTLED`),
    Reverter p/ Em aberto (`OPEN`), Anulado (`VOID`).
  - Botão "Aplicar" próprio, `disabled` quando `!bulkStatus || bulkStatusMut.isPending`.
- Limpar `bulkStatus` nos mesmos pontos em que `bulkCategoryId` é limpo: o
  `useEffect` que reage a `[activeTab, outrasSubTab, page]` e o botão "Limpar seleção".

## Comportamento esperado (herdado dos métodos por-documento)

- Separador Fornecedores/Clientes (documentos TOConline): **Liquidado** falha para
  todos (liquidação gerida pelo recibo no TOConline) → toast indica 0 aplicados.
- **Pago** funciona em documentos TOConline.
- **Anular** falha em documentos já Liquidados.
- **Reverter** só atua em documentos Pagos/Liquidados.
- Cascata às parcelas e sincronização do estado da fatura-mãe são automáticas.

## Fora de âmbito

- Sem alterações de schema Prisma.
- Sem alterar a atribuição de categoria existente.
- Sem seleção entre páginas (a seleção continua por página visível, como hoje).
