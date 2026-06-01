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
