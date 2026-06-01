# Dokploy Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar os artefactos de Docker (`Dockerfile`s, `nginx.conf`, `.dockerignore`s) no monorepo, validá-los localmente com `docker build`/`docker run`, e fazer push para `main` para que o Dokploy possa fazer deploy.

**Architecture:** Dois Dockerfiles multi-stage independentes em `apps/api/` e `apps/web/`, ambos com build context = raiz do monorepo (necessário para o `package-lock.json` da raiz e workspaces npm). O frontend é servido por `nginx:alpine` com SPA fallback e cache de assets. A API tem entrypoint que corre `prisma migrate deploy → prisma seed → node dist/server.js`.

**Tech Stack:** Docker multi-stage, Node 20 alpine, nginx alpine, npm workspaces, Prisma, tsx (para seed em runtime).

**Spec:** [docs/superpowers/specs/2026-06-01-dokploy-deploy-design.md](../specs/2026-06-01-dokploy-deploy-design.md)

---

## File Structure

| Ficheiro | Responsabilidade |
|---|---|
| `apps/api/Dockerfile` | Build multi-stage da API (deps → build TS + prisma generate → runtime com tsx para seed) |
| `apps/api/.dockerignore` | Excluir `node_modules`, `dist`, `.env`, etc. do build context |
| `apps/web/Dockerfile` | Build multi-stage do frontend (build Vite → nginx alpine) |
| `apps/web/nginx.conf` | Config nginx (SPA fallback, gzip, cache de assets) |
| `apps/web/.dockerignore` | Excluir `node_modules`, `dist`, etc. |

Cinco ficheiros novos, **nenhum** ficheiro de código modificado. Tudo é stateless deploy infra.

**Validação:** não há testes unitários para Dockerfiles. A validação é fazer `docker build` local e `docker run` para confirmar que cada imagem arranca sem erros estruturais (mesmo sem BD/Redis a correr — basta ver que o processo inicia e tenta ligar-se).

**Pré-requisitos no ambiente:**
- Docker funcional (confirmado: Docker version 29.4.0).
- Estar na raiz do repo: `d:\BizzPm\Projetos\Software\Mapa de Tesouraria V3\`.

---

## Task 1: `.dockerignore` para a API

**Files:**
- Create: `apps/api/.dockerignore`

- [ ] **Step 1: Criar `apps/api/.dockerignore`**

```
node_modules
dist
.env
.env.*
*.log
.git
.gitignore
.vscode
.idea
coverage
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/.dockerignore
git commit -m "build(api): adiciona .dockerignore"
```

---

## Task 2: Dockerfile da API

**Files:**
- Create: `apps/api/Dockerfile`

Notas importantes ANTES de escrever o ficheiro:
- O build context vai ser a **raiz do monorepo** (não `apps/api/`), porque precisamos do `package-lock.json` da raiz e dos `package.json` dos workspaces para o `npm ci` funcionar.
- O `prisma generate` corre durante o build para gerar o cliente em `node_modules/.prisma/client`.
- O runtime precisa de `tsx` porque o seed está em TypeScript e corre via `npx tsx prisma/seed.ts`.
- Em vez de fazer `npm ci --omit=dev` no runtime (que removeria `tsx` e o `@prisma/client` regenerado), **copiamos o `node_modules` completo do stage de build**. Mais simples e fiável para a primeira versão; pode optimizar-se depois.

- [ ] **Step 1: Criar `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# ─── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy root + ALL workspace manifests (root package.json has "workspaces":
# ["apps/*"], so npm needs every workspace package.json present to resolve).
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci -w apps/api

# ─── Stage 2: build ────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# Copy api source
COPY apps/api ./apps/api

# Generate Prisma client and compile TypeScript
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w apps/api

# ─── Stage 3: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copy installed node_modules (root and workspace) from build stage.
# We keep dev deps because we need `tsx` to run the seed at boot.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules

# Copy package.json files (needed for npm workspace resolution at runtime)
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

# Copy compiled output and prisma schema/migrations/seed
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/server.js"]
```

- [ ] **Step 2: Build local para validar**

Run (a partir da raiz do repo):
```bash
docker build -f apps/api/Dockerfile -t mapa-api:test .
```

Expected: build termina com `Successfully tagged mapa-api:test` (ou equivalente no buildkit moderno: `naming to docker.io/library/mapa-api:test done`). Sem erros de TypeScript nem do Prisma.

Se falhar em `npx prisma generate`, confirmar que `apps/api/prisma/schema.prisma` foi copiado (estamos a copiar `apps/api` inteiro em build stage). Se falhar em `tsc`, ler o erro — normalmente é uma import path errada.

- [ ] **Step 3: Smoke test do container**

Run:
```bash
docker run --rm --name mapa-api-smoke -e DATABASE_URL="postgresql://x:y@127.0.0.1:1/none" -e REDIS_URL="redis://127.0.0.1:1" -e JWT_SECRET=test -e ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 -e FRONTEND_URL=http://localhost -e API_URL=http://localhost mapa-api:test
```

Expected: o container arranca, corre `npx prisma migrate deploy` e **falha** ao ligar à BD (porque o `DATABASE_URL` aponta para um IP que não existe). Isto é OK — confirma que:
1. A imagem foi construída correctamente.
2. `prisma`, `tsx` e o `dist/server.js` estão presentes no caminho certo.
3. O entrypoint corre.

O erro esperado vai ser algo como `Can't reach database server at '127.0.0.1:1'`. Se o erro for `prisma: command not found` ou `Cannot find module ...`, a imagem tem um problema estrutural que tem de ser resolvido.

Carrega `Ctrl+C` para sair.

- [ ] **Step 4: Commit**

```bash
git add apps/api/Dockerfile
git commit -m "build(api): adiciona Dockerfile multi-stage"
```

---

## Task 3: `.dockerignore` para o Web

**Files:**
- Create: `apps/web/.dockerignore`

- [ ] **Step 1: Criar `apps/web/.dockerignore`**

```
node_modules
dist
.env
.env.*
*.log
.git
.gitignore
.vscode
.idea
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/.dockerignore
git commit -m "build(web): adiciona .dockerignore"
```

---

## Task 4: `nginx.conf` para o Web

**Files:**
- Create: `apps/web/nginx.conf`

- [ ] **Step 1: Criar `apps/web/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_min_length 256;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/json
        application/xml
        application/xml+rss
        image/svg+xml;

    # Long cache for fingerprinted Vite assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA fallback — never cache index.html
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/nginx.conf
git commit -m "build(web): adiciona nginx.conf com SPA fallback e cache"
```

---

## Task 5: Dockerfile do Web

**Files:**
- Create: `apps/web/Dockerfile`

Notas:
- Build context é a raiz do monorepo (igual à API), pelas mesmas razões.
- `VITE_API_URL` é declarado como `ARG` e exposto via `ENV` antes do `npm run build` para o Vite o inlinar no bundle.

- [ ] **Step 1: Criar `apps/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# ─── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Copy root + ALL workspace manifests (see note in apps/api/Dockerfile).
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci -w apps/web

# Copy web source and build
COPY apps/web ./apps/web
RUN npm run build -w apps/web

# ─── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 2: Build local para validar**

Run (a partir da raiz do repo):
```bash
docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.mapa.ricardodomingos.eu -t mapa-web:test .
```

Expected: build termina com sucesso. Sem erros de TypeScript nem do Vite.

Se falhar em `tsc && vite build`, ler o output e corrigir. Se a build context não tiver o `apps/web/nginx.conf`, o stage 2 falha (`failed to compute cache key`). Confirmar que o ficheiro foi criado no Task 4.

- [ ] **Step 3: Smoke test do container**

Run:
```bash
docker run --rm -d --name mapa-web-smoke -p 8080:80 mapa-web:test
```

Depois (mesmo terminal ou outro):
```bash
curl -I http://localhost:8080
```

Expected: `HTTP/1.1 200 OK` com header `Content-Type: text/html`.

Testar SPA fallback:
```bash
curl -I http://localhost:8080/qualquer/rota/inexistente
```

Expected: `HTTP/1.1 200 OK` (não 404 — o nginx serve o `index.html` graças ao `try_files $uri $uri/ /index.html`).

Parar:
```bash
docker stop mapa-web-smoke
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "build(web): adiciona Dockerfile multi-stage com nginx"
```

---

## Task 6: Push para `main` e desencadear deploy

**Files:** —

- [ ] **Step 1: Verificar estado do git**

Run:
```bash
git log --oneline -6
git status
```

Expected: 5 commits novos no topo (`.dockerignore` x2, Dockerfile x2, nginx.conf x1), working tree clean.

- [ ] **Step 2: Push**

Run:
```bash
git push origin main
```

Expected: push aceite. Se o utilizador já tiver ligado o Dokploy ao repo com Auto Deploy On, os serviços `mapa-api` e `mapa-web` vão começar a re-build automaticamente assim que forem criados.

- [ ] **Step 3: Confirmar no GitHub**

Abrir https://github.com/WhiskeyNeeds/mapa_tesouraria_3.1/commits/main no browser e confirmar que os 5 commits aparecem.

---

## Pós-plano: handoff para Fase C (Dokploy UI)

Depois deste plano estar terminado, o código está pronto. O passo seguinte é o utilizador (com guia do Claude na conversa) executar a **Fase C** do spec (configuração no Dokploy):
1. Criar projeto `mapa-tesouraria`.
2. Criar `mapa-postgres` (Postgres 16).
3. Criar `mapa-redis` (Redis 7).
4. Criar `mapa-api` com source GitHub + Dockerfile `apps/api/Dockerfile` + envs da secção 5.1 do spec.
5. Criar `mapa-web` com source GitHub + Dockerfile `apps/web/Dockerfile` + build arg `VITE_API_URL`.

Esses passos não são automatizáveis a partir daqui — são clicks na UI do Dokploy.

---

## Notas de segurança / coisas a vigiar durante a execução

- **`npm ci -w apps/api`** com workspaces: na primeira vez pode tentar instalar deps do workspace `apps/web` também, dependendo da versão npm. Se isso acontecer, o stage `deps` fica desnecessariamente gordo mas funciona. Se for um problema (tempo de build > 5min), passamos a usar `npm install --omit=workspaces` ou copiamos só o que precisamos.
- **CRLF warnings no Windows:** `git commit` vai emitir avisos `LF will be replaced by CRLF`. Inofensivo, mas se o `nginx.conf` for criado com CRLF, o nginx no container pode reclamar (raro mas possível). Se acontecer, configurar `.gitattributes` para `*.conf text eol=lf` — só fazer se aparecer problema, não preemptivamente.
- **`prisma migrate deploy` em produção é destrutivo se as migrations forem destrutivas.** Como é versão de testes, OK. Em produção real, considerar pre-deploy review das migrations.
- **Seed corre a cada deploy.** O seed actual usa `upsert` (verificado nas primeiras linhas), por isso é idempotente — não duplica dados. Se for adicionada lógica não-idempotente ao seed no futuro, vai duplicar dados a cada re-deploy.
