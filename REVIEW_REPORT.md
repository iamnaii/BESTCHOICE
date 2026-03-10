# BESTCHOICE Installment System - Comprehensive Code Review Report

**Date:** 2026-03-10
**Reviewer:** Automated AI Code Review (Claude Opus 4.6)
**Project:** BESTCHOICE - Phone installment payment management system
**Repository:** Monorepo (Turborepo)

---

## 1. Executive Summary

**Overall Health Score: B-**

BESTCHOICE is a well-structured NestJS + React monorepo for managing phone installment sales, with good foundational security (JWT auth, rate limiting, CORS, security headers, input validation). However, 25 npm vulnerabilities (12 high severity), a critical XSS-vulnerable DOMPurify version, missing role protection on several mutation endpoints, and multiple large "god" page components (2000+ lines) present significant risks that should be addressed promptly. The codebase demonstrates solid business logic with proper transaction handling for financial operations but lacks comprehensive test coverage and has several performance concerns around N+1 queries and missing pagination.

---

## 2. Phase 1: Project Understanding

### 2.1 Project Structure

```
BESTCHOICE/                          # Monorepo root (Turborepo)
├── apps/
│   ├── api/                         # NestJS backend API (TypeScript)
│   │   ├── prisma/                  # Database schema & migrations (39 migrations)
│   │   └── src/
│   │       ├── modules/             # 30+ feature modules
│   │       │   ├── auth/            # JWT authentication & authorization
│   │       │   ├── contracts/       # Installment contracts (core)
│   │       │   ├── payments/        # Payment recording & allocation
│   │       │   ├── products/        # Product inventory management
│   │       │   ├── customers/       # Customer management
│   │       │   ├── ocr/             # AI-powered document OCR (Anthropic)
│   │       │   ├── credit-check/    # AI credit scoring
│   │       │   ├── notifications/   # LINE/SMS notifications
│   │       │   ├── audit/           # Audit logging & security middleware
│   │       │   └── ...              # 20+ other modules
│   │       ├── prisma/              # Prisma service/module
│   │       └── utils/               # Shared utilities
│   ├── web/                         # React SPA frontend (Vite + Tailwind)
│   │   └── src/
│   │       ├── pages/               # 40+ page components
│   │       ├── components/          # Shared UI components
│   │       ├── contexts/            # Auth context
│   │       ├── hooks/               # Custom hooks
│   │       ├── lib/                 # API client, utilities
│   │       └── store/               # Zustand state management
│   └── card-reader/                 # Thai smart card reader (Windows desktop)
├── packages/
│   └── shared/                      # Shared constants, types, enums
├── nginx/                           # Reverse proxy config
├── scripts/                         # Deployment & backup scripts
└── docker-compose*.yml              # Container orchestration
```

### 2.2 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Backend** | NestJS | 10.4.x |
| **Frontend** | React | 18.3.x |
| **Build Tool** | Vite | 6.0.x |
| **Database** | PostgreSQL | 16 (via Docker) |
| **ORM** | Prisma | 6.19.x |
| **Auth** | Passport JWT + bcrypt | JWT 10.2, bcrypt 5.1.1 |
| **State Mgmt** | Zustand + React Query | 4.5.x / 5.60.x |
| **CSS** | Tailwind CSS | 3.4.x |
| **AI/OCR** | Anthropic Claude API | SDK 0.78.x |
| **Monorepo** | Turborepo | 2.4.x |
| **Container** | Docker (multi-stage) | Node 20 Alpine |
| **Proxy** | Nginx | Alpine |

### 2.3 Entry Points (API Routes)

| Module | Prefix | Auth | Key Operations |
|--------|--------|------|----------------|
| auth | `/api/auth` | Public/JWT | login, refresh, me |
| users | `/api/users` | JWT+Roles | CRUD, signature management |
| branches | `/api/branches` | JWT+Roles | CRUD |
| products | `/api/products` | JWT+Roles | CRUD, stock, transfers, pricing |
| customers | `/api/customers` | JWT | CRUD, search, risk flags |
| contracts | `/api/contracts` | JWT+Roles | CRUD, workflow, activation, early payoff |
| payments | `/api/payments` | JWT+Roles | record, auto-allocate, daily summary |
| purchase-orders | `/api/purchase-orders` | JWT+Roles | PO lifecycle, receiving |
| ocr | `/api/ocr` | JWT | ID card, payment slip, driving license, book bank |
| credit-check | `/api/credit-check` | JWT+Roles | AI analysis, manual override |
| documents | `/api/documents` | JWT+Roles | Contract templates, signing |
| notifications | `/api/notifications` | JWT+Roles | LINE/SMS, templates, bulk send |
| reports | `/api/reports` | JWT+Roles | Financial reports |
| dashboard | `/api/dashboard` | JWT | Stats, summaries |
| cron | `/api/cron` | JWT+OWNER | Manual cron triggers |
| migration | `/api/migration` | JWT+OWNER | Data import |
| audit | `/api/audit` | JWT+OWNER | Audit log viewing |
| settings | `/api/settings` | JWT+Roles | System configuration |
| health | `/api/health` | Public | Health check |

### 2.4 Main User Flows

1. **Customer Onboarding**: OCR ID card scan → Create customer → Credit check (AI) → Approve
2. **Installment Sale**: Select product → Create contract → Workflow review → Signatures → Activate
3. **Payment Collection**: View pending payments → Record/Auto-allocate → Receipt
4. **Overdue Management**: Auto late fees (cron) → Notifications (LINE/SMS) → Call logs → Repossession
5. **Inventory Management**: Purchase orders → Goods receiving → QC inspection → Pricing → Stock transfer
6. **Reporting**: Daily summaries, revenue reports, overdue analytics

### 2.5 Third-Party Dependencies (Key)

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.78.0 | AI OCR and credit check |
| `bcrypt` | ^5.1.1 | Password hashing |
| `passport-jwt` | ^4.0.1 | JWT authentication |
| `@nestjs/throttler` | ^6.0.0 | Rate limiting |
| `dompurify` | ^3.3.1 | XSS sanitization |
| `xlsx` | ^0.18.5 | Excel import/export |
| `jspdf` | ^4.2.0 | PDF generation |
| `axios` | ^1.7.0 | HTTP client |
| `@tiptap/*` | ^3.20.1 | Rich text editing |
| `@dnd-kit/*` | ^6.3.1 | Drag & drop |

### 2.6 Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `JWT_SECRET` | Yes | Access token signing |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing |
| `JWT_EXPIRATION` | No (15m) | Access token TTL |
| `JWT_REFRESH_EXPIRATION` | No (7d) | Refresh token TTL |
| `ENCRYPTION_KEY` | No | AES key for national IDs |
| `FRONTEND_URL` | No | CORS allowed origins |
| `PORT` | No (3000) | API port |
| `NODE_ENV` | No | Environment mode |
| `ANTHROPIC_API_KEY` | No | AI OCR/credit check |
| `LINE_CHANNEL_ACCESS_TOKEN` | No | LINE messaging |
| `LINE_CHANNEL_SECRET` | No | LINE webhook verification |
| `SMS_API_KEY` | No | ThaiBulkSMS API |
| `SMS_API_SECRET` | No | ThaiBulkSMS password |
| `SMS_SENDER` | No (BESTCHOICE) | SMS sender name |

---

## 3. Phase 2: Security Audit

### CRITICAL Issues

#### SEC-01: Vulnerable DOMPurify Version (XSS)
- **File:** `apps/web/package.json:29`
- **Severity:** Critical
- **Description:** DOMPurify `3.3.1` has a known XSS vulnerability (GHSA-v2wj-7wpq-c8vv). This library is used for sanitizing HTML in template rendering (`BlockRenderer.tsx`), which directly uses `dangerouslySetInnerHTML`.
- **Fix:** Upgrade to `dompurify@^3.3.2` or later.

#### SEC-02: Vulnerable xlsx Library (Prototype Pollution + ReDoS, No Fix Available)
- **File:** `apps/web/package.json:37`
- **Severity:** Critical
- **Description:** `xlsx@0.18.5` has known prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) vulnerabilities with **no fix available**. This library processes user-uploaded Excel files in migration and reporting.
- **Fix:** Migrate to `exceljs` or `SheetJS Pro` which has fixes.

#### SEC-03: Multer DoS Vulnerabilities (3 CVEs)
- **File:** `apps/api/package.json` (transitive via `@nestjs/platform-express`)
- **Severity:** Critical
- **Description:** `multer@<=2.1.0` has three DoS vulnerabilities: resource exhaustion (GHSA-v52c-386h-88mc), uncontrolled recursion (GHSA-5528-5vmv-3xc2), and incomplete cleanup (GHSA-xf7r-hgr6-v32p).
- **Fix:** Upgrade `@nestjs/platform-express` to `^11.1.15+` or NestJS 11.

### HIGH Issues

#### SEC-04: Missing Role Protection on Customer Mutation Routes
- **File:** `apps/api/src/modules/customers/customers.controller.ts:42-49`
- **Severity:** High
- **Description:** `@Post()` (create) and `@Patch(':id')` (update) endpoints have `@UseGuards(JwtAuthGuard, RolesGuard)` at the controller level but **no `@Roles()` decorator** on these methods. This means any authenticated user (including SALES staff) can create and modify any customer record.
- **Fix:** Add `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` to create, `@Roles('OWNER', 'BRANCH_MANAGER')` to update (or whichever roles are appropriate).

#### SEC-05: Missing Role Protection on Inspection Mutation Routes
- **File:** `apps/api/src/modules/inspections/inspections.controller.ts:84-96`
- **Severity:** High
- **Description:** `createInspection`, `updateInspection`, and `completeInspection` endpoints lack `@Roles()` decorators. Any authenticated user can create, modify, and complete product inspections.
- **Fix:** Add appropriate `@Roles()` decorators.

#### SEC-06: Hardcoded Seed Password
- **File:** `apps/api/prisma/seed.ts:58`
- **Severity:** High
- **Description:** Seed file uses hardcoded password `'admin1234'` for all users. While this is a seed file, if accidentally run in production, all accounts would share a weak, known password.
- **Fix:** Use environment variable for seed password or add production guard.

#### SEC-07: Refresh Token Not Invalidated on Rotation
- **File:** `apps/api/src/modules/auth/auth.service.ts:62-98`
- **Severity:** High
- **Description:** When a refresh token is rotated (line 89-92), the old token is not stored/blacklisted. An attacker who intercepts a refresh token can use it indefinitely until it expires (7 days), even after the legitimate user has rotated it.
- **Fix:** Implement a refresh token blacklist (Redis) or store active refresh tokens in the database and invalidate old ones on rotation.

#### SEC-08: JWT Tokens Stored in localStorage
- **File:** `apps/web/src/lib/api.ts:13`, `apps/web/src/contexts/AuthContext.tsx`
- **Severity:** High
- **Description:** Access and refresh tokens are stored in `localStorage`, which is accessible to any JavaScript running on the page. If any XSS vulnerability exists (see SEC-01), tokens can be exfiltrated.
- **Fix:** Migrate to `httpOnly` cookies for token storage, or at minimum use `sessionStorage`.

#### SEC-09: Missing Signature Input Validation
- **File:** `apps/api/src/modules/users/users.controller.ts:22`
- **Severity:** High
- **Description:** `saveSignature` endpoint accepts raw `signatureImage` string from `@Body('signatureImage')` without a DTO class. No validation on size, format, or content of the base64 data.
- **Fix:** Create a DTO with `@IsString()`, `@MaxLength()`, and validate base64 image format.

#### SEC-10: serialize-javascript RCE Vulnerability
- **File:** `node_modules/serialize-javascript` (transitive)
- **Severity:** High
- **Description:** `serialize-javascript@<=7.0.2` has an RCE vulnerability via `RegExp.flags` and `Date.prototype.toISOString()` (GHSA-5c6j-r48x-rmvq).
- **Fix:** Run `npm audit fix` to upgrade.

#### SEC-11: bcrypt Depends on Vulnerable tar
- **File:** `apps/api/package.json` (transitive via bcrypt)
- **Severity:** High
- **Description:** `bcrypt@5.1.1` depends on `@mapbox/node-pre-gyp` which depends on `tar@<=7.5.9` with 5 path traversal vulnerabilities.
- **Fix:** Upgrade to `bcrypt@^6.0.0` (breaking change) or use `bcryptjs` as a pure-JS alternative.

### MEDIUM Issues

#### SEC-12: No CSRF Protection
- **File:** `apps/api/src/main.ts`
- **Severity:** Medium
- **Description:** No CSRF protection is implemented. While JWT Bearer tokens provide some CSRF protection (tokens aren't automatically sent by browsers), the `credentials: true` CORS setting with localStorage tokens means custom CSRF protection is still recommended.
- **Fix:** Implement CSRF tokens for state-changing operations, or migrate to `SameSite=Strict` cookies.

#### SEC-13: Security Middleware Skip Paths Too Broad
- **File:** `apps/api/src/modules/audit/security.middleware.ts:18-24`
- **Severity:** Medium
- **Description:** The `skipScanPaths` array includes `/contracts/`, `/documents`, and `/contract-templates`. These paths skip all XSS/injection scanning of request bodies. While necessary to avoid false positives on HTML content, this creates blind spots.
- **Fix:** Implement targeted scanning that checks non-HTML fields even on these paths, or validate HTML fields separately with DOMPurify server-side.

#### SEC-14: Error Message Leaks Internal Details
- **File:** `apps/api/src/modules/contracts/contracts.service.ts:231`
- **Severity:** Medium
- **Description:** `InternalServerErrorException` includes `err?.message` which may leak database column names, Prisma internals, or stack traces to the client.
- **Fix:** Return a generic error message to the client and log the detailed error server-side only.

#### SEC-15: Weak UID Generation
- **File:** `apps/web/src/utils/uid.ts`
- **Severity:** Medium
- **Description:** Client-side UID generation uses timestamp + counter, which is predictable and can collide across browser sessions.
- **Fix:** Use `crypto.randomUUID()` which is available in all modern browsers.

#### SEC-16: Docker Dev Compose Exposes Ports Publicly
- **File:** `docker-compose.yml:12,20`
- **Severity:** Medium
- **Description:** Development `docker-compose.yml` exposes PostgreSQL (5432) and Redis (6379) on all interfaces. Production compose correctly binds to `127.0.0.1`.
- **Fix:** Bind to `127.0.0.1:5432:5432` and `127.0.0.1:6379:6379` in dev compose.

#### SEC-17: No Redis Authentication
- **File:** `docker-compose.yml:17-20`
- **Severity:** Medium
- **Description:** Redis is configured without a password in both dev and prod. While prod binds to localhost only, this is still a risk if any other process runs on the host.
- **Fix:** Configure Redis with `requirepass` in production.

---

## 4. Phase 3: Bug Detection

### HIGH Issues

#### BUG-01: Payment Schedule Recalculation Incorrect After Partial Payments
- **File:** `apps/api/src/modules/contracts/contracts.service.ts:315`
- **Severity:** High
- **Description:** When updating a contract with paid installments, the remaining financed amount is calculated as `financedAmount - (monthlyPayment * paidCount)`. This doesn't account for partially paid installments or late fees already applied. If a customer has partial payments, the recalculated schedule will be incorrect.
- **Fix:** Calculate remaining principal from actual paid amounts, not estimated values.

#### BUG-02: Race Condition in Contract Activation
- **File:** `apps/api/src/modules/contracts/contracts.service.ts:426-429`
- **Severity:** High
- **Description:** `activate()` uses `this.prisma.$transaction([...])` (array-based batch) which does NOT provide serializable isolation. Two concurrent activation requests for the same contract could both succeed, double-updating the product status.
- **Fix:** Use interactive transaction `$transaction(async (tx) => {...})` and re-check product status inside.

#### BUG-03: Notification `sendBulk` N+1 Query Pattern
- **File:** `apps/api/src/modules/notifications/notifications.service.ts:221-249`
- **Severity:** High
- **Description:** `sendBulk` queries each contract individually inside a for loop (`findUnique` per contractId). For large bulk sends, this creates N+1 queries and can be very slow.
- **Fix:** Fetch all contracts in a single `findMany` query, then iterate.

### MEDIUM Issues

#### BUG-04: Date Calculation Using `getMonth() + i` Without Year Overflow
- **File:** `apps/api/src/utils/installment.util.ts:72-74`
- **Severity:** Medium
- **Description:** Payment schedule date calculation uses `now.getMonth() + i` which can exceed 11. While JavaScript's `Date` constructor handles month overflow correctly (wrapping to next year), the code at line 73 calculates `lastDay` using `targetMonth + 1` which could produce unexpected results for edge cases around year boundaries.
- **Fix:** The current code actually works due to JS Date auto-correction, but should be documented for clarity or refactored to use explicit year calculation.

#### BUG-05: `checkContractCompletion` Type Signature Too Loose
- **File:** `apps/api/src/modules/payments/payments.service.ts:244`
- **Severity:** Medium
- **Description:** The `tx` parameter type is manually defined with `any[]` return types, which bypasses TypeScript type checking. If Prisma's API changes, this won't catch errors at compile time.
- **Fix:** Use `Prisma.TransactionClient` type from `@prisma/client`.

#### BUG-06: Early Payoff Quote Not Idempotent with Concurrent Access
- **File:** `apps/api/src/modules/contracts/contracts.service.ts:495-529`
- **Severity:** Medium
- **Description:** `earlyPayoff` calls `getEarlyPayoffQuote` outside the transaction, then uses that quote's `totalPayoff` inside the transaction. If payments are made between the quote and the transaction, the payoff amount will be stale.
- **Fix:** Recalculate the quote inside the transaction.

#### BUG-07: `overdue.service` Late Fee Calculation Not Checked
- **File:** Multiple cron handlers in `scheduler.service.ts`
- **Severity:** Medium
- **Description:** The `calculateLateFees` and `updateContractStatuses` operations run as separate cron jobs (midnight and 00:30). If `calculateLateFees` fails, `updateContractStatuses` still runs, potentially marking contracts as overdue without applying late fees.
- **Fix:** Either combine into a single transaction or add dependency checking.

### LOW Issues

#### BUG-08: `formatThaiPhone` Doesn't Validate Phone Length
- **File:** `apps/api/src/modules/notifications/notifications.service.ts:168-177`
- **Severity:** Low
- **Description:** The phone formatter strips non-digits and converts `0` prefix to `66`, but doesn't validate that the result is a valid 10-digit Thai phone number (e.g., `66XXXXXXXXX`).
- **Fix:** Add length validation after formatting.

---

## 5. Phase 4: Code Quality & Cleanliness

### HIGH Issues

#### CQ-01: God Page Components (Multiple files exceed 500+ lines)
- **Severity:** High
- **Files and line counts:**
  - `PurchaseOrdersPage.tsx` - **2,172 lines**
  - `ContractCreatePage.tsx` - **1,501 lines**
  - `StockPage.tsx` - **1,157 lines**
  - `StockTransfersPage.tsx` - **883 lines**
  - `POSPage.tsx` - **761 lines**
  - `StockAlertsPage.tsx` - **696 lines**
  - `ContractDetailPage.tsx` - **694 lines**
  - `CustomersPage.tsx` - **687 lines**
  - `ProductCreatePage.tsx` - **685 lines**
  - `SuppliersPage.tsx` - **671 lines**
- **Impact:** These monolithic page components mix form logic, API calls, rendering, and state management in single files. This makes them very hard to test, maintain, and review.
- **Fix:** Extract into sub-components, custom hooks, and separate form/data layers.

#### CQ-02: Duplicated Thai Address Data
- **File:** `apps/web/src/data/thai-address-data.ts` AND `apps/api/src/modules/address/thai-address-data.ts`
- **Severity:** High
- **Description:** 7,533 lines of Thai address data is duplicated between web and API. This is 15,066 lines of identical data.
- **Fix:** Move to `packages/shared` and import from there, or serve from API only.

#### CQ-03: Duplicated Province List
- **File:** `apps/api/src/modules/ocr/ocr.service.ts:32-49`
- **Severity:** Medium
- **Description:** The OCR service has its own hardcoded province list (77 provinces) separate from the Thai address data files. If provinces change or there's a typo, these sources can diverge.
- **Fix:** Import from shared constants.

### MEDIUM Issues

#### CQ-04: Extensive Use of `any` Type
- **Severity:** Medium
- **Files:** Multiple across `documents.service.ts` (lines 363, 369, 374, 375, 389, 390, 463, 597), `contracts.service.ts`, `credit-check.service.ts:163`, utility files
- **Description:** At least 20+ instances of `any` type usage, especially in the documents service which handles contract data rendering. This defeats TypeScript's type safety.
- **Fix:** Define proper interfaces for contract data, payment data, and customer data.

#### CQ-05: Large Backend Services
- **Severity:** Medium
- **Files:**
  - `products-stock.service.ts` - 899 lines
  - `purchase-orders.service.ts` - 846 lines
  - `ocr.service.ts` - 794 lines
  - `documents.service.ts` - 727 lines
- **Fix:** Extract sub-services (e.g., `ProductTransferService`, `ProductQCService`).

#### CQ-06: `@types/jspdf` Listed as Production Dependency
- **File:** `apps/web/package.json:27`
- **Severity:** Low
- **Description:** `@types/jspdf` is a type definition package listed under `dependencies` instead of `devDependencies`.
- **Fix:** Move to `devDependencies`.

### LOW Issues

#### CQ-07: Inconsistent Error Response Language
- **Severity:** Low
- **Description:** Error messages are a mix of Thai and English across the codebase. Backend uses mostly Thai error messages (e.g., `'อีเมลหรือรหัสผ่านไม่ถูกต้อง'`), while some HTTP exceptions use English (e.g., `'Invalid request payload'`).
- **Fix:** Standardize on Thai for user-facing errors with English error codes for logging.

#### CQ-08: TypeScript Strict Flags Disabled in Web
- **File:** `apps/web/tsconfig.json:15-16`
- **Severity:** Low
- **Description:** `noUnusedLocals` and `noUnusedParameters` are set to `false`, allowing dead code to accumulate.
- **Fix:** Enable these flags and clean up unused declarations.

---

## 6. Phase 5: Performance Review

### HIGH Issues

#### PERF-01: N+1 Query in Notification Bulk Send
- **File:** `apps/api/src/modules/notifications/notifications.service.ts:221-249`
- **Severity:** High
- **Description:** `sendBulk()` executes a separate `findUnique` for each contract ID in the loop, creating N+1 queries. For 100 contracts, this means 100 individual database queries.
- **Fix:** Use `findMany({ where: { id: { in: contractIds } } })` to batch-load all contracts.

#### PERF-02: Missing Pagination on Multiple List Endpoints
- **File:** Multiple controllers/services
- **Severity:** High
- **Description:** Several `findAll` methods return all records without pagination:
  - `users.service.ts:12-26` - Returns ALL users
  - `branches.service.ts` - Returns ALL branches
  - `suppliers.service.ts` - Returns ALL suppliers
  - `notificationLogs` - Limited to 50 but no offset pagination
- **Fix:** Add cursor-based or offset pagination to all list endpoints.

### MEDIUM Issues

#### PERF-03: Dashboard Makes Many Parallel Queries Without Caching
- **File:** `apps/api/src/modules/dashboard/dashboard.service.ts`
- **Severity:** Medium
- **Description:** Dashboard stats fire many parallel count/aggregate queries on every page load. These rarely change and could be cached for 1-5 minutes.
- **Fix:** Implement Redis caching or in-memory cache with TTL for dashboard stats.

#### PERF-04: Full Customer Object Included in Contract Queries
- **File:** `apps/api/src/modules/contracts/contracts.service.ts:67`
- **Severity:** Medium
- **Description:** `findOne()` includes `customer: true` which fetches ALL customer fields including potentially large `references` JSON, `addressIdCard`, `addressCurrent`, etc. Many callers only need `name` and `phone`.
- **Fix:** Use `select` to limit returned fields, or create separate `findOneWithDetails` for the detail page.

#### PERF-05: No Connection Pooling Configuration
- **File:** `apps/api/src/prisma/prisma.service.ts`
- **Severity:** Medium
- **Description:** Prisma connection pooling uses defaults. For production workloads with multiple concurrent users, the default pool size (based on CPU cores) may be insufficient.
- **Fix:** Configure `connection_limit` in the `DATABASE_URL` query parameter.

#### PERF-06: Base64 Image Upload Instead of Binary
- **File:** Multiple endpoints (OCR, product photos, signatures, contract documents)
- **Severity:** Medium
- **Description:** All file uploads use base64 encoding in JSON bodies, which increases payload size by ~33% and requires parsing the entire payload into memory. The API allows 20MB bodies (`main.ts:16`).
- **Fix:** Use `multipart/form-data` for file uploads with streaming.

### LOW Issues

#### PERF-07: Frontend Lazy Loading Could Be More Granular
- **File:** `apps/web/src/App.tsx`
- **Severity:** Low
- **Description:** While route-level lazy loading is implemented, large shared component libraries (Tiptap, jsPDF, xlsx) are not code-split.
- **Fix:** Use dynamic imports for heavy libraries used only on specific pages.

---

## 7. Phase 6: Architecture & Design Review

### Strengths
- Clean modular NestJS architecture with proper separation of concerns
- Prisma ORM prevents SQL injection by default
- Global validation pipe with whitelist/forbidNonWhitelisted
- Global throttle guard with configurable rate limiting
- Audit interceptor logs all mutating operations with sensitive field redaction
- Security middleware adds comprehensive HTTP security headers
- Proper transaction handling for financial operations (payments, contracts)
- Contract workflow with approval process prevents unauthorized activation
- Environment validation at startup ensures required vars are present
- Docker multi-stage builds with non-root user
- Nginx reverse proxy with rate limiting and security headers
- Graceful shutdown handling (`app.enableShutdownHooks()`)

### Issues

#### ARCH-01: No Centralized Error Handler
- **Severity:** Medium
- **Description:** Error handling is done per-service with catch blocks. There is no global exception filter to standardize error responses, mask internal errors in production, or ensure consistent error format.
- **Fix:** Implement a global `AllExceptionsFilter` that standardizes error responses.

#### ARCH-02: No API Versioning
- **Severity:** Medium
- **Description:** All routes are under `/api/` with no version prefix. Adding breaking changes will affect all clients simultaneously.
- **Fix:** Add `/api/v1/` prefix for versioning.

#### ARCH-03: Business Logic in Controllers
- **Severity:** Low
- **Description:** Some controllers contain light business logic (e.g., extracting IP address in `documents.controller.ts:59-64`). While minor, this reduces testability.
- **Fix:** Move all business logic to services.

#### ARCH-04: No Structured Logging
- **Severity:** Medium
- **Description:** The NestJS `Logger` is used throughout, which outputs plain text. For production observability with log aggregation tools (ELK, Datadog), structured JSON logging is preferred.
- **Fix:** Configure NestJS to use a structured logger (e.g., `pino` or `winston` with JSON format).

#### ARCH-05: Missing Database Abstraction Layer
- **Severity:** Low
- **Description:** Services directly use `PrismaService` for database access. While Prisma provides a good abstraction, there's no repository pattern, making it harder to swap the database or add cross-cutting concerns like caching.
- **Fix:** Consider a lightweight repository pattern for complex entities (contracts, products).

---

## 8. Phase 7: Dependency Health Check

### npm audit Results: 25 vulnerabilities (4 low, 9 moderate, 12 high)

| Package | Severity | CVE/Advisory | Fix Available |
|---------|----------|-------------|---------------|
| **dompurify** 3.3.1 | Moderate (XSS) | GHSA-v2wj-7wpq-c8vv | Yes: `npm audit fix` |
| **xlsx** 0.18.5 | High (Prototype Pollution + ReDoS) | GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9 | **No fix available** |
| **multer** <=2.1.0 | High (3 DoS CVEs) | GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc, GHSA-5528-5vmv-3xc2 | Breaking: upgrade NestJS |
| **serialize-javascript** <=7.0.2 | High (RCE) | GHSA-5c6j-r48x-rmvq | Yes: `npm audit fix` |
| **tar** <=7.5.9 | High (5 path traversal CVEs) | Multiple | Breaking: upgrade bcrypt |
| **glob** 10.2-10.4 | High (Command injection) | GHSA-5j98-mcp5-4vw2 | Breaking: upgrade @nestjs/cli |
| **ajv** 7.0-8.17.1 | Moderate (ReDoS) | GHSA-2g4f-4pwh-qvx6 | Breaking: upgrade @nestjs/cli |
| **lodash** 4.0-4.17.21 | Moderate (Prototype Pollution) | GHSA-xxjr-mmjv-4gpg | Breaking: upgrade @nestjs/config |
| **esbuild** <=0.24.2 | Moderate (SSRF) | GHSA-67mh-4wv8-2f99 | Breaking |
| **webpack** 5.49-5.104 | Moderate (SSRF) | GHSA-8fgc-7cc6-rx7x | Breaking: upgrade @nestjs/cli |
| **tmp** <=0.2.3 | High (Symlink) | GHSA-52f5-9888-hmc6 | Breaking: upgrade @nestjs/cli |

### Recommended Safe Upgrades (Non-Breaking)
```bash
npm audit fix  # Fixes: dompurify, serialize-javascript
```

### Recommended Breaking Upgrades (Planned)
1. `bcrypt@5.1.1` → `bcrypt@6.0.0` (fixes tar vulnerabilities)
2. `@nestjs/platform-express@10.4.0` → `@nestjs/platform-express@11.1.15+` (fixes multer DoS)
3. Replace `xlsx@0.18.5` with `exceljs` (no fix available for xlsx)
4. `@nestjs/cli@10.4.0` → `@nestjs/cli@11.0.16+` (fixes glob, ajv, webpack, tmp)

---

## 9. Phase 8: Missing Essentials Checklist

- [x] `.gitignore` - Covers node_modules, .env, dist, uploads, coverage, .prisma, .DS_Store
- [x] `.env.example` - Documents all 17 environment variables with descriptions
- [x] `README.md` - Has DEPLOY.md and IMPLEMENTATION-GUIDE.md (no top-level README.md)
- [x] Error handling middleware - `SecurityMiddleware` handles XSS, `AuditInterceptor` logs errors
- [x] Request validation middleware - Global `ValidationPipe` with whitelist + forbidNonWhitelisted
- [x] Logging setup - NestJS Logger used throughout (not structured JSON)
- [x] Health check endpoint - `AppController` with `/api/health` route
- [x] Graceful shutdown handling - `app.enableShutdownHooks()` in main.ts
- [x] Input sanitization - `SecurityMiddleware` scans for XSS/injection patterns
- [x] CORS configuration - Configured with allowed origins from env
- [x] Rate limiting - Global throttle (30 req/s) + per-endpoint overrides + Nginx rate limiting
- [ ] **Missing:** Global exception filter (centralized error response formatting)
- [ ] **Missing:** Top-level README.md with setup instructions
- [ ] **Missing:** Structured JSON logging for production
- [ ] **Missing:** API versioning
- [ ] **Missing:** Refresh token invalidation/blacklist
- [ ] **Missing:** CSRF protection
- [ ] **Missing:** Comprehensive test suite (only 2 test files found: `auth.service.spec.ts`, `ocr.service.spec.ts`)

---

## 10. Statistics

### Issues by Category

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 3 | 8 | 6 | 0 | 17 |
| Bugs | 0 | 3 | 4 | 1 | 8 |
| Code Quality | 0 | 2 | 3 | 3 | 8 |
| Performance | 0 | 2 | 4 | 1 | 7 |
| Architecture | 0 | 0 | 3 | 2 | 5 |
| **Total** | **3** | **15** | **20** | **7** | **45** |

### Codebase Statistics

| Metric | Value |
|--------|-------|
| Total source files (TS/TSX) | ~180 |
| Total lines of code | ~63,637 |
| API modules | 30+ |
| Frontend pages | 40+ |
| Database models | 25+ |
| Database migrations | 39 |
| npm vulnerabilities | 25 (12 high) |
| Test files | 2 |
| Test coverage | Very low (<5% estimated) |

---

## 11. Recommended Fix Order

### Immediate (S - Small effort, do today)
1. **SEC-01** - Upgrade DOMPurify: `npm audit fix` [S]
2. **SEC-10** - Fix serialize-javascript: `npm audit fix` [S]
3. **SEC-16** - Bind dev Docker ports to localhost [S]
4. **SEC-14** - Remove internal error details from client responses [S]
5. **SEC-15** - Replace UID generation with `crypto.randomUUID()` [S]

### This Week (M - Medium effort)
6. **SEC-04** - Add `@Roles()` to customers controller [S]
7. **SEC-05** - Add `@Roles()` to inspections controller [S]
8. **SEC-09** - Add signature validation DTO [S]
9. **SEC-02** - Replace `xlsx` with `exceljs` [M]
10. **SEC-07** - Implement refresh token blacklist [M]
11. **BUG-02** - Fix race condition in contract activation [M]
12. **BUG-01** - Fix payment schedule recalculation [M]

### This Sprint (L - Large effort)
13. **SEC-03** - Upgrade NestJS to fix multer DoS [L]
14. **SEC-08** - Migrate tokens to httpOnly cookies [L]
15. **SEC-11** - Upgrade bcrypt to v6 [M]
16. **PERF-01** - Fix N+1 in notification bulk send [S]
17. **PERF-02** - Add pagination to all list endpoints [M]
18. **CQ-01** - Refactor large page components [L]
19. **CQ-02** - Deduplicate Thai address data [M]
20. **ARCH-01** - Add global exception filter [M]
21. **ARCH-04** - Implement structured logging [M]
22. **BUG-06** - Fix early payoff race condition [M]

### Backlog
23. **CQ-04** - Eliminate `any` types [M]
24. **CQ-05** - Split large backend services [L]
25. **PERF-03** - Add dashboard caching [M]
26. **PERF-06** - Migrate to multipart file uploads [L]
27. **ARCH-02** - Add API versioning [M]
28. **SEC-12** - Implement CSRF protection [M]
29. Increase test coverage to >60% [L]

---

## 12. Patches for Critical Issues

### Patch 1: Upgrade DOMPurify (SEC-01)

```diff
--- a/apps/web/package.json
+++ b/apps/web/package.json
@@ -26,7 +26,7 @@
     "clsx": "^2.1.1",
-    "dompurify": "^3.3.1",
+    "dompurify": "^3.4.0",
     "jspdf": "^4.2.0",
```

### Patch 2: Add Missing Role Protection on Customer Routes (SEC-04)

```diff
--- a/apps/api/src/modules/customers/customers.controller.ts
+++ b/apps/api/src/modules/customers/customers.controller.ts
@@ -39,10 +39,12 @@
   }

   @Post()
+  @Roles('OWNER', 'BRANCH_MANAGER', 'SALES')
   create(@Body() dto: CreateCustomerDto) {
     return this.customersService.create(dto);
   }

   @Patch(':id')
+  @Roles('OWNER', 'BRANCH_MANAGER')
   update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
     return this.customersService.update(id, dto);
   }
```

### Patch 3: Fix Race Condition in Contract Activation (BUG-02)

```diff
--- a/apps/api/src/modules/contracts/contracts.service.ts
+++ b/apps/api/src/modules/contracts/contracts.service.ts
@@ -420,10 +420,20 @@
-    // Verify product is still reserved for this contract
-    const product = await this.prisma.product.findUnique({ where: { id: contract.productId } });
-    if (!product || (product.status !== 'RESERVED' && product.status !== 'IN_STOCK')) {
-      throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
-    }
-
-    await this.prisma.$transaction([
-      this.prisma.contract.update({ where: { id }, data: { status: 'ACTIVE' } }),
-      this.prisma.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } }),
-    ]);
+    await this.prisma.$transaction(async (tx) => {
+      // Re-verify product status inside transaction to prevent race condition
+      const product = await tx.product.findUnique({ where: { id: contract.productId } });
+      if (!product || (product.status !== 'RESERVED' && product.status !== 'IN_STOCK')) {
+        throw new BadRequestException('สินค้าไม่พร้อมสำหรับเปิดสัญญา (อาจถูกขายหรือลบไปแล้ว)');
+      }
+
+      await tx.contract.update({ where: { id }, data: { status: 'ACTIVE' } });
+      await tx.product.update({ where: { id: contract.productId }, data: { status: 'SOLD_INSTALLMENT' } });
+    });
```

### Patch 4: Bind Dev Docker Ports to Localhost (SEC-16)

```diff
--- a/docker-compose.yml
+++ b/docker-compose.yml
@@ -9,12 +9,12 @@
       POSTGRES_DB: installment_db
     ports:
-      - '5432:5432'
+      - '127.0.0.1:5432:5432'
     volumes:
       - postgres_data:/var/lib/postgresql/data

   redis:
     image: redis:7-alpine
     container_name: installment-redis
     ports:
-      - '6379:6379'
+      - '127.0.0.1:6379:6379'
     volumes:
       - redis_data:/data
```

### Patch 5: Fix Internal Error Message Leak (SEC-14)

```diff
--- a/apps/api/src/modules/contracts/contracts.service.ts
+++ b/apps/api/src/modules/contracts/contracts.service.ts
@@ -228,7 +228,7 @@
         }

-        throw new InternalServerErrorException(`ไม่สามารถสร้างสัญญาได้: ${err?.message || 'ข้อผิดพลาดไม่ทราบสาเหตุ'}`);
+        throw new InternalServerErrorException('ไม่สามารถสร้างสัญญาได้ กรุณาลองใหม่อีกครั้ง');
       }
     }
```

### Patch 6: Replace Weak UID Generator (SEC-15)

```diff
--- a/apps/web/src/utils/uid.ts
+++ b/apps/web/src/utils/uid.ts
@@ -1,6 +1,3 @@
-let counter = 0;
 export function uid(): string {
-  counter++;
-  return Date.now().toString(36) + counter.toString(36);
+  return crypto.randomUUID();
 }
```

---

*End of Report*
