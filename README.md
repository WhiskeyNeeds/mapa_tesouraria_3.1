# Mapa de Tesouraria v3

## Dizem que à terceira é de vez

- Próximo passo: Conquistar o mundo (ou pelo menos terminar o projeto de estágio)

# Mapa Tesouraria

> Serviço monorepo para gestão de tesouraria (API + Web). Conteúdo em Português.

**Descrição:**
- Backend em Node.js + Fastify + Prisma.
- Frontend em React + Vite + TypeScript.

**Estrutura do repositório**
- `apps/api/` — código da API, Prisma, scripts de seed e migrações.
- `apps/web/` — app frontend em Vite/React.

**Requisitos**
- Node.js 18+ (recomendado).
- PostgreSQL (ou outro suportado pelo Prisma) — variável `DATABASE_URL`.
- Redis (opcional, usado por plugins) — variável `REDIS_URL`.
- Ferramentas: `npm` (ou `pnpm`/`yarn` compatíveis com workspaces).

**Instalação**
1. Instalar dependências no root (workspaces):

```
npm install
```

2. Variáveis de ambiente: criar um ficheiro `.env` na raiz do `apps/api` (ex.: `apps/api/.env`) com pelo menos:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
REDIS_URL=redis://localhost:6379
JWT_SECRET=uma_chave_secreta
RESEND_API_KEY=xxxxx
AWS_S3_BUCKET=nome-bucket
NODE_ENV=development
PORT=4000
```

Adapte conforme necessário (ver `apps/api/prisma/schema.prisma` para detalhes do `DATABASE_URL`).

**Comandos úteis (root)**
- Iniciar ambos (API + Web) em desenvolvimento:

```
npm run dev
```

- Iniciar só a API:

```
npm run dev:api
```

- Iniciar só o Web:

```
npm run dev:web
```

- Build de produção (API + Web):

```
npm run build
```

**Comandos (apps/api)**
- Iniciar em dev (tsx watch): `npm run dev` (executar em `apps/api`).
- Build TypeScript: `npm run build`.
- Testes: `npm run test` / `npm run test:watch`.
- Prisma: `npm run db:generate`, `npm run db:migrate`, `npm run db:migrate:prod`, `npm run db:seed`, `npm run db:studio`.

Exemplos (a partir da raiz usando workspaces):

```
npm run db:migrate
npm run db:seed
```

**Comandos (apps/web)**
- Desenvolvimento: `npm run dev` (executar em `apps/web` ou `npm run dev:web` na raiz).
- Build: `npm run build`.
- Preview: `npm run preview`.

**Banco de dados / Prisma**
- Migrations estão em `apps/api/prisma/migrations/`.
- O seed local está em `apps/api/prisma/seed.ts` e existe um script `apps/api/seed.ts` usado para testes.

**Testes**
- A API usa `vitest`. Execute em `apps/api`:

```
npm run test --workspace=apps/api
```

**Deployment (resumo)**
- Buildar a API (`npm run build` em `apps/api`) e servir `dist/server.js`.
- Buildar o frontend (`npm run build` em `apps/web`) e servir os ficheiros estáticos.
- Aplicar migrations em produção com `prisma migrate deploy` (script: `db:migrate:prod`).

**Contribuição**
- Ver `CONTRIBUTING.md` para fluxo de trabalho, estilos e PRs.

**Contacto / Suporte**
- Colocar issues no repositório com o template apropriado.

---
Gerado para uso interno — adapte as secções de `env` e `deploy` conforme o ambiente de produção.