# Budget Rules & Detail Panel — Design Spec

**Data:** 2026-05-27

---

## Objectivo

Redesenhar o sistema de budgets para:

1. **Eliminar `TreasuryBudgetCategory`** — as categorias de budget eram uma entidade autónoma separada das categorias de movimentos. Passam a ser a mesma coisa: `TreasuryCategory`.
2. **Introduzir regras de associação** — em vez de o utilizador associar manualmente cada transação a um budget, define regras do tipo "Categoria X → Budget Y" ou "Categoria X + texto 'Meo' → Budget Y".
3. **Painel de detalhe** — ao clicar num budget, abre um painel lateral com transações, regras e pendentes de revisão.

---

## 1. Modelo de Dados

### 1.1 O que se remove

| Entidade | Motivo |
|---|---|
| `TreasuryBudgetCategory` | Substituída por `TreasuryCategory` (categorias de movimentos) |
| `TreasuryBudgetCategoryLink` | Substituída por `TreasuryBudgetRule` |
| `budgetCategoryId` em `TreasuryReceivable` | Eliminado — a associação faz-se por `budgetId` directo |
| `budgetCategoryId` em `TreasuryPayable` | Eliminado — idem |

### 1.2 O que se adiciona

#### `TreasuryBudgetRule`

```prisma
model TreasuryBudgetRule {
  id          String   @id @default(cuid())
  clientId    String
  budgetId    String
  categoryId  String
  textPattern String?  @db.VarChar(200)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  client   Client          @relation(fields: [clientId], references: [id], onDelete: Cascade)
  budget   TreasuryBudget  @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  category TreasuryCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([clientId, budgetId])
  @@index([clientId, categoryId])
}
```

- **`categoryId`** — obrigatório; aponta para `TreasuryCategory` (as mesmas categorias usadas para classificar movimentos bancários, faturas, etc.)
- **`textPattern`** — opcional; string case-insensitive que é testada contra a descrição da transação e o nome da contraparte (fornecedor / cliente)

#### Campo `budgetAutoAssigned` em `TreasuryReceivable` e `TreasuryPayable`

```prisma
budgetAutoAssigned Boolean @default(false)
```

Marcado `true` quando a associação ao budget foi feita automaticamente por uma regra (e não pelo utilizador). Permite identificar transações que precisam de revisão.

### 1.3 O que se mantém

- `TreasuryBudget` — sem alterações estruturais
- `budgetId` em `TreasuryReceivable` e `TreasuryPayable` — mantém-se como associação directa opcional

---

## 2. Lógica de Resolução de Regras

Quando uma transação (payable ou receivable) é criada ou importada:

1. Recolhe todas as `TreasuryBudgetRule` do cliente cujo `categoryId` coincide com o `categoryId` da transação.
2. Divide em dois grupos:
   - **Específicas**: regras com `textPattern` não nulo — verificar se o padrão aparece (case-insensitive) na descrição da transação OU no nome da contraparte.
   - **Gerais**: regras sem `textPattern`.
3. **Prioridade**: regras específicas têm prioridade sobre gerais. Se existir pelo menos uma específica que corresponda, ignora as gerais.
4. Em caso de empate dentro do mesmo grupo (múltiplas regras com o mesmo nível de especificidade), prevalece a criada mais recentemente (`createdAt DESC`).
5. **Associação manual sobrepõe sempre qualquer regra** — se o utilizador definiu `budgetId` explicitamente, não é substituído.

---

## 3. Comportamento por Contexto de Criação

### 3.1 Formulário manual (Contas a Pagar / Contas a Receber)

Quando o utilizador selecciona uma **categoria** no formulário:

1. O frontend chama um endpoint `GET /treasury/:clientId/budget-rules/suggest?categoryId=X&text=Y` (ou inclui na resposta do formulário).
2. Se houver correspondência de regra, mostra uma caixa de sugestão:
   - Nome do budget sugerido
   - Regra que originou a sugestão (ex: "Telecomunicações + 'Meo'")
   - Botões: **Aceitar** (preenche o campo budget) / **Ignorar** (fecha a sugestão, campo budget fica vazio)
3. O utilizador pode aceitar, ignorar, ou escolher manualmente outro budget no dropdown.
4. A transação é criada com `budgetAutoAssigned = false` (foi o utilizador a decidir).

### 3.2 Importação TOConline (sync automático)

Quando um documento é importado via TOConline:

1. O serviço corre a lógica de resolução de regras (secção 2).
2. Se houver correspondência, associa `budgetId` à transação e define `budgetAutoAssigned = true`.
3. A transação aparece na tab **"Para rever"** do painel do budget com badge de contagem.
4. O utilizador pode:
   - **Confirmar** — mantém a associação, define `budgetAutoAssigned = false`
   - **Mover para...** — escolhe outro budget, define `budgetAutoAssigned = false`
   - **Remover** — limpa `budgetId`, define `budgetAutoAssigned = false`

---

## 4. UI — Página de Budgets com Painel Lateral

### 4.1 Lista de budgets (lado esquerdo)

- Mantém o layout actual (cards com progress bar, filtros por tipo e arquivados)
- Badge amarelo no card quando `budgetAutoAssigned = true` em transações associadas (ex: "2 para rever")
- Clicar no card (fora dos botões de acção) abre o painel lateral

### 4.2 Painel lateral (lado direito)

Abre sem navegação, à direita da lista. Fecha com botão ✕ ou clicando fora.

**Header do painel:**
- Nome do budget, datas, tipo (Despesa/Receita)
- Botões editar e eliminar
- Progress bar: segmento azul escuro (Pago) + azul claro (Previsto) + cinzento (Disponível)
- Legenda: Pago · Previsto · Disponível / Excedido (vermelho se overrun)

**3 Tabs:**

#### Tab 1 — Transações
- Lista de `TreasuryPayable` / `TreasuryReceivable` com `budgetId = este budget`
- Colunas: contraparte · categoria · data · valor · estado (badge: Pago / Pendente / Previsto / Anulado)
- Filtra por estado (toggle)
- Link para abrir o documento

#### Tab 2 — Regras
- Lista compacta das `TreasuryBudgetRule` deste budget
- Cada regra mostra: chip da categoria + chip do textPattern (se existir) + botões editar/eliminar
- Tooltip explica o nível de especificidade
- Formulário inline "Nova regra": dropdown de categoria + input de texto opcional + botão Guardar

#### Tab 3 — Para rever
- Filtra transações deste budget com `budgetAutoAssigned = true`
- Badge com contagem na tab (ex: "Para rever 2")
- Cada item mostra: contraparte · valor · data · regra que originou a associação
- Acções por item: **Confirmar** · **Mover para...** (dropdown de budgets) · **Remover** (✕)
- Botão global "Confirmar todas (N)" no fundo

---

## 5. UI — Definições → Regras de Budget

Nova tab em Definições (ao lado de "Regras de Classificação"):

**"Regras de Budget"**

Tabela global com todas as regras de todos os budgets do cliente:

| Budget | Categoria | Filtro de texto | Acções |
|---|---|---|---|
| Energias | Telecomunicações | "Meo" | ✏️ 🗑️ |
| Energias | Energia | — | ✏️ 🗑️ |
| Marketing | Publicidade | — | ✏️ 🗑️ |

- Botão "+ Nova regra" abre modal com: dropdown de budget + dropdown de categoria + input de texto opcional
- Nota informativa: "Regras com filtro de texto têm prioridade sobre regras só por categoria."

---

## 6. API — Novos Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/treasury/:clientId/budget-rules` | Lista todas as regras do cliente |
| POST | `/treasury/:clientId/budget-rules` | Criar regra |
| PATCH | `/treasury/:clientId/budget-rules/:id` | Editar regra |
| DELETE | `/treasury/:clientId/budget-rules/:id` | Eliminar regra |
| GET | `/treasury/:clientId/budget-rules/suggest` | Sugerir budget para uma transação (query: `categoryId`, `text`) |

Endpoints de budgets modificados:
- `GET /treasury/:clientId/budgets` — inclui contagem de `budgetAutoAssigned` por budget (para badge no card)
- `GET /treasury/:clientId/budgets/:id` — inclui `rules`, transações associadas, e transações com `budgetAutoAssigned = true`

As acções de "Confirmar / Mover / Remover" na tab "Para rever" usam os endpoints PATCH existentes de receivables/payables com os campos `budgetId` e `budgetAutoAssigned`:
- Confirmar → `PATCH .../receivables/:id` com `{ budgetAutoAssigned: false }`
- Mover → `PATCH .../receivables/:id` com `{ budgetId: outroId, budgetAutoAssigned: false }`
- Remover → `PATCH .../receivables/:id` com `{ budgetId: null, budgetAutoAssigned: false }`

---

## 7. Migração de Dados

1. Criar tabela `treasury_budget_rules`
2. Adicionar coluna `budget_auto_assigned` em `treasury_receivables` e `treasury_payables`
3. Remover coluna `budget_category_id` de `treasury_receivables` e `treasury_payables`
4. Drop tabela `treasury_budget_category_links`
5. Drop tabela `treasury_budget_categories`

Os `budgetId` existentes em receivables/payables mantêm-se — apenas a lógica de categorias de budget é substituída.

---

## 8. Fora de Âmbito (YAGNI)

- Alertas automáticos quando budget é excedido
- Relatórios / analytics de budget
- Clone de budget
- Export PDF/CSV
- Regras baseadas em valor (ex: "transações > 1000€")
- Regras baseadas em contraparte específica (sem ser por texto livre)
