# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
# apps/web/package.json must be present so npm workspaces correctly resolves
# and hoists all workspace deps (including @nestjs/cli from apps/api devDeps)
COPY apps/web/package.json apps/web/
# apps/card-reader/package.json is required for `npm ci` to install the
# card-reader workspace's transitive deps. Card-reader is a local-only
# service not deployed to Cloud Run, but its `express: ^4.21.0` dependency
# is load-bearing for the Docker build: after the NestJS 11 bump,
# @nestjs/platform-express@11 pulls express@5 and npm nests it under
# node_modules/@nestjs/platform-express/node_modules/express. Without
# card-reader also present, there is no express at root node_modules,
# and `require('express')` from apps/api/dist/src/main.js fails at runtime
# with `Cannot find module 'express'`. Card-reader brings express@4.21.x
# to root node_modules, which main.js resolves via the standard walk.
COPY apps/card-reader/package.json apps/card-reader/
COPY packages/ packages/
# --include=dev: force devDeps even when NODE_ENV=production
RUN npm ci --include=dev

# ============================================
# Stage 2: Build API
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

# After Tier 1 npm update (commit 85598bd), the @nestjs/cli binary is
# fully hoisted to root node_modules/.bin/nest. apps/api/node_modules
# is no longer reliably created by `npm ci` in the deps stage — npm's
# flat hoisting has no reason to keep it when there are no version
# conflicts forcing local nested installs. Relying on root node_modules
# alone is sufficient: `npm run build` in apps/api picks up `nest` via
# the standard node_modules walk to the workspace root.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api ./apps/api
COPY packages ./packages
# Generate Prisma client + Build NestJS API
RUN cd apps/api && npx prisma generate && ../node_modules/.bin/nest build && npm run verify:assets

# ============================================
# Stage 3: Production Runtime
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install wget for health check
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

# Copy API build artifacts (use --chown for correct permissions)
# Runtime resolves all deps from root node_modules via workspace hoisting —
# no apps/api/node_modules copy needed (see builder stage comment).
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=appuser:appgroup /app/apps/api/package.json ./apps/api/
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/apps/api/prisma ./apps/api/prisma

# ⚠️ TEMPORARY: Legacy migration data — remove after migration done
COPY --chown=appuser:appgroup apps/api/scripts/import-legacy/data ./apps/api/scripts/import-legacy/data
COPY --chown=appuser:appgroup ["ข้อมูลโปรแกรมเขียว4-7-2026", "./ข้อมูลโปรแกรมเขียว4-7-2026"]

# Copy entrypoint script
COPY --chown=appuser:appgroup docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
