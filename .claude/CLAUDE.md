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
- **ภาษีซื้อเครื่องขายผ่อน (ก้อน 5 · 2026-10-05)**: FINANCE เคลม `Dr 11-4101 / Cr 42-1108` วันเปิดสัญญา (ต้องมีใบกำกับภาษีจากผู้จัดจำหน่ายที่จด VAT) · ยอด VAT เห็นเฉพาะ OWNER/FM/ACCOUNTANT (ตัดฝั่ง server) · ใบกำกับที่มาทีหลังบันทึกที่ใบรับของ แล้วเคลมย้อนให้สัญญาที่รอ — `.claude/rules/accounting.md` หัวข้อ "ภาษีซื้อของเครื่องที่ขายผ่อน"

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
   - Frontend reference: `apps/web/src/pages/CustomersPage/` (โฟลเดอร์ — ไฟล์เดี่ยว `CustomersPage.tsx` ถูกลบแล้ว) หรือ `apps/web/src/pages/StockPage/`

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
| `qa-engineer` | ต้องการรันชุดทดสอบ (Jest/Vitest/Playwright), triage failures, และประเมิน coverage gaps ก่อน merge/deploy |

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
`/overdue`, `/letters` (queue + bulk print + dispatch tracking), `/repossessions` (ใบรับเครื่องคืน + รอยึดเครื่อง + ยึดคืน & ขายต่อ — เมนู "รับเครื่องคืน / ยึดคืน"), `/credit-checks`, `/slip-review`, `/after-sales(/:id|/new)` (หลังการขาย — ใบรับฝาก/ใบส่งมอบ PDF; `/insurance*` เหลือ redirect)

### Revenue & Tax
`/commissions`, `/tax-reports`, `/trade-in`, `/promotions`, `/shop/accounting` (งบทดลอง + P&L SHOP), `/shop/daily-cash` (สรุปเงินหน้าร้านรายวัน), `/shop/petty-cash` (เงินสดย่อย S11-1106 — เติม/คืน/วงเงิน · กติกาใน `.claude/rules/accounting.md`)

### Admin & Settings
`/settings` (registry-driven panel: `/settings/:categoryId`; old paths redirect), `/users`, `/branches`, `/audit-logs`, `/financial-audit`, `/system-status`, `/notifications`, `/migration`, `/pdpa`, `/document-dashboard`

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
  qa-engineer.md              # Run tests + triage failures + coverage gaps

scripts/                      # Existing project scripts
  backup.sh                   # Database backup
  test-e2e.sh                 # E2E test runner
  # Production: deploy via GitHub Actions → GCP Cloud Run
```

## Important Notes
- **แจ้งพนักงานทาง LINE (2026-10-26 · ก้อน 7 A16)**: โมดูล global `apps/api/src/modules/staff-notify` — ท่อเดียว `StaffNotifyService.notify(event, payload)` (ไม่ throw · ฉีด `@Optional()` ที่จุดเรียก) · แคตตาล็อก 18 เหตุการณ์ใน `staff-event-catalog.ts` · กติกาผู้รับ (บทบาท/สาขา/กลุ่ม) ใน SystemConfig `staff_notify_rules` แก้ที่ แจ้งเตือน › แท็บ "แจ้งพนักงาน (LINE)" (OWNER) · เพดาน `staff_notify_monthly_cap` 280/เดือน · ผู้รับ = `User.lineStaffUserId` ที่ผูกด้วยรหัส 6 หลักผ่าน webhook Staff OA `POST /webhooks/line-staff` (หน้าผู้ใช้ › ไลน์พนักงาน) — **`User.lineId` เป็นไอดีค้นหาเพื่อน ใช้ push ไม่ได้** · กันซ้ำด้วย `NotificationLog.relatedId = staff:<event>:<dedupeKey>` · **เพิ่มเหตุการณ์ใหม่ = เพิ่มใน catalog + เรียก `notify` หลัง commit** (ห้ามส่ง LINE พนักงานตรงจาก NotificationsService/LineOaService อีก) · cron เงินสดหน้าร้าน `CashCloseAlertsCron` 10:00 ไทย · spec `docs/superpowers/specs/2026-10-26-staff-line-notify-design.md`
- **ถังขยะรวม (2026-10-26 · ก้อน 8 A10)**: ตั้งค่า › ระบบ & ความปลอดภัย › ถังขยะ (`/settings/system/trash`, OWNER) กู้ของที่ soft-delete ตาม **allow-list เดียว** `apps/api/src/modules/trash/trash-registry.ts` (30 ประเภทกู้ได้ + สินค้า/ร่างสัญญาแบบดูอย่างเดียว) · กู้ = `deletedAt: null` ใน tx + ตรวจเฉพาะประเภท (ล็อกเบอร์ลูกค้า+ซ้ำ · เลขใบรายจ่ายซ้ำ · ร่างเท่านั้น · โควต้าแม่แบบ) + audit `RESTORED` ผ่าน `AuditService.log` หลัง commit · ประเภทที่การลบตั้ง flag ปิด (`isActive`/`active`/`enabled`) **กลับมาแบบปิดใช้งาน** ต้องเปิดเองที่หน้านั้น (ยกเว้นแม่แบบแจ้งเตือน/ดอกเบี้ยที่หน้าไม่มีสวิตช์ → กู้แล้วเปิดเลย ดอกเบี้ยห้ามทับตัวที่เปิดอยู่ในหมวดเดียวกัน) · **แถวที่ผู้ใช้ระบบลบ (audit userId = isSystemUser) กู้ไม่ได้** · สินค้ากู้ผ่านคำขอ "พบของคืน" เท่านั้น (`/stock/adjustments?request=found&q=<imei>`) · ร่างสัญญากู้ไม่ได้ (ตอนลบคืนเงินดาวน์/เครดิตแล้ว) · ใบขาย/ค่างวด/JE/การรวมผู้ติดต่อ ไม่เข้าถัง (`deletedAt` = ยกเลิก) · **เพิ่มประเภท = เพิ่ม entry เดียวใน registry** (เทส R2 บังคับว่า select ตรงสคีมา) · "ลบโดย" มาจาก AuditLog `(entity, entityId)` ±10 นาที · ไม่มีลบถาวร · spec `docs/superpowers/specs/2026-10-26-trash-bin-design.md`
- **ลงเวลาทำงาน (2026-10-27 · ก้อน 10 D3)**: เลิกเครื่องสแกนนิ้ว — ตอกเข้า-ออกได้ที่ **แท็บเล็ตประจำสาขาเท่านั้น** หน้า `/kiosk` (สาธารณะ ไม่มี JWT · `KioskPublicController`) · ผูกเครื่องด้วยรหัสลงทะเบียน 8 ตัว อายุ 10 นาที ใช้ครั้งเดียว (ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร, OWNER) · **token เครื่องหมุนเฉพาะเมื่องานสำเร็จ — ใน tx เดียวกับงาน + จำคำตอบ** (`AttendanceDeviceService.commitRotation`) ⇒ รหัสผิด/409/เน็ตหลุด/500 = token เดิมยังใช้ได้ · `requestId` ส่งซ้ำได้ผลเดิม (คำตอบหาย = ออก token รุ่นถัดไปใหม่ให้ · คำตอบที่จำไว้ไม่มี token ดิบ) · แข่งกันหมุน = 409 `REQUEST_BUSY` ไม่ล็อก · token รุ่นเก่ามากับ requestId อื่น = ถูกคัดลอก ⇒ เครื่อง `LOCKED` + ธง `DEVICE_CONFLICT` ย้อนถึง**จุดแยก** (เวลาที่ token รุ่นนั้นถูกใช้) ทั้งแถวตอกและแถววันตาม (คน, วัน) + Todo เจ้าของ · error ตอบผ่าน `KioskExceptionFilter` ของ controller (filter กลางตัด `code` ทิ้ง) · เว็บ `kiosk-api.ts` คิวคำขอเดียว + จด pending requestId ใน store ก่อนส่ง (ลองใหม่ = requestId เดิม · คำขอใหม่กู้คำตอบที่ค้างก่อน) · ปลดล็อก = ยกเลิก + ลงทะเบียนใหม่ · พนักงานกรอกรหัส 6 หลัก (`User.attendancePinHash` = `hashPII` unique ทั้งบริษัท · ตั้ง/รีเซ็ตที่หน้าผู้ใช้ OWNER แสดงครั้งเดียว) + รูปหลักฐาน · ผิด 5 ครั้งพักรหัสทั้งเครื่อง 15 นาที · กติกา**ฟังก์ชันเดียว** `attendance/attendance-rules.ts` (kiosk/แก้ไข/cron): เวลางานค่าระบบ 10:00–19:00 ตั้งทับรายสาขาได้ (`Branch.workStart/workEnd`) · สายเกินผ่อนผัน (ค่าเริ่ม 15 นาที) · OT = เวลาที่ทำจริงหลังเลิกงาน นับจาก max(เวลาเลิกงาน, เวลาเข้า) เมื่อออกหลังเลิกงาน ≥ 15 นาที ปัดเศษของชั่วโมงตามตารางเจ้าของ (<15 = 0 · 15–44 = 0.5 · 45–59 = 1 ชม.) · วันหยุด/ลา/ร้านปิดไม่นับสาย/ออกก่อน · สาย/OT เก็บแยก ไม่หักลบกัน · OUT ข้ามเที่ยงคืนผูกแถวเมื่อวานได้เฉพาะแถวที่ IN มาไม่เกิน 18 ชม. · ธงประกอบ `NETWORK_CHANGED` / `LOCATION_CHANGED` (ห่างจุดตอกก่อน > 500 ม.) · cron 00:05 ปิดวัน (ไม่ตอกออก = `MISSING_OUT` OT 0 · วันทำงานไม่มา = ขาด · ทั้งสาขาไม่มีรายการเลย = `DEVICE_UNAVAILABLE` ไม่นับขาด) · 03:30 ลบรูปเกินอายุ (ค่าเริ่ม 365 วัน) + เครื่องเงียบเกิน 24 ชม. แจ้งเจ้าของ · เมนู **ลงเวลา** `/attendance` (OWNER/BM: วันนี้ · รายเดือน+Excel · ตารางหยุด/ลา · แก้ไขพร้อมเหตุผล ≥ 10 ตัว (ล้างเวลาเข้าได้ = ไม่มา) · ตารางหยุด/ลา = วางแผนล่วงหน้าเท่านั้น (วันที่ผ่านแล้วล็อก · ผจก.เฉพาะพนักงานสาขาตัวเอง) · BM แก้แถวตัวเองไม่ได้ · ธงชนล้างได้เฉพาะเจ้าของ "ตรวจแล้ว ล้างธง") · **เวลาทำงานของฉัน** `/attendance/me` ทุก role อ่านอย่างเดียว · สิทธิ์ใหม่ `attendance.read` / `attendance.manage` / `attendance.devices` (boundary = `selection` ห่อ handler · manifest `resolution: record` — ห้ามเป็น collection ที่แทน handler) · ก้อน 9 D4 (เงินเดือน/OT 1.5 × เงินเดือน÷30÷8) ใช้ข้อมูลจากตาราง `attendance_days` · spec `docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md`
- **บิลประจำ — เตือนจ่ายล่วงหน้า (2026-10-26 · ก้อน 6 D5)**: แม่แบบรายจ่าย `isRecurring` + `recurrence/recurringDay/recurringMonth/reminderLeadDays/startsOn` → cron `RecurringBillsCron` 08:05 ไทย (advisory lock กันหลาย instance) สร้างแถว `recurring_bill_occurrences` ต่องวด + **ร่าง**ใบรายจ่าย (ลงวันครบกำหนด) + งาน /todos tag `recurring-bill` + แจ้ง OWNER/ACCOUNTANT (LINE = log จนกว่าก้อน 7 A16) · ระบบ**ไม่โพสต์/ไม่จ่าย**ให้ — "จ่ายแล้ว" อ่านจากใบ `POSTED` + `paidAt` หรือคนกดเอง (= PAID_UNPOSTED จนกว่าจะลงบัญชี) · แม่แบบไม่ตั้งวิธีจ่าย+บัญชี ⇒ ร่างโพสต์ได้แค่ตั้งหนี้ · งวดหลุดเกิน 7 วัน = SKIPPED ระบบ + งานตรวจ · หน้า `/expenses/recurring-bills` + กล่องตั้งบิลบน `/expenses/favorites` · spec `docs/superpowers/specs/2026-10-26-recurring-bill-reminders-design.md`
- **ด่าน blacklist ตอนทำสัญญา (2026-10-24 · ก้อน 5 C3)**: `CustomerBlacklistService` (`customers/customer-blacklist.service.ts`, โมดูล `CustomerBlacklistModule`) ประเมินจากสถานะปัจจุบัน — **HARD** (ไม่มีใครปลด รวม OWNER): มีสัญญาผ่อนอยู่ `ACTIVE/OVERDUE/DEFAULT` (1 คน 1 เครื่อง) · `TERMINATED` ยังไม่คืนเครื่อง/รอ FINANCE ยืนยัน · เคยถูกยึด/คืนเอง (`Repossession`) · เคยตัดหนี้สูญ · tag `BLACKLIST` · เบอร์หลักซ้ำกับคนใน set — **SOFT** (OWNER/BM ปลดพร้อมเหตุผล 10–500 ตัว): ผู้อ้างอิงพัวพันกับคนใน set ทั้งสองทิศ (จับคู่ด้วยเบอร์) · การปลดบันทึกลง `Contract.blacklistOverrideReason/-ById/-At` + audit `CONTRACT_BLACKLIST_OVERRIDDEN` หลัง commit · ตรวจ **สองจุด**: `ContractLifecycleService.create()` (409 `CUSTOMER_BLACKLISTED` / `CUSTOMER_BLACKLIST_REVIEW`) และ `ContractWorkflowService.activate()` (สัญญาเปลี่ยนเครื่อง `exchangedFromContractId` และสัญญาทดแทนเปลี่ยนเครื่องตำหนิ `parentContractId`→`DEFECT_EXCHANGED` ข้าม · SOFT ผ่านเมื่อร่างปลดไว้ **หรือ OWNER/BM ส่ง `blacklistOverrideReason` ใน body ตอนเปิดใช้** — หน้าสัญญาเปิด `BlacklistOverrideDialog`) + `assertCustomerContractPolicy(tx, customerId)` fail-closed ใน tx ทั้งสองจุด · ช่อง "อนุมัติผ่อนซ้อน" (`overrideActiveContractCheck`) ถอดแล้วทั้ง API/web · โหมดทดสอบไม่ข้ามด่านนี้ · อ่านผล `GET /customers/:id/blacklist` · `GET /customers/blacklist?ids=` (≤100) · web: `useCustomerBlacklist` + `CustomerBlacklistBadge` (หน้าสร้างสัญญา fail-closed · `/credit-checks` · หัวหน้าลูกค้า · แผงแชท) · spec `docs/superpowers/specs/2026-10-23-contract-blacklist-gate-design.md`
- **เปลี่ยนเครื่องแบบมีราคา (device swap) ปิดใช้ (2026-10-06 — คำตัดสินเจ้าของ "ลูกค้าต้องปิดยอดก่อนถึงจะทำสัญญาผ่อนใหม่ได้")**: นโยบายอยู่ที่ `apps/api/src/modules/contract-exchange/device-swap-closed.policy.ts` — `computeOutcomes` คืน `PRICED_EXCHANGE` enabled:false พร้อมเหตุผล · `createCase` outcome PRICED / `approvePriced` / `preview` / legacy `insurance/exchange-requests` submit·preview·approve = **410 Gone** ข้อความชี้ทาง (ปิดยอดก่อนกำหนดแล้วเปิดสัญญาใหม่ · คำขอค้างให้เจ้าของ "ปฏิเสธ") · ยังเปิด: ปฏิเสธ / ยกเลิก swap / finalize ของคำขอที่อนุมัติไว้ก่อน · เว็บไม่มีปุ่ม "อนุมัติ" (ApprovePricedDialog ถูกถอด) · **เปลี่ยนเครื่องตำหนิ 7 วัน (SAME_MODEL_EXCHANGE) ไม่กระทบ** · engine `ContractExchangeService.submit/approve/buildPreview` ไม่มีผู้เรียกใน production (คง integration spec กติกาบัญชี A.1–A.5)
- **เปลี่ยนเครื่องตำหนิ 7 วันเมื่อสัญญาเดิมมีการชำระแล้ว (2026-10-17 · 15ข/18.3ข)**: ด่าน C-6 ถูกถอด — ใบรับเงินทุกใบของสัญญาเดิมได้ใบลดหนี้ (`cnSource DEFECT_EXCHANGE` · ไม่ส่ง LINE) · เงินเดินผ่าน 21-1106 ไม่แตะธนาคาร → เครดิต 21-5101 สัญญาใหม่ (T = ส่วนเพิ่มของ 21-1106 ใน tx) · `activate(id, actorId?)` ใช้เครดิตชำระงวดอัตโนมัติหลัง commit · เคยปรับดิว = ปฏิเสธ · กติกาเต็ม `.claude/rules/accounting.md` หัวข้อ "เปลี่ยนเครื่องตำหนิ 7 วัน เมื่อสัญญาเดิมมีการชำระแล้ว"
- **ตัดสินค้า (2026-10-05 · ก้อน 3)**: เมนู คลังสินค้า › ตัดสินค้า (`/stock/adjustments`) — ผู้ขอ SALES/BM/OWNER ส่งคำขอ `SA-YYYYMMDD-NNNN` (เหตุผล สูญหาย/เสียหาย/ตัดจำหน่าย พักขายเครื่องด้วยสถานะ `ADJUSTMENT_PENDING` · เสียหายต้องมีรูป) → **เจ้าของอนุมัติทุกใบ** → `Dr S53-1102 / Cr S11-200x` เฉพาะเครื่องที่ลงบัญชีรับเข้าแล้ว (`resolveBookedInventory`) · เสียหายคงในสต๊อกไม่ลง (ข7) · พบของคืน = กลับรายการ · PATCH สถานะตัดสินค้า/ลบเครื่องที่ลงบัญชีแล้วถูกปิด · กติกาเต็ม `.claude/rules/accounting.md` หัวข้อ "ตัดสินค้า — สูญหาย/เสียหาย/ตัดจำหน่าย/พบของคืน" · เอกสารถึงฝ่ายบัญชี `docs/accounting/stock-writeoff-2026-10.md` · **2026-10-06**: เครื่องจากใบสั่งซื้อที่ยังอยู่ในคิวรอถ่ายรูป (`GoodsReceivingItem.journalEntryId` ว่าง + `PHOTO_PENDING`) **ขอตัดสินค้าไม่ได้** — ต้องตีกลับผู้จัดจำหน่ายที่ รอถ่ายรูป › ไม่รับเข้าคลัง (`poUnbookedBlock` ใน `createRequest`/`preview`) · เครื่องจาก PO ที่ถูกเปลี่ยนสถานะมือออกจากคิว: **ตั้งแต่ 2026-10-13 (ฝ่ายบัญชีข้อ 7 แบบ ข) อนุมัติตัด = ลงรับเข้าก่อนแล้วตัด** (ไม่มี Todo unbooked อีก)
- **ใบรับเครื่องคืน (2026-09-20)**: สาขา (OWNER/BM/SALES) บันทึก `POST /device-returns` (`DR-YYYYMMDD-NNNN`) → VOLUNTARY flip เป็น `TERMINATED` ทันทีและเก็บ `previousContractStatus`; REPOSSESSION ใช้สัญญา `TERMINATED` อยู่แล้ว + ไลน์แจ้งลูกค้า (`DEVICE_RETURNED` — แม่แบบ seed ด้วย migration `20261003200000_seed_device_return_templates`, idempotent `ON CONFLICT DO NOTHING`) → OWNER/FM ยืนยันใน `RepossessionOverlay` โหมดยืนยันอย่างเดียว (`POST /device-returns/:id/confirm` → `RepossessionsService.createInTx`; `POST /repossessions` + `create()` ถูกลบ) → JP5 ขา Dr = `11-2107` stamp `DEVICE_RETURN` เสมอ + SHOP `Dr S11-2002 / Cr S21-1104` → ค่าเครื่องหักในรอบจ่าย INTER-CO (แถวประเภทที่ 3 `deviceReturnAmount`) หรือ `POST /interco-settlement/device-returns/:contractId/settle-cash`; tag AUTO `RETURNED_DEVICE`; journey `DEVICE_RETURNED`; ชิป "คืนเครื่อง" ในวิซาร์ดรับชำระถูกถอด · ส่งกลับ/ยกเลิกคืนสถานะ VOLUNTARY เฉพาะเมื่อมี `previousContractStatus` และสัญญายัง `TERMINATED`; ไม่คืนทับสถานะที่เปลี่ยนไปแล้ว และ REPOSSESSION ไม่เปลี่ยนสถานะ · กติกาเต็ม: `.claude/rules/accounting.md` หัวข้อย่อย "ใบรับเครื่องคืน (DeviceReturn)" + `.claude/rules/database.md` หัวข้อ "ใบรับเครื่องคืน"
- **เริ่มใช้คลัง+จัดซื้อจริงบน DB ที่ยังทดสอบ (2026-09-05)**: spec `docs/superpowers/specs/2026-09-05-stock-go-live-design.md` · runbook `docs/accounting/stock-go-live-runbook-2026-09.md` · แหล่งความจริงของ "ข้อมูลทดสอบ" = `apps/api/src/utils/test-data-markers.ts` (marker `TEST-` / `ทดสอบระบบ` / `[ทดสอบระบบ]` / ที่อยู่ลูกค้า `ข้อมูลทดสอบระบบ — ลบได้` — **ห้ามเปลี่ยนค่า, ห้ามมีสำเนา, ห้ามเพิ่มคอลัมน์ isTest**) · รั้ว `assertSameTestSide` ที่ POS/เปิดสัญญา/ใบจอง/เปลี่ยนเครื่อง (submit+approve)/เคลมเปลี่ยนเครื่อง (ไม่มี flag ปิด — เปลี่ยนเครื่องสืบทอดเฉพาะลูกค้า เครื่องเลือกใหม่ = คู่ใหม่) · `wipe:stock-go-live` ล้างคลังด้วย timestamp เดียว (ย้อนกลับได้; เอกสารเคลื่อนไหวเลือกด้วย marker ของใบ ไม่ใช่ตามเครื่อง) · **`factory:reset` ปฏิเสธเมื่อมีของจริง** (`ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE` ข้ามได้ — dev seed ไม่มี marker จึงต้องตั้งทุกครั้งบน dev แม้ `DRY_RUN=1`; บน prod = ตั้งใจทิ้งคลังจริง) — ของที่คีย์ทดสอบด้วยมือโดยไม่มี marker = ถือเป็นของจริง
- `BranchReceivingPage.tsx` is superseded — `/stock/branch-receiving` redirects to `/stock/transfers?view=incoming`.
- **ยกเลิกใบขาย (void sale, 2026-08-23)**: `POST /sales/:id/void` (OWNER / BM สาขาตัวเอง) สำหรับ `CASH` + `EXTERNAL_FINANCE` — กติกาเต็มใน `.claude/rules/accounting.md` หัวข้อ "ยกเลิกใบขาย (void sale)"; `ShopCashSaleTemplate` **มี production caller** (`sale-writer.service.ts` ตั้งแต่ 2026-06-23) — กล่อง "WIRING STATUS — DEFERRED" ใน accounting.md มี stale note กำกับแล้ว อย่าอ่านว่าการขายสดไม่ลง JE
- **Environment variables**: see `.env.example` for full list
- **CI/CD**: `.github/workflows/deploy.yml` — auto-deploy on push to `main`
- **Database backups**: ใช้ Cloud SQL automated backups ของ GCP (managed, encrypted at rest). ไม่มี script-based backup แล้ว — `scripts/backup.sh` ลบไปใน 2026-04-09 เพราะเป็น legacy จากตอน self-hosted
  > ⚠️ **PITR ปิดอยู่** (ตรวจ 2026-08-25: `settings.backupConfiguration.pointInTimeRecoveryEnabled` **ไม่มีคีย์นี้เลย**ใน `gcloud sql instances describe bestchoice-db`) — บรรทัดนี้เคยเขียนว่า "automated backups + PITR" ซึ่ง**ไม่จริง** ⇒ จุดกู้คืนที่มีจริงคือ **backup รายวัน 03:00 UTC เก็บ 7 ชุด** เท่านั้น (เสียข้อมูลได้ถึง 24 ชม.) · ก่อนงานที่แก้ข้อมูลเยอะให้สร้าง on-demand ก่อนเสมอ: `gcloud sql backups create --instance=bestchoice-db --description="..."` · `transactionLogRetentionDays=7` ที่ตั้งไว้ **ไม่ได้แปลว่า PITR เปิด**

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

### v5 (PR #__ — Promise-to-Pay Lifecycle Redesign 2026-04-27)
- **PromiseSlot model** — 1 promise → N "ที่" (slots). Replaces 2-slot split (legacy `secondSettlementDate/Amount` deprecated, kept for backward compat)
- **Lifecycle fields on CallLog**: `supersededAt`, `supersededByCallLogId`, `keptAt`, `canceledAt`, `cycleStartedAt`, `cycleDeadline`, `rescheduleCount`, `targetInstallmentIds[]`. Self-relation `PromiseSupersedeChain`
- **`Contract.keptPromiseCount`** — denormalized counter. Source of truth = `KEPT_PROMISE` AuditLog (matches existing `BROKEN_PROMISE` pattern via auto-assign.service)
- **`PromiseService`** at `apps/api/src/modules/overdue/promise.service.ts` — `findActivePromise`, `createPromise` (supersede + reschedule penalty), `calcCycleDeadline` (next future Payment.dueDate or last-day-of-next-month fallback)
- **`promise-resolution.cron`** (hourly) — replaces `broken-promise.cron`. Resolves PromiseSlot.keptAt/brokenAt + auto-MDM-lock on broken
- **`no-promise-lock.cron`** (hourly) — 2 consecutive `NO_ANSWER`/`UNREACHABLE` callLogs + no active promise → MDM auto-lock
- **`MdmLockService.autoLock` + `autoUnlock`** — no-approval lock/unlock paths (audit logs `MDM_AUTO_LOCK`/`MDM_AUTO_UNLOCK`). Idempotent
- **PaymentService real-time hook** `checkPromiseAfterPayment` — non-blocking after Payment.create. Detects all-slots-kept → marks promise kept + auto-unlock when whole cycle paid
- **ContactLogDialog redesign** — N-slot manager (replaces 2-slot toggle), cycle deadline banner, sum indicator, supersede confirm dialog, FIFO installment picker (override available)
- **`SupersedePromiseConfirmDialog`** — shows broken-vs-not-broken before reschedule (≥2 reschedule or past-due slot = broken)
- **`InstallmentPickerPopover`** — checkbox UI to override default FIFO installment allocation
- **PromiseTab** — slot status chips (kept/broken/pending) + cycle countdown with reschedule count
- **2 new endpoints**: `GET /overdue/contracts/:id/cycle-deadline` (also returns activePromise summary), `GET /overdue/contracts/:id/overdue-installments`
- **Reschedule rules**: ก่อนวันนัด ครั้งที่ 1 ฟรี (no broken), ≥2 ครั้ง = นับ broken; หลังวันนัด = นับ broken เสมอ
- **Grace 1 day** consistent across kept/broken decision (cron cutoff = `now - 1d`)
- **Backfill script** `npm run backfill:promise-slots` (in apps/api) — migrates legacy `secondSettlementDate/Amount` to PromiseSlot rows + computes historical `keptAt`/`keptPromiseCount`
- **`Payment` IS the installment** (not separate `Installment` model — discovered during impl, plan/spec adjusted)
- **AuditLog conventions** confirmed: `entity` (lowercase), `userId` real UUID FK, `ipAddress` optional. New actions: `BROKEN_PROMISE`, `KEPT_PROMISE`, `MDM_AUTO_LOCK`, `MDM_AUTO_UNLOCK`

### v6 (PR #__ — SP5 Phase 2 Insurance / Repair Ticket)
- **RepairTicket** model with 6-status lifecycle (OPEN → IN_PROGRESS → READY_FOR_PICKUP → CLOSED/REPLACED/CANCELLED)
- Auto-detect warranty status (IN_7DAY_DEFECT / IN_SHOP_WARRANTY / IN_MANUFACTURER / OUT_OF_WARRANTY / WALK_IN) from contract.deviceReceivedAt + shopWarrantyEndDate + product.warrantyExpireDate
- Auto-create ExpenseDocument (payer=SHOP) or OtherIncome (payer=CUSTOMER) draft on ticket close — atomic via `$transaction`
- Reuses `Supplier` model + new `isRepairCenter` flag (repair centers are SHOP suppliers)
- Replace flow integrates with existing `/defect-exchange` via `bypassWindowCheck` flag (OWNER/BM only) — atomic markReplaced across both modules
- Audit trail: 9 new AuditLog action strings + per-status-transition RepairStatusLog rows
- SystemConfig keys: `REPAIR_EXPENSE_ACCOUNT_CODE` (S51-1105) + `REPAIR_INCOME_ACCOUNT_CODE` (S42-1101)
- Test counts: API +62 (repair-tickets) +5 (defect-exchange bypass) = +67 tests
- Frontend: `/insurance` promoted from redirect stub → full list/detail/create UI with 5 action dialogs + 3 reusable badge/timeline components

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
