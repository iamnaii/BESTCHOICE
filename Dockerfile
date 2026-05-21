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
RUN cd apps/api && npx prisma generate && npm run build

# ============================================
# Stage 3: Production Runtime
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install wget (health check) + chromium (puppeteer PDF generation) + tzdata
# - Puppeteer-core has no bundled Chromium — must provide system one.
# - Chromium + minimal font/ca deps are needed for headless PDF rendering in
#   documents.service.ts::htmlToPdf. Thai fonts (TH Sarabun PSK) are base64
#   embedded at runtime from public/fonts/, so we only need ttf-freefont here
#   for fallback glyphs.
# - tzdata is REQUIRED for @nestjs/schedule timezone-bound crons
#   (e.g. OffsiteBackupCron at 03:30 Asia/Bangkok). Without it Alpine has no
#   IANA zoneinfo and the cron silently falls back to UTC — daily backup
#   would run at 10:30 BKK instead of the intended 03:30. We also force
#   process TZ for consistent log timestamps.
RUN apk add --no-cache \
      wget \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      tzdata
ENV TZ=Asia/Bangkok

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Create non-root user
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

# Copy API build artifacts (use --chown for correct permissions)
# Most workspace deps hoist to root /app/node_modules, but npm nests
# version-conflicting packages under apps/api/node_modules (e.g. node-forge
# v1.x conflicts with selfsigned's transitive ^0.10.0 pin → nested under
# apps/api). Without this copy, `require('node-forge')` from compiled
# dist/.../pkcs7-signer.js resolves to the wrong version OR fails outright
# (SP5 e-Tax XML hit this with revision 00633 crash at boot).
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=appuser:appgroup /app/apps/api/package.json ./apps/api/
# TH Sarabun PSK fonts are embedded into PDFs at runtime. htmlToPdf reads
# them from process.cwd()/public/fonts (and fallbacks); ensure they exist.
COPY --chown=appuser:appgroup apps/api/public ./public
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
# Workspace-nested deps (resolution conflicts) — see comment above.
COPY --from=deps --chown=appuser:appgroup /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/apps/api/prisma ./apps/api/prisma
# SP7.1 — finance Prisma client generated to apps/api/node_modules/@prisma/client-finance
# (per generator output="../node_modules/@prisma/client-finance" in prisma-finance/schema.prisma).
# Dep-stage copy at line 97 doesn't include generated client — must pull from builder explicitly.
COPY --from=builder --chown=appuser:appgroup /app/apps/api/node_modules/@prisma/client-finance ./apps/api/node_modules/@prisma/client-finance
COPY --from=builder --chown=appuser:appgroup /app/apps/api/prisma-finance ./apps/api/prisma-finance

# ⚠️ TEMPORARY: Legacy migration data — remove after migration done
COPY --chown=appuser:appgroup apps/api/scripts/import-legacy/data ./apps/api/scripts/import-legacy/data
# Note: the "ข้อมูลโปรแกรมเขียว4-7-2026" data dump was deleted from the repo in
# PR #1048 (build context no longer contains the folder, so the COPY would
# fail). The data lives in Cloud SQL now — no longer needed at build time.

# Copy entrypoint script
COPY --chown=appuser:appgroup docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
