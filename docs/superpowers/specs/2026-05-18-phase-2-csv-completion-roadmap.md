# Phase 2 — CSV 100% Completion Roadmap

**Status:** Spec 2026-05-18. Closes remaining 5 gaps vs original CSV after Phase 1 (Sidebar Redesign SP1-SP6 deployed)
**Goal:** ครบ 100% ตาม CSV ที่ owner ส่ง 2026-05-17

---

## 1. Gap Analysis vs CSV

After Phase 1 deploy, these 5 CSV items remain partial/missing:

| # | CSV item | Phase 1 status | Phase 2 SP |
|---|---|---|---|
| 1 | CRM Pipeline (สนใจ→ติดต่อ→เสนอราคา→ปิดการขาย) | Existing Kanban, needs 4-stage labels + filter | P2-SP1 |
| 2 | ตั้งค่าเลขที่/รูปแบบเอกสาร UI | D1.1.2.x backend exists, no UI | P2-SP2 |
| 3 | e-Tax PDF Thai font | ASCII placeholder | P2-SP3 |
| 4 | การจอง / มัดจำ booking system | Not built | P2-SP4 |
| 5 | e-Tax XML ส่ง RD (ม.86/4 + ขมธอ.21-2562) | Phase 1 Receipt only | P2-SP5 |

## 2. Decomposition (5 sub-projects)

### Wave 1 — Quick wins (parallel, ship same-day)

**P2-SP1: CRM 4-stage Kanban Thai labels**
- Schema: confirm `CrmLead.stage` enum has LEAD/CONTACTED/QUOTED/WON/LOST
- Frontend: Kanban columns with Thai labels: เสนอ / ติดต่อ / เสนอราคา / ปิดการขาย / ยกเลิก
- Drag-and-drop between columns
- Link "เสนอราคา" → /quotes (new Quote)
- Link "ปิดการขาย" → /pos with prefilled customer
- ETA: 1 hour

**P2-SP2: Document Number Config UI**
- Frontend: `DocumentConfigPage.tsx` at `/settings/document-config`
- Backend: reuse D1.1.2.x SystemConfig keys (`doc_prefix_per_type`, `doc_number_format`, `doc_number_reset_cycle`)
- Form: edit prefix per doc type + select format from whitelist + select reset cadence
- Live preview using existing `DocNumberService.peek()` (if not exists, add)
- Audit log on save (action='DOC_NUMBER_CONFIG_UPDATED')
- OWNER only
- ETA: 2 hours

**P2-SP3: e-Tax PDF Thai font**
- Bundle Noto Sans Thai (Apache 2.0) per PR #843 pattern
- Replace jsPDF Helvetica with pdfmake (or jsPDF + addFileToVFS for custom font)
- Real customer name in Thai (not `[contract <num>]` placeholder)
- ETA: 1 hour

### Wave 2 — Booking system (defaults applied)

**P2-SP4: การจอง / มัดจำ (Booking)**

Defaults (use unless OWNER overrides via settings):
- 1 booking = 1+ products (multiple allowed)
- มัดจำ = THB amount (fixed, not %)
- Expire = 7 days (configurable via SystemConfig `booking_expire_days`)
- Cancel before expire = 100% refund (configurable)
- Cancel after expire = 0% refund (forfeit)
- Convert to sale: deposit transfers to down payment, no separate dialog

Backend:
- `Booking` model: customer, branch, items[], depositAmount, expireDate, status (PENDING/PAID/CANCELED/CONVERTED/EXPIRED), depositPaymentId
- `BookingItem` model: productId, quantity, unitPrice
- Service: create, payDeposit, cancel (refund), convertToSale, autoExpireCron
- Endpoints: POST/GET/PATCH/DELETE `/bookings`
- Migration: new tables + cron job

Frontend:
- `BookingsPage.tsx` at `/bookings`
- Create from POS or standalone
- Status column with Thai labels: รอชำระ / มัดจำแล้ว / ยกเลิก / ขายแล้ว / หมดอายุ
- Convert button → POS prefilled with customer + items + remaining balance

Routes: `/bookings`, `/bookings/new`, `/bookings/:id`

ETA: 1-2 days

### Wave 3 — e-Tax XML legal (infrastructure, cert plug-in later)

**P2-SP5: e-Tax XML submission scaffolding**

Build infrastructure, owner plugs in CA cert + RD sandbox creds later:

Backend:
- Module: `apps/api/src/modules/e-tax-xml/`
- Service:
  - `generateXml(paymentId)` — produces XML per ขมธอ.21-2562 (Thailand UBL 2.1)
  - `signXml(xml, certPath, certPass)` — PKCS#7 detached signature using node-signpdf or @signpdf/signpdf
  - `submitToRd(signedXml, mode: 'sandbox' | 'prod')` — POST to RD endpoint
  - `pollStatus(submissionId)` — check RD response
- Env vars: `ETAX_CERT_PATH`, `ETAX_CERT_PASS`, `ETAX_RD_ENDPOINT`, `ETAX_RD_USERNAME`, `ETAX_RD_PASSWORD`, `ETAX_SUBMIT_MODE` (default 'disabled')
- Schema: `ETaxSubmission` model — paymentId, xmlContent, status (PENDING/SIGNED/SUBMITTED/ACCEPTED/REJECTED), rdResponse, submittedAt

Frontend:
- Extend `ETaxInvoicePage.tsx`:
  - "ส่งให้สรรพากร" button per invoice (disabled if ETAX_SUBMIT_MODE='disabled' with tooltip "ยังไม่ได้ตั้งค่า e-Tax CA cert")
  - Status badge: รอส่ง / ส่งแล้ว / สรรพากรรับ / ปฏิเสธ
  - Resubmit failed
  - Bulk submit (monthly)

Configuration UI (OWNER only):
- `/settings/e-tax-config` — upload cert + RD creds + sandbox/prod toggle
- Test connection button

When `ETAX_SUBMIT_MODE='enabled'`:
- Cron job submits all eligible invoices nightly
- Sentry alarms on RD rejections

ETA: 1 week (infrastructure) + owner adds cert/creds when ready

---

## 3. PR Strategy

5 worktrees, 5 parallel branches:
- `feat/p2-sp1-crm-stages`
- `feat/p2-sp2-doc-config-ui`
- `feat/p2-sp3-etax-thai-font`
- `feat/p2-sp4-booking`
- `feat/p2-sp5-etax-xml-scaffolding`

Merge sequence (after each CI green):
1. P2-SP3 (Thai font) — smallest, fastest
2. P2-SP1 (CRM stages) — small, frontend only
3. P2-SP2 (Doc config UI) — small-medium
4. P2-SP4 (Booking) — medium with migration
5. P2-SP5 (e-Tax XML) — largest

## 4. Test Plan

- P2-SP1: 2 vitest + 1 Playwright
- P2-SP2: 5 jest + 2 vitest + 1 Playwright
- P2-SP3: 3 jest (PDF Thai render)
- P2-SP4: 12 jest + 4 vitest + 2 Playwright
- P2-SP5: 8 jest + 1 vitest + 1 Playwright (mock RD response)

## 5. Owner deliverables for Wave 3 go-live

After P2-SP5 merge, to actually submit to RD:
1. ลงทะเบียนเป็นผู้ออก e-Tax กับสรรพากร (form ภ.อ.01)
2. ขอ Digital Signature Certificate จาก CA (NDID, INET, ThaiCERT — ลิงก์: https://etax.rd.go.th/etax_staging/etaxws/)
3. ได้ username/password สำหรับ RD sandbox + prod
4. Upload cert + creds ใน `/settings/e-tax-config`
5. Toggle `ETAX_SUBMIT_MODE='enabled'` + restart API service

## 6. Acceptance Criteria

- [ ] CRM 4-stage Kanban with Thai labels working
- [ ] OWNER can edit doc number prefix/format/cadence via UI
- [ ] e-Tax PDF shows Thai customer names correctly
- [ ] Booking flow: create → payDeposit → expire/cancel/convert all working
- [ ] e-Tax XML generates per ขมธอ.21-2562, ready to sign + submit (cert pending)
- [ ] All Playwright E2E pass
- [ ] Each SP through DEEP /review + fix cycle
- [ ] 0 TS errors

## 7. Out of Scope (Phase 3+ if needed)

- VAT-on-interest CR-001 (CPA consult)
- GFIN integration
- Year-end closing entries (39-9999 → 33-1101 flow)
- Off-site backup replication
- PII column-level encryption
