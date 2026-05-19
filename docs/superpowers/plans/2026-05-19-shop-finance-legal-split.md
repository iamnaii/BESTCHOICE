# SHOP/FINANCE Legal Entity Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยก BESTCHOICE จาก 1 นิติบุคคล (single DB) → 2 นิติบุคคลแยก (2 DBs: bc_shop + bc_finance) cutover 1 ม.ค. 2027

**Architecture:** Single NestJS API w/ dual Prisma clients (PrismaService for shop + PrismaFinanceService for finance) + Outbox/Saga for cross-entity transactions. shared tables (users, audit, system config) live in bc_shop. NOT a microservice split.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL 15, Cloud SQL, React 18 + Vite (web), Playwright (E2E), Jest (API), Vitest (web), Docker Compose (CI/dev), GCP Cloud Run

**Design Spec:** [docs/superpowers/specs/2026-05-19-shop-finance-legal-split-design.md](../specs/2026-05-19-shop-finance-legal-split-design.md)

---

## 0. Sub-Project Roadmap (executive view)

ทั้ง 10 sub-projects ตามลำดับ. แต่ละ SP จะมี detailed plan แยก (เปิดก่อนเริ่ม SP)

| SP | Title | Effort | Phase | When | Predecessor |
|---|---|---|---|---|---|
| **7.1** | Dual Prisma Client Foundation | 2 wks | P-1 | มิ.ย. 2026 | — |
| **7.2** | Outbox + PairedJournalService | 2 wks | P-1 | มิ.ย.-ก.ค. 2026 | 7.1 |
| **7.3** | Auth/RBAC Cross-Entity | 1 wk | P-1 | ก.ค. 2026 | 7.1 |
| **7.4** | ExternalFinanceCompany + Commission | 1 wk | P-2 | ส.ค. 2026 (parallel 7.5) | 7.1, 7.3 |
| **7.5** | Per-Entity Tax Filing | 2 wks | P-2 | ส.ค. 2026 (parallel 7.4) | 7.1, 7.3 |
| **7.6** | Consolidated Reports | 1 wk | P-2 | ก.ย. 2026 | 7.5 |
| **7.7** | Data Audit + Migration Scripts | 2 wks | P-3 | ก.ย.-ต.ค. 2026 | 7.1-7.6 |
| **7.8** | 2 LINE OAs + 2 Backup Pipelines | 1.5 wks | P-3 | ต.ค. 2026 | 7.1 |
| **7.9** | Year-End Closing (legacy entity) | 1 wk | P-4 | ธ.ค. 2026 | — |
| **7.10** | Cutover Playbook + Rehearsal + UAT | 1.5 wks | P-4 | พ.ย.-ธ.ค. 2026 | 7.7-7.9 |

**Critical path:** 7.1 → 7.2 → 7.7 → 7.10 → cutover (1 ม.ค. 2027)
**Parallelizable:** 7.4 || 7.5 (different domains); 7.8 || 7.10 prep

---

## 1. SP7.1 — Dual Prisma Client Foundation (DETAILED)

**Goal:** เพิ่ม Prisma client ที่ 2 ชี้ไปที่ `bc_finance` DB (ตอนนี้ว่างเปล่า). ทั้ง 2 PrismaService ทำงานควบคู่ใน NestJS process เดียว. User schema เพิ่ม `accessibleCompanies` + `primaryCompany`. JWT carry entity scope. EntityScope middleware/decorator พร้อมใช้

**ไม่กระทบ user**: live ยังใช้ PrismaService (bc_shop) ตามปกติ. bc_finance DB ว่างจนกว่า SP7.7 จะ migrate ข้อมูล

**File structure (new files):**
- `apps/api/prisma-finance/schema.prisma` — Prisma schema สำหรับ bc_finance
- `apps/api/prisma-finance/migrations/` — migration history แยกจาก bc_shop
- `apps/api/src/prisma/prisma-finance.service.ts` — NestJS provider
- `apps/api/src/middleware/entity-scope.middleware.ts` — request → entity
- `apps/api/src/decorators/entity.decorator.ts` — `@Entity('shop'|'finance')`
- `apps/api/src/guards/entity-scope.guard.ts` — 403 ถ้าไม่มีสิทธิ์
- `docs/architecture/dual-prisma.md` — architecture note

**File structure (modified):**
- `apps/api/prisma/schema.prisma` — User model: + `accessibleCompanies`, `primaryCompany`
- `apps/api/src/prisma/prisma.module.ts` — export ทั้ง 2 services
- `apps/api/src/modules/auth/auth.service.ts` — JWT payload เพิ่ม entity fields
- `apps/api/src/modules/auth/jwt.strategy.ts` — copy เข้า req.user
- `apps/api/src/types/express.d.ts` — เพิ่ม req.entityScope
- `apps/api/package.json` — เพิ่ม script `prisma:finance:*`
- `docker-compose.yml` — เพิ่ม postgres-finance service
- `.github/workflows/test.yml` — CI: spin up 2 postgres

---

### Task 1: เตรียม bc_finance Prisma schema + generator

**Files:**
- Create: `apps/api/prisma-finance/schema.prisma`
- Modify: `apps/api/package.json` (scripts)

- [ ] **Step 1: สร้าง schema เริ่มต้น**

สร้าง `apps/api/prisma-finance/schema.prisma`:

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "../node_modules/@prisma/client-finance"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL_FINANCE")
}

// Placeholder — ทดสอบว่า generator ทำงานก่อน schema จริง
// (SP7.7 จะ copy tables จาก bc_shop ที่ควรอยู่ใน bc_finance)
model HealthCheck {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())

  @@map("health_check")
}
```

- [ ] **Step 2: เพิ่ม npm scripts**

แก้ `apps/api/package.json` scripts block:

```json
{
  "scripts": {
    "prisma:finance:generate": "prisma generate --schema=prisma-finance/schema.prisma",
    "prisma:finance:migrate:dev": "prisma migrate dev --schema=prisma-finance/schema.prisma",
    "prisma:finance:migrate:deploy": "prisma migrate deploy --schema=prisma-finance/schema.prisma",
    "prisma:finance:studio": "prisma studio --schema=prisma-finance/schema.prisma --port 5556"
  }
}
```

- [ ] **Step 3: รัน generate**

```bash
cd apps/api && npm run prisma:finance:generate
```

Expected: `✔ Generated Prisma Client (v5.x.x) to ./node_modules/@prisma/client-finance`

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma-finance/schema.prisma apps/api/package.json
git commit -m "feat(sp7.1): add bc_finance Prisma schema + generator scripts"
```

---

### Task 2: Docker Compose service สำหรับ bc_finance

**Files:**
- Modify: `docker-compose.yml`
- Create: `apps/api/scripts/init-finance-db.sql` (optional — ตอนนี้ generate ผ่าน migration)

- [ ] **Step 1: เพิ่ม postgres-finance service**

แก้ `docker-compose.yml` (เพิ่มก่อน `volumes:`):

```yaml
  postgres-finance:
    image: postgres:15-alpine
    container_name: bestchoice-postgres-finance
    restart: unless-stopped
    environment:
      POSTGRES_USER: bestchoice
      POSTGRES_PASSWORD: bestchoice_dev_password
      POSTGRES_DB: bestchoice_finance
    ports:
      - '5433:5432'
    volumes:
      - postgres-finance-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U bestchoice -d bestchoice_finance']
      interval: 5s
      timeout: 5s
      retries: 5
```

และ volumes block เพิ่ม:

```yaml
volumes:
  postgres-data:
  postgres-finance-data:
```

- [ ] **Step 2: เพิ่ม env var เริ่มต้น**

แก้ `apps/api/.env.example`:

```env
DATABASE_URL="postgresql://bestchoice:bestchoice_dev_password@localhost:5432/bestchoice_dev"
DATABASE_URL_FINANCE="postgresql://bestchoice:bestchoice_dev_password@localhost:5433/bestchoice_finance"
```

- [ ] **Step 3: Spin up**

```bash
docker-compose up -d postgres-finance
docker-compose ps postgres-finance
```

Expected: `bestchoice-postgres-finance` Up + healthy

- [ ] **Step 4: รัน initial migration**

```bash
cd apps/api && npm run prisma:finance:migrate:dev -- --name init
```

Expected: HealthCheck table created in bestchoice_finance DB

- [ ] **Step 5: Verify connectivity**

```bash
psql postgresql://bestchoice:bestchoice_dev_password@localhost:5433/bestchoice_finance -c "\dt"
```

Expected: shows `health_check` table

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/api/.env.example apps/api/prisma-finance/migrations
git commit -m "feat(sp7.1): docker-compose postgres-finance + initial migration"
```

---

### Task 3: PrismaFinanceService NestJS provider

**Files:**
- Create: `apps/api/src/prisma/prisma-finance.service.ts`
- Create: `apps/api/src/prisma/prisma-finance.service.spec.ts`
- Modify: `apps/api/src/prisma/prisma.module.ts`

- [ ] **Step 1: Write failing test**

สร้าง `apps/api/src/prisma/prisma-finance.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaFinanceService } from './prisma-finance.service';

describe('PrismaFinanceService', () => {
  let service: PrismaFinanceService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaFinanceService],
    }).compile();

    service = module.get<PrismaFinanceService>(PrismaFinanceService);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('connects to bc_finance DB', async () => {
    const result = await service.$queryRaw<Array<{ now: Date }>>`SELECT NOW() as now`;
    expect(result[0].now).toBeInstanceOf(Date);
  });

  it('has access to healthCheck model', async () => {
    const created = await service.healthCheck.create({ data: {} });
    expect(created.id).toBeDefined();
    await service.healthCheck.delete({ where: { id: created.id } });
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
cd apps/api && npx jest src/prisma/prisma-finance.service.spec.ts
```

Expected: FAIL "Cannot find module './prisma-finance.service'"

- [ ] **Step 3: Implement service**

สร้าง `apps/api/src/prisma/prisma-finance.service.ts`:

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client-finance';

@Injectable()
export class PrismaFinanceService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaFinanceService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to bc_finance database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Run test → pass**

```bash
cd apps/api && npx jest src/prisma/prisma-finance.service.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Export from PrismaModule**

แก้ `apps/api/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PrismaFinanceService } from './prisma-finance.service';

@Global()
@Module({
  providers: [PrismaService, PrismaFinanceService],
  exports: [PrismaService, PrismaFinanceService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/prisma/prisma-finance.service.ts apps/api/src/prisma/prisma-finance.service.spec.ts apps/api/src/prisma/prisma.module.ts
git commit -m "feat(sp7.1): PrismaFinanceService + module export"
```

---

### Task 4: User schema — accessibleCompanies + primaryCompany

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (User model)
- Create: migration file (auto-generated)
- Modify: `apps/api/src/cli/backfill-user-companies.cli.ts` (new)

- [ ] **Step 1: เพิ่ม fields ใน User model**

แก้ `apps/api/prisma/schema.prisma` ที่ User model:

```prisma
model User {
  // ... existing fields ...
  
  /// SP7.1 — รายชื่อ companies ที่ user เข้าถึงได้
  /// OWNER/ACCOUNTANT = ["SHOP", "FINANCE"]; SALES/BM = ["SHOP"]; FM = ["FINANCE"]
  accessibleCompanies String[] @default([]) @map("accessible_companies")
  
  /// SP7.1 — Company context เริ่มต้นเมื่อ user login (default ใน pill switcher)
  primaryCompany      String?  @map("primary_company")
  
  // ... existing relations ...
}
```

- [ ] **Step 2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name sp7_1_user_accessible_companies
```

Expected: migration file สร้างใน `apps/api/prisma/migrations/YYYYMMDDHHMMSS_sp7_1_user_accessible_companies/`

- [ ] **Step 3: เขียน backfill CLI**

สร้าง `apps/api/src/cli/backfill-user-companies.cli.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '@nestjs/common';

const ROLE_ACCESS_MAP: Record<string, { accessible: string[]; primary: string }> = {
  OWNER:           { accessible: ['SHOP', 'FINANCE'], primary: 'SHOP' },
  ACCOUNTANT:      { accessible: ['SHOP', 'FINANCE'], primary: 'FINANCE' },
  FINANCE_MANAGER: { accessible: ['FINANCE'],         primary: 'FINANCE' },
  BRANCH_MANAGER:  { accessible: ['SHOP'],            primary: 'SHOP' },
  SALES:           { accessible: ['SHOP'],            primary: 'SHOP' },
};

async function main() {
  const logger = new Logger('BackfillUserCompanies');
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const users = await prisma.user.findMany({
    where: { accessibleCompanies: { equals: [] } },
    select: { id: true, email: true, role: true },
  });

  logger.log(`Backfilling ${users.length} users`);

  for (const user of users) {
    const access = ROLE_ACCESS_MAP[user.role] ?? { accessible: ['SHOP'], primary: 'SHOP' };
    await prisma.user.update({
      where: { id: user.id },
      data: {
        accessibleCompanies: access.accessible,
        primaryCompany: access.primary,
      },
    });
    logger.log(`${user.email} (${user.role}) → ${access.accessible.join(',')} primary=${access.primary}`);
  }

  await app.close();
  logger.log('Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: เพิ่ม npm script + run backfill**

แก้ `apps/api/package.json` scripts:

```json
"backfill:user-companies": "ts-node -r tsconfig-paths/register src/cli/backfill-user-companies.cli.ts"
```

รัน:

```bash
cd apps/api && npm run backfill:user-companies
```

Expected: log "Done" + ทุก user มี accessibleCompanies + primaryCompany set

- [ ] **Step 5: Test backfill**

สร้าง `apps/api/src/cli/backfill-user-companies.cli.spec.ts`:

```typescript
import { PrismaService } from '../prisma/prisma.service';
// ...

describe('backfill-user-companies', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    // setup test prisma w/ seed users in each role
  });

  it('assigns OWNER both SHOP and FINANCE', async () => {
    const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    expect(owner?.accessibleCompanies).toEqual(['SHOP', 'FINANCE']);
    expect(owner?.primaryCompany).toBe('SHOP');
  });

  it('assigns SALES only SHOP', async () => {
    const sales = await prisma.user.findFirst({ where: { role: 'SALES' } });
    expect(sales?.accessibleCompanies).toEqual(['SHOP']);
  });

  it('assigns FINANCE_MANAGER only FINANCE', async () => {
    const fm = await prisma.user.findFirst({ where: { role: 'FINANCE_MANAGER' } });
    expect(fm?.accessibleCompanies).toEqual(['FINANCE']);
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/cli/backfill-user-companies.cli.ts apps/api/src/cli/backfill-user-companies.cli.spec.ts apps/api/package.json
git commit -m "feat(sp7.1): User.accessibleCompanies + backfill CLI"
```

---

### Task 5: JWT payload + AuthService

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`
- Modify: `apps/api/src/modules/auth/dto/jwt-payload.dto.ts` (or interface)

- [ ] **Step 1: Failing test in auth.service.spec.ts**

แก้ `apps/api/src/modules/auth/auth.service.spec.ts` เพิ่ม:

```typescript
describe('login()', () => {
  it('returns JWT with accessibleCompanies + primaryCompany', async () => {
    const result = await service.login({ email: 'owner@test.com', password: 'admin1234' });
    const decoded = jwt.decode(result.access_token) as any;
    
    expect(decoded.accessibleCompanies).toEqual(['SHOP', 'FINANCE']);
    expect(decoded.primaryCompany).toBe('SHOP');
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
cd apps/api && npx jest src/modules/auth/auth.service.spec.ts -t "accessibleCompanies"
```

Expected: FAIL — `decoded.accessibleCompanies` is undefined

- [ ] **Step 3: Update auth.service.ts**

หา function ที่ sign JWT (`generateAccessToken` หรือ inline ใน login):

```typescript
private generateAccessToken(user: User): string {
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    accessibleCompanies: user.accessibleCompanies,  // เพิ่ม
    primaryCompany: user.primaryCompany,            // เพิ่ม
  };
  return this.jwtService.sign(payload, { expiresIn: '15m' });
}
```

แก้ JwtPayload interface (`apps/api/src/modules/auth/dto/jwt-payload.dto.ts` หรือไฟล์เดียวกัน):

```typescript
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  branchId?: string | null;
  accessibleCompanies: string[];     // เพิ่ม
  primaryCompany: string | null;     // เพิ่ม
}
```

- [ ] **Step 4: Run test → pass**

```bash
cd apps/api && npx jest src/modules/auth/auth.service.spec.ts -t "accessibleCompanies"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/dto/ apps/api/src/modules/auth/auth.service.spec.ts
git commit -m "feat(sp7.1): JWT payload carries accessibleCompanies + primaryCompany"
```

---

### Task 6: JWT strategy → req.user

**Files:**
- Modify: `apps/api/src/modules/auth/jwt.strategy.ts`
- Modify: `apps/api/src/modules/auth/jwt.strategy.spec.ts`
- Modify: `apps/api/src/types/express.d.ts`

- [ ] **Step 1: Test req.user contains fields**

แก้ `apps/api/src/modules/auth/jwt.strategy.spec.ts`:

```typescript
describe('JwtStrategy.validate', () => {
  it('copies accessibleCompanies + primaryCompany to req.user', async () => {
    const payload: JwtPayload = {
      sub: 'user-1',
      email: 'owner@test.com',
      role: 'OWNER',
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    };
    const user = await strategy.validate(payload);
    expect(user.accessibleCompanies).toEqual(['SHOP', 'FINANCE']);
    expect(user.primaryCompany).toBe('SHOP');
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
cd apps/api && npx jest src/modules/auth/jwt.strategy.spec.ts
```

Expected: FAIL

- [ ] **Step 3: Update jwt.strategy.ts**

```typescript
async validate(payload: JwtPayload) {
  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    branchId: payload.branchId,
    accessibleCompanies: payload.accessibleCompanies ?? [],  // เพิ่ม
    primaryCompany: payload.primaryCompany ?? null,         // เพิ่ม
  };
}
```

- [ ] **Step 4: Update express.d.ts**

แก้ `apps/api/src/types/express.d.ts`:

```typescript
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      role: UserRole;
      branchId?: string | null;
      accessibleCompanies: string[];     // เพิ่ม
      primaryCompany: string | null;     // เพิ่ม
    }

    interface Request {
      entityScope?: 'SHOP' | 'FINANCE';  // เพิ่ม (จะ populate ใน Task 7)
    }
  }
}
```

- [ ] **Step 5: Run test → pass**

```bash
cd apps/api && npx jest src/modules/auth/jwt.strategy.spec.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/jwt.strategy.ts apps/api/src/modules/auth/jwt.strategy.spec.ts apps/api/src/types/express.d.ts
git commit -m "feat(sp7.1): JwtStrategy.validate exposes entity fields on req.user"
```

---

### Task 7: EntityScope middleware

**Files:**
- Create: `apps/api/src/middleware/entity-scope.middleware.ts`
- Create: `apps/api/src/middleware/entity-scope.middleware.spec.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Failing test**

สร้าง `apps/api/src/middleware/entity-scope.middleware.spec.ts`:

```typescript
import { EntityScopeMiddleware } from './entity-scope.middleware';

describe('EntityScopeMiddleware', () => {
  let middleware: EntityScopeMiddleware;

  beforeEach(() => {
    middleware = new EntityScopeMiddleware();
  });

  function mkReq(overrides: any = {}): any {
    return {
      query: {},
      headers: {},
      user: { accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' },
      ...overrides,
    };
  }

  it('URL query takes precedence', () => {
    const req = mkReq({ query: { company: 'finance' } });
    const next = jest.fn();
    middleware.use(req, {} as any, next);
    expect(req.entityScope).toBe('FINANCE');
    expect(next).toHaveBeenCalled();
  });

  it('header next', () => {
    const req = mkReq({ headers: { 'x-company-scope': 'shop' } });
    const next = jest.fn();
    middleware.use(req, {} as any, next);
    expect(req.entityScope).toBe('SHOP');
  });

  it('user.primaryCompany default', () => {
    const req = mkReq();
    const next = jest.fn();
    middleware.use(req, {} as any, next);
    expect(req.entityScope).toBe('SHOP');
  });

  it('reject if requested company not in accessibleCompanies (403)', () => {
    const req = mkReq({
      query: { company: 'finance' },
      user: { accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' },
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const next = jest.fn();
    middleware.use(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('SHOP-only user with no query/header gets SHOP', () => {
    const req = mkReq({ user: { accessibleCompanies: ['SHOP'], primaryCompany: 'SHOP' } });
    const next = jest.fn();
    middleware.use(req, {} as any, next);
    expect(req.entityScope).toBe('SHOP');
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
cd apps/api && npx jest src/middleware/entity-scope.middleware.spec.ts
```

Expected: FAIL "Cannot find module"

- [ ] **Step 3: Implement middleware**

สร้าง `apps/api/src/middleware/entity-scope.middleware.ts`:

```typescript
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

type Company = 'SHOP' | 'FINANCE';

@Injectable()
export class EntityScopeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // ไม่บังคับสำหรับ public endpoints — ถ้าไม่มี user, ข้าม
    if (!req.user) {
      return next();
    }

    const user = req.user as Express.User;
    const requested = this.resolveRequested(req);
    const target = requested ?? user.primaryCompany ?? 'SHOP';

    if (!user.accessibleCompanies.includes(target as Company)) {
      return res.status(403).json({
        message: `User ไม่มีสิทธิ์เข้าถึง company ${target}`,
        accessibleCompanies: user.accessibleCompanies,
      });
    }

    req.entityScope = target as Company;
    next();
  }

  private resolveRequested(req: Request): Company | null {
    const fromQuery = String(req.query.company ?? '').toUpperCase();
    if (fromQuery === 'SHOP' || fromQuery === 'FINANCE') return fromQuery;

    const fromHeader = String(req.headers['x-company-scope'] ?? '').toUpperCase();
    if (fromHeader === 'SHOP' || fromHeader === 'FINANCE') return fromHeader;

    return null;
  }
}
```

- [ ] **Step 4: Run test → pass**

```bash
cd apps/api && npx jest src/middleware/entity-scope.middleware.spec.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Wire middleware ใน AppModule**

แก้ `apps/api/src/app.module.ts`:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { EntityScopeMiddleware } from './middleware/entity-scope.middleware';
// ...

@Module({ /* ... existing ... */ })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(EntityScopeMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/middleware/entity-scope.middleware.ts apps/api/src/middleware/entity-scope.middleware.spec.ts apps/api/src/app.module.ts
git commit -m "feat(sp7.1): EntityScope middleware (URL query > header > primaryCompany)"
```

---

### Task 8: @Entity decorator + EntityScopeGuard

**Files:**
- Create: `apps/api/src/decorators/entity.decorator.ts`
- Create: `apps/api/src/guards/entity-scope.guard.ts`
- Create: `apps/api/src/guards/entity-scope.guard.spec.ts`

- [ ] **Step 1: Failing test**

สร้าง `apps/api/src/guards/entity-scope.guard.spec.ts`:

```typescript
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { EntityScopeGuard, ENTITY_KEY } from './entity-scope.guard';

describe('EntityScopeGuard', () => {
  let guard: EntityScopeGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new EntityScopeGuard(reflector);
  });

  function mkCtx(opts: { handlerScope?: string; reqScope?: string; userCompanies?: string[] }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          entityScope: opts.reqScope,
          user: { accessibleCompanies: opts.userCompanies ?? ['SHOP', 'FINANCE'] },
        }),
      }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as any;
  }

  it('allow when no @Entity decoration', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = mkCtx({ reqScope: 'SHOP', userCompanies: ['SHOP'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allow when @Entity(SHOP) and req.entityScope=SHOP', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('SHOP');
    const ctx = mkCtx({ reqScope: 'SHOP', userCompanies: ['SHOP'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('reject when @Entity(FINANCE) and user only has SHOP', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    const ctx = mkCtx({ reqScope: 'SHOP', userCompanies: ['SHOP'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allow @Entity(FINANCE) when user has both even if req.entityScope=SHOP — handler decides authoritatively', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('FINANCE');
    const ctx = mkCtx({ reqScope: 'SHOP', userCompanies: ['SHOP', 'FINANCE'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
cd apps/api && npx jest src/guards/entity-scope.guard.spec.ts
```

Expected: FAIL

- [ ] **Step 3: Implement decorator + guard**

สร้าง `apps/api/src/decorators/entity.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const ENTITY_KEY = 'entity_scope';

export type EntityType = 'SHOP' | 'FINANCE';

/**
 * @Entity('SHOP') — handler ต้องการ user มี SHOP access
 * @Entity('FINANCE') — handler ต้องการ user มี FINANCE access
 * 
 * ใช้คู่กับ EntityScopeGuard:
 *   @UseGuards(JwtAuthGuard, EntityScopeGuard)
 *   @Entity('FINANCE')
 *   @Get('contracts')
 */
export const Entity = (scope: EntityType) => SetMetadata(ENTITY_KEY, scope);
```

สร้าง `apps/api/src/guards/entity-scope.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENTITY_KEY, EntityType } from '../decorators/entity.decorator';

@Injectable()
export class EntityScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScope = this.reflector.getAllAndOverride<EntityType>(ENTITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredScope) return true; // no decoration → public-to-scope

    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user?.accessibleCompanies?.includes(requiredScope)) {
      throw new ForbiddenException(
        `Handler ต้องการสิทธิ์ company ${requiredScope}; user สิทธิ์: ${user?.accessibleCompanies?.join(',')}`
      );
    }

    return true;
  }
}
```

- [ ] **Step 4: Run test → pass**

```bash
cd apps/api && npx jest src/guards/entity-scope.guard.spec.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/decorators/entity.decorator.ts apps/api/src/guards/entity-scope.guard.ts apps/api/src/guards/entity-scope.guard.spec.ts
git commit -m "feat(sp7.1): @Entity decorator + EntityScopeGuard"
```

---

### Task 9: Integration test (login flow)

**Files:**
- Create: `apps/api/test/sp7-1-dual-prisma.e2e-spec.ts`

- [ ] **Step 1: Write integration test**

สร้าง `apps/api/test/sp7-1-dual-prisma.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaFinanceService } from '../src/prisma/prisma-finance.service';

describe('SP7.1 — Dual Prisma + Entity Scope (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let prismaFin: PrismaFinanceService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    prismaFin = app.get(PrismaFinanceService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Both Prisma clients connected', () => {
    it('PrismaService connects to bc_shop', async () => {
      const result = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() as db`;
      expect(result[0].db).toContain('bestchoice');
      expect(result[0].db).not.toContain('finance');
    });

    it('PrismaFinanceService connects to bc_finance', async () => {
      const result = await prismaFin.$queryRaw<Array<{ db: string }>>`SELECT current_database() as db`;
      expect(result[0].db).toContain('finance');
    });
  });

  describe('JWT carries entity fields', () => {
    it('OWNER login returns JWT with [SHOP, FINANCE]', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@bestchoice.com', password: 'admin1234' });

      expect(res.status).toBe(200);
      expect(res.body.user.accessibleCompanies).toEqual(['SHOP', 'FINANCE']);
      expect(res.body.user.primaryCompany).toBe('SHOP');
    });

    it('SALES login returns JWT with only [SHOP]', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'sales1@bestchoice.com', password: 'admin1234' });

      expect(res.body.user.accessibleCompanies).toEqual(['SHOP']);
    });
  });

  describe('EntityScope middleware', () => {
    let ownerToken: string;
    let salesToken: string;

    beforeAll(async () => {
      const owner = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'admin@bestchoice.com', password: 'admin1234' });
      ownerToken = owner.body.access_token;

      const sales = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'sales1@bestchoice.com', password: 'admin1234' });
      salesToken = sales.body.access_token;
    });

    it('OWNER can switch to FINANCE via ?company=finance', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me?company=finance')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
    });

    it('SALES rejected with 403 if requests ?company=finance', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me?company=finance')
        .set('Authorization', `Bearer ${salesToken}`);
      expect(res.status).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Ensure test DB has 2 databases**

ตรวจ `apps/api/.env.test`:

```env
DATABASE_URL="postgresql://bestchoice:bestchoice_dev_password@localhost:5432/bestchoice_test"
DATABASE_URL_FINANCE="postgresql://bestchoice:bestchoice_dev_password@localhost:5433/bestchoice_test_finance"
```

สร้าง bestchoice_test_finance ถ้ายังไม่มี:

```bash
psql postgresql://bestchoice:bestchoice_dev_password@localhost:5433/postgres -c "CREATE DATABASE bestchoice_test_finance;"
cd apps/api && DATABASE_URL_FINANCE=postgresql://bestchoice:bestchoice_dev_password@localhost:5433/bestchoice_test_finance npm run prisma:finance:migrate:deploy
```

- [ ] **Step 3: Run e2e test → pass**

```bash
cd apps/api && npx jest test/sp7-1-dual-prisma.e2e-spec.ts --config=test/jest-e2e.json
```

Expected: PASS (all assertions)

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/sp7-1-dual-prisma.e2e-spec.ts apps/api/.env.test
git commit -m "test(sp7.1): e2e dual-Prisma + entity scope flow"
```

---

### Task 10: CI pipeline — 2 postgres containers

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Update CI workflow**

แก้ `.github/workflows/test.yml` services block:

```yaml
jobs:
  api-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: bestchoice
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: bestchoice_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U bestchoice"
          --health-interval 10s
          --health-retries 5

      postgres-finance:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: bestchoice
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: bestchoice_test_finance
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U bestchoice"
          --health-interval 10s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://bestchoice:testpass@localhost:5432/bestchoice_test
      DATABASE_URL_FINANCE: postgresql://bestchoice:testpass@localhost:5433/bestchoice_test_finance

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: cd apps/api && npx prisma migrate deploy
      - run: cd apps/api && npm run prisma:finance:migrate:deploy
      - run: cd apps/api && npm run prisma:generate
      - run: cd apps/api && npm run prisma:finance:generate
      - run: cd apps/api && npm test
      - run: cd apps/api && npm run test:e2e
```

- [ ] **Step 2: Push + verify CI passes**

```bash
git add .github/workflows/test.yml
git commit -m "ci(sp7.1): spin up 2 postgres containers for dual-Prisma tests"
git push origin <branch>
```

ดู GitHub Actions — Expected: both DBs spin up + tests pass

---

### Task 11: Documentation

**Files:**
- Create: `docs/architecture/dual-prisma.md`

- [ ] **Step 1: เขียน architecture note**

สร้าง `docs/architecture/dual-prisma.md`:

```markdown
# Dual Prisma Architecture (SP7.1)

## Overview

BESTCHOICE มี 2 Prisma clients ทำงานพร้อมกันใน NestJS process เดียว:

- `PrismaService` → bc_shop database (existing)
- `PrismaFinanceService` → bc_finance database (added in SP7.1)

## Why dual clients

ดูเหตุผลใน `docs/superpowers/specs/2026-05-19-shop-finance-legal-split-design.md`

## How to use

### Inject ทั้งคู่ใน service

```typescript
@Injectable()
export class MyService {
  constructor(
    private readonly prismaShop: PrismaService,
    private readonly prismaFin: PrismaFinanceService,
  ) {}
  
  async crossEntityQuery() {
    const shopData = await this.prismaShop.product.findMany();
    const finData = await this.prismaFin.contract.findMany();
    return { shopData, finData };
  }
}
```

### Cross-entity transaction — ห้ามใช้ $transaction across clients!

PostgreSQL ไม่รองรับ atomic TX ข้าม database. ใช้ Outbox pattern แทน (รออ SP7.2)

### Entity scope

ทุก request ผ่าน `EntityScopeMiddleware` → populate `req.entityScope = 'SHOP'|'FINANCE'`. Handler routes ที่ scope-specific ใช้:

```typescript
@UseGuards(JwtAuthGuard, EntityScopeGuard)
@Entity('FINANCE')
@Get('contracts')
async getContracts() { ... }
```

User ที่ไม่มีสิทธิ์ FINANCE จะถูกปฏิเสธ 403

## Migration management

- bc_shop migrations: `apps/api/prisma/migrations/`
- bc_finance migrations: `apps/api/prisma-finance/migrations/`
- ทำงานแยกกัน: `npm run prisma:migrate:dev` vs `npm run prisma:finance:migrate:dev`

## Test setup

CI ใช้ 2 postgres services (5432 + 5433). Local dev ใช้ docker-compose.

ตัวอย่าง: `apps/api/test/sp7-1-dual-prisma.e2e-spec.ts`
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/dual-prisma.md
git commit -m "docs(sp7.1): dual-Prisma architecture note"
```

---

### Task 12: SP7.1 Verification

- [ ] **Step 1: Full test suite**

```bash
cd apps/api && npm test && npm run test:e2e
```

Expected: 0 failures

- [ ] **Step 2: Type check**

```bash
./tools/check-types.sh all
```

Expected: 0 errors

- [ ] **Step 3: Manual smoke**

```bash
# Start dev
npm run dev

# In another terminal — login as OWNER
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bestchoice.com","password":"admin1234"}' | jq

# JWT payload should contain accessibleCompanies
```

Expected: response includes `accessibleCompanies: ["SHOP","FINANCE"]`, `primaryCompany: "SHOP"`

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat(sp7.1): dual Prisma client foundation" --body "$(cat <<'EOF'
## Summary
- เพิ่ม PrismaFinanceService → bc_finance DB
- User.accessibleCompanies + primaryCompany
- JWT payload carries entity fields
- EntityScope middleware + @Entity decorator + EntityScopeGuard
- Docker compose + CI 2-postgres setup
- Dual-Prisma e2e test
- Architecture documentation

## Test plan
- [x] All API unit tests pass
- [x] E2E sp7-1-dual-prisma passes
- [x] TypeScript 0 errors
- [x] Smoke: OWNER login → JWT.accessibleCompanies = ["SHOP","FINANCE"]
- [x] Smoke: SALES login → only ["SHOP"]
- [x] Smoke: SALES requesting ?company=finance → 403

Spec: `docs/superpowers/specs/2026-05-19-shop-finance-legal-split-design.md`
Plan: `docs/superpowers/plans/2026-05-19-shop-finance-legal-split.md` (SP7.1)
EOF
)"
```

- [ ] **Step 5: After PR merge — kick off SP7.2 planning**

```bash
# กลับมาเขียน detailed plan สำหรับ SP7.2 ต่อ
```

---

## 2. SP7.2 — Outbox + PairedJournalService (OUTLINE)

**Goal:** เพิ่ม `outbox_events` table ใน bc_shop + `PairedJournalService` ที่ใช้ outbox pattern + saga retries + Sentry on failure + reconciliation cron + manual reconcile UI

**Files (new):**
- `apps/api/prisma/migrations/*_outbox_events/` — outbox_events table
- `apps/api/src/modules/journal/outbox.service.ts` — outbox CRUD
- `apps/api/src/modules/journal/paired-journal.service.ts` — saga orchestration
- `apps/api/src/modules/journal/paired-journal.service.spec.ts`
- `apps/api/src/modules/journal/cron/outbox-processor.cron.ts` — every 30s
- `apps/api/src/modules/journal/cron/reconciliation.cron.ts` — daily 04:00 BKK
- `apps/api/src/modules/journal/reconcile.controller.ts` — manual reconcile UI API
- `apps/web/src/pages/AdminReconcileDashboardPage.tsx` — UI
- Tests for cron + reconciliation

**Files (modified):**
- ทุก template ที่ post JE ข้าม entity (เริ่มจาก contract-activation, payment, commission flows) — เปลี่ยนเรียก PairedJournalService แทน direct write

**Key tasks (high-level — to be expanded into TDD tasks before SP7.2 starts):**
1. Outbox schema migration
2. OutboxService (write event in same TX as source JE)
3. PairedJournalService.processOutbox (retry up to 5×)
4. Idempotency key check
5. Cron schedulers (outbox processor + reconciliation)
6. Sentry alarms on FAILED
7. Manual reconcile dashboard UI (OWNER-only)
8. Refactor 3 key flows: contract activation, payment, commission

**Exit criteria:**
- Outbox events processed within 30s under normal load
- Failed events retried 5× over 1 hour, then Sentry alarm
- Daily reconciliation report comparing bc_shop JE vs bc_finance JE pairs
- Manual reconcile dashboard usable by OWNER

---

## 3. SP7.3 — Auth/RBAC Cross-Entity (OUTLINE)

**Goal:** Pill switcher UI ใน topbar + entity-scoped routes + UX confirming current entity

**Files (new):**
- `apps/web/src/components/topbar/CompanyPillSwitcher.tsx` — UI component
- `apps/web/src/contexts/EntityScopeContext.tsx` — React context
- `apps/web/src/hooks/useEntityScope.ts`
- `apps/api/src/middleware/entity-scope.middleware.ts` (extended from SP7.1)

**Files (modified):**
- `apps/web/src/lib/api.ts` — axios interceptor adds `?company=` to all requests
- `apps/web/src/components/layout/MainLayout.tsx` — render pill switcher when accessibleCompanies.length > 1
- `apps/web/src/contexts/AuthContext.tsx` — store accessibleCompanies + primaryCompany from JWT
- `apps/web/src/pages/menu` — filter menu items by current entity
- `apps/api/src/modules/*/` — add `@Entity('FINANCE')` on relevant controllers (contracts, payments, etc.)

**Key tasks:**
1. EntityScopeContext + provider in App.tsx
2. CompanyPillSwitcher component (reuse from sidebar SP1 if patterns exist)
3. Persist entity in localStorage + URL sync
4. axios interceptor for ?company=
5. Apply @Entity decorators on ~50 controllers (sweep)
6. E2E test: SALES cannot access /finance/contracts URL
7. Visual: entity indicator badge in topbar

**Exit criteria:**
- OWNER sees pill switcher [SHOP][FINANCE], can toggle
- SALES sees no pill (locked to SHOP)
- Direct URL access (e.g. /finance/contracts) by SALES → 403 with friendly UI

---

## 4. SP7.4 — ExternalFinanceCompany + Commission (OUTLINE)

**Goal:** รองรับ commission จาก GFIN และ external finance อื่นๆ

**Files (new):**
- `apps/api/prisma/migrations/*_external_finance/` — 2 new tables
- `apps/api/src/modules/external-finance/external-finance.module.ts`
- `apps/api/src/modules/external-finance/external-finance.controller.ts`
- `apps/api/src/modules/external-finance/external-finance.service.ts`
- `apps/api/src/modules/external-finance/dto/*.dto.ts`
- `apps/api/src/modules/journal/cpa-templates/external-finance-commission.template.ts` × 3 (immediate/accrual/receive)
- `apps/web/src/pages/ExternalFinanceListPage.tsx`
- `apps/web/src/pages/ExternalFinanceDetailPage.tsx`
- `apps/web/src/pages/ExternalFinanceCommissionsPage.tsx`

**Files (modified):**
- `apps/web/src/config/menu.ts` — เพิ่ม "ไฟแนนซ์ภายนอก" submenu
- `apps/api/src/modules/sales/sales.service.ts` — record external finance sale flow

**Key tasks:**
1. Schema: ExternalFinanceCompany + ExternalFinanceCommission tables
2. CRUD service + controller (OWNER, BRANCH_MANAGER, SALES)
3. 3 JE templates (immediate/accrual/receive)
4. Frontend list + detail + commission tracker
5. Tests: each JE template + service + e2e

**Exit criteria:**
- Sales staff can record "ขายให้ GFIN" + ระบบสร้าง JE อัตโนมัติ
- Commission tracking: pending → received transitions
- WHT receivable handled

---

## 5. SP7.5 — Per-Entity Tax Filing (OUTLINE)

**Goal:** ภ.พ.30 (FIN only), ภ.ง.ด.3/53/50/51 (per entity), ภ.ง.ด.1 (per entity) — ทั้งหมดแยกตาม entity

**Files (new/modified):**
- `apps/api/prisma/migrations/*_taxreport_entity_scope/` — เพิ่ม column entityScope (or move TaxReport to per-DB)
- `apps/api/src/modules/tax-reports/*` — sweep entity-filter
- `apps/web/src/pages/TaxReportsPage.tsx` — pill switcher integration

**Key tasks:**
1. Schema: TaxReport.entityScope or split table (decide based on SP7.7 migration plan)
2. PP30 service rejects entity=SHOP (only FINANCE)
3. PND3/53 per entity
4. PND50/51 per entity (corporate income tax)
5. UI filters by current entity
6. e-Tax XML / PDF templates per entity (signer name + tax ID per company)

**Exit criteria:**
- ทุก tax report query/page filter by current entity automatically
- PP30 for SHOP entity blocked (UI + API)
- Sample tax filing generated per entity matches expected format

---

## 6. SP7.6 — Consolidated Reports (OUTLINE)

**Goal:** Dashboard + report views ที่รวม 2 entities สำหรับ OWNER

**Files:**
- `apps/api/src/modules/accounting/consolidated.service.ts`
- `apps/api/src/modules/dashboard/consolidated-dashboard.service.ts`
- `apps/web/src/pages/DashboardPage.tsx` (เพิ่ม `?view=consolidated` mode)
- `apps/web/src/pages/ConsolidatedProfitLossPage.tsx`

**Key tasks:**
1. ConsolidatedService.getDashboardKpis() — sum both entities
2. ConsolidatedProfitLoss — รวม + apply eliminating entries
3. Eliminating entries logic (commission income vs expense, intercompany transfers)
4. UI: dashboard toggle "เฉพาะ X" vs "รวม"
5. OWNER-only feature flag

**Exit criteria:**
- OWNER toggle dashboard mode → consolidated KPI cards
- Consolidated P&L มี eliminating entries ที่ตรงกับ accountant's manual calculation
- ACCOUNTANT มี consolidated view (read-only)

---

## 7. SP7.7 — Data Audit + Migration Scripts (OUTLINE — SIMPLIFIED 2026-05-19)

**Goal (revised):** เนื่องจาก owner directive "บัญชีที่ทำมาตลอด = FINANCE", migration กลายเป็น **rule-based** ไม่ใช่ per-row audit. effort ลดลง ~50%

**Approach:** 2-step migration
1. **bc_orig (current single DB) → bc_finance** — straight rename + dump/restore (FINANCE inherits everything by default)
2. **Selective extract → bc_shop** — เฉพาะ tables ที่ตาม rule (ดู spec 11.2): products, stock, sales, branches, shop expense_docs, S-prefix chart + JE, commissions, users (shared), audit_logs (shared)
3. **Opening balance transfer JE** — บน 1 ม.ค. 2027 post JE in bc_finance + bc_shop เพื่อ transfer SHOP-side balance (inventory + AR + AP) จาก FINANCE → SHOP per OQ4 (needs CPA approval first)

**Files (new):**
- `apps/api/src/cli/clone-orig-to-finance.cli.ts` — straight clone bc_orig → bc_finance
- `apps/api/src/cli/extract-shop-from-finance.cli.ts` — extract SHOP-side tables → bc_shop + delete from bc_finance
- `apps/api/src/cli/post-opening-balance-transfer.cli.ts` — JE posting OQ4 transfer
- `apps/api/scripts/migration/cutover.sh` — orchestrator
- `apps/api/src/cli/audit-edge-cases.cli.ts` — audit เฉพาะ 3 tables ที่ต้อง manual review (customers, fixed_assets, payroll)
- `docs/migration/audit-report-2026-09-XX.md` — output for edge cases

**Key tasks (revised — ลดลง):**
1. Clone bc_orig → bc_finance (full data dump + restore + schema rename)
2. Extract SHOP-side tables → bc_shop (rule-based, no manual classification needed for 47+ tables)
3. Audit edge cases (only 3 tables: customers split + fixed_assets + payroll)
4. Customer dedupe + dual-entity creation (national_id_hash matching)
5. Opening balance transfer JE template (FINANCE → SHOP) per CPA approval
6. Validation: row count, checksums, FK integrity
7. Dry-run #1 on staging clone (Sep)
8. Accountant review of dry-run + edge cases
9. Dry-run #2 (Oct) post-fixes
10. Final migration playbook

**Exit criteria:**
- bc_finance contains all historical data unchanged (TB matches pre-split state)
- bc_shop contains only SHOP-side tables (clean opening state) + post-transfer balances
- 3 edge-case tables reviewed + classified by accountant
- Dry-run #2 produces both DBs passing smoke tests
- TB ของแต่ละ entity match expected per CPA approval

---

## 8. SP7.8 — Infrastructure (OUTLINE)

**Goal:** 2 LINE OAs + 2 backup pipelines + 1 Sentry project w/ entity tag

**Files:**
- `apps/api/src/modules/backup/backup.service.ts` — extend to 2 DBs
- `apps/api/src/modules/notifications/line-oa.service.ts` — route by entity
- `infrastructure/terraform/*.tf` (or manual gcloud) — Cloud SQL second instance config

**Key tasks:**
1. Provision 2nd Cloud SQL instance (production-grade)
2. Backup cron: split into shop-backup + finance-backup jobs
3. Off-site GCS sync: per-DB destinations
4. LINE OA routing: contract notification → finance OA; sales promo → shop OA
5. Sentry tag = entity_scope (already in code via SP7.1 — verify in production)

**Exit criteria:**
- Daily backup runs for both DBs + verified restore
- LINE messages sent from correct OA per entity context
- Sentry filters by entity_scope working

---

## 9. SP7.9 — Year-End Closing in Legacy Entity (OUTLINE)

**Goal:** ตรวจสอบ + ปรับ existing year-end closing template (P3-SP1) ทำงาน clean บน bc_orig (single-entity ตอนปลายปี 2026)

**Files:**
- `apps/api/src/modules/accounting/closing.service.ts` — verify/adjust
- `apps/api/src/modules/journal/cpa-templates/year-end-closing.template.ts` — verify
- `apps/api/test/year-end-closing-pre-split.e2e-spec.ts` (new)

**Key tasks:**
1. รัน existing year-end closing บน clone of prod data
2. Edge cases: เครื่องที่ลูกค้าผ่อนค้าง (asset transfer ที่ต้องทำหลัง split — flag for SP7.10)
3. Backup snapshot ก่อน + หลัง closing
4. UAT: accountant verify final TB

**Exit criteria:**
- Year-end closing template tested on prod clone
- TB at 31 Dec 2026 (simulated) = expected
- Backup snapshot procedure documented

---

## 10. SP7.10 — Cutover Playbook + Rehearsal + UAT (OUTLINE)

**Goal:** Documented playbook + 2 successful rehearsals + final UAT before real cutover

**Files:**
- `docs/runbooks/sp7-cutover-playbook.md` — step-by-step
- `docs/runbooks/sp7-rollback-playbook.md`
- `apps/api/scripts/cutover/*.sh` — execute scripts (idempotent)
- `apps/api/test/cutover/smoke.e2e-spec.ts` — automated smoke

**Key tasks:**
1. Detailed playbook from spec section 11.4 → executable
2. Rehearsal #1 (mid-Nov): full dry-run on prod clone, time the steps, identify issues
3. Fix issues + rerun
4. Rehearsal #2 (mid-Dec): final dry-run + accountant UAT
5. War room setup (Slack #cutover-2027, on-call schedule)
6. Rollback drill — execute rollback playbook, verify return to bc_orig
7. Pre-cutover checklist signed off by owner + accountant

**Exit criteria:**
- 2 successful rehearsals (zero data loss, smoke tests green)
- Accountant UAT signoff
- Owner signoff
- War room ready (Slack + on-call + phone tree)
- Rollback drill proven

---

## 11. Critical Path & Risk Mitigations

### Critical path
```
SP7.1 → SP7.2 → SP7.7 → SP7.10 → CUTOVER
```

### Parallelizable
- SP7.4 || SP7.5 (different domains)
- SP7.8 || SP7.10 prep (infra vs runbook)

### Top risks (from spec section 14)
| Risk | Mitigation in plan |
|---|---|
| Cross-DB TX failure | SP7.2 outbox/saga + daily reconcile cron (SP7.2 cron task) |
| Migration bug → data loss | SP7.7 dry-run #1 + #2 + checksums + bc_orig retention 90 days |
| Accountant rejects TB | SP7.10 rehearsal #2 includes accountant UAT |
| Legal registration delay | Owner action item, NOT blocking — schema fields nullable until used |
| Customer dedupe edge cases | SP7.7 audit + CustomerLinkService (built in SP7.4 timing) |

### Owner action items (parallel to dev work)
- [ ] Engage CPA for OQ1 (equity split methodology) — by Aug 2026
- [ ] Engage lawyer for OQ3 (contract novation) — by Sep 2026
- [ ] Engage RD for new tax IDs — by Oct 2026
- [ ] Bank account setup for new entities — by Nov 2026
- [ ] LINE OA registration second OA — by Nov 2026

---

## 12. Definition of Done (overall P3-SP7)

- [ ] ทุก 10 SPs ผ่าน DEEP code review + merged
- [ ] 2 rehearsals สำเร็จ (zero data loss)
- [ ] Accountant + Owner UAT signoff
- [ ] War room ready (Slack + on-call + phone tree)
- [ ] Rollback playbook proven
- [ ] Real cutover executed 31 Dec 2026 → 1 Jan 2027 (≤ 6 hr maintenance window)
- [ ] 7-day post-cutover stabilization: daily reconcile + 0 critical bugs
- [ ] 30-day post-cutover: 2 entities running independently + accountant happy

---

**End of Plan**

(SP7.2-SP7.10 detailed task breakdown will be written in subsequent plan files before each SP starts. SP7.1 above is fully executable now.)
