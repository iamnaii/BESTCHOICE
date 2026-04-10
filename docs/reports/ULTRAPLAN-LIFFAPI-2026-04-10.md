# Ultraplan — LIFF API Integration Hardening (2026-04-10)

**สถานะ**: Proposed
**Branch**: `claude/ultraplan-liffapi-integration-YyeBo`
**Baseline**: 7 LIFF pages, 15 LIFF endpoints (across 2 controllers), 0 LIFF-specific tests, `liffApi` without envelope unwrap, no server-side LIFF token verification

---

## Executive Summary

ระบบ LIFF API ทำงานได้ครบ flow (register → view contracts → pay → history → early payoff → profile) แต่มีช่องโหว่ด้าน **security**, **architecture**, และ **quality** ที่ต้องแก้ก่อน scale:

1. **Security gap ร้ายแรง** — Backend เชื่อ `lineId` จาก client โดยไม่ verify กับ LINE API → ใครก็เข้าถึงข้อมูลลูกค้าได้ถ้ารู้ LINE userId
2. **ไม่มี DTO validation** — LIFF endpoints ใน `line-oa.controller.ts` ใช้ raw `@Body()` / `@Query()` ไม่มี class-validator → input injection risk
3. **Monolithic controller** — `line-oa.controller.ts` 1029 บรรทัด ผสม webhook + chatbot + LIFF API + admin settings → ยากต่อ maintain
4. **Frontend anti-patterns** — 5/7 LIFF pages ใช้ raw `useEffect + liffApi` แทน `useQuery/useMutation` (ผิด frontend rules)
5. **Error response ไม่สม่ำเสมอ** — บาง endpoint return `{ error: '...' }` (200), บาง endpoint throw exception (4xx) → frontend ต้อง handle 2 แบบ
6. **0 unit tests** สำหรับ LIFF endpoints — ไม่มี safety net

**Target**: 5 phases, ~55 tasks. Phase 1 เป็น **P0** — ต้องทำก่อน go-live กับลูกค้าจริง

---

## New Findings (2026-04-10 update)

จาก deep-dive รอบ 2 พบปัญหาเพิ่มเติมที่ไม่อยู่ใน draft แรก:

### [L-001] Decimal Precision Leak — 27 จุดใน 4 ไฟล์ LIFF
- **ไฟล์**: `line-oa.controller.ts` (14 จุด), `line-oa-payment.controller.ts` (9 จุด), `line-oa.service.ts` (3 จุด), `payment-link.service.ts` (1 จุด)
- **ปัญหา**: ใช้ `Number(p.amountDue)`, `Number(c.sellingPrice)`, etc. แปลง `Prisma.Decimal` → `Number` ก่อนส่ง LIFF response
- **ผลกระทบ**: precision loss ที่ satang → ลูกค้าเห็นยอดผิดเล็กน้อย + running total ผิดสะสม
- **ตัวอย่าง**: `line-oa.controller.ts:684` — `reduce((sum, p) => sum + Number(p.amountDue) + Number(p.lateFee) - Number(p.amountPaid), 0)` ใช้ float arithmetic
- **แก้**: ใช้ `Prisma.Decimal` arithmetic ทั้ง chain แล้ว `.toNumber()` เฉพาะตอนส่ง response; หรือส่ง string แล้ว format ที่ frontend

### [L-002] Slip Upload ใช้ Local Filesystem — ❌ Cloud Run Incompatible
- **ไฟล์**: `line-oa-payment.controller.ts:565-569`, `line-oa.controller.ts:227-231`
- **ปัญหา**: `fs.mkdirSync('uploads/slips/')` + `fs.writeFileSync(filePath, file.buffer)` — ใช้ local disk
- **ผลกระทบ**: Cloud Run ใช้ ephemeral filesystem → ไฟล์หายหลัง container recycle → สลิปที่ upload หาย
- **แก้**: เปลี่ยนเป็น S3-compatible storage (MinIO dev / GCS prod) ที่โปรเจคมี config อยู่แล้ว (`S3_ENDPOINT`, `S3_BUCKET`)

### [L-003] Webhook Dedup ใช้ In-Memory Map — ❌ Multi-Instance Unsafe
- **ไฟล์**: `chatbot-finance.controller.ts:13-66`
- **ปัญหา**: `new WebhookDedup()` ใช้ `Map<eventId, timestamp>` — comment ในโค้ดเขียนไว้เลยว่า "in-memory dedup only works within a single process. For multi-instance deployments (Cloud Run scale-out), consider Redis-based dedup."
- **ผลกระทบ**: Cloud Run auto-scale → duplicate events processed ข้ามอินสแตนซ์ → ข้อความซ้ำ
- **แก้**: Redis-based dedup (ถ้ามี Redis) หรือ database-based idempotency key

### [L-004] PDPA Consent — Field มี Endpoint ไม่มี
- **ไฟล์**: `schema.prisma:471-472` — `chatConsent Boolean @default(false)`, `chatConsentAt DateTime?`
- **ปัญหา**: Prisma model มี field สำหรับ consent แต่ไม่มี LIFF endpoint ให้ลูกค้ากดยินยอม/ถอนยินยอม
- **ผลกระทบ**: PDPA compliance gap — เก็บข้อมูลแชทโดยยังไม่มีกลไกขอ consent อย่างเป็นทางการ
- **แก้**: เพิ่ม `POST /line-oa/liff/consent` + UI ใน LIFF page (modal ก่อนใช้งานครั้งแรก)

---

## Current LIFF API Inventory

### Backend Endpoints

#### `line-oa.controller.ts` (Public LIFF section, lines 664-803)
| Method | Path | Purpose | Auth | DTO |
|--------|------|---------|------|-----|
| GET | `/line-oa/liff/contracts` | ดูสัญญาทั้งหมด | lineId query | ❌ |
| POST | `/line-oa/liff/register/lookup` | ค้นหาลูกค้าจากเบอร์โทร | lineId body | ❌ |
| POST | `/line-oa/liff/register/confirm` | ยืนยันผูกบัญชี | lineId body | ❌ |
| GET | `/line-oa/liff/history` | ดูประวัติการชำระ | lineId query | ❌ |
| GET | `/line-oa/liff/profile` | ดูโปรไฟล์ลูกค้า | lineId query | ❌ |
| POST | `/line-oa/liff/unlink` | ยกเลิกผูก LINE | lineId body | ❌ |

#### `line-oa-payment.controller.ts` (LIFF payment section)
| Method | Path | Purpose | Auth | DTO |
|--------|------|---------|------|-----|
| GET | `/line-oa/pay/:token` | Resolve payment link | token param | ❌ |
| POST | `/line-oa/slip-upload` | อัพโหลดสลิป | token body | ❌ (file validator only) |
| POST | `/line-oa/liff/create-payment-link` | สร้าง payment link | lineId body | ❌ |
| GET | `/line-oa/liff/early-payoff-quote` | คำนวณยอดปิดก่อนกำหนด | lineId query | ❌ |
| POST | `/line-oa/liff/early-payoff` | สร้าง early payoff link | lineId body | ❌ |

#### `chatbot-finance-liff.controller.ts` (Finance bot LIFF) ✅ Well-structured
| Method | Path | Purpose | Auth | DTO |
|--------|------|---------|------|-----|
| GET | `/chatbot/finance/liff/status` | เช็คสถานะ link | lineUserId query | ❌ (manual check) |
| POST | `/chatbot/finance/liff/request-otp` | ส่ง OTP | lineUserId body | ✅ `RequestOtpDto` |
| POST | `/chatbot/finance/liff/verify-otp` | ยืนยัน OTP | lineUserId body | ✅ `VerifyOtpDto` |
| POST | `/chatbot/finance/liff/feedback` | ส่ง feedback | lineUserId body | ✅ `SubmitFeedbackDto` |

### Frontend Pages

| Route | File | Lines | Uses useQuery | Uses liffApi |
|-------|------|-------|:---:|:---:|
| `/liff/contract` | `LiffContract.tsx` | 464 | ✅ | ✅ |
| `/liff/register` | `LiffRegister.tsx` | 284 | ❌ | ✅ |
| `/liff/history` | `LiffHistory.tsx` | 167 | ❌ | ✅ |
| `/liff/profile` | `LiffProfile.tsx` | 194 | ❌ | ✅ |
| `/liff/early-payoff` | `LiffEarlyPayoff.tsx` | 202 | ❌ | ✅ |
| `/liff/finance-verify` | `LiffFinanceVerify.tsx` | 332 | ❌ | ✅ |
| `/pay/:token` | `LiffPayment.tsx` | 653 | ❌ | ✅ |

### Infrastructure

| File | Purpose | Issues |
|------|---------|--------|
| `useLiffInit.ts` (58 lines) | LIFF SDK init + LINE profile | Returns `lineId` but no ID token |
| `api.ts:143` — `liffApi` | Separate axios instance | No response envelope unwrap |
| `useMockPayment.ts` (144 lines) | Mock payment for prototyping | Unused — dead code |

### Database Models (LIFF-related)

| Model | Purpose | Issues |
|-------|---------|--------|
| `Customer` (lineId field) | เชื่อม LINE userId กับลูกค้า (Shop OA) | Legacy single-field; ใช้ `CustomerLineLink` สำหรับ multi-channel |
| `CustomerLineLink` | Multi-channel binding (SHOP/FINANCE/STAFF) | ✅ Well-designed |
| `ChatSession` | Finance bot session per customer per channel | ✅ Includes verification state |
| `ChatMessage` | ข้อความในแชท | ✅ Includes AI metadata (tokens, cost) |
| `ChatbotOtpRequest` | OTP storage (SHA256 hashed) | ✅ DB-backed, multi-instance safe |
| `ChatAutoTrigger` | Scheduled reminders (T-5, T-3, T-1, T+1...) | ✅ Idempotency key |
| `ChatFeedback` | User 👍/👎 rating | ✅ |
| `ChatKnowledgeBase` | FAQ templates for bot | ✅ Priority-ranked |
| `PaymentEvidence` | สลิปที่ลูกค้า upload | ⚠️ `imageUrl` is local path — needs S3 migration |
| `PaymentLink` | Short-lived payment tokens | ✅ Status lifecycle (ACTIVE → USED/EXPIRED) |

### Decimal Precision Issues

| File | Occurrences | Location |
|------|:-----------:|----------|
| `line-oa.controller.ts` | 14 | LIFF contract/payment response builders + chatbot handlers |
| `line-oa-payment.controller.ts` | 9 | Evidence amount, payment link resolution, slip upload |
| `line-oa.service.ts` | 3 | Receipt/history helpers |
| `payment-link.service.ts` | 1 | Amount calculation |
| **Total** | **27** | — |

---

## Phase 1 — Security Hardening (Priority: P0)

**Theme**: ปิดช่องโหว่ security ที่ทำให้ข้อมูลลูกค้ารั่วได้ — **ต้องทำก่อน go-live**

### 1A: LIFF Token Verification (Server-side)

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 1.1 | สร้าง `LiffTokenGuard` — verify LIFF ID token via LINE API (`https://api.line.me/oauth2/v2.1/verify`) แทนการเชื่อ lineId จาก client | `apps/api/src/modules/line-oa/guards/liff-token.guard.ts` (NEW) | M | Med |
| 1.2 | อัปเดต `useLiffInit` hook — เพิ่ม `liff.getIDToken()` ส่งเป็น header `X-Liff-Id-Token` ทุก request | `apps/web/src/hooks/useLiffInit.ts` | S | Low |
| 1.3 | อัปเดต `liffApi` interceptor — attach `X-Liff-Id-Token` header อัตโนมัติ | `apps/web/src/lib/api.ts` | S | Low |
| 1.4 | Apply `LiffTokenGuard` บน LIFF endpoints ทั้งหมดใน `line-oa.controller.ts` (6 endpoints) | `apps/api/src/modules/line-oa/line-oa.controller.ts:666-803` | S | Low |
| 1.5 | Apply `LiffTokenGuard` บน LIFF endpoints ใน `line-oa-payment.controller.ts` (3 endpoints: create-payment-link, early-payoff-quote, early-payoff) | `apps/api/src/modules/line-oa/line-oa-payment.controller.ts:671-791` | S | Low |
| 1.6 | Cache verified token result (5 นาที) เพื่อลด LINE API calls — ใช้ in-memory Map หรือ CacheModule | `liff-token.guard.ts` | S | Low |
| 1.7 | Unit test: valid token → pass, expired token → 401, missing token → 401, tampered lineId → 403 | `apps/api/src/modules/line-oa/guards/liff-token.guard.spec.ts` (NEW) | M | Low |

### 1B: DTO Validation

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 1.8 | สร้าง DTOs สำหรับ LIFF endpoints: `LiffContractsQueryDto`, `LiffRegisterLookupDto`, `LiffRegisterConfirmDto`, `LiffProfileQueryDto`, `LiffHistoryQueryDto`, `LiffUnlinkDto` | `apps/api/src/modules/line-oa/dto/liff-*.dto.ts` (NEW) | M | Low |
| 1.9 | สร้าง DTOs สำหรับ payment LIFF: `LiffCreatePaymentLinkDto`, `LiffEarlyPayoffQueryDto`, `LiffEarlyPayoffDto`, `LiffSlipUploadDto` | `apps/api/src/modules/line-oa/dto/liff-payment-*.dto.ts` (NEW) | M | Low |
| 1.10 | Apply DTOs ทั้งหมดแทน raw `@Body()` / `@Query()` ใน controller methods | `line-oa.controller.ts`, `line-oa-payment.controller.ts` | S | Low |
| 1.11 | Validation messages เป็นภาษาไทย ตาม project convention | DTO files | S | Low |

### 1C: Rate Limiting

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 1.12 | เพิ่ม `@Throttle()` decorators บน LIFF endpoints ที่ sensitive — register/lookup (5/min), register/confirm (3/min), unlink (3/min), create-payment-link (5/min/IP) | `line-oa.controller.ts`, `line-oa-payment.controller.ts` | S | Low |
| 1.13 | เพิ่ม rate limit test: ส่ง request เกิน limit → 429 | `liff-rate-limit.spec.ts` (optional) | S | Low |

### 1D: Error Response Consistency

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 1.14 | Standardize LIFF error responses — ทุก endpoint ใช้ NestJS exceptions (`BadRequestException`, `NotFoundException`, `ForbiddenException`) แทน `return { error: '...' }` | `line-oa.controller.ts:713-803`, `line-oa-payment.controller.ts:671-791` | M | Med |
| 1.15 | อัปเดต frontend LIFF pages ให้จัดการ HTTP error status แทน `data.error` field | All LIFF pages | M | Med |

**Effort รวม Phase 1**: M-L (~1-2 สัปดาห์)
**Rationale**: ปัจจุบันใครก็สามารถดึงข้อมูลสัญญา/ประวัติชำระ/โปรไฟล์ลูกค้าได้ถ้ารู้ LINE userId ของเป้าหมาย — นี่คือ **data exposure vulnerability** ระดับ P0

---

## Phase 2 — Architecture Cleanup (Priority: P1)

**Theme**: แยก LIFF API ออกจาก monolithic controller + สร้าง shared infrastructure

### 2A: Controller Split

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 2.1 | สร้าง `LiffApiController` — ย้าย LIFF endpoints (6 routes) ออกจาก `line-oa.controller.ts` | `apps/api/src/modules/line-oa/liff-api.controller.ts` (NEW) | M | Med |
| 2.2 | สร้าง `LiffApiService` — ย้าย business logic ที่ LIFF ใช้ออกจาก `LineOaService` (findCustomerContractsFull, findCustomerPaymentHistory, findCustomerProfile, lookupCustomerByPhone, confirmLinkLine, unlinkLineAccount) | `apps/api/src/modules/line-oa/liff-api.service.ts` (NEW) | L | Med |
| 2.3 | ย้าย LIFF payment endpoints (3 routes) ออกจาก `line-oa-payment.controller.ts` เข้า `LiffApiController` | `liff-api.controller.ts`, `line-oa-payment.controller.ts` | M | Med |
| 2.4 | Register `LiffApiController` + `LiffApiService` ใน `line-oa.module.ts` | `apps/api/src/modules/line-oa/line-oa.module.ts` | S | Low |
| 2.5 | Verify ว่า route paths ไม่เปลี่ยน (ใช้ `@Controller('line-oa')` prefix เดิม) — frontend ไม่ต้องแก้ | Manual verification | S | Low |

### 2B: Shared Types

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 2.6 | สร้าง shared LIFF types ใน `packages/shared/` — `LiffContractResponse`, `LiffPaymentResponse`, `LiffProfileResponse`, `LiffHistoryResponse`, `LiffEarlyPayoffQuote` | `packages/shared/src/types/liff.ts` (NEW) | M | Low |
| 2.7 | Backend ใช้ shared types สำหรับ response shape | `liff-api.service.ts` | S | Low |
| 2.8 | Frontend ใช้ shared types แทน inline interfaces ใน LIFF pages | All LIFF pages | M | Low |

### 2C: liffApi Infrastructure

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 2.9 | เพิ่ม response envelope unwrap interceptor ใน `liffApi` (เหมือน main `api` instance) | `apps/web/src/lib/api.ts:143` | S | Low |
| 2.10 | เพิ่ม error interceptor ใน `liffApi` — map error responses เป็น structured format + Sentry capture สำหรับ 5xx | `apps/web/src/lib/api.ts` | S | Low |
| 2.11 | ลบ `useMockPayment.ts` — dead code ที่ไม่มี page ไหน import | `apps/web/src/pages/liff/useMockPayment.ts` | S | Low |

**Effort รวม Phase 2**: L (~1-2 สัปดาห์)
**Rationale**: `line-oa.controller.ts` 1029 lines คือ maintenance risk สูงสุด — flagged ตั้งแต่ v4 (task 3.10) แต่ยังไม่ทำ; shared types ป้องกัน frontend/backend type drift

---

## Phase 3 — Frontend Quality (Priority: P1)

**Theme**: ยกระดับ LIFF pages ให้ตรงกับ frontend conventions — useQuery pattern + consistent UX

### 3A: Migrate to useQuery/useMutation

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 3.1 | `LiffRegister.tsx` — แทน `useEffect + liffApi` ด้วย `useMutation` สำหรับ lookup + confirm | `apps/web/src/pages/liff/LiffRegister.tsx` | M | Low |
| 3.2 | `LiffHistory.tsx` — แทนด้วย `useQuery` สำหรับ history fetch | `apps/web/src/pages/liff/LiffHistory.tsx` | S | Low |
| 3.3 | `LiffProfile.tsx` — แทนด้วย `useQuery` สำหรับ profile fetch, `useMutation` สำหรับ unlink | `apps/web/src/pages/liff/LiffProfile.tsx` | S | Low |
| 3.4 | `LiffEarlyPayoff.tsx` — แทนด้วย `useQuery` สำหรับ quote, `useMutation` สำหรับ payoff | `apps/web/src/pages/liff/LiffEarlyPayoff.tsx` | S | Low |
| 3.5 | `LiffFinanceVerify.tsx` — แทนด้วย `useQuery` สำหรับ status, `useMutation` สำหรับ OTP flow | `apps/web/src/pages/liff/LiffFinanceVerify.tsx` | M | Low |
| 3.6 | `LiffPayment.tsx` — refactor payment polling ด้วย `useQuery` + `refetchInterval` แทน manual `setInterval` | `apps/web/src/pages/liff/LiffPayment.tsx` | M | Med |

### 3B: UX Fixes

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 3.7 | Payment polling: เพิ่ม max attempts (60 = 3 นาที) + exponential backoff (3s → 5s → 10s) + timeout UI | `LiffContract.tsx`, `LiffPayment.tsx` | S | Low |
| 3.8 | Fix broken document download ใน `LiffContract.tsx:282-293` — endpoint ต้อง staff JWT; เปลี่ยนเป็น LIFF-compatible endpoint หรือซ่อนปุ่ม | `LiffContract.tsx` + possibly new backend endpoint | M | Med |
| 3.9 | Loading skeletons สำหรับ `LiffHistory` + `LiffProfile` (ปัจจุบันใช้ text "กำลังโหลด..." แทน skeleton) | `LiffHistory.tsx`, `LiffProfile.tsx` | S | Low |
| 3.10 | QR code expiry countdown timer ใน `LiffPayment.tsx` — แจ้ง "QR หมดอายุใน XX:XX" (30 นาที) | `LiffPayment.tsx` | S | Low |

**Effort รวม Phase 3**: M (~1 สัปดาห์)
**Rationale**: LIFF pages เป็น customer-facing → UX ต้องดี + code ต้อง maintainable ตาม convention เดียวกับ admin pages

---

## Phase 4 — Test Coverage (Priority: P2)

**Theme**: เพิ่ม safety net สำหรับ LIFF API — ปัจจุบัน 0 specific tests

### 4A: Backend Unit Tests

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 4.1 | `liff-api.controller.spec.ts` — test ทุก LIFF endpoint: valid lineId → data, invalid → 400, not found → 404, ownership check | `apps/api/src/modules/line-oa/liff-api.controller.spec.ts` (NEW) | L | Low |
| 4.2 | `liff-api.service.spec.ts` — test business logic: findCustomerContractsFull (multi-contract), lookupCustomerByPhone (format validation, not found, already linked), confirmLinkLine (success, duplicate), unlinkLineAccount | `apps/api/src/modules/line-oa/liff-api.service.spec.ts` (NEW) | L | Low |
| 4.3 | LIFF payment tests: early-payoff-quote (active contract, closed contract, wrong owner), create-payment-link (rate limit 5/24h), slip-upload (TOCTOU race) | Extend existing or new spec | M | Low |

### 4B: E2E Tests

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 4.4 | E2E: LIFF register flow — phone input → lookup → confirm → redirect to contracts | `apps/web/e2e/liff-register.spec.ts` (NEW) | M | Low |
| 4.5 | E2E: LIFF contract view — load contracts → payment schedule → pay button | `apps/web/e2e/liff-contract.spec.ts` (NEW) | M | Low |
| 4.6 | E2E: LIFF payment flow — resolve token → select method → (mock) gateway → success | `apps/web/e2e/liff-payment.spec.ts` (NEW) | M | Med |

**Target**: +40-50 tests → LIFF-specific coverage baseline
**Effort รวม Phase 4**: L (~1-2 สัปดาห์)
**Rationale**: LIFF เป็น public-facing ที่ลูกค้าใช้โดยตรง — regression ส่งผลต่อ revenue; ปัจจุบัน 0 tests = blind spot

---

## Phase 5 — Infrastructure & Compliance (Priority: P1)

**Theme**: แก้ปัญหา production-readiness — filesystem, decimal, dedup, PDPA

### 5A: Decimal Precision Cleanup (27 occurrences)

| # | Task | File | Occurrences | Effort |
|---|------|------|-------------|--------|
| 5.1 | **[L-001]** `line-oa.controller.ts` — LIFF response builders: `Number(c.sellingPrice)` → `new Prisma.Decimal(c.sellingPrice).toNumber()` (หรือ string) | `apps/api/src/modules/line-oa/line-oa.controller.ts:298,308,347,365,400,420,494,684,691-693,701-703` | 14 | M |
| 5.2 | **[L-001]** `line-oa-payment.controller.ts` — evidence + payment amount calculations | `apps/api/src/modules/line-oa/line-oa-payment.controller.ts:188,294,409,413,495,518-519,591,627` | 9 | S |
| 5.3 | **[L-001]** `line-oa.service.ts` — receipt + history helpers | `apps/api/src/modules/line-oa/line-oa.service.ts:352,604,607` | 3 | S |
| 5.4 | **[L-001]** `payment-link.service.ts` — amount calculation | `apps/api/src/modules/line-oa/payment-links/payment-link.service.ts:50` | 1 | S |

### 5B: S3 Storage Migration

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 5.5 | **[L-002]** สร้าง `LiffStorageService` — wrap S3 upload logic (reuse existing S3 config จาก `S3_ENDPOINT`, `S3_BUCKET`) | `apps/api/src/modules/line-oa/liff-storage.service.ts` (NEW) | M | Med |
| 5.6 | **[L-002]** เปลี่ยน slip upload ใน `line-oa-payment.controller.ts:564-571` — `fs.writeFileSync` → `liffStorageService.uploadSlip(file)` | `line-oa-payment.controller.ts` | S | Med |
| 5.7 | **[L-002]** เปลี่ยน image upload ใน `line-oa.controller.ts:225-232` — `fs.writeFileSync` → S3 | `line-oa.controller.ts` | S | Med |
| 5.8 | Return signed URL แทน local path (`/uploads/slips/...` → S3 presigned URL) | `line-oa-payment.controller.ts` | S | Low |

### 5C: Webhook Dedup

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 5.9 | **[L-003]** เปลี่ยน `WebhookDedup` จาก in-memory Map → database-based idempotency (ใช้ `processedWebhookEvents` table with TTL) | `apps/api/src/modules/chatbot-finance/chatbot-finance.controller.ts` | M | Med |
| 5.10 | Migration: สร้าง `ProcessedWebhookEvent` model (id, eventId unique, processedAt, expiresAt) + cleanup cron | `schema.prisma` + new migration | S | Low |
| 5.11 | ลบ `WebhookDedup` in-memory class | `chatbot-finance.controller.ts` | S | Low |

### 5D: PDPA Consent

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 5.12 | **[L-004]** สร้าง `POST /line-oa/liff/consent` endpoint — รับ `{ lineId, consent: boolean }` → update `Customer.chatConsent` + `chatConsentAt` | `liff-api.controller.ts` (หรือ `line-oa.controller.ts`) | S | Low |
| 5.13 | สร้าง `GET /line-oa/liff/consent` — เช็คสถานะ consent ปัจจุบัน | Same | S | Low |
| 5.14 | Frontend: เพิ่ม consent modal ใน `LiffContract.tsx` — แสดงครั้งแรกที่ user เข้าใช้, กดยินยอมแล้วจำ | `apps/web/src/pages/liff/LiffContract.tsx` | M | Low |
| 5.15 | DTO: `LiffConsentDto` with `@IsBoolean() consent` + Thai error messages | DTO file | S | Low |

**Effort รวม Phase 5**: M-L (~1-2 สัปดาห์)
**Rationale**: L-002 (filesystem) เป็น **blocker สำหรับ production Cloud Run** — สลิปจะหายหลัง container restart; L-001 (Decimal) สอดคล้องกับ v4 Decimal cleanup strategy; L-004 (PDPA) คือ legal compliance

---

## Out of Scope

| # | Item | เหตุผล |
|---|------|--------|
| 1 | PWA / Service Worker / Offline mode | Q4 2026 decision — ต้อง business review |
| 2 | Push notifications (Web Push / LINE) | Feature ใหม่ — ไม่ใช่ hardening |
| 3 | CHATCONE unified chat integration | Phase 6 ของ master plan |
| 4 | LIFF page redesign / new UI | Functional first, then beautiful |
| 5 | Payment via credit card (Omise/Stripe) | ปัจจุบันใช้ PaySolutions เท่านั้น — partner decision |
| 6 | API versioning (`/v1/liff/...`) | Premature — มี consumer เดียว (LIFF frontend) |
| 7 | Multi-language support | ลูกค้าเป็นคนไทย 100% |
| 8 | LINE Flex Message LIFF integration | Chatbot ส่ง Flex ได้แล้ว — ไม่ต้องแก้ |

---

## Success Criteria

- [ ] **Security**: ทุก LIFF endpoint verify LIFF ID token server-side — ไม่มี endpoint ที่เชื่อ lineId จาก client
- [ ] **Validation**: ทุก LIFF endpoint มี class-validator DTO — 0 raw `@Body()` / `@Query()` ที่ไม่มี validation
- [ ] **Architecture**: `line-oa.controller.ts` ≤ 700 lines (จาก 1029) หลังแยก LIFF endpoints
- [ ] **Frontend**: ทุก LIFF page ใช้ `useQuery` / `useMutation` — 0 raw `useEffect + fetch/liffApi`
- [ ] **Error handling**: ทุก LIFF endpoint ใช้ NestJS exceptions — 0 endpoint return `{ error: '...' }` with 200 status
- [ ] **Types**: ≥ 5 shared LIFF types ใน `packages/shared/`
- [ ] **Tests**: ≥ 40 LIFF-specific tests (unit + E2E)
- [ ] **Dead code**: `useMockPayment.ts` ถูกลบ
- [ ] **Decimal**: 0 `Number(decimal)` ในไฟล์ LIFF (จาก 27 จุดใน 4 ไฟล์)
- [ ] **Storage**: 0 `fs.writeFileSync` ในไฟล์ LIFF — ใช้ S3 ทั้งหมด
- [ ] **Dedup**: Webhook dedup ใช้ persistent storage (DB/Redis) — ไม่ใช่ in-memory Map
- [ ] **PDPA**: LIFF มี consent endpoint + UI modal — `chatConsent` field ถูกใช้งานจริง
- [ ] TypeScript 0 errors หลังทุก phase

---

## Dependency Graph

```
Phase 1A (Token Guard) ──┐
Phase 1B (DTOs)          ├──→ Phase 2A (Controller Split) ──→ Phase 4A (Unit Tests)
Phase 1C (Rate Limit)    │                                         │
Phase 1D (Error Format) ─┘    Phase 2B (Shared Types) ──→ Phase 3A (useQuery Migration)
                               Phase 2C (liffApi Infra) ──→ Phase 3B (UX Fixes)
                                                                   │
                                                              Phase 4B (E2E Tests)

Phase 5A (Decimal) ── standalone (ทำเมื่อไหร่ก็ได้)
Phase 5B (S3 Storage) ── standalone, **P0 สำหรับ production**
Phase 5C (Webhook Dedup) ── standalone (ทำก่อน multi-instance scale)
Phase 5D (PDPA Consent) ── ต้องรอ Phase 1A (Token Guard) + Phase 2A (Controller Split)
```

- Phase 1 ทำได้อิสระทั้ง 4 sub-phases
- Phase 2A ต้องรอ Phase 1 เสร็จ (controller split หลัง DTOs + guard เข้าที่แล้ว)
- Phase 3 ต้องรอ Phase 2B + 2C (shared types + liffApi infra)
- Phase 4 ทำได้หลัง Phase 2A เสร็จ (test ต่อ new controller structure)
- Phase 5A-C ทำได้อิสระจาก Phase 1-4 (ไม่ depend กัน)
- Phase 5B (S3) ควรทำคู่กับ Phase 1 เพราะเป็น **production blocker** เหมือนกัน
- Phase 5D ต้องรอ controller structure เข้าที่

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| LIFF token verification เพิ่ม latency 50-200ms ต่อ request | UX ช้าลงเล็กน้อย | Cache verified token 5 นาที (task 1.6) |
| Controller split ทำให้ route paths เปลี่ยน | Frontend พัง | ใช้ `@Controller('line-oa')` prefix เดิม + verify ด้วย E2E |
| LINE API verify endpoint rate limit / downtime | LIFF ใช้งานไม่ได้ | Fallback: cache + graceful degradation |
| Error format change (200 → 4xx) break existing LIFF pages | Pages แสดง error ผิด | ทำ task 1.14 + 1.15 ด้วยกัน ใน PR เดียว |
| `useQuery` migration เปลี่ยน loading/error behavior | UI flash/flicker | Test ทุก page manually + E2E |
| S3 migration ทำให้ slip images เดิม (local) เข้าถึงไม่ได้ | สลิปเก่าหาย | Migrate existing files ก่อน switch + fallback read local → S3 |
| Decimal `.toNumber()` ส่งกลับ customer → ยังเป็น float | ทศนิยมยังผิดเล็กน้อย | ส่งเป็น string + format ที่ frontend ด้วย `formatNumber` |
| DB-based dedup เพิ่ม write latency ทุก webhook | Webhook response ช้าลง 5-10ms | ใช้ `INSERT ... ON CONFLICT DO NOTHING` — single query, minimal overhead |

---

## Reference

- **Ultraplan v4**: `docs/reports/ULTRAPLAN-V4-2026-04-09.md` — controller split flagged as task 3.10
- **LINE OA Deployment Plan**: `docs/sales/line-oa-deployment-plan.md`
- **Security Rules**: `.claude/rules/security.md` — LIFF endpoints listed as intentionally public
- **Frontend Rules**: `.claude/rules/frontend.md` — useQuery/useMutation mandate
- **LINE LIFF docs**: LINE Developers > LIFF > Verifying LIFF access tokens

**Next Step**: Review this plan → approve → start Phase 1A (LiffTokenGuard) + 1B (DTOs) in parallel
