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

Every authenticated request has `req.entityScope: 'SHOP' | 'FINANCE'` set by `EntityScopeMiddleware`.

Resolution order:
1. `?company=shop|finance` URL query (case-insensitive)
2. `x-company-scope: shop|finance` header
3. `user.primaryCompany` from JWT
4. Fallback `SHOP`

If the resolved scope is NOT in `user.accessibleCompanies`, request rejected with 403.

## Handler-level scope guard

For routes that are entity-specific, decorate the handler:

```typescript
@UseGuards(JwtAuthGuard, EntityScopeGuard)
@Entity('FINANCE')
@Get('contracts')
async getContracts(@Req() req: Request) {
  // req.entityScope === 'FINANCE' guaranteed here
}
```

A user without `FINANCE` in `accessibleCompanies` gets 403.

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

Existing users need `accessibleCompanies` + `primaryCompany` set per role:

```bash
cd apps/api && npm run backfill:user-companies
```

Mapping:
- OWNER, ACCOUNTANT → both SHOP + FINANCE
- FINANCE_MANAGER → FINANCE only
- BRANCH_MANAGER, SALES → SHOP only

## CI integration

GitHub Actions spins up both postgres services in the `lint-and-test` job. The finance container runs on port 5433. Finance migrations run after shop migrations. The `test:e2e` script then runs `apps/api/e2e/sp7-1-dual-prisma.e2e-spec.ts` which verifies both clients connect to distinct databases. See `.github/workflows/deploy-gcp.yml` (`lint-and-test` job, `postgres-finance` service + `Run dual-Prisma integration tests` step).

## Future work (SP7.2+)

- SP7.2: Outbox + Saga for cross-entity transactions
- SP7.3: Frontend pill switcher UI
- SP7.4-7.6: Entity-aware features (external commission, tax, reports)
- SP7.7: Data migration scripts (cutover Jan 1, 2027)
- SP7.10: Cutover playbook + rehearsals
