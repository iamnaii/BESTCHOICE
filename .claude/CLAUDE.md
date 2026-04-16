# BESTCHOICE - ระบบผ่อนชำระ (Installment Management System)

## Project Overview
BESTCHOICE is a full-stack installment payment management system for mobile/phone shops in Thailand.

## Business Model
- ปัจจุบัน 1 นิติบุคคล แบ่ง 2 ส่วนธุรกิจ (วางแผนแยก 2 นิติบุคคลในอนาคต):
  - **BESTCHOICE SHOP** (หลายสาขา) — ขายมือถือใหม่+มือสอง+แถมอุปกรณ์เสริม, **ไม่จด VAT**
  - **BESTCHOICE FINANCE** (ส่วนกลาง) — จัดไฟแนนซ์, **จด VAT**, ถือกรรมสิทธิ์สินค้าระหว่างผ่อน
- เจ้าของเดียวกันทั้ง SHOP + FINANCE, บัญชีธนาคารแยก, LINE OA แยก
- ขายเงินสด, ผ่อน (จำนวนงวดตั้งค่าได้, flat rate), ผ่านไฟแนนซ์ภายนอก (GFIN)
- รับซื้อมือถือมือสองจากลูกค้า (ตรวจสภาพ → ตีราคาตามตารางกลาง → จ่ายเงินสด → เข้าสต็อก SHOP)
- มือสองขายผ่อนได้เหมือนเครื่องใหม่

### Flow เงินเมื่อขายผ่อน
- ลูกค้าจ่ายดาวน์ → **SHOP เก็บ**
- FINANCE จ่ายให้ SHOP = **ยอดจัดไฟแนนซ์ + ค่าคอม** (% ของยอดจัด)
- กรรมสิทธิ์สินค้าย้ายจาก SHOP → FINANCE (จนลูกค้าผ่อนครบ)
- ลูกค้าจ่ายค่างวดให้ FINANCE (โอน/PaySolutions QR ผ่าน LINE)
- **VAT 7%** คิดจาก (เงินต้น+ดอกเบี้ย+ค่าคอม) → รวมในค่างวด → นำส่งรายเดือนตามจ่ายจริง

### ระบบภายนอก
- PEAK (บัญชี), CHATCONE (แชท LINE/Facebook/TikTok), MDM PJ-Soft (ล็อคเครื่อง), PaySolutions (QR)

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite 6 + Tailwind CSS + shadcn/ui + Radix UI (`apps/web`)
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
- **Admin (OWNER)**: admin@bestchoice.com / admin1234
- **ผจก.สาขา**: manager.ladprao@bestchoice.com / admin1234
- **ผจก.การเงิน**: finance@bestchoice.com / admin1234
- **พนง.ขาย**: sales1@bestchoice.com / admin1234
- **ฝ่ายบัญชี**: accountant@bestchoice.com / admin1234

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
| ตรวจสอบระบบบัญชี | `/accounting-audit` | ต้องการตรวจสอบระบบบัญชีตามหลักบัญชีไทย (TAS/TFRS) |

Skills อยู่ใน `.claude/skills/` — แต่ละ skill จะ:
1. อ่าน workflow ที่เกี่ยวข้องก่อนเริ่มงาน
2. ถาม input ที่จำเป็นจาก user
3. ค้นหา existing code ก่อนสร้างใหม่
4. ใช้ tools (generate-module.sh, check-types.sh) อัตโนมัติ
5. Verify ด้วย TypeScript check

### Anthropic Skills (General-Purpose)

Skills จาก [anthropics/skills](https://github.com/anthropics/skills) ที่ install ไว้ — ใช้ได้กับทุกงานไม่จำกัดเฉพาะ BESTCHOICE

| Category | Skills | ใช้เมื่อ |
|----------|--------|---------|
| Documents | `/docx`, `/xlsx`, `/pdf`, `/pptx` | สร้าง/แก้เอกสาร Word, Excel, PDF, PowerPoint |
| Design | `/frontend-design`, `/canvas-design`, `/algorithmic-art` | สร้าง UI สวยๆ, poster, generative art |
| Styling | `/theme-factory`, `/brand-guidelines` | ใส่ theme/branding ให้ artifacts |
| Dev Tools | `/claude-api`, `/mcp-builder`, `/webapp-testing` | Claude API, สร้าง MCP server, ทดสอบ web app |
| Communication | `/internal-comms`, `/doc-coauthoring` | เขียน comms ภายใน, ร่วมเขียนเอกสาร |
| Creative | `/slack-gif-creator`, `/web-artifacts-builder` | สร้าง GIF, สร้าง web artifacts |
| Meta | `/skill-creator` | สร้าง/แก้ไข skills ใหม่ |

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
      modules/[feature]/     # NestJS modules (48+ features incl. company, journal, tax, commission, trade-in, promotions)
        [feature].module.ts
        [feature].controller.ts
        [feature].service.ts
        dto/                 # class-validator DTOs
      guards/                # CsrfGuard, UserThrottlerGuard
      modules/auth/guards/   # JwtAuthGuard, RolesGuard
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
docs/
  guides/                    # DEPLOY.md, IMPLEMENTATION-GUIDE.md
  specs/                     # SPEC-installment.md, PLAN-contract-system.md
  reports/                   # REVIEW_REPORT.md, audit reports
  references/                # agent-teams-reference.md
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
- **UI**: shadcn/ui components + Radix UI primitives + Tailwind CSS + lucide-react icons
- **Theme**: Minimal Zinc + Emerald Accent (ธาตุไม้), White/Light sidebar, IBM Plex Sans Thai font
- **Design tokens**: CSS variables in `index.css` — ห้ามใช้ hardcoded hex/gray colors, ใช้ tokens เท่านั้น (bg-primary, text-muted-foreground, etc.)

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

### Revenue & Tax
`/commissions`, `/tax-reports`, `/trade-in`, `/promotions`

### Admin & Settings
`/settings(/interest-config/line-oa/sms/pricing-templates/companies)`, `/users`, `/branches`, `/audit-logs`, `/financial-audit`, `/system-status`, `/notifications`, `/migration`, `/pdpa`, `/document-dashboard`

### LINE LIFF (Customer Mobile)
`/liff/contract`, `/liff/early-payoff`, `/liff/history`, `/liff/profile`, `/liff/register`

## User Roles
- **OWNER** — Full access, system settings, user management
- **BRANCH_MANAGER** — Branch-level operations
- **FINANCE_MANAGER** — Financial oversight, contract approval, reports, cross-branch access
- **ACCOUNTANT** — Financial access, reports, payment recording
- **SALES** — Sales operations, POS, customer management, own commissions

## Multi-Entity Structure
- **BESTCHOICE SHOP** (companyCode: "SHOP") — ไม่จด VAT, ทุก branch อยู่ใต้ SHOP
- **BESTCHOICE FINANCE** (companyCode: "FINANCE") — จด VAT 7%, ส่วนกลาง ไม่มี branch
- CompanyInfo model เชื่อมกับ Branch via `companyId`
- Inter-company transactions track FINANCE↔SHOP flows

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
  accounting-audit.md         # /accounting-audit — ตรวจระบบบัญชี
  # Anthropic Skills (from github.com/anthropics/skills)
  algorithmic-art/            # Generative art with p5.js
  brand-guidelines/           # Brand identity guidelines
  canvas-design/              # Visual art (.png/.pdf)
  claude-api/                 # Claude API/SDK integration
  doc-coauthoring/            # Co-authoring documentation
  docx/                       # Word document manipulation
  frontend-design/            # Production-grade UI design
  internal-comms/             # Internal communications
  mcp-builder/                # MCP server builder
  pdf/                        # PDF manipulation
  pptx/                       # PowerPoint manipulation
  skill-creator/              # Create/improve skills
  slack-gif-creator/          # Animated GIFs for Slack
  theme-factory/              # Theme styling toolkit
  web-artifacts-builder/      # Complex web artifacts
  webapp-testing/             # Playwright web testing
  xlsx/                       # Excel spreadsheet manipulation

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
  # Production: deploy via GitHub Actions → GCP Cloud Run
```

## Important Notes
- `BranchReceivingPage.tsx` is superseded — `/stock/branch-receiving` redirects to `/stock/transfers?view=incoming`.
- **Environment variables**: see `.env.example` for full list
- **CI/CD**: `.github/workflows/deploy.yml` — auto-deploy on push to `main`
- **Database backups**: ใช้ Cloud SQL automated backups + PITR ของ GCP (managed, encrypted at rest). ไม่มี script-based backup แล้ว — `scripts/backup.sh` ลบไปใน 2026-04-09 เพราะเป็น legacy จากตอน self-hosted

## Hardening History (ultraplan v1, v2, v3)

โปรเจคผ่าน hardening sprints 3 รอบ — สิ่งที่ทำเสร็จแล้วและไม่ต้องทำซ้ำ:

### v1 (PR #430, #431)
- Soft-delete + `ownedByCompanyId` บน Product (SHOP↔FINANCE transfer)
- BranchGuard บน 22 controllers
- `branch-access.util.ts` — `CROSS_BRANCH_ROLES` source of truth
- Company CRUD + ownership-aware delete guard
- **QueryBoundary บน ~44 หน้า** — ทุกหน้า data list มี error+retry UI
- Sentry: ErrorBoundary, AuthContext user tagging, QueryClient 5xx forwarding
- 332 API + 104 web tests baseline

### v2 (PR #432, #435, #436)
- Sentry capture บน 17 cron jobs + BullMQ worker exhausted retries
- PaySolutions atomicity (gateway+DB ใน `$transaction`, orphan-intent Sentry alarm)
- Commission Decimal precision (`Prisma.Decimal` แทน `Number()`)
- Repossessions previewCalculation: full Decimal arithmetic
- 66 new tests: useContractCalculation (16), commission (20), finance-receivable (21), excel.util (9)
- a11y: PaymentTable checkbox aria-label, DashboardAlerts native button
- FinanceReceivable `(status, branchId)` compound index

### v3 (PR #437, #438, #439)
- **Account lockout**: 5 failed → 15 min lock (`User.failedLoginAttempts` + `lockedUntil`)
- **Cascade → Restrict** บน Payment + 4 doc tables (Payment, EDocument, Signature, CallLog, ContractDocument) — ป้องกัน accidental hard-delete erasing legal evidence
- **PaySolutions fetch timeout** 15s + AbortController + Sentry on timeout
- **PII webhook log allow-list** (refno, result_code, etc. เท่านั้น)
- **Bundle split**: exceljs/jspdf/recharts แยก chunks — initial bundle saving ~525KB gzip
- **bad-debt.service.spec.ts** — 22 tests (aging buckets, idempotency, segregation of duties)
- **Webhook hardening**: LINE Finance prod-strict, SMS webhook throttle 60/min
- **PaySolutions webhook idempotency**: retry ไม่ double-credit ไม่ false orphan alarm
- **6 missing FK indexes** (bad-debt, trade-in, expense compound)
- **Log retention cron**: AuditLog 1yr + NotificationLog 6mo
- **Backup AES-256 encryption** (refuse to run ถ้าไม่มี `BACKUP_ENCRYPTION_KEY`)

### v4 (PR #444, #445, #446, #447, #448)
- **Journal unbalanced → throw + Sentry** (was silent `return null` — P0 bug)
- **Sentry capture** บน 5 cron jobs ที่เหลือ + 2 retention crons
- **Decimal precision**: 53 `Number()` → `Prisma.Decimal` ใน 12 services (0 `Number(_sum` remaining)
- **Bad debt write-off journal**: `Dr. Bad Debt Expense / Cr. HP Receivable` auto-created
- **+177 API tests**: accounting (47), contracts (42), sales (27), journal-auto (+25), repossessions (15), trade-in (18), trial balance e2e (1)
- **Form modernization**: 3 forms → react-hook-form + zod (POS, PlanDetailsStep, Customers) with inline validation
- **ContractCreate auto-save**: localStorage draft, 30s interval, 24hr expiry, recovery prompt
- **A11y**: 0 `alt=""` + ESLint rule, SkipLink, prefers-reduced-motion, div→button fixes
- **Breadcrumb** wired into 5 detail pages via PageHeader `breadcrumb` prop
- **useCopyToClipboard** hook + copy buttons (contract#, IMEI, phone)
- **Dashboard KPI** consumes `getComparativePL` → MoM/YoY badges
- **QueryBoundary** on 6 remaining pages, **confirm()→ConfirmDialog** 3 pages
- **DevOps**: `/health` endpoint (DB+S3 probes), `x-request-id` tracing, structured logging 5 services
- **Retention crons**: ChatMessage 6mo + DocumentAuditLog 2yr
- **Backup runbook** + restore drill checklist
- **`.claude/rules/accounting.md`** — TFRS for NPAEs policy, chart of accounts, journal templates

### Test counts after v4
- API: **577 tests** (26 suites)
- Web: **129 tests** (11 files)
- TypeScript: 0 errors

### Things deferred (out of scope of v1-v4)
- VAT-on-interest (CR-001) — owner skip, ต้องปรึกษานักบัญชี
- GFIN integration — รอ business flow
- E2E expansion — มี 35 specs แต่ส่วนใหญ่เป็น smoke tests
- Off-site backup replication (GCS sync — runbook documented, implementation pending)
- PII column-level encryption (PDPA strict mode)
- Interest recognized upfront vs accrual (N-005 — ต้อง CPA review)
- Unearned interest field (W-003 — ต้อง business decision)
