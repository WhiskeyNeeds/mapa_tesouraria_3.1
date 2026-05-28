# TOConline Local Mirror — Design Spec

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Sincronizar dados TOConline para a nossa base de dados local, eliminando chamadas on-demand e resolvendo permanentemente os erros 429 por rate-limiting.

**Motivação:** Chamadas concorrentes à API TOConline (entity-sub-docs + entity-payment-timing) causam 429 Too Many Requests. A solução definitiva é manter um espelho local actualizado em background, e todas as queries consultam a nossa BD em vez da API TOConline directamente.

---

## Âmbito

**Incluído (v1):**
- Sincronização de dados de **leitura** — sem POST/PATCH/DELETE ao TOConline neste âmbito
- Dados transaccionais: documentos de venda/compra, recibos de venda, pagamentos de compra
- Dados mestre: clientes, fornecedores, produtos, serviços
- Scheduler em-processo (setInterval no servidor Fastify)
- Trigger manual via endpoint + botão no frontend

**Excluído (v1):**
- Write-through (criar/editar entidades em TOConline e reflectir imediatamente)
- Sync incremental (delta) — v1 usa upsert completo
- Multi-instância / job queue distribuída (pg-boss)

---

## Modelo de Dados

### Tabelas de entidades sincronizadas

Todas as tabelas partilham o padrão:
- `id` — UUID primary key local
- `clientId` — FK para `clients`
- `tocId` — ID inteiro do TOConline
- `raw` — JSONB com o objeto completo retornado pela API
- `syncedAt` — timestamp do último sync que escreveu este registo
- Índice único em `(clientId, tocId)`

#### `toc_customers`
```
tocId         Int
clientId      String
name          String
nif           String?
email         String?
phone         String?
raw           Json
syncedAt      DateTime
```

#### `toc_suppliers`
```
tocId         Int
clientId      String
name          String
nif           String?
email         String?
phone         String?
raw           Json
syncedAt      DateTime
```

#### `toc_products`
```
tocId         Int
clientId      String
name          String
unitPrice     Float?
taxRate       Float?
raw           Json
syncedAt      DateTime
```

#### `toc_services`
```
tocId         Int
clientId      String
name          String
unitPrice     Float?
taxRate       Float?
raw           Json
syncedAt      DateTime
```

#### `toc_sales_documents`
```
tocId         Int
clientId      String
customerId    Int?         -- filter[customer_id] do TOConline
date          String?      -- "YYYY-MM-DD"
dueDate       String?
status        Int?         -- 1=rascunho, 2=finalizado, 3=liquidado, 4=anulado
grossTotal    Float?
pendingTotal  Float?
receiptsIds   Int[]        -- IDs dos recibos associados
raw           Json
syncedAt      DateTime
```

#### `toc_purchase_documents`
```
tocId         Int
clientId      String
supplierId    Int?
date          String?
dueDate       String?
status        Int?
grossTotal    Float?
pendingTotal  Float?
paymentsIds   Int[]
raw           Json
syncedAt      DateTime
```

#### `toc_sales_receipts`
```
tocId         Int
clientId      String
customerId    Int?
date          String?
grossTotal    Float?
raw           Json
syncedAt      DateTime
```

#### `toc_purchase_payments`
```
tocId         Int
clientId      String
supplierId    Int?
date          String?
grossTotal    Float?
raw           Json
syncedAt      DateTime
```

### Tabela de controlo de sync

#### `toc_sync_state`
```
id            String        @id @default(uuid())
clientId      String
entityType    String        -- "customers" | "suppliers" | "products" | "services"
                            --   | "salesDocuments" | "purchaseDocuments"
                            --   | "salesReceipts" | "purchasePayments"
lastSyncAt    DateTime?
lastError     String?
recordCount   Int?

@@unique([clientId, entityType])
```

---

## Arquitectura do Scheduler

### Ficheiros novos

```
apps/api/src/lib/toc-sync/
  scheduler.ts        — regista e gere os loops por cliente
  sync-client.ts      — orquestra o sync completo de 1 cliente
  sync-entities.ts    — funções de sync por tipo de entidade
```

### Arranque

1. Hook `fastify.addHook('onReady', ...)` em `src/app.ts`
2. Lê `toconlineConfig` onde `status = 'ACTIVE'`
3. Para cada cliente activo, inicia dois timers independentes:

| Loop | Intervalo | Entidades |
|------|-----------|-----------|
| Transaccional | 5 min | `salesDocuments`, `purchaseDocuments`, `salesReceipts`, `purchasePayments` |
| Mestre | 30 min | `customers`, `suppliers`, `products`, `services` |

4. Ao arrancar, cada timer verifica `toc_sync_state.lastSyncAt` — se o último sync foi há menos do que o intervalo, aguarda o tempo restante antes de correr (evita re-sync desnecessário após deploy)

### Lógica de sync por entidade

```
1. Chamar ToconlineService.apiGetFlat(clientId, path) — já trata paginação
2. Para cada item, extrair campos normalizados + guardar raw completo
3. Prisma upsertMany por (clientId, tocId) — insert ou update
4. Actualizar toc_sync_state: lastSyncAt = now(), recordCount, lastError = null
5. Em caso de erro: guardar lastError, não relançar — loop continua no próximo ciclo
```

### Activação de novo cliente

Quando um cliente completa o OAuth callback (`handleCallback`), o scheduler regista-o imediatamente e dispara o primeiro sync completo em background.

---

## Camada API

### Endpoints existentes — implementação alterada (interface igual)

| Endpoint | Antes | Depois |
|----------|-------|--------|
| `GET /toconline/:clientId/entity-sub-docs` | N chamadas individuais à API TOConline | `prisma.tocSalesReceipt.findMany` / `tocPurchasePayment.findMany` |
| `GET /toconline/:clientId/entity-payment-timing` | Loop por doc com chamadas individuais | Query SQL sobre `toc_sales_documents` + `toc_sales_receipts` |
| `GET /toconline/:clientId/customers` (lista) | `apiGetFlat /api/customers` | `prisma.tocCustomer.findMany` |
| `GET /toconline/:clientId/suppliers` (lista) | `apiGetFlat /api/suppliers` | `prisma.tocSupplier.findMany` |

### Endpoints novos

**`POST /toconline/:clientId/sync`**
- Requer autenticação + acesso ao cliente
- Corre sync completo imediatamente (fora do ciclo)
- Resposta: `{ syncedAt: string, counts: { customers: N, salesDocuments: N, ... } }`

**`GET /toconline/:clientId/sync-status`**
- Devolve estado por entidade: `{ entityType, lastSyncAt, lastError, recordCount }[]`
- Usado pelo frontend para mostrar "última actualização"

### Estado vazio (primeiro acesso)

Se `toc_sync_state` não tem registo para o cliente, o endpoint:
1. Devolve `{ syncing: true, data: [] }`
2. Dispara primeiro sync em background
3. O frontend mostra skeleton com "A sincronizar dados TOConline…"

---

## Frontend

As alterações são mínimas — os endpoints mantêm a mesma interface.

### Componente `TocSyncStatus`

Aparece nas páginas que consomem dados TOConline (EmpresaPage, EntityDetailPage):
- Texto "Actualizado há X min" com base em `lastSyncAt` (query a `sync-status`)
- Botão "↻ Actualizar" que chama `POST /sync` e invalida as queries TanStack afectadas (`['toc-customers', clientId]`, `['toc-supplier-docs', ...]`, etc.)
- Se `syncing: true`, mostra skeleton com mensagem em vez de tabela vazia

### Settings page (`/definicoes`)

Painel com estado detalhado por entidade: última sync, nº de registos, erro se existir.

### Sem outras alterações

Os `useQuery` hooks existentes continuam a apontar para os mesmos endpoints — a mudança é transparente para o resto do frontend.

---

## Tratamento de Erros

| Cenário | Comportamento |
|---------|---------------|
| TOConline offline durante sync | Guarda `lastError`, mantém dados anteriores, tenta no próximo ciclo |
| Token expirado | `tryRefreshToken` corre normalmente; se falhar, regista erro e para o sync desse cliente |
| Primeiro acesso sem sync | Devolve `{ syncing: true, data: [] }`, dispara sync em background |
| Sync manual falhado | Devolve HTTP 502 com detalhe do erro |
| Cliente desactiva TOConline | `revokeConfig` cancela os timers e remove os dados `toc_*` desse cliente |

---

## Decisões de Design

- **v1 sem write-through** — criação/edição de documentos no TOConline continua a usar `ToconlineService` directamente; o espelho local reflecte no próximo ciclo de 5 min
- **Upsert completo** (não incremental) — todos os registos são upserted a cada ciclo; sem delta tracking na v1
- **setInterval em-processo** — sem pg-boss na v1; migração possível sem alterar a interface
- **Campos normalizados mínimos** — apenas os campos usados em filtros e cálculos; tudo o resto em `raw`
