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
