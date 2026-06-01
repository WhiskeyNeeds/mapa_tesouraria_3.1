# Deploy do Mapa de Tesouraria V3 no Dokploy

**Data:** 2026-06-01
**Servidor alvo:** Dokploy self-hosted (já instalado e a correr)
**Domínio:** `*.mapa.ricardodomingos.eu`

---

## 1. Objectivo

Colocar o monorepo `Mapa de Tesouraria V3` (API Fastify + frontend React) em produção num servidor Dokploy, com HTTPS automático, base de dados e Redis geridos pelo próprio Dokploy, e auto-deploy a partir do GitHub.

Não inclui: configuração inicial do Dokploy (já feita), aprovisionamento do servidor, monitorização avançada.

---

## 2. Decisões tomadas no brainstorming

| Tema | Escolha | Razão |
|---|---|---|
| Servidor | Dokploy já instalado | Brainstorming Q1 |
| BD + Redis | Dentro do Dokploy | Brainstorming Q2 — simples, sem custos extra |
| Método de build | Dockerfiles dedicados | Brainstorming Q3 — controlo total, builds mais rápidos |
| Frontend serving | Container nginx separado | Brainstorming Q4 — subdomínios distintos para web e API |
| Domínios | `app.*` + `api.*` | Brainstorming Q5 — separação clara, certificados automáticos |
| Fonte do código | GitHub auto-deploy | Brainstorming Q6 — push para `main` re-deploya |
| Storage | **Nenhum** | Confirmado: imports de Excel/PDF processam em memória e gravam só na BD. `@aws-sdk/client-s3` está nas deps mas nunca é importado. |
| Email | SMTP genérico (não Resend) | Brainstorming Q+ — flexível para qualquer provider |

---

## 3. Arquitectura

```
                Traefik (Dokploy + Let's Encrypt)
                   │                   │
          app.mapa.ricardodomingos.eu   api.mapa.ricardodomingos.eu
                   │                   │
            ┌──────▼──────┐     ┌──────▼──────┐
            │   web       │     │    api      │
            │ nginx+React │     │  Fastify    │
            │ (static)    │     │  Node 20    │
            └─────────────┘     └──┬───────┬──┘
                                   │       │
                          ┌────────▼─┐  ┌──▼─────┐
                          │ postgres │  │ redis  │
                          │ (volume) │  │(volume)│
                          └──────────┘  └────────┘
```

- **4 serviços Dokploy** num projeto `mapa-tesouraria`.
- Postgres e Redis **sem domínio público** — só acessíveis dentro da rede Docker do projeto.
- API e Web expostos via Traefik com HTTPS Let's Encrypt automático.
- Auto-deploy on push para `main` em ambos os serviços de app.

---

## 4. Componentes

### 4.1 `mapa-postgres`
- Imagem: PostgreSQL 16 (template Dokploy).
- Database: `mapa_tesouraria`, user `mapa`, password gerada pelo Dokploy.
- Volume persistente em `/var/lib/postgresql/data`.
- Sem porta externa. Hostname interno: `mapa-postgres`.
- Backups diários activados via Dokploy.

### 4.2 `mapa-redis`
- Imagem: Redis 7 (template Dokploy).
- `--appendonly yes` para persistência.
- Volume em `/data`.
- Sem porta externa. Hostname interno: `mapa-redis`.

### 4.3 `mapa-api`
- Source: GitHub `WhiskeyNeeds/mapa_tesouraria_3.1`, branch `main`.
- Build: `Dockerfile` em `apps/api/Dockerfile`, context = raiz do repo.
- Domínio: `api.mapa.ricardodomingos.eu` → porta `3001`, HTTPS.
- Auto-deploy on push.
- Entrypoint corre `prisma migrate deploy` antes de iniciar o servidor.

**Dockerfile (multi-stage):**

1. **deps** — `node:20-alpine`, copia `package.json` da raiz + `apps/api/package.json` + `package-lock.json`, corre `npm ci` (com devDeps para compilar TS).
2. **build** — copia todo o repo, corre `npx prisma generate` e `npx tsc` em `apps/api` → produz `dist/`.
3. **runtime** — `node:20-alpine` slim, copia `dist/`, `prisma/` e `node_modules` apenas de produção (`npm ci --omit=dev`). Entrypoint: `npx prisma migrate deploy && node dist/server.js`. Expõe `3001`.

### 4.4 `mapa-web`
- Source: GitHub, mesmo repo, branch `main`.
- Build: `Dockerfile` em `apps/web/Dockerfile`, context = raiz.
- Build Arg: `VITE_API_URL=https://api.mapa.ricardodomingos.eu`.
- Domínio: `app.mapa.ricardodomingos.eu` → porta `80`, HTTPS.
- Auto-deploy on push.

**Dockerfile (multi-stage):**

1. **build** — `node:20-alpine`, instala deps, recebe `VITE_API_URL` como `ARG`, corre `npm run build` em `apps/web` → `dist/`.
2. **runtime** — `nginx:alpine`, copia `dist/` para `/usr/share/nginx/html` e o `apps/web/nginx.conf` para `/etc/nginx/conf.d/default.conf`. Expõe `80`.

**`apps/web/nginx.conf` (essencial):**
- `root /usr/share/nginx/html`, `index index.html`
- `try_files $uri $uri/ /index.html` (SPA fallback)
- Gzip activo para tipos comuns
- `Cache-Control: public, max-age=31536000, immutable` em `/assets/*`
- `Cache-Control: no-cache` em `index.html`

### 4.5 Ficheiros auxiliares
- `apps/api/.dockerignore` e `apps/web/.dockerignore` excluem `node_modules`, `dist`, `.env`, `.git`, `*.log`.

---

## 5. Variáveis de ambiente

### 5.1 `mapa-api` (Environment)

```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://mapa:<password-do-postgres>@mapa-postgres:5432/mapa_tesouraria
REDIS_URL=redis://mapa-redis:6379
JWT_SECRET=<openssl rand -hex 32>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
ENCRYPTION_KEY=<openssl rand -hex 32>
FRONTEND_URL=https://app.mapa.ricardodomingos.eu
API_URL=https://api.mapa.ricardodomingos.eu

EMAIL_PROVIDER=smtp
SMTP_HOST=<host SMTP>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<utilizador SMTP>
SMTP_PASS=<password SMTP>
EMAIL_FROM=Mapa Tesouraria <no-reply@mapa.ricardodomingos.eu>
ADMIN_EMAILS=
```

Notas:
- `JWT_SECRET` e `ENCRYPTION_KEY` gerados na hora com `openssl rand -hex 32` (32 bytes hex = 64 chars).
- `SMTP_*` dependem do provider escolhido (Gmail, Mailgun, etc.). Para Gmail, usar App Password (não a password normal da conta).

### 5.2 `mapa-web` (Build Arguments — não Environment)

```
VITE_API_URL=https://api.mapa.ricardodomingos.eu
```

Tem de ser **Build Argument** porque o Vite inlina o valor no bundle JS no momento do build. Se for definido como runtime env, fica `undefined` no browser.

### 5.3 `mapa-postgres` / `mapa-redis`
- Configurados via UI Dokploy (templates oficiais). User/password/database geridos pelo painel.

---

## 6. Email

O código em `apps/api/src/plugins/email.ts` suporta dois providers via `EMAIL_PROVIDER`:
- `smtp` (escolhido) → usa `nodemailer` com `SMTP_HOST/PORT/SECURE/USER/PASS`.
- `resend` → não usado neste deploy.

Usos da função `sendEmail`:
- `auth.service.ts` — reset de password.
- `treasury/followups/followups.service.ts` — envio de lembretes a clientes.
- `treasury/dunning-rules/dunning-rules.service.ts` — cobrança automática.

Sem configuração SMTP válida, os 3 fluxos falham silenciosamente (a função devolve `{ success: false }`). Não bloqueia o resto da app, mas tem de ser configurado para uso real.

---

## 7. Migrations e seeds

- **Migrations:** `prisma migrate deploy` no entrypoint do container API. Idempotente — só aplica o que falta. Em caso de erro de migration, o container falha o arranque (Dokploy mostra logs com o erro).
- **Seed em produção:** **não** corre automaticamente. O seed actual (`apps/api/prisma/seed.ts`) é para dev. Se for preciso criar utilizador admin inicial, fazer manualmente uma vez via "Run Command" do Dokploy no container API:
  ```
  npx tsx prisma/seed.ts
  ```
  Ou criar um `seed-prod.ts` dedicado (fora do âmbito deste spec).

---

## 8. Plano de execução (passo-a-passo)

### Fase A — Pré-requisitos (utilizador)
- [x] DNS wildcard `*.mapa.ricardodomingos.eu` → IP do servidor (já confirmado pelo utilizador)
- [x] Dokploy acessível e portas 80/443 abertas

### Fase B — Preparação do código (Claude)
1. Criar `apps/api/Dockerfile` (multi-stage).
2. Criar `apps/api/.dockerignore`.
3. Criar `apps/web/Dockerfile` (multi-stage).
4. Criar `apps/web/nginx.conf`.
5. Criar `apps/web/.dockerignore`.
6. Testar build local de ambos os Dockerfiles (`docker build`) se Docker estiver disponível.
7. Commit "feat(deploy): Dockerfiles para API e Web" e push para `main`.

### Fase C — Configuração no Dokploy (utilizador, com guia do Claude)

Por ordem:

1. **Criar projecto** `mapa-tesouraria`.
2. **Postgres**: `+ Add Service` → Database → PostgreSQL 16; nome `mapa-postgres`, user `mapa`, db `mapa_tesouraria`, password gerada. Sem porta externa. Volume persistente. Deploy → esperar Running.
3. **Redis**: `+ Add Service` → Database → Redis 7; nome `mapa-redis`. Sem porta externa. Volume persistente. Deploy → esperar Running.
4. **API**:
   - `+ Add Service` → Application → GitHub → repo + branch `main`.
   - Build: Dockerfile `apps/api/Dockerfile`, context `.`.
   - Environment: bloco completo da secção 5.1.
   - Domínio: `api.mapa.ricardodomingos.eu` → port `3001`, HTTPS.
   - Auto Deploy: On.
   - Deploy → confirmar nos logs `Server listening on 0.0.0.0:3001`.
5. **Web**:
   - `+ Add Service` → Application → GitHub → mesmo repo, branch `main`.
   - Build: Dockerfile `apps/web/Dockerfile`, context `.`.
   - Build Arguments: `VITE_API_URL=https://api.mapa.ricardodomingos.eu`.
   - Domínio: `app.mapa.ricardodomingos.eu` → port `80`, HTTPS.
   - Auto Deploy: On.
   - Deploy → confirmar build completo.

### Fase D — Verificação (smoke test)
1. `https://app.mapa.ricardodomingos.eu` carrega com cadeado HTTPS válido.
2. `https://api.mapa.ricardodomingos.eu/health` responde 200 com `{ status: 'ok', ts: ... }` (rota definida em `apps/api/src/server.ts:95`).
3. Login funcional. Pedidos no DevTools vão para `api.mapa....` com 200.
4. (Se SMTP configurado) reset de password chega ao inbox.
5. Push trivial para `main` → ambos os serviços re-deployam automaticamente.

---

## 9. Pontos de atenção

- **`VITE_API_URL` é build-time, não runtime.** Se mudares o domínio da API, tens de fazer rebuild do web.
- **Migrations falhadas bloqueiam o arranque da API.** O container reinicia em loop. Vai aos logs e resolve a migration antes de continuar.
- **Postgres password no `DATABASE_URL`.** Sempre que rodares a password do Postgres no Dokploy, tens de actualizar o `DATABASE_URL` na API.
- **`@aws-sdk/client-s3` é dependência morta.** Pode ser removida do `package.json` no futuro (limpeza, fora deste spec).
- **`@fastify/multipart` limits.** Se houver imports de ficheiros grandes (Excel grande, PDF), poderá ser preciso configurar o limite do multipart (env `MULTIPART_LIMIT` ou ajuste no plugin). Avaliar caso a caso depois do deploy.
- **Wildcard SSL.** O Traefik do Dokploy emite um certificado por subdomínio (não wildcard). Funciona, mas se um dia tiveres 20+ subdomínios pode valer a pena DNS-01 com wildcard.

---

## 10. Out of scope

- Monitorização (Sentry, logs centralizados).
- CI tests pré-deploy.
- Staging environment (só produção).
- Backups off-site (Dokploy guarda no próprio servidor).
- CDN.
- Limites de rate / WAF.

Estes podem ser specs futuros separados.
