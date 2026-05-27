# Entity Detail Page — Design Spec

## Goal

Criar uma página de detalhe por fornecedor/cliente que agrega: dados TOConline, historial de faturas locais, e configurações de categoria automática.

## Architecture

Abordagem 1: página própria com rota dedicada (`/empresa/fornecedores/:id`, `/empresa/clientes/:id`), nova tabela `TreasuryEntityConfig` no Prisma, novos endpoints REST, e integração nos serviços de criação de payables/receivables para auto-aplicar a categoria default.

**Tech Stack:** React + React Router, TanStack Query, Prisma, Fastify, PostgreSQL.

---

## 1. Data Model

### Nova tabela: `TreasuryEntityConfig`

```prisma
model TreasuryEntityConfig {
  id                String            @id @default(cuid())
  clientId          String
  entityType        String            // "supplier" | "customer"
  tocEntityId       String            // ID do fornecedor/cliente no TOConline
  defaultCategoryId String?
  category          TreasuryCategory? @relation(fields: [defaultCategoryId], references: [id])
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@unique([clientId, entityType, tocEntityId])
  @@map("treasury_entity_configs")
}
```

- `entityType` é `"supplier"` (fornecedores) ou `"customer"` (clientes).
- `tocEntityId` é o ID numérico da entidade no TOConline (guardado como string).
- `defaultCategoryId` é opcional — a config pode existir sem categoria (para extensões futuras).
- A unicidade em `(clientId, entityType, tocEntityId)` garante no máximo uma config por entidade por cliente.
- Relação com `TreasuryCategory` valida que a categoria existe; a categoria deve ser `EXPENSE` para fornecedores e `REVENUE` para clientes (validado na camada de serviço).
- No modelo `TreasuryCategory` do schema Prisma é necessário adicionar `entityConfigs TreasuryEntityConfig[]` para a relação inversa.

### Migração Prisma

Ficheiro: `apps/api/prisma/migrations/20260527000000_treasury_entity_configs/migration.sql`

```sql
CREATE TABLE "treasury_entity_configs" (
  "id"                TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "entityType"        TEXT NOT NULL,
  "tocEntityId"       TEXT NOT NULL,
  "defaultCategoryId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "treasury_entity_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_entity_configs_clientId_entityType_tocEntityId_key"
    UNIQUE ("clientId", "entityType", "tocEntityId"),
  CONSTRAINT "treasury_entity_configs_defaultCategoryId_fkey"
    FOREIGN KEY ("defaultCategoryId") REFERENCES "treasury_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);
```

---

## 2. Backend API

### Novo módulo: `entity-configs`

**Ficheiros:**
- `apps/api/src/modules/treasury/entity-configs/entity-configs.service.ts`
- `apps/api/src/modules/treasury/entity-configs/entity-configs.routes.ts`

### Endpoints

| Método   | Rota                                                              | Descrição                         |
|----------|-------------------------------------------------------------------|-----------------------------------|
| `GET`    | `/treasury/:clientId/entity-configs/:type/:tocId`                 | Buscar config (null se não existe) |
| `PUT`    | `/treasury/:clientId/entity-configs/:type/:tocId`                 | Upsert — cria ou actualiza         |
| `DELETE` | `/treasury/:clientId/entity-configs/:type/:tocId`                 | Remove a config                    |

**PUT body:**
```json
{ "defaultCategoryId": "cat_xxx" }
```

**Validações no serviço:**
- `type` deve ser `"supplier"` ou `"customer"`.
- Se `defaultCategoryId` fornecido: verificar que a categoria existe para o `clientId` e que o tipo é compatível (`EXPENSE` para supplier, `REVENUE` para customer).

**Registo no router principal** (`apps/api/src/index.ts` ou equivalente): registar `entityConfigsRoutes` junto dos outros módulos treasury.

### Auto-categoria na criação de payables/receivables

**`payables.service.ts` — método `create()`:**

Após resolver `categoryId` mas antes do `prisma.treasuryPayable.create()`:

```typescript
// Se não há categoryId e há tocSupplierId, tentar aplicar config de entidade
if (!resolvedCategoryId && data.tocSupplierId) {
  const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({
    where: {
      clientId_entityType_tocEntityId: {
        clientId,
        entityType: 'supplier',
        tocEntityId: String(data.tocSupplierId),
      },
    },
    select: { defaultCategoryId: true },
  })
  if (entityConfig?.defaultCategoryId) {
    resolvedCategoryId = entityConfig.defaultCategoryId
  }
}
```

**`receivables.service.ts` — método `create()`:** lógica simétrica com `entityType: 'customer'` e `data.tocCustomerId`.

**`payables.service.ts` — método `update()` (para "Associar a Fatura TOC"):**

Quando `tocPurchasesDocId` é definido e o payable ainda não tem `categoryId`:

```typescript
if (data.tocPurchasesDocId && !item.categoryId && data.tocSupplierId) {
  const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({ ... })
  if (entityConfig?.defaultCategoryId) {
    updateData.category = { connect: { id: entityConfig.defaultCategoryId } }
  }
}
```

---

## 3. Frontend

### Novas rotas

Em `apps/web/src/App.tsx`, dentro das rotas autenticadas:

```tsx
<Route path="/empresa/fornecedores/:tocId" element={<EntityDetailPage entityType="supplier" />} />
<Route path="/empresa/clientes/:tocId"     element={<EntityDetailPage entityType="customer" />} />
```

### Novo ficheiro: `apps/web/src/pages/EntityDetailPage.tsx`

**Props:**
```typescript
interface Props {
  entityType: 'supplier' | 'customer'
}
```

**Parâmetro de rota:** `tocId` (string, ID da entidade no TOConline).

**Queries TanStack:**

| queryKey | Endpoint | Descrição |
|----------|----------|-----------|
| `['toc-supplier-detail', clientId, tocId]` | `GET /toconline/:clientId/suppliers/:tocId` | Dados TOC da entidade |
| `['payables', clientId, ..., tocSupplierId]` | `GET /treasury/:clientId/payables?tocSupplierId=:tocId&limit=500` | Faturas locais (supplier) |
| `['receivables', clientId, ..., tocCustomerId]` | `GET /treasury/:clientId/receivables?tocCustomerId=:tocId&limit=500` | Faturas locais (customer) |
| `['entity-config', clientId, entityType, tocId]` | `GET /treasury/:clientId/entity-configs/:type/:tocId` | Config da entidade |
| `['categories', clientId]` | já em cache | Categorias disponíveis |

**Layout (componente principal):**

```
┌─────────────────────────────────────────────────────────┐
│ ← Fornecedores  /  EDP Comercial, S.A.      NIF: 502…  │  ← breadcrumb header
├──────────────────────────────┬──────────────────────────┤
│  [Atuais (3)] [Histórico (14)]│  KPIs                    │
│                               │  ─────────────────────   │
│  Tabela de faturas            │  Dados TOConline         │
│  - FC 2025/044  1.240€ Atraso │  (read-only + btn editar)│
│  - FC 2025/038  1.180€ Parcial│  ─────────────────────   │
│  - ...                        │  Configurações           │
│                               │  Categoria automática    │
│                               │  [Eletricidade ▼]        │
└──────────────────────────────┴──────────────────────────┘
```

**Separação das faturas em tabs:**
- **Atuais:** `status` in `['OPEN', 'PARTIAL']`
- **Histórico:** `status` in `['SETTLED', 'VOID']`

**Secção de Configurações (painel direito):**
- `<select>` ou combobox para selecionar categoria (filtrado por tipo: EXPENSE para supplier, REVENUE para customer).
- Ao mudar: `PUT /treasury/:clientId/entity-configs/supplier/:tocId` com `{ defaultCategoryId }`.
- Opção "Sem categoria" limpa o campo (envia `PUT` com `{ defaultCategoryId: null }` → faz `disconnect` da categoria, a config fica sem categoria mas não é apagada).
- Mostra indicador visual quando guardado.

**Botão "Editar no TOC":** abre o `NovoRegistoModal` existente do `EmpresaPage` em modo de edição (`editRow = tocEntityData`). Reutiliza o modal sem duplicar código.

### Pontos de entrada na navegação

**1. EmpresaPage (`apps/web/src/pages/EmpresaPage.tsx`):**
- Linhas da tab "fornecedores" e "clientes" tornam-se clicáveis.
- Ao clicar numa linha: `navigate('/empresa/fornecedores/' + row.id)`.
- Adicionar ícone `Eye` ou `ChevronRight` na coluna de acções (onde já existe o botão "Nova Conta").

**2. PayablesPage (`apps/web/src/pages/PayablesPage.tsx`):**
- Na tabela "Fornecedores", coluna `entityName`: envolver o texto num `<button>` ou `<Link>` que navega para `/empresa/fornecedores/:tocSupplierId`.
- Apenas quando `p.tocSupplierId` está definido (TOC entity).

**3. ReceivablesPage (`apps/web/src/pages/ReceivablesPage.tsx`):**
- Mesma lógica para a coluna `entityName` com `tocCustomerId`.

---

## 4. Error Handling

- TOC entity não encontrada (404 do TOConline): mostrar banner de erro com botão "Voltar".
- Sem faturas locais: empty state "Ainda não há faturas registadas para este fornecedor."
- Falha ao guardar categoria: toast de erro, reverter estado optimista.

---

## 5. Out of Scope

- Edição directa dos dados TOC a partir desta página (usa o modal existente do EmpresaPage).
- Suporte a entidades sem `tocEntityId` (locais puras sem ID no TOConline) — ficam para uma iteração futura.
- Múltiplas regras por entidade (condicionais por palavras-chave) — opção C rejeitada conscientemente.
- Retroactividade da auto-categoria (não aplica a docs já existentes).
