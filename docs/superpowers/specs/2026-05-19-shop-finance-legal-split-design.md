# P3-SP7 — SHOP/FINANCE Legal Entity Split (Design Spec)

**Sub-project:** P3-SP7 (final SP of Phase 3 — deferred from Phase 3 cutover, gets its own dedicated session)
**สถานะ:** Design draft 2026-05-19 — pending owner sign-off
**Cutover target:** **00:00 1 ม.ค. 2027** (ขอบรอบบัญชี 2027)
**Runway:** ~7 เดือนกว่า (วันนี้ → cutover)
**Effort:** ~15-18 person-weeks (~5-6 เดือนถ้า 1-2 dev เต็มเวลา)
**Tracking issue:** TBD (open after spec sign-off)
**Predecessor:** Builds on P3-SP4 (PII encryption) + P3-SP5 (SHOP-side accounting foundation)

---

## 1. Problem Statement

BESTCHOICE ดำเนินธุรกิจ 2 ฝั่งภายใต้ **1 นิติบุคคล**:
- **SHOP** (หลายสาขา) — ขายมือถือ + รับซื้อมือสอง + รับ commission จาก finance — ไม่จด VAT
- **FINANCE** (ส่วนกลาง) — ปล่อยผ่อน + เก็บดอกเบี้ย + ถือกรรมสิทธิ์ระหว่างผ่อน — จด VAT 7%

ปัจจุบันแยกในระบบที่ระดับ logical (FK `companyId` ใน `CompanyInfo` table) แต่:
- ใช้ database เดียวกัน → ไม่ใช่ legal separation
- ใช้ tax ID เดียวกัน → ยื่นภาษีรวม
- ลูกหนี้ปะปนกัน — เครื่องที่ SHOP ขาย กรรมสิทธิ์ "ย้าย" ไป FINANCE ในระดับบันทึกบัญชี แต่ตามกฎหมายยังเป็นทรัพย์สินของ "บริษัทเดียว"

**แผนธุรกิจปลายปี 2026:** จดทะเบียน 2 นิติบุคคลแยก
- **BC FINANCE Co.,Ltd.** — **continuing entity** (นิติบุคคลปัจจุบัน, tax ID เดิม, ผู้สอบบัญชีเดิม, ภ.พ.30 history, journal history, ทุกอย่างที่บันทึกบัญชีมาตลอด)
- **BC SHOP Co.,Ltd.** — **brand new entity** (จดทะเบียนใหม่ที่กรมพัฒน์ฯ + tax ID ใหม่, เริ่มจากศูนย์ ณ 1 ม.ค. 2027)
- เจ้าของเดียวกัน, บัญชีธนาคารแยก, LINE OA แยก
- ภ.พ.30 แยก (FINANCE only — SHOP ยังไม่จด VAT), ภ.ง.ด. 3/53/50/51 แยก
- ระหว่าง entities ใช้ inter-company transactions + commission flows

**Key decision (2026-05-19 owner directive):** "พวกบัญชีที่ทำมาตลอด ให้ยึดเป็นของไฟแนนซ์" — historical accounting records ทั้งหมด (99-account chart, journal entries, tax reports, accounting periods) เป็นของ **FINANCE entity (continuing)**. SHOP entity เริ่ม clean state, มีเฉพาะ opening balance transferred จาก FINANCE สำหรับ SHOP-side accounts (เครื่องในสต็อก, รายการขายเงินสด accruals ฯลฯ — รายละเอียดใน OQ4 ปรับปรุง)

ระบบต้องสนับสนุน split นี้ **ก่อน 1 ม.ค. 2027** เพื่อให้รอบบัญชี 2027 เริ่มแบบสะอาด

## 2. Goals / Non-Goals

### Goals

- **G1** — แยก data store เป็น 2 PostgreSQL databases (`bc_shop`, `bc_finance`) บน Cloud SQL
- **G2** — Single API service ที่จัดการทั้ง 2 entities ผ่าน dual Prisma clients
- **G3** — Atomic-ish cross-entity transactions ผ่าน Outbox + Saga pattern
- **G4** — ภาษีแยกตามนิติบุคคล: ภ.พ.30 (FINANCE), ภ.ง.ด.3/53/50/51 (ทั้ง 2), trial balance/P&L/BS แยก
- **G5** — Cross-entity OWNER + ACCOUNTANT (เห็นทั้ง 2 บริษัท), single-entity SALES/BM/FM (เห็นเฉพาะของตน)
- **G6** — Consolidated dashboard สำหรับ OWNER (รวม 2 entities)
- **G7** — รองรับ commission จาก **ไฟแนนซ์ภายนอก** (GFIN ฯลฯ) — ใหม่
- **G8** — Migration script + rollback playbook ที่ผ่าน rehearsal 2 ครั้งก่อน real cutover
- **G9** — 2 separate backup pipelines + 2 separate retention policies
- **G10** — Year-end closing 31 ธ.ค. 2026 ของบริษัทเดิม (1 entity เก่า) → snapshot → 1 ม.ค. 2027 ตื่นมาเริ่มงวดใหม่ใน 2 entities

### Non-Goals

- **NG1** — Real-world legal registration (จดทะเบียนกรมพัฒน์ฯ, ขอ tax ID — เป็นงาน owner + ทนาย)
- **NG2** — 2 separate codebases หรือ 2 separate Cloud Run services (1 codebase, 1 service, scale หลายๆ instances)
- **NG3** — 2 separate Sentry projects (1 project + `entity_scope` tag)
- **NG4** — 2 separate domains/URL paths (single domain, entity context มาจาก auth + URL query)
- **NG5** — Cross-DB foreign keys (ใช้ ID-only references + app-level integrity)
- **NG6** — Multi-currency / multi-language (Thai-only, THB-only)
- **NG7** — Microservice split (saga/outbox ทำใน-process)
- **NG8** — Mid-year split (cutover ที่ขอบรอบบัญชี 2027 เท่านั้น)
- **NG9** — Re-architect existing modules ที่ทำงานดีอยู่แล้ว — แค่ rewire DB layer + add saga

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Single NestJS API (bestchoice-api on Cloud Run, scales)  │
│                                                            │
│  Request Flow:                                             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │ JwtGuard │─▶│ EntityScope  │─▶│ RoutingDecorator │     │
│  │          │  │ Resolver     │  │ @Entity(SHOP)    │     │
│  └──────────┘  └──────────────┘  └──────────────────┘     │
│                                                            │
│  Service Layer:                                            │
│  ┌─────────────────────┐    ┌──────────────────────────┐  │
│  │ PrismaShopService   │    │ PrismaFinanceService     │  │
│  │ (bc_shop DB)        │    │ (bc_finance DB)          │  │
│  └──────────┬──────────┘    └──────────┬───────────────┘  │
│             │                          │                   │
│             └────────┬─────────────────┘                   │
│                      ▼                                     │
│           ┌──────────────────────┐                         │
│           │ PairedJournalService │                         │
│           │ (Outbox + Saga)      │                         │
│           └──────────────────────┘                         │
└──────────────────────┬───────────────────────────────────┘
                       │
            ┌──────────┴────────────┐
            │                       │
     ┌──────▼──────┐         ┌──────▼────────┐
     │  bc_shop    │         │  bc_finance   │
     │  Cloud SQL  │         │  Cloud SQL    │
     │             │         │               │
     │  shop data  │         │  finance data │
     │  + shared:  │         │               │
     │  - users    │         │               │
     │  - audit    │         │               │
     │  - sysconf  │         │               │
     │  - outbox   │         │               │
     └─────────────┘         └───────────────┘
```

**หลักการ:**
- **1 NestJS process** — ไม่ใช่ microservice. ลด ops complexity, ทีมเล็ก
- **2 Prisma clients** — `PrismaShopService` + `PrismaFinanceService` (extend คนละ generated client)
- **EntityScope** — middleware ดึงจาก JWT (`user.accessibleCompanies[]`) + URL (`?company=shop|finance`) + default per role
- **Shared tables ใน bc_shop** — Users, audit logs, system config, notifications, outbox events. FINANCE-side references `userId` แบบ no-FK (lookup ผ่าน UsersService)
- **เลือก bc_shop เป็น primary** — เพราะ user activity เยอะกว่า (SALES login บ่อยกว่า ACCOUNTANT), shop เป็น customer touchpoint แรก

### 3.1 ทำไมไม่ใช้ 1 DB + 2 schemas

- 1 DB = single point of backup/restore → ขายบริษัท FINANCE แยกยาก
- 1 DB = ความเสี่ยง cross-schema query slip (dev เผลอ JOIN ข้าม schema)
- 2 DBs = true isolation, backup แยก, ขายแยกง่าย, ภาษีตรวจสอบง่าย
- Trade-off: cross-DB transactions ไม่ atomic — แก้ด้วย outbox/saga (acceptable for accounting)

### 3.2 ทำไมไม่ split เป็น 2 Cloud Run services

- 1 service + 2 Prisma = ง่ายต่อ deploy + รักษา 1 codebase
- 2 services = ต้อง API gateway + inter-service auth + double monitoring → over-engineering สำหรับ SMB
- ถ้าอนาคตขาย FINANCE จริง → refactor 1→2 services ได้ภายหลัง (codebase modular เพียงพอ)

## 4. Database Split — ตารางต่อตาราง

### 4.1 bc_shop DB — เก็บ
| ตาราง | เหตุผล |
|---|---|
| `users` | shared — primary auth |
| `user_roles` | shared |
| `branches` (SHOP-side) | SHOP เป็นเจ้าของสาขา |
| `companies` | shared — registry ของ 2 entities |
| `audit_logs` | shared — เก็บ activity ทุก entity |
| `audit_log_v2` (D1.x) | shared |
| `system_config` | shared |
| `notifications` | shared — push ไปทั้ง 2 entities |
| `notification_logs` | shared |
| `pdpa_*` (encryption keys, backfill runs) | shared — key เดียวสะดวก rotate |
| `outbox_events` | shared — saga coordinator |
| `products` | SHOP เป็นเจ้าของสต็อก |
| `serial_numbers` (IMEI) | SHOP สต็อก |
| `stock_*` (movements, transfers, adjustments) | SHOP คลัง |
| `suppliers` | SHOP ซื้อ |
| `purchase_orders` | SHOP ซื้อ |
| `sales` (cash sales) | SHOP รายได้ |
| `trade_in_*` | SHOP รับซื้อ |
| `quotes`, `drafts` (D1.x) | SHOP เสนอราคา |
| `promotions` | SHOP ส่งเสริมการขาย |
| `stickers`, `pricing_templates` | SHOP จัดราคา |
| `customers` (SHOP-side records) | คน 1 คนมี 1 record ต่อ entity |
| `commissions` (received from FINANCE + external) | SHOP รายได้ค่าคอม |
| `external_finance_companies` (ใหม่) | SHOP relationship |
| `external_finance_commissions` (ใหม่) | SHOP รับจาก GFIN |
| `crm_*` | SHOP sales pipeline |
| `chart_of_accounts` SHOP-prefix (S-) | SHOP ledger |
| `journal_entries` SHOP-scope | SHOP บัญชี |
| `journal_lines` SHOP | SHOP |
| `accounting_periods` SHOP | SHOP |
| `tax_reports` SHOP (PND3/53/PND50/PND51) | SHOP ภาษี (ไม่มี PP30) |
| `expense_documents` SHOP | SHOP ค่าใช้จ่าย (เงินเดือนพนักงาน, ค่าน้ำไฟ, ค่าโฆษณา) |
| `petty_cash_*` SHOP | SHOP |
| `payroll_*` SHOP | SHOP — พนักงานหน้าร้าน |

### 4.2 bc_finance DB — เก็บ
| ตาราง | เหตุผล |
|---|---|
| `customers` (FINANCE-side records) | FINANCE มี contract w/ ลูกค้า |
| `contracts` | FINANCE ออก HP |
| `payments` (installments) | FINANCE รับค่างวด |
| `receipts` | FINANCE ใบเสร็จ |
| `call_logs`, `promise_slots` | FINANCE collection |
| `overdue_*` | FINANCE collection |
| `repossessions` | FINANCE ยึด |
| `exchange_contracts` | FINANCE แลกเครื่อง |
| `credit_checks` | FINANCE pre-approval |
| `slip_review` | FINANCE verify slip |
| `e_documents`, `signatures` | FINANCE contracts |
| `contract_documents` | FINANCE |
| `contract_templates` | FINANCE |
| `fixed_assets`, `depreciation_*` | FINANCE — ส่วนกลาง |
| `vat_60day_*` | FINANCE |
| `chatbot_*` | FINANCE (LIFF) |
| `chart_of_accounts` FINANCE (99 accounts) | FINANCE ledger |
| `journal_entries` FINANCE-scope | FINANCE |
| `journal_lines` FINANCE | FINANCE |
| `accounting_periods` FINANCE | FINANCE |
| `tax_reports` FINANCE (PP30/PND3/53/PND50/PND51) | FINANCE ภาษี (มี PP30) |
| `expense_documents` FINANCE | FINANCE ค่าใช้จ่าย |
| `petty_cash_*` FINANCE | FINANCE |
| `payroll_*` FINANCE | FINANCE — พนักงานส่วนกลาง |
| `inter_company_transactions` (mirror) | mirror outbox-processed events จาก bc_shop |

### 4.3 ตัดสินใจ tricky case

- **Customers**: คน 1 คน = สูงสุด 2 records (1 ต่อ entity). dedupe key = encrypted national_id hash. `CustomerLinkService` matches และ block double-create
- **Branches**: ทุก branch ตอนนี้ผูก SHOP เท่านั้น (FINANCE ไม่มี branch) → live ใน bc_shop. FINANCE refs `branchId` แบบ no-FK ใน records ที่เกี่ยวกับการขาย (`contracts.salesBranchId`)
- **Users**: live ใน bc_shop. FINANCE refs `userId` แบบ no-FK ใน fields เช่น `payment.recordedBy`. UsersService cache user records (TTL 5 min) เพื่อลด API call ข้าม DB
- **Expense documents**: แต่ละ doc ผูก 1 entity (`entityScope` column = SHOP|FINANCE) → live ใน DB ของฝั่งนั้น. UI ใน /expenses กรองตาม current entity
- **Commission**: ตามทิศทาง — `commissions` (SHOP received) อยู่ bc_shop; `commission_paid` (FINANCE paid out) อยู่ bc_finance. Reconcile ผ่าน `inter_company_transactions`

## 5. Cross-Entity Transaction Strategy

### 5.1 ปัญหา

PostgreSQL ไม่มี cross-DB ACID transaction (ในเมื่อ 2 DBs อยู่คนละ instance หรือคนละ logical database). ปัจจุบัน FINANCE ขายเครื่องผ่าน SHOP → ต้อง atomic JE 2 ฝั่ง (SHOP รับเงิน, FINANCE จ่ายเงิน + receivable + commission expense)

### 5.2 Solution: Outbox + Saga

**Outbox events** (table ใน bc_shop):
```sql
outbox_events (
  id              uuid PRIMARY KEY,
  flow_type       varchar NOT NULL,     -- 'CONTRACT_ACTIVATION', 'COMMISSION_PAYOUT', etc.
  source_id       varchar NOT NULL,     -- contract_id, payment_id
  source_entity   varchar NOT NULL,     -- 'shop' or 'finance' (where TX originated)
  target_entity   varchar NOT NULL,
  payload         jsonb NOT NULL,       -- amounts, account codes, idempotency keys
  status          varchar NOT NULL,     -- PENDING|PROCESSING|PROCESSED|FAILED
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  idempotency_key varchar UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
)
```

**Flow:**
```
1. SHOP side TX begin
2. write SHOP JE
3. write outbox_event (status=PENDING) ในการ TX เดียวกัน → TX commit
4. PairedJournalService.processOutbox() (cron + on-demand) picks up event
5. update status=PROCESSING
6. write FINANCE JE inside FINANCE TX (uses idempotency_key)
7. on success: update outbox status=PROCESSED, processed_at=now()
8. on failure: increment attempts. If attempts<5: retry. If ≥5: status=FAILED + Sentry alarm + page admin
```

**Idempotency:** FINANCE side checks `journal_entries WHERE idempotency_key = ?` ก่อน insert — re-run safe

### 5.3 Reconciliation cron (daily 04:00 BKK)

- Scan `outbox_events WHERE status='PROCESSED' AND created_at > now() - INTERVAL '7 days'`
- For each: verify bc_shop has JE + bc_finance has paired JE + amounts match (sum balanced)
- Alert: ถ้าเจอ row ที่ amounts diff > 0.01 → Sentry alarm + dashboard flag

### 5.4 Failure modes & manual reconcile UI

- `/admin/reconcile-dashboard` (OWNER only): list FAILED outbox events + per-row diagnostic + "Retry" button + "Manual JE" form
- ทุก manual reconcile = audit log + reason

## 6. Customer Model

### 6.1 Dual customer records

```
bc_shop.customers              bc_finance.customers
- id (uuid)                    - id (uuid)
- nationalIdHash (sha256-      - nationalIdHash (same hash)  ← match key
   based)
- nationalIdEncrypted          - nationalIdEncrypted
- firstName, lastName          - firstName, lastName
- phone, email, address        - phone, email, address
- createdViaModule:            - createdViaModule:
  POS|TRADE_IN|QUOTE|CRM         CONTRACT|LIFF|IMPORT
- shopMetadata jsonb           - financeMetadata jsonb (PII heavy)
- ...                          - ...
```

### 6.2 CustomerLinkService

```typescript
// ก่อนสร้าง customer ใหม่ ฝั่งใดก็ตาม
async createOrLink(input: CreateCustomerDto, entity: 'shop'|'finance') {
  const hash = sha256(input.nationalId);
  
  // ตรวจอีกฝั่ง
  const otherSide = await this.findInOtherEntity(hash, entity);
  if (otherSide) {
    // คนเดียวกันแล้วมีอยู่ฝั่งโน้น → สร้างของฝั่งนี้ + link via national_id_hash
    return this.createInEntity(input, entity, { linkedTo: otherSide.id });
  }
  return this.createInEntity(input, entity);
}
```

### 6.3 ทำไมไม่ใช้ centralized customer DB

- เพิ่ม DB ที่ 3 = ops cost
- Customer attributes ต่างกัน per entity (SHOP สนใจ phone preferences, FINANCE สนใจ income/employer)
- กฎหมายแยก — relationship แต่ละ entity คือ relationship แยก
- PDPA: SHOP customer ขอลบได้แม้ FINANCE ยังเก็บอยู่ (ยังมี active contract)

## 7. External Finance Commission Model

### 7.1 ภาพรวม flow

```
1. ลูกค้าเข้ามาที่ SHOP, เลือกผ่อนกับ GFIN
2. GFIN ตรวจอนุมัติ
3. SHOP ขายเครื่องให้ GFIN ที่ราคา N บาท (เครื่องเป็นของ GFIN)
4. GFIN จ่าย SHOP N บาททันที + ค่าคอม X% ของยอดจัด
5. ลูกค้าผ่อนกับ GFIN โดยตรง — BC FINANCE ไม่เกี่ยวเลย
6. SHOP บันทึก: รายได้ขาย N + commission income X%
```

### 7.2 ตารางใหม่ (ใน bc_shop)

```prisma
model ExternalFinanceCompany {
  id              String   @id @default(uuid())
  name            String                          // "GFIN", "Krungsri Auto", ...
  contactPerson   String?
  contactPhone    String?
  defaultCommissionRate Decimal? @db.Decimal(5,4) // 0.0250 = 2.5%
  bankAccountInfo Json?
  notes           String?
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?
  
  sales           Sale[]
  commissions     ExternalFinanceCommission[]
}

model ExternalFinanceCommission {
  id                       String   @id @default(uuid())
  externalFinanceCompanyId String
  saleId                   String   // ผูกการขายที่ปล่อยให้ external
  customerId               String   // shop-side customer
  financedAmount           Decimal  @db.Decimal(12,2)
  commissionRate           Decimal  @db.Decimal(5,4)
  commissionAmount         Decimal  @db.Decimal(12,2)
  receivedAt               DateTime?  // null = pending
  bankSlipUrl              String?
  journalEntryId           String?  // link to SHOP JE
  status                   ExternalCommissionStatus  // PENDING|RECEIVED|CANCELLED
  createdAt                DateTime @default(now())
  ...
}
```

### 7.3 JE templates ใหม่ (SHOP side)

**Template 1: ขายเครื่องให้ external**
```
Dr 11-1101 Cash (SHOP)             N
   Cr 41-1101 Sales Revenue (SHOP)   N
   Cr (Inventory cost)               (separate Cost of Goods Sold entry)
```

**Template 2: รับ commission จาก external (ทันที)**
```
Dr 11-1101 Cash (SHOP)             X
   Cr 41-2101 External Commission Income (SHOP)  X
```

**Template 3: รับ commission ภายหลัง (accrual ก่อน, รับเงินทีหลัง)**
```
ตอน contract approved + เครื่องส่ง:
Dr 11-2901 External Commission Receivable   X
   Cr 41-2101 External Commission Income     X

ตอนรับเงิน:
Dr 11-1101 Cash                    X
   Cr 11-2901 External Commission Receivable  X
```

### 7.4 ภาษีของ external commission

- SHOP ไม่จด VAT → ไม่ออกใบกำกับ output VAT
- GFIN จะออกใบหัก ณ ที่จ่าย (ป.รัษฎากร) → SHOP รับ WHT cert + เก็บไว้
- บันทึก: `Dr 11-4202 Withholding Tax Receivable` ตามจำนวน WHT, `Cr` ลด cash หรือ commission ตามจริง

## 8. Auth / RBAC

### 8.1 Cross-entity roles

| Role | Access |
|---|---|
| OWNER | ทั้ง bc_shop + bc_finance — Read/Write |
| ACCOUNTANT | ทั้ง bc_shop + bc_finance — Read/Write (บัญชี+ภาษี) |
| FINANCE_MANAGER | bc_finance only — Read/Write |
| BRANCH_MANAGER | bc_shop only — Read/Write within own branch |
| SALES | bc_shop only — Read/Write own sales |

### 8.2 User model change

```prisma
model User {
  // ... existing fields ...
  accessibleCompanies String[]    // ["SHOP", "FINANCE"] or ["SHOP"] etc.
  primaryCompany      String      // default entity context
}
```

### 8.3 JWT payload

```json
{
  "sub": "user-uuid",
  "role": "OWNER",
  "accessibleCompanies": ["SHOP", "FINANCE"],
  "primaryCompany": "SHOP",
  ...
}
```

### 8.4 Request entity context

```
Order of precedence:
1. URL query: ?company=shop or ?company=finance (explicit override)
2. Header: x-company-scope: shop|finance (API client)
3. User's primaryCompany from JWT
```

`EntityScopeMiddleware` populates `req.entityScope` → used by `PrismaShopService` / `PrismaFinanceService` routing

### 8.5 Pill switcher in UI

- OWNER + ACCOUNTANT: pill switcher [SHOP][FINANCE] ที่ topbar (อันนี้ใช้ component จาก P3-SP1 sidebar redesign)
- SALES/BM: ไม่มี pill — locked to SHOP
- FM: ไม่มี pill — locked to FINANCE

## 9. Tax Filing Per Company

### 9.1 ภ.พ.30 (VAT — FINANCE only)

- FINANCE จด VAT → ยื่น ภ.พ.30 รายเดือนที่ tax ID FINANCE
- SHOP ไม่จด VAT → ไม่ยื่น ภ.พ.30
- TaxReport table ใน bc_finance เท่านั้น สำหรับ PP30

### 9.2 ภ.ง.ด.3 / 53 (WHT — ทั้ง 2)

- SHOP จ่ายค่าแรง พนักงาน → ภ.ง.ด.1, ค่าบริการบุคคล → ภ.ง.ด.3, ค่าบริการนิติบุคคล → ภ.ง.ด.53 — ที่ tax ID SHOP
- FINANCE มี payroll ส่วนกลาง + WHT vendors → ที่ tax ID FINANCE
- TaxReport แยกใน bc_shop และ bc_finance

### 9.3 ภ.ง.ด.50/51 (Corporate Income Tax — ทั้ง 2)

- ภ.ง.ด.50 = ภาษีนิติบุคคลครึ่งปี
- ภ.ง.ด.51 = ภาษีนิติบุคคลทั้งปี
- แต่ละ entity ยื่นแยกที่ tax ID ของตัว
- TaxReport แยก

### 9.4 ภ.ง.ด.1 (PIT WHT from salary — ทั้ง 2)

- SHOP จ่ายเงินเดือนพนักงานหน้าร้าน → SHOP ยื่น
- FINANCE จ่ายเงินเดือนพนักงานส่วนกลาง → FINANCE ยื่น

### 9.5 Document numbering

- ทุก doc type มี per-entity sequence:
  - EX-SHOP-YYYYMMDD-NNNN vs EX-FIN-YYYYMMDD-NNNN
  - หรือคง prefix เดิม + add `entityScope` column และ unique(`entityScope`, `docNumber`)
- ตัดสินใจ: **คงรูปแบบเดิม + entityScope column** (เปลี่ยน prefix breaks existing PDF templates + searches)

## 10. Reports / Consolidated Views

### 10.1 Per-entity reports

- `/accounting/trial-balance?entity=shop|finance` — TB per entity
- `/accounting/profit-loss?entity=shop|finance&start=&end=` — P&L per entity
- `/accounting/balance-sheet?entity=shop|finance&asOf=` — BS per entity
- `/accounting/peak-export?entity=shop|finance` — PEAK CSV per entity

### 10.2 Consolidated views (OWNER only)

- `/dashboard?view=consolidated` — KPI cards: รายได้รวม, กำไรรวม, รายจ่ายรวม → sum 2 entities
- `/accounting/consolidated-pl?start=&end=` — P&L รวม 2 entities + eliminating entries
- Eliminating entries = ตัด commission income (SHOP) vs commission expense (FINANCE) ที่เป็น inter-company
- ใช้ `inter_company_transactions` table track elimination amounts

### 10.3 Cross-entity links in UI

- Customer detail page (FINANCE): "ดูประวัติซื้อใน SHOP" button → opens SHOP customer record in new tab + URL `?company=shop`
- Inter-company JE pair viewer: clicking SHOP JE entry shows linked FINANCE JE (via outbox_event)

## 11. Migration Strategy

### 11.1 Pre-cutover (ระหว่าง P-1 ถึง P-3 = มิ.ย.-พ.ย. 2026)

- ทุก dev work บน current DB (single instance), แค่เพิ่ม `entityScope` column + EntityScope middleware ที่ค่าเริ่มต้น = `SHOP` ตาม table category
- Live runs unchanged (no user-visible change)
- Tests on dual-DB staging environment (clone of prod data, split into 2 DBs)

### 11.2 Data audit (P-2 = ส.ค.-ก.ย. 2026)

**Simplified rule (owner directive 2026-05-19):** บัญชีที่ทำมาตลอด = ของ FINANCE entity (continuing). ทำให้ audit ส่วนใหญ่กลายเป็น **rule-based assignment** ไม่ใช่ per-row review:

| Table | Rule | Manual review needed? |
|---|---|---|
| `journal_entries`, `journal_lines`, `accounting_periods` | **ALL → bc_finance** (historical FINANCE accounting) | ไม่ต้อง |
| `tax_reports` (PP30, PND3/53/50/51 ที่มีอยู่) | **ALL → bc_finance** | ไม่ต้อง |
| `chart_of_accounts` 99-account FINANCE chart | **→ bc_finance** | ไม่ต้อง |
| `chart_of_accounts` S-prefix (P3-SP5 SHOP additions) | **→ bc_shop** ก็เริ่มจากกราฟ S- ใหม่ใน bc_shop, opening balances transferred via journal entries | ไม่ต้อง |
| `contracts`, `payments`, `receipts`, FINANCE customers | **ALL → bc_finance** | ไม่ต้อง |
| `products`, `serial_numbers`, `stock_*` | **ALL → bc_shop** (SHOP เป็นเจ้าของสต็อก) | ไม่ต้อง |
| `sales` (cash sales) | **ALL → bc_shop** | ไม่ต้อง |
| `expense_documents` | filter by existing `companyId` FK (มีอยู่แล้ว) | ไม่ต้อง |
| `commissions` (existing) | **→ bc_shop** (SHOP received side) | ไม่ต้อง |
| `users`, `audit_logs`, `system_config`, `notifications` | **→ bc_shop** (per arch — shared tables) | ไม่ต้อง |
| `customers` (single table currently) | split by usage — POS/quote/sale → bc_shop; contract/LIFF → bc_finance; both → ทั้งคู่ + link via national_id_hash | partial — automated dedup + manual review of ambiguous |
| `branches` | **→ bc_shop** (เฉพาะ branches; FINANCE = ส่วนกลาง ไม่มี branches) | ไม่ต้อง |
| `fixed_assets` | **→ bc_finance** (อุปกรณ์ FINANCE ส่วนกลาง — ของ SHOP สาขามีน้อย, ตรวจรายตัว) | partial |
| `payroll_*` | classify by employee.branch — branch มี → bc_shop; ไม่มี branch (HQ staff) → bc_finance | partial |

**Manual review ลดเหลือ ~3 tables (customers, fixed_assets, payroll)** แทน 50+ tables → SP7.7 effort ลดลง ~50%

**Output**: report `migration-audit-2026-09-XX.md` + per-table CSV เฉพาะ tables ที่ต้อง manual review

### 11.3 Migration script (P-2)

```bash
# Dry-run on staging
node scripts/migration/split-databases.js --dry-run --source-db=bc_orig --dest-shop=bc_shop_staging --dest-finance=bc_finance_staging

# Actual cutover (executed Jan 1, 2027 00:30)
node scripts/migration/split-databases.js --execute --source-db=bc_orig --dest-shop=bc_shop --dest-finance=bc_finance --verify-checksums
```

**Script logic:**
1. Connect to bc_orig (single source DB)
2. For each table:
   - Lookup mapping in `migration_table_mapping` registry
   - Generate `COPY ... TO PROGRAM` → `COPY ... FROM PROGRAM` pipeline
   - Filter rows: `WHERE entityScope = 'SHOP'` → bc_shop; `WHERE entityScope = 'FINANCE'` → bc_finance
   - For shared tables: COPY to bc_shop only
3. Validate: row count per table + checksum per critical table (journal_lines, payments, contracts)
4. Apply post-migration adjustments:
   - Reset sequences (per-entity doc numbering)
   - Rebuild indexes
   - VACUUM ANALYZE
5. Smoke test (run /api/health + login + 1 sale + 1 payment in each entity)

### 11.4 Cutover playbook (Dec 31 → Jan 1)

```
== วันที่ 31 ธ.ค. 2026 ==
22:00 บอกผู้ใช้ Maintenance mode ON (read-only ทั้ง bc_orig)
22:30 Final TB snapshot ของ bc_orig
       - บันทึก hash + ลง audit_log
       - Email Accountant: "Pre-split TB attached, verify before 23:00"
23:00 Year-end closing JE post (ทั้ง 2 sides ของ bc_orig)
       - ใช้ existing year-end closing template (P3-SP1)
       - Revenue → 39-9999, Expenses → 39-9999, 39-9999 → 33-1101
       - หลังโพสต์ TB ต้อง balance
23:30 Backup snapshot ของ bc_orig
       - Cloud SQL automated backup + manual export to GCS
       - Hash + verify

== วันที่ 1 ม.ค. 2027 ==
00:00 Maintenance mode FULL (no traffic)
00:10 Migration script execute
       - Step 1: COPY data to bc_shop
       - Step 2: COPY data to bc_finance
       - Step 3: Validate counts + checksums
00:45 Run prisma migrate deploy on bc_shop + bc_finance
       (ทั้ง 2 DBs เริ่มจาก initial schema ที่ split — migrations applied fresh)
01:00 Smoke tests (automated)
       - /api/health both DBs
       - Login as OWNER, switch SHOP→FINANCE, dashboard loads
       - Create test sale in SHOP → JE posted
       - Create test payment in FINANCE → JE posted + outbox processed
01:30 UAT (Accountant)
       - TB shop = expected
       - TB finance = expected
       - 1 contract activation → SHOP+FINANCE pair JE posted via outbox
02:00 Open to internal staff (low risk users first)
04:00 Maintenance mode OFF (full traffic)
```

### 11.5 Rollback playbook

ถ้า step ใดล้มเหลวก่อน 02:00:
```
1. Stop migration script
2. Drop bc_shop + bc_finance (just-created DBs)
3. Verify bc_orig untouched (snapshot at 23:30 still valid)
4. Re-enable bc_orig + remove maintenance mode
5. Open old API service (revert env vars pointing back to bc_orig)
6. Schedule new cutover window (next 2 weeks)
7. Root cause analysis + fix
```

หลัง 04:00 → rollback ยากขึ้น (อาจมี real txns ใน bc_shop/finance)
→ ใช้ point-in-time recovery จาก Cloud SQL backups + manual reconcile

### 11.6 Post-cutover stabilization (ม.ค. 2027)

- 7 วันแรก: daily reconciliation report จาก accountant — ตรวจ TB + outbox + cross-entity links
- 30 วันแรก: bc_orig DB เก็บ read-only + accessible (forensic case) → drop หลัง 90 วัน

## 12. Sub-Project Decomposition

10 sub-projects, sequential ตามลำดับเลข

### SP7.1 — Dual Prisma Client Foundation (2 wks, มิ.ย. 2026)
- เพิ่ม `bc_finance` Prisma schema (clone จาก current แล้ว trim เฉพาะ finance tables)
- `PrismaShopService` (current) + `PrismaFinanceService` (ใหม่)
- EntityScope middleware + decorator
- staging environment 2-DB setup
- ทุก test pass บน dual-DB
- **ไม่กระทบ live** (live ยังใช้ bc_orig → bc_shop เท่านั้น, bc_finance ว่าง)

### SP7.2 — Outbox + PairedJournalService (2 wks, มิ.ย.-ก.ค. 2026)
- `outbox_events` table + schema
- PairedJournalService refactor: outbox-pattern
- Saga retries + Sentry on failure
- Reconciliation cron
- Manual reconcile UI

### SP7.3 — Auth/RBAC Cross-Entity (1 wk, ก.ค. 2026)
- User.accessibleCompanies field
- JWT payload update
- EntityScopeMiddleware
- Pill switcher UI (build on P3-SP1 sidebar foundation)
- 403 logic when user touches unauthorized entity

### SP7.4 — ExternalFinanceCompany + Commission (1 wk, ส.ค. 2026 — parallel w/ 7.5)
- 2 new tables in bc_shop
- 3 JE templates (Template 1/2/3 ของ section 7.3)
- UI: /external-finance/* (CRUD + commission tracking)
- WHT integration

### SP7.5 — Per-Entity Tax Filing (2 wks, ส.ค. 2026 — parallel w/ 7.4)
- TaxReport rewire — add entityScope, filter all reports by entity
- PP30: only FINANCE
- PND3/53/50/51: per-entity
- PND1: per-entity (from payroll module)
- /tax-reports UI: pill switcher

### SP7.6 — Consolidated Reports (1 wk, ก.ย. 2026)
- /dashboard?view=consolidated
- /accounting/consolidated-pl
- Eliminating entries logic
- OWNER-only feature flag

### SP7.7 — Data Audit + Migration Scripts (2 wks, ก.ย.-ต.ค. 2026)
- Audit scripts (entityScope assignment)
- Migration script (bc_orig → bc_shop + bc_finance)
- Dry-run tooling
- Run dry-run #1 on staging clone

### SP7.8 — Infrastructure: 2 LINE OAs + 2 Backup Pipelines (1.5 wks, ต.ค. 2026)
- LINE OA per entity (CompanyInfo.lineOaId)
- Off-site backup cron: split into 2 jobs (per DB)
- 1 Sentry project + entity_scope tag (NOT 2 projects, per NG3)
- Health checks both DBs

### SP7.9 — Year-End Closing in Old Structure (1 wk, ธ.ค. 2026)
- ตรวจ existing year-end closing template (P3-SP1) ใช้ได้กับ bc_orig (legacy single entity)
- Edge case: ลองโพสต์ตัวอย่าง closing JE บน clone of prod data
- Verify: balance sheet at 31 ธ.ค. 2026 final state

### SP7.10 — Cutover Playbook + Rehearsal + UAT (1.5 wks, พ.ย.-ธ.ค. 2026)
- Document cutover playbook (จาก section 11.4)
- Rehearsal #1 (mid-Nov) — full dry-run on staging
- Rehearsal #2 (mid-Dec) — final dry-run + accountant UAT
- War room setup (Slack channel + on-call dev + accountant phone)
- Rollback drill (proven workable)

### Timeline

| Phase | ช่วงเวลา | Sub-projects |
|---|---|---|
| **P-1: Foundation** | มิ.ย.-ก.ค. 2026 | SP7.1 + SP7.2 + SP7.3 |
| **P-2: Domain features** | ส.ค.-ก.ย. 2026 | SP7.4 (parallel SP7.5) + SP7.6 |
| **P-3: Migration prep** | ก.ย.-พ.ย. 2026 | SP7.7 + SP7.8 + Rehearsal #1 |
| **P-4: Pre-cutover** | ธ.ค. 2026 | SP7.9 + SP7.10 + Rehearsal #2 |
| **CUTOVER** | 31 ธ.ค. 2026 22:00 → 1 ม.ค. 2027 04:00 | Live execution |
| **Stabilization** | ม.ค.-ก.พ. 2027 | Daily reconcile + bug bash + bc_orig retention |

## 13. Testing Strategy

### 13.1 Unit tests
- Per-service 2 mock Prisma clients (jest.mock both PrismaShopService + PrismaFinanceService)
- Coverage target: ≥85% on new code

### 13.2 Integration tests
- docker-compose w/ 2 PostgreSQL containers in CI (postgres:15 ×2)
- bc_shop_test + bc_finance_test schemas
- Test outbox flow: write SHOP TX → wait for outbox processed → verify FINANCE JE exists
- Test saga compensation: simulate FINANCE DB down → retry → eventual success

### 13.3 E2E tests (Playwright)
- Flow specs touching both DBs:
  - Cash sale (SHOP only)
  - Installment contract activation (SHOP + FINANCE pair JE)
  - Payment with commission (SHOP + FINANCE)
  - External finance commission flow (SHOP only)
  - Year-end closing (after cutover — both entities)

### 13.4 Migration tests
- Migration script unit tests (table-by-table mapping)
- Full migration dry-run on clone of prod (run ใน CI nightly)
- Checksum verification

### 13.5 Reconciliation tests
- Daily cron test (mock outbox events) → reconciliation report correctness
- Edge cases: orphan outbox, duplicate idempotency_key, amount mismatch

### 13.6 UAT scripts
- Accountant runs through 20 standard transactions per entity
- All TB/P&L/BS reports cross-checked against manual Excel calc
- ภ.พ.30 / ภ.ง.ด.3 sample for Jan 2027 = compared to expected output

## 14. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Cross-DB transaction failure mid-flow | Lost JE, accounting imbalance | Medium | Outbox + saga retry + daily reconcile + Sentry alarms |
| Migration script bug → data loss | Total data corruption | Low (mitigated by dry-runs) | 2 staging rehearsals + checksum validation + bc_orig untouched as backup |
| Accountant rejects post-cutover TB | Cutover ล้มเหลว rollback | Medium | UAT during P-4, accountant sign-off rehearsal, pre-cutover TB snapshot |
| Legal registration delayed | ตื่นมา 1 ม.ค. แต่ยังไม่มี tax ID ใหม่ | Medium | Owner to confirm tax IDs by Oct 2026 + schema field nullable until first use |
| Customer dedupe edge cases | คนเดียวมี 2 records | High | CustomerLinkService + manual reconcile UI |
| External finance integration unclear | GFIN flow ผิดจาก spec | Medium | Owner verifies SP7.4 with sample real GFIN agreement before merge |
| Inter-company JE imbalance after split | Reports wrong | Low | Eliminating entries logic + consolidated view tests |
| BC FINANCE มี vendor ค้างจ่ายข้าม entity | AP confusion | Low | Audit + manual classify by accountant ใน P-2 |
| LINE LIFF users post-cutover see wrong entity | Customer UX broken | Medium | LIFF auth tied to FINANCE only (LINE OA finance) |
| OWNER login confusion (which entity am I in?) | UX | Low | Pill switcher prominent + entity context shown in topbar |
| Prisma migrate deploy mid-cutover fails | Cutover blocked | Low | Test migrations in dry-runs + manual SQL backup |
| PII encryption key per-entity confusion | Decrypt fails | Low | Shared key in bc_shop (per arch decision) + key rotation tested |

## 15. Out of Scope

ดู Non-Goals (section 2). โดยสรุป:
- Real-world legal registration (owner + lawyer)
- 2 Cloud Run services
- 2 codebases
- 2 Sentry projects
- Multi-currency
- Mid-year split
- New module refactors นอกเหนือจาก DB layer

## 16. Open Questions (ต้องการคำตอบก่อน SP7.7 = ก.ย. 2026)

### OQ1 — Equity split (CRITICAL, needs CPA)
ตอนแยก 1 ม.ค. 2027:
- ทุนจดทะเบียน (paid-in capital) บริษัทเดิม → แบ่งให้ SHOP และ FINANCE อย่างไร?
- กำไรสะสม (retained earnings) → แบ่งสัดส่วนเท่าไร?
- คำตอบกำหนด opening balance ของแต่ละ entity. **ต้อง CPA + ทนายตัดสิน ก่อน Sept 2026**

### OQ2 — Tax IDs (CRITICAL, needs owner action — REVISED 2026-05-19)
- **BC FINANCE Co.,Ltd.** = continuing entity → tax ID เดิม (อาจต้อง update นิติบุคคล name change ที่ RD + กรมพัฒน์ฯ)
- **BC SHOP Co.,Ltd.** = new entity → ต้องจดทะเบียนใหม่ที่กรมพัฒน์ฯ + ขอ tax ID จาก RD
- Timeline: BC SHOP ต้องมี tax ID ภายใน **ต.ค. 2026** เพื่อให้ทันบันทึก system + invoice template
- กรมพัฒน์ฯ จดทะเบียน ~30 วัน, RD ~7-14 วัน — เริ่ม process ภายใน **ก.ค. 2026** (3 เดือนก่อน deadline)

### OQ3 — Existing contracts (ลูกค้า active)
ลูกค้าที่มี contract active ณ 31 ธ.ค. 2026:
- Contract เดิมระบุคู่สัญญาเป็น "BC ปัจจุบัน" → ต้อง novate (โอนสัญญา) เป็น BC FINANCE Co.,Ltd. ใหม่
- มี option (a) ทำหนังสือโอนสัญญารายลูกค้า, (b) แจ้งยกเลิกแบบโดยปริยายผ่าน LINE OA + รอ 30 วัน, (c) ดำเนินคดีต่อด้วย BC FINANCE ในฐานะผู้รับโอน → ต้องปรึกษาทนาย
- ระบบรองรับ: contract.legalEntityId column + migration script เปลี่ยน contract เก่าเป็น BC FINANCE Co.,Ltd. ใหม่

### OQ4 — SHOP entity opening balance transfer (CRITICAL, needs CPA — EXPANDED 2026-05-19)
Per owner directive: FINANCE = continuing entity, SHOP = new entity. ตอน 1 ม.ค. 2027 BC SHOP เริ่มจากศูนย์ — ต้องมี **opening balance transfer JE** จาก FINANCE (อดีต = บริษัทเดียว) → SHOP (entity ใหม่):

- **Inventory** (เครื่องในสต็อก, อะไหล่, สินค้ารับซื้อมือสอง) — book value ณ 31 ธ.ค. 2026 → transferred to SHOP. JE: FINANCE Cr inventory, owner capital injection to SHOP Dr inventory
- **SHOP receivables** (commission receivable ยังไม่จ่าย, trade-in deposits) → transferred to SHOP
- **SHOP-side payables** (เงินเดือนพนักงานหน้าร้าน, ค่าน้ำไฟค้างจ่าย) → transferred to SHOP
- **Equity injection to SHOP** = net of above transfers + owner cash injection (if any)
- ปรึกษา CPA ว่า transfer JE แต่ละ leg ใช้ accounts ไหน + ภาษีมีผลกระทบยังไง (ภาษีของขวัญ, capital transfer tax)
- **ต้อง CPA approval ก่อน Aug 2026** (ก่อน SP7.7 migration script เริ่ม)

### OQ5 — Bank accounts
- บัญชีธนาคารปัจจุบัน — แยกอยู่แล้วต่อ entity logical ใช่ไหม?
- ต้องเปลี่ยนเลขผู้เสียภาษีของบัญชีธนาคารใหม่หรือเปล่า?
- PaySolutions merchant account: ต้อง re-onboard เป็น 2 merchants ใหม่ไหม?

### OQ6 — VAT registration
- BC SHOP Co.,Ltd. ใหม่ จะจด VAT หรือไม่? (ปัจจุบันนโยบาย "ไม่จด")
- ถ้าจะจดในอนาคต spec นี้ต้องปรับ chart of accounts (SHOP-side มี output VAT)

### OQ7 — PDPA encryption key
- ใช้ shared key (อยู่ใน bc_shop) ดีไหม? หรือควรแยก key ต่อ entity?
- Trade-off: shared = ง่าย, แยก = แต่ละ entity มี blast radius เล็กลง

### OQ8 — Subdomain / URL
- ต้องการ shop.bestchoice.app + finance.bestchoice.app ไหม?
- หรือ bestchoice.app + URL query ?company=shop|finance ก็พอ (ปัจจุบัน assumption)

## 17. Dependencies & Predecessors

- **P3-SP4 PII encryption** (✅ merged 2026-05-18) — encryption ต้อง stable + key rotation tested
- **P3-SP5 SHOP-side accounting** (✅ merged 2026-05-18) — SHOP chart of accounts + JE templates อยู่แล้ว, แค่ rewire DB
- **P3-SP1 Year-end closing** (✅ merged 2026-05-18) — ใช้ใน SP7.9
- **Sidebar redesign (D1)** (✅ deployed 2026-05-18) — Pill switcher pattern ใช้ใน SP7.3
- **SP5 follow-ups** (deferred, จะทำใน SP7 ด้วย): SHOP balance sheet, per-branch BM P&L, ShopRepossessionReversalTemplate

## 18. Approval

**Owner approval (required before implementation starts):**
- [ ] Design overall structure (section 3-10)
- [ ] Sub-project decomposition + timeline (section 12)
- [ ] Open questions plan (OQ1-OQ8 — เริ่มหาคำตอบจาก CPA + ทนาย ก่อน Aug 2026)

**CPA/accountant approval (required before SP7.7):**
- [ ] Equity split methodology (OQ1)
- [ ] Asset transfer methodology (OQ4)
- [ ] Eliminating entries methodology (section 10.2)

**Tracking:**
- Owner sign-off date: TBD
- GitHub issue: TBD (open after sign-off)
- Slack channel: #p3-sp7-split (proposed)
- Status meetings: bi-weekly during P-1/P-2, weekly during P-3/P-4

---

**End of Spec**
