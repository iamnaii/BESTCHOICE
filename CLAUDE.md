# BESTCHOICE - ระบบผ่อนชำระ (Installment Management System)

## Project Overview
BESTCHOICE is a full-stack installment payment management system for mobile/phone shops in Thailand.

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind CSS (`apps/web`)
- **Backend**: NestJS + Prisma + PostgreSQL (`apps/api`)
- **Monorepo**: Turborepo with npm workspaces
- **Shared**: `packages/shared/` for shared types/utilities

## Development
```bash
# Install dependencies
npm install

# Start dev servers (API + Web)
npm run dev

# Web only (localhost:5173)
cd apps/web && npm run dev

# API only (localhost:3000)
cd apps/api && npm run dev
```

## Test Accounts (Dev Mode)
- **Admin**: admin@bestchoice.com / admin1234

---

## Agent Instructions (WAT Framework)

โปรเจคนี้ใช้ WAT Framework (Workflows, Agents, Tools) — แยก reasoning (Agent) ออกจาก execution (Tools) เพื่อให้ทำงานได้แม่นยำและเป็นระบบ

### หลักการทำงาน

1. **อ่าน Workflow ก่อนทำงานเสมอ**
   - ก่อนสร้าง API module → อ่าน `workflows/create-api-module.md`
   - ก่อนสร้าง React page → อ่าน `workflows/create-page.md`
   - ก่อนแก้ Prisma schema → อ่าน `workflows/prisma-changes.md`
   - ก่อน fix bug → อ่าน `workflows/fix-bug.md`
   - ก่อน deploy → อ่าน `workflows/deploy.md`
   - ก่อนเพิ่ม endpoint → อ่าน `workflows/add-api-endpoint.md`

2. **ค้นหาก่อนสร้าง**
   - ค้นหา existing components, hooks, utilities ใน codebase ก่อนสร้างใหม่
   - ตรวจว่ามี module/page ที่ทำงานคล้ายกันอยู่แล้วหรือไม่
   - Reuse code ที่มีอยู่แทนการ duplicate

3. **ใช้ Tools สำหรับ routine tasks**
   - `./tools/generate-module.sh <name>` — scaffold NestJS module
   - `./tools/check-types.sh [api|web|all]` — ตรวจ TypeScript errors
   - `./tools/run-tests.sh [--skip-e2e]` — lint + type check + E2E
   - `./tools/db-reset.sh` — reset dev database

4. **ตาม Pattern เดิม**
   - ดู module/page ที่คล้ายกันเป็น reference ก่อนสร้างใหม่
   - Backend reference: `apps/api/src/modules/customers/`
   - Frontend reference: `apps/web/src/pages/CustomersPage.tsx`

5. **อัปเดต Workflow เมื่อเจอ pattern ใหม่**
   - เมื่อค้นพบ constraint, rate limit, หรือ pattern ใหม่ → อัปเดต workflow
   - อย่าสร้างหรือ overwrite workflow โดยไม่ถามก่อน
   - Workflow คือ instructions ที่ต้องรักษาและปรับปรุง

### Self-Improvement Loop
เมื่อเกิด error หรือพบวิธีที่ดีกว่า:
1. หา root cause
2. Fix tool/code
3. Verify ว่า fix ทำงาน
4. อัปเดต workflow ที่เกี่ยวข้อง
5. ไปต่อด้วยระบบที่แข็งแกร่งขึ้น

### Agent Skills (Slash Commands)

Skills คือ shortcut commands ที่เรียกใช้ได้ใน Claude Code — แต่ละ skill จะอ่าน workflow + ใช้ tools + ทำงานตาม pattern อัตโนมัติ

| Skill | คำสั่ง | ใช้เมื่อ |
|-------|--------|---------|
| สร้าง Full-Stack Feature | `/create-feature` | ต้องการสร้าง feature ใหม่ครบ (Prisma + API + Page) |
| สร้าง API Module | `/create-module` | ต้องการสร้าง backend module (controller, service, DTO) |
| สร้าง React Page | `/create-page` | ต้องการสร้าง frontend page + routing |
| เพิ่ม API Endpoint | `/add-endpoint` | ต้องการเพิ่ม route ใน module ที่มีอยู่ |
| Fix Bug | `/fix-bug` | ต้องการ debug และ fix bug อย่างเป็นระบบ |
| แก้ไข Database | `/db-change` | ต้องการเพิ่ม/แก้ Prisma model, field, enum |
| Pre-Deploy Check | `/pre-deploy` | ต้องการตรวจสอบก่อน merge/deploy |
| รัน E2E Tests | `/run-e2e` | ต้องการรัน Playwright E2E tests |

Skills อยู่ใน `.claude/skills/` — แต่ละ skill จะ:
1. อ่าน workflow ที่เกี่ยวข้องก่อนเริ่มงาน
2. ถาม input ที่จำเป็นจาก user
3. ค้นหา existing code ก่อนสร้างใหม่
4. ใช้ tools (generate-module.sh, check-types.sh) อัตโนมัติ
5. Verify ด้วย TypeScript check

### Subagents

Subagents คือ agent เฉพาะทางที่ทำงานแยก — ใช้ Sonnet model เพื่อประหยัด cost และไม่ปนเปื้อน context ของ parent

| Agent | ใช้เมื่อ |
|-------|---------|
| `code-reviewer` | ต้องการ review code changes ก่อน commit/merge — รายงานปัญหาตาม severity (Critical/Warning/Info) |
| `type-checker` | ต้องการตรวจ TypeScript errors และรับคำแนะนำการแก้ไข |

Agents อยู่ใน `.claude/agents/` — **เป็น read-only reporters** ไม่แก้โค้ดเอง รายงานกลับมาให้ parent agent แก้ไข

### Build Workflow

ขั้นตอนมาตรฐานเมื่อสร้างหรือแก้ไข feature:

1. **Write** — เขียน code ตาม workflow + rules ที่กำหนด
2. **Review** — ใช้ `code-reviewer` agent ตรวจ code changes
3. **Test** — รัน `./tools/check-types.sh all` + E2E tests ที่เกี่ยวข้อง
4. **Fix** — แก้ไขตาม review + test results (parent agent เป็นคนแก้)
5. **Ship** — `/pre-deploy` checklist → commit → merge

ทุกขั้นตอนต้องผ่านก่อนไปขั้นต่อไป — ถ้า review พบ Critical issue ต้องแก้ก่อน test

---

## Codebase Structure
```
apps/
  api/
    src/
      modules/[feature]/     # NestJS modules (42 features)
        [feature].module.ts
        [feature].controller.ts
        [feature].service.ts
        dto/                 # class-validator DTOs
      guards/                # JwtAuthGuard, RolesGuard
      prisma/                # PrismaService (DB access)
      utils/                 # Shared utilities
    prisma/
      schema.prisma          # Database schema (40+ models)
      migrations/            # SQL migrations (48+)
  web/
    src/
      pages/                 # Page components (55+)
      pages/liff/            # LINE LIFF pages (customer mobile)
      components/            # Shared UI components
      hooks/                 # useDebounce, useIsMobile, useKeyboardShortcuts, useLiffInit
      store/                 # Zustand stores
      lib/api.ts             # Axios client (JWT in-memory, refresh token)
      contexts/              # AuthContext
      types/                 # Shared TypeScript types
      constants/             # App constants
    e2e/                     # Playwright E2E tests
packages/
  shared/                    # Shared types/utilities
workflows/                   # WAT workflow SOPs (Markdown)
tools/                       # WAT automation scripts (Shell)
scripts/                     # Deploy & backup scripts
```

## Architecture Notes

### Authentication
- JWT access token stored **in-memory** (JS variable, NOT localStorage) — XSS safe
- Refresh token in httpOnly cookie — auto-sent by browser
- Token rotation on refresh
- API client: `apps/web/src/lib/api.ts` (axios interceptors handle 401 → refresh)
- Auth context: `apps/web/src/contexts/AuthContext.tsx`

### Backend Patterns
- **Module structure**: controller → service → PrismaService
- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard)` on controllers
- **Roles**: `@Roles('OWNER', 'BRANCH_MANAGER')` on methods
- **Validation**: class-validator decorators on DTOs, Thai error messages
- **Soft delete**: `deletedAt: DateTime?` — never hard delete
- **Money**: use `Decimal` (`@db.Decimal(12, 2)`), never `Float`
- **Global**: ThrottlerGuard (200 req/sec), CsrfGuard, AuditInterceptor

### Frontend Patterns
- **Data fetching**: `useQuery` / `useMutation` from @tanstack/react-query
- **Cache**: `queryClient.invalidateQueries()` after mutations
- **State**: Zustand stores for complex state, React Query for server state
- **Notifications**: `toast.success()` / `toast.error()` from sonner
- **Routing**: lazy-loaded pages, `ProtectedRoute` wrapper, `MainLayout`
- **API calls**: `api.get()` / `api.post()` from `@/lib/api`
- **UI**: Radix UI primitives + Tailwind CSS + lucide-react icons

### Integrations
- LINE LIFF — customer mobile access (`/liff/*` routes)
- S3-compatible storage (MinIO in dev) — requires `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`
- API proxy: Vite dev server proxies `/api` to `localhost:3000`

## Coding Conventions
- **Naming**: camelCase (variables/functions), PascalCase (components/classes/types)
- **Components**: functional components + hooks only, no class components
- **Backend**: NestJS decorators + dependency injection
- **DTOs**: separate Create/Update DTOs with class-validator
- **Formatting**: Prettier (semi: true, singleQuote: true, printWidth: 100, tabWidth: 2)
- **IDs**: UUID (`@default(uuid())`)
- **Timestamps**: always include `createdAt`, `updatedAt`, `deletedAt`

## Key Routes (grouped)

### Auth & Public
`/login`, `/forgot-password`, `/reset-password`, `/landing`, `/verify/:id`, `/pay/:token`, `/customer-access/:token`

### Core Business
`/` (Dashboard), `/pos`, `/customers(/:id)`, `/contracts(/create/:id/:id/sign)`, `/contract-templates`, `/payments(/import-csv)`, `/receipts`, `/sales`

### Inventory & Supply
`/stock(/transfers/alerts/count/adjustments)`, `/suppliers(/:id)`, `/purchase-orders`, `/stickers`

### Collections & Risk
`/overdue`, `/exchange`, `/repossessions`, `/credit-checks`, `/slip-review`

### Admin & Settings
`/settings(/interest-config/line-oa/sms/pricing-templates)`, `/users`, `/branches`, `/audit-logs`, `/financial-audit`, `/system-status`, `/notifications`, `/migration`, `/pdpa`, `/document-dashboard`

### LINE LIFF (Customer Mobile)
`/liff/contract`, `/liff/early-payoff`, `/liff/history`, `/liff/profile`, `/liff/register`

## User Roles
- **OWNER** — Full access, system settings, user management
- **BRANCH_MANAGER** — Branch-level operations
- **ACCOUNTANT** — Financial access, reports
- **SALES** — Sales operations, POS, customer management

## Testing & Verification
```bash
# TypeScript check
./tools/check-types.sh all

# Full test suite (lint + types + E2E)
./tools/run-tests.sh

# E2E only
cd apps/web && npx playwright test

# Specific E2E test
cd apps/web && npx playwright test e2e/login.spec.ts

# E2E with browser visible
cd apps/web && npx playwright test --headed

# Interactive mode
cd apps/web && npx playwright test --ui
```

## WAT File Structure
```
workflows/                    # Markdown SOPs — read before doing
  create-api-module.md        # สร้าง NestJS module ใหม่
  create-page.md              # สร้าง React page ใหม่
  prisma-changes.md           # แก้ไข Prisma schema
  fix-bug.md                  # Debug & fix bugs
  deploy.md                   # Deployment process
  add-api-endpoint.md         # เพิ่ม endpoint ใน module ที่มีอยู่

tools/                        # Shell scripts — deterministic execution
  generate-module.sh          # Scaffold NestJS module
  check-types.sh              # TypeScript error check
  run-tests.sh                # Full test suite
  db-reset.sh                 # Reset dev database

.claude/skills/               # Agent Skills — slash commands
  create-feature.md           # /create-feature — Full-stack feature
  create-module.md            # /create-module — NestJS API module
  create-page.md              # /create-page — React page + routing
  add-endpoint.md             # /add-endpoint — เพิ่ม API endpoint
  fix-bug.md                  # /fix-bug — Debug & fix bugs
  db-change.md                # /db-change — Prisma schema changes
  pre-deploy.md               # /pre-deploy — Pre-deploy checklist
  run-e2e.md                  # /run-e2e — Playwright E2E tests

.claude/rules/                # Convention rules — auto-loaded
  database.md                 # Prisma/PostgreSQL conventions
  security.md                 # Auth & security patterns
  frontend.md                 # React/Vite/Tailwind patterns
  backend.md                  # NestJS module patterns
  coding-standards.md         # Naming, formatting, general

.claude/agents/               # Subagents — specialized tasks
  code-reviewer.md            # Review code changes by severity
  type-checker.md             # TypeScript error analysis

scripts/                      # Existing project scripts
  backup.sh                   # Database backup
  test-e2e.sh                 # E2E test runner
  deploy-digitalocean.sh      # Production deploy
```

## Important Notes
- `BranchReceivingPage.tsx` is superseded — `/stock/branch-receiving` redirects to `/stock/transfers?view=incoming`.
- **Environment variables**: see `.env.example` for full list
- **CI/CD**: `.github/workflows/deploy.yml` — auto-deploy on push to `main`
