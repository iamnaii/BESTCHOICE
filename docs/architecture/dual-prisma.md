# Dual Prisma Architecture (SP7.1)

## Overview

BESTCHOICE runs 2 Prisma clients in one NestJS process for the SHOP/FINANCE legal entity split (P3-SP7, cutover 1 Jan 2027).

| Client | DB | Purpose |
|---|---|---|
| `PrismaService` | bc_shop (installment_db) | Existing — SHOP-side data |
| `PrismaFinanceService` | bc_finance (installment_finance_db) | New — FINANCE-side data |

See `docs/superpowers/specs/2026-05-19-shop-finance-legal-split-design.md` for the full design.

## Why dual clients (not 1 DB w/ 2 schemas, not microservices)

- True isolation: backup/restore independent, sell FINANCE separately if needed.
- Single NestJS process keeps ops simple (1 codebase, 1 Cloud Run service).
- Cross-DB atomic TX impossible → outbox/saga pattern (SP7.2).

## Using both clients

Inject either or both — `PrismaModule` is `@Global()`:

```typescript
@Injectable()
export class MyService {
  constructor(
    private readonly prismaShop: PrismaService,
    private readonly prismaFin: PrismaFinanceService,
  ) {}
}
```

## Request entity scope

`req.entityScope: 'SHOP' | 'FINANCE' | undefined` is written by **`EntityScopeInterceptor`**
(`apps/api/src/interceptors/entity-scope.interceptor.ts`, registered as an `APP_INTERCEPTOR`).
`EntityScopeMiddleware` was deleted on 2026-09-10: middleware runs *before* every guard, so it saw
`req.user === undefined` on every request and `next()`-ed without ever checking anything. An
interceptor always runs after the per-controller `JwtAuthGuard`, so it sees the real principal.

Resolution order — **two steps only**:
1. `?company=shop|finance` URL query (case-insensitive)
2. `x-company-scope: shop|finance` header

Anything else — including a value that is neither `shop` nor `finance` — counts as *not specified*:
no check is performed and **`req.entityScope` is left `undefined`**. The old precedence steps
(`user.primaryCompany`, then a `SHOP` fallback) were dropped deliberately; do not reintroduce them.

Two more pass-throughs: a request with no `req.user` (public / `@Public()` / LIFF / webhook), and a
storefront customer principal (`aud === 'shop'` or `role === 'CUSTOMER'`), which carries no company
fields at all.

If a company IS named and is not in the caller's resolved access set, the request is rejected with
`ForbiddenException` (403). An **empty** `accessibleCompanies` array means "not configured yet" and
resolves to the role default via `resolveCompanyAccess()` — it is never a 403 on its own.

> The admin web sends `?company=` on **every** request (`apps/web/src/lib/api.ts`), so browser
> traffic does populate `req.entityScope`. Non-browser clients (curl, scripts, LIFF, webhooks)
> typically do not. Its only readers today are the three tax handlers in
> `apps/api/src/modules/tax/tax.controller.ts`.

## Handler-level scope guard

For routes that are entity-specific, decorate the handler:

```typescript
@UseGuards(JwtAuthGuard, EntityScopeGuard)
@Entity('FINANCE')
@Get('contracts')
async getContracts(@Req() req: Request) {
  // req.entityScope may be undefined here — @Entity() ENFORCES access, it does not
  // populate the scope. Only a request that named a company gets one.
}
```

`EntityScopeGuard` rejects with 403 when the caller's resolved access set lacks `FINANCE`, and
always rejects a storefront customer principal. A user whose `accessibleCompanies` is empty is NOT
rejected — the empty array resolves to their role default first.

## Migration management

| | Shop | Finance |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | `apps/api/prisma-finance/schema.prisma` |
| Migrations | `apps/api/prisma/migrations/` | `apps/api/prisma-finance/migrations/` |
| Generate | `npm run prisma:generate` | `npm run prisma:finance:generate` |
| Migrate dev | `npm run prisma:migrate` | `npm run prisma:finance:migrate:dev` |
| Migrate deploy | `npx prisma migrate deploy` | `npm run prisma:finance:migrate:deploy` |
| Studio | `npm run prisma:studio` | `npm run prisma:finance:studio` (port 5556) |

## Local dev setup

Two postgres containers via docker-compose:

```bash
docker-compose up -d postgres postgres-finance
```

`postgres` → 5432, `installment_db`; `postgres-finance` → 5433, `installment_finance_db`.

Env vars (see `.env.example`):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/installment_db?schema=public
DATABASE_URL_FINANCE=postgresql://postgres:postgres@localhost:5433/installment_finance_db?schema=public
```

## User backfill

Existing users need `accessibleCompanies` + `primaryCompany` set per role. An empty
`accessibleCompanies` means "not configured yet" — `resolveCompanyAccess()` resolves it to the
role default, so a missing backfill can never lock anyone out. The backfill only makes the stored
data match what the code already resolves.

The CLI is **dry-run by default** and refuses to run without `EXPECTED_DB_NAME`:

```bash
# dry-run — prints the per-role plan + samples, writes nothing
EXPECTED_DB_NAME=<db> npm --prefix apps/api run backfill:user-companies

# write for real
CONFIRM_BACKFILL=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
  [ALLOW_PROD_BACKFILL=YES_I_AM_SURE NODE_ENV=production] \
  npm --prefix apps/api run backfill:user-companies
```

Run it from the **repo root**, not `apps/api` (`npm --prefix` resolves against the cwd, so
`cd apps/api` first would look for `apps/api/apps/api`). The script runs `dist`, so build once
(`npm --prefix apps/api run build`) before running it locally.

Mapping — do **not** duplicate it here. The single source of truth is
`packages/shared/src/company-access.ts` (`ROLE_COMPANY_ACCESS`), shared by the CLI, `JwtStrategy`,
the entity-scope check and the web menu. A test pinned to the `UserRole` enum
(`apps/api/src/cli/backfill-user-companies.cli.spec.ts`) fails CI if a new role is added without an
entry.

Production procedure (backup → deploy check → dry-run → live → verify):
[`docs/runbooks/2026-09-10-user-companies-backfill-runbook.md`](../runbooks/2026-09-10-user-companies-backfill-runbook.md)

## CI integration

GitHub Actions spins up both postgres services in the `lint-and-test` job. The finance container runs on port 5433. Finance migrations run after shop migrations. The `test:e2e` script then runs `apps/api/e2e/sp7-1-dual-prisma.e2e-spec.ts` which verifies both clients connect to distinct databases. See `.github/workflows/deploy-gcp.yml` (`lint-and-test` job, `postgres-finance` service + `Run dual-Prisma integration tests` step).

## Future work (SP7.2+)

- SP7.2: Outbox + Saga for cross-entity transactions
- SP7.3: Frontend pill switcher UI
- SP7.4-7.6: Entity-aware features (external commission, tax, reports)
- SP7.7: Data migration scripts (cutover Jan 1, 2027)
- SP7.10: Cutover playbook + rehearsals
