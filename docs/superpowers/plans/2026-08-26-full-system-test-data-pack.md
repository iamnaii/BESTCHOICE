# Full-System Test Data Pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างชุดข้อมูลทดสอบที่ครอบ 19 โดเมน (~55 แถว) ให้ทุกหน้าใน 182 route มีของให้กด พร้อมโหมดเดินเรื่องที่ทำให้สมุดบัญชีมีตัวเลขจริง และ cleanup ที่กวาดคืนได้หมด

**Architecture:** orchestrator CLI 2 ตัว (`seed-test-pack` / `cleanup-test-pack`) + โมดูลต่อโดเมนที่ implement `DomainSeeder` interface เดียวกัน แต่ละโมดูลถือทั้ง `seed` และ `cleanup` ไว้ในไฟล์เดียวกัน ทำงาน 3 เฟส — เฟส 1-2 เขียน Prisma ตรง (ไม่มีผลบัญชี) เฟส 3 เรียก service จริงผ่าน `TestPackModule` ที่ไม่มี cron

**Tech Stack:** NestJS 11 · Prisma 6 · TypeScript 5.6 · jest 29 (unit, ไม่แตะ DB) · tsx สำหรับรัน CLI

---

## Global Constraints

ทุก task อยู่ใต้ข้อบังคับเหล่านี้ — ละเมิดข้อไหนคือ implementation ผิด ไม่ใช่แค่ไม่สวย
(ที่มา: `docs/superpowers/specs/2026-08-26-full-system-test-data-pack-design.md` §3)

- **R1 — seeder ห้ามเขียน `JournalEntry` / `JournalLine` เอง** ไม่ว่ากรณีใด JE ทุกใบต้องมาจาก template จริงผ่าน service จริงในเฟส 3 เท่านั้น
- **R2 — เฟส 1-2 ต้องหยุดที่สถานะสุดท้าย "ก่อนเงินขยับ"** ห้าม seed `Booking.status='PAID'`, `FinanceReceivable.receivedAmount>0`, `TradeIn.status='ACCEPTED'`, `ExpenseDocument.status` เป็น `ACCRUAL`/`POSTED`, `OtherIncome.status='POSTED'`, `EquityDocument.status='POSTED'`, `FixedAsset.status='POSTED'`
- **R3 — ห้าม import `AppModule`** ในโค้ดใด ๆ ของ test-pack (มี `ScheduleModule.forRoot()` ที่จะลงทะเบียน cron ทั้งหมด) เฟส 3 ใช้ `TestPackModule` เท่านั้น
- **Marker บังคับ 3 ชั้น** — เลขเอกสารที่เราคุมเอง = prefix `TEST-` · เลขที่ `DocNumberService` คุม (`EX-` `OI-` `EQ-` `ASSET-` `RT-`) = **ห้ามแตะเลข** ให้ marker อยู่ที่ฟิลด์ข้อความ ขึ้นต้น `[ทดสอบระบบ]` · ทะเบียนหลัก = ชื่อขึ้นต้น `ทดสอบระบบ`
  **ข้อยกเว้นเดียว: `FixedAsset.assetCode` ใช้ลำดับแยก `TESTASSET-`** เพราะรหัสจริงเป็น**รายหมวด** (`COMP-001`) ไม่ใช่รายวัน ⇒ ถ้าเอาไปตั้งให้แถวทดสอบ เลขนั้นจะถูกเผาถาวร (soft-delete แต่ `@unique` ยังกันอยู่) · `docNo` (`ASSET-YYMM-`) ยังเดินตามลำดับจริงเหมือนเอกสารอื่น
- **Guard shape** ต้องเหมือน `seed-test-contracts.cli.ts` ทุกประการ — `EXPECTED_DB_NAME` เทียบ `SELECT current_database()` · dry-run เป็น default · `CONFIRM_SEED` / `CONFIRM_CLEANUP` = `YES_I_AM_SURE` · `NODE_ENV=production` ต้องมี `ALLOW_PROD_SEED` / `ALLOW_PROD_CLEANUP` เพิ่ม
- **Re-run safe บังคับ** — ทุกโดเมนต้องเช็ค marker ก่อนสร้าง รันซ้ำแล้วต้องไม่เกิดแถวซ้ำ
- **Money = `Decimal`** ห้ามใช้ `Number()` กับจำนวนเงิน (`.claude/rules/database.md`)
- **ข้อความ user-facing เป็นภาษาไทย** รวม log ที่ผู้ใช้อ่าน
- **Prettier**: `semi: true, singleQuote: true, printWidth: 100, tabWidth: 2`
- **เทสเป็น jest unit spec ที่ไม่แตะ DB** — ทดสอบ pure function ที่ export ออกมา (pattern เดียวกับ `backfill-employee-profiles.cli.spec.ts`) ไฟล์ `*.spec.ts` ใต้ `src/` ถูกจับโดย `testRegex: ".*\\.spec\\.ts$"` อัตโนมัติ
- **โดเมน seeder ไม่มี unit test โดยเจตนา — พิสูจน์ด้วย round-trip กับ DB จริงแทน**
  (Task 3 · 5 · 6 · 7 · 8 · 9 · 10 จึงไม่มี step เขียนเทส และ **ไม่ถือเป็นข้อบกพร่องตอน review**)
  เหตุผล: ตัวโดเมนเกือบทั้งหมดเป็น `prisma.X.create()` ⇒ unit test ต้อง mock `PrismaService`
  ซึ่งทดสอบได้แค่ *"mock ถูกเรียกด้วย argument ชุดนี้"* — **ไม่ได้ทดสอบว่าชื่อฟิลด์ตรง schema จริง
  หรือ enum มีค่านั้นจริง** ซึ่งเป็นบั๊กคลาสที่เกิดขึ้นจริงในแผนฉบับแรก (5 จุด ดูหัวข้อ "รอบแก้หลัง
  scrutinize") · round-trip `seed → cleanup → seed ซ้ำ` กับ DB จริงจับได้ทั้ง 5 จุดนั้น
  **pure function ยังต้องมี unit test เสมอ** — `_context` `_helpers` `_registry` `_preflight` `_docgen`
  (Task 1 · 4 · 11 · 13)
- **เช็ค `deletedAt` ของทุกโมเดลก่อนเลือกวิธีลบ** — มี `deletedAt` = soft delete เสมอ (`.claude/rules/database.md`: *"ใช้ `deletedAt` — **ห้าม hard delete** เด็ดขาด"*) · **ข้อยกเว้นเดียว** คือ `JournalEntry`/`JournalLine`/`JournalPostAuditLog` ที่ hard delete โดยเจตนาเพื่อคืนงบทดลอง (precedent: `cleanup-test-contracts.cli.ts`) และตารางลูกที่ไม่มี `deletedAt` เลย
- **ห้ามเดาชื่อฟิลด์** — ก่อนเขียน `create` ของโมเดลไหน ให้หาโมเดลนั้นใน `apps/api/prisma/seed.ts` ก่อน (Task 0) ถ้าไม่มีจึงค่อยอ่าน `schema.prisma`

> **บทเรียนที่ทำให้มีสองข้อสุดท้าย** — แผนฉบับแรกถูก scrutinize แล้วพบ compile error 3 จุด
> (`AssetsModule` ที่ไม่มีอยู่ · `ContractExchangeRequest.reason` ที่ไม่มีในโมเดล ·
> `equityShareholderLine.equityDocumentId` ที่ชื่อจริงคือ `documentId`) + hard delete ผิดกฎ 5 จุด
> + `POStatus.PARTIAL` ที่ค่าจริงคือ `PARTIALLY_RECEIVED` — **ทั้งหมดเกิดจากการเดาชื่อฟิลด์
> ทั้งที่ `prisma/seed.ts` มีของจริงอยู่แล้ว 1,647 บรรทัด**

---

## File Structure

| ไฟล์ | หน้าที่ |
|---|---|
| `apps/api/src/cli/test-pack/_types.ts` | `DomainSeeder` · `SeedContext` · `SeedRefs` · `PlanRow` · `SeedStat` · `CleanupStat` — ไม่มี logic |
| `apps/api/src/cli/test-pack/_context.ts` | marker constants · `testNote()` · `testName()` · `bkkDateStr()` · `resolveRefs()` |
| `apps/api/src/cli/test-pack/_registry.ts` | รวม DomainSeeder ทุกตัวเป็น array + `selectDomains()` + `orderForCleanup()` |
| `apps/api/src/cli/test-pack/_registry.spec.ts` | unit test ของ `selectDomains` / `orderForCleanup` |
| `apps/api/src/cli/test-pack/_context.spec.ts` | unit test ของ `testNote` / `testName` / `bkkDateStr` |
| `apps/api/src/cli/test-pack/_preflight.ts` | ตรวจ 4 ข้อก่อนเริ่ม (Task 11) |
| `apps/api/src/cli/test-pack/_module.ts` | `TestPackModule` — import เฉพาะ feature module ที่เฟส 3 ใช้ (Task 12) |
| `apps/api/src/cli/test-pack/_drive.ts` | แผนเดินเรื่อง 6 ก้าว (Task 12) |
| `apps/api/src/cli/test-pack/<domain>.seed.ts` × 19 | หนึ่งไฟล์ต่อโดเมน ถือทั้ง `plan` `seed` `cleanup` |
| `apps/api/src/cli/seed-test-pack.cli.ts` | orchestrator ขาสร้าง |
| `apps/api/src/cli/cleanup-test-pack.cli.ts` | orchestrator ขาล้าง |
| `apps/api/package.json` | เพิ่ม 4 script: `seed:test-pack` `seed:test-pack:help` `cleanup:test-pack` `cleanup:test-pack:help` |
| `docs/guides/FULL-SYSTEM-TEST-CHECKLIST/README.md` | generate จาก registry (Task 13) |

**ไม่แตะ:** `seed-test-contracts.cli.ts` และ `cleanup-test-contracts.cli.ts` — Task 3 ห่อมันผ่าน export ที่มีอยู่แล้วเท่านั้น

---

### Task 0: Harvest ของจริงจาก `prisma/seed.ts` (อ่านอย่างเดียว ไม่แก้โค้ด)

**Files:** ไม่สร้าง/แก้ไฟล์ใด — ผลลัพธ์คือบันทึกที่เอาไปใช้ใน Task 7-9

**Interfaces:** ไม่มี — task นี้ผลิต *ความรู้* ไม่ใช่โค้ด

**ทำไมต้องมี task นี้:** `apps/api/prisma/seed.ts` (1,647 บรรทัด) มี `create` ที่**รันผ่านจริง**สำหรับ
7 ใน 19 โดเมนที่แผนนี้จะสร้าง การคัดรูป `data` มาจากของจริงตัดปัญหาเดาชื่อฟิลด์ทิ้งทั้งหมด

| โดเมนในแผน | สิ่งที่ dev seed มีให้ harvest |
|---|---|
| `suppliers-po` (Task 7) | `supplier` · `purchaseOrder` · `poItemsData` (มี `brand` `model` `color` `storage` `category` `quantity` `unitPrice` `receivedQty`) · `goodsReceiving` |
| `stock-ops` (Task 7) | `stockAdjustment` · **`reorderPoint`** · `stockAlert` · `stockCount` + `items` · `stockTransfer` |
| `inspections` (Task 9) | `inspection` (`inspectedAt` `overallGrade` `isCompleted` `notes`) · `inspectionResult` · `inspectionTemplate` |
| `applications` (Task 8) | `creditCheck` |

- [ ] **Step 1: อ่านบล็อกที่เกี่ยวข้อง**

```bash
sed -n '990,1060p' apps/api/prisma/seed.ts    # inspections + results
sed -n '1140,1230p' apps/api/prisma/seed.ts   # stockAdjustment + reorderPoint + stockAlert + stockCount
sed -n '300,360p' apps/api/prisma/seed.ts     # purchaseOrder + poItemsData
grep -n -B4 -A12 "prisma.creditCheck.create" apps/api/prisma/seed.ts
grep -n -A12 "prisma.goodsReceiving.create" apps/api/prisma/seed.ts
grep -n -A10 "prisma.stockTransfer.create" apps/api/prisma/seed.ts
```

- [ ] **Step 2: จดค่าที่ยืนยันแล้ว (ใช้ต่อใน Task 7-9)**

ค่าที่ตรวจแล้วตอนเขียนแผน — ยืนยันซ้ำว่ายังตรง:

| สิ่งที่ต้องรู้ | ค่าจริง |
|---|---|
| `POStatus` | `DRAFT` `APPROVED` `ORDERED` `PENDING` `PARTIALLY_RECEIVED` `FULLY_RECEIVED` `CANCELLED` — **ไม่มี `PARTIAL`** |
| `StockCount.status` | `String` ธรรมดา (ไม่ใช่ enum) ค่าที่ใช้: `DRAFT` `IN_PROGRESS` `COMPLETED` `CANCELLED` |
| `StockCountItem` | `productId` · `expectedStatus` (String) · `actualFound` · `scannedImei` |
| `StockAdjustment` | `productId` `branchId` `reason` `previousStatus` `notes` `adjustedById` `approvedById` — **ผู้อนุมัติต้องเป็นคนละคนกับผู้ปรับ** |
| `StockAlert` | ต้องมี `reorderPointId` ก่อน ⇒ สร้าง `ReorderPoint` นำเสมอ · ฟิลด์: `brand` `model` `storage` `category` `branchId` `currentStock` `minQuantity` `reorderQuantity` `status` |
| `ReorderPoint` | `brand` `model` `storage` `category` `branchId` `minQuantity` `reorderQuantity` |
| `Inspection` | `productId` `templateId` `inspectorId` `inspectedAt` `overallGrade` `isCompleted` `notes` |

- [ ] **Step 3: ยืนยันโมเดลไหนมี `deletedAt` (ตัวตัดสิน soft vs hard delete)**

```bash
for m in StockCount StockCountItem StockTransfer StockAdjustment StockAlert ReorderPoint \
         RepairTicket OnlineOrder OnlineInstallmentApplication ProductReservation \
         BookingItem POItem GoodsReceiving Inspection InspectionResult; do
  printf "%-30s " "$m"
  awk "/^model $m /,/^}/" apps/api/prisma/schema.prisma | grep -q deletedAt && echo "soft" || echo "hard"
done
```
Expected (ตรวจแล้วตอนเขียนแผน): `StockCount` `StockCountItem` `RepairTicket` `OnlineOrder`
`OnlineInstallmentApplication` `Inspection` = **soft** · `ProductReservation` `BookingItem` = **hard**
ถ้าผลไม่ตรงกับที่โค้ดใน Task 7-9 ใช้ ให้ยึดผลจากคำสั่งนี้

**ไม่มี commit สำหรับ task นี้** — เป็นการอ่านล้วน ๆ

---

### Task 1: Framework + โดเมนแรก (`todos`)

**Files:**
- Create: `apps/api/src/cli/test-pack/_types.ts`
- Create: `apps/api/src/cli/test-pack/_context.ts`
- Create: `apps/api/src/cli/test-pack/_registry.ts`
- Create: `apps/api/src/cli/test-pack/todos.seed.ts`
- Create: `apps/api/src/cli/seed-test-pack.cli.ts`
- Modify: `apps/api/package.json` (scripts block)
- Test: `apps/api/src/cli/test-pack/_context.spec.ts`
- Test: `apps/api/src/cli/test-pack/_registry.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` จาก `../../prisma/prisma.service`
- Produces: `DomainSeeder` · `SeedContext` · `SeedRefs` · `PlanRow` · `SeedStat` · `CleanupStat` (จาก `_types.ts`) · `TEST_NOTE_MARKER` · `TEST_NAME_PREFIX` · `TEST_DOC_PREFIX` · `testNote(what: string): string` · `testName(what: string): string` · `bkkDateStr(now: Date): string` · `bkkMidnight(now: Date): Date` · `resolveRefs(prisma: PrismaService): Promise<SeedRefs>` (จาก `_context.ts`) · `ALL_DOMAINS: DomainSeeder[]` · `selectDomains(all: DomainSeeder[], csv: string | undefined): DomainSeeder[]` · `orderForCleanup(domains: DomainSeeder[]): DomainSeeder[]` (จาก `_registry.ts`) · `todosSeeder: DomainSeeder`

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน — `_context.spec.ts`**

```ts
import { bkkDateStr, bkkMidnight, testName, testNote, TEST_NAME_PREFIX, TEST_NOTE_MARKER } from './_context';

describe('marker helpers', () => {
  it('testNote ขึ้นต้นด้วย marker เสมอ — cleanup ค้นด้วย startsWith', () => {
    expect(testNote('ค่าเช่าร้าน')).toBe(`${TEST_NOTE_MARKER} ค่าเช่าร้าน`);
    expect(testNote('x').startsWith(TEST_NOTE_MARKER)).toBe(true);
  });

  it('testName ขึ้นต้นด้วยคำว่าทดสอบระบบ', () => {
    expect(testName('ซัพพลายเออร์ 1')).toBe(`${TEST_NAME_PREFIX} ซัพพลายเออร์ 1`);
  });
});

describe('bkk date helpers', () => {
  // 2026-08-26T18:30:00Z = 2026-08-27 01:30 เวลาไทย → ต้องได้วันที่ 27 ไม่ใช่ 26
  const lateUtc = new Date('2026-08-26T18:30:00.000Z');

  it('bkkDateStr คืนวันที่ตามเวลาไทย ไม่ใช่ UTC', () => {
    expect(bkkDateStr(lateUtc)).toBe('20260827');
  });

  it('bkkMidnight คืนเที่ยงคืนของวันไทยวันนั้น', () => {
    const m = bkkMidnight(lateUtc);
    expect(m.getUTCFullYear()).toBe(2026);
    expect(m.getUTCMonth()).toBe(7); // สิงหาคม = 7
    expect(m.getUTCDate()).toBe(27);
    expect(m.getUTCHours()).toBe(0);
  });
});
```

- [ ] **Step 2: เขียนเทสที่ยังไม่ผ่าน — `_registry.spec.ts`**

```ts
import { orderForCleanup, selectDomains } from './_registry';
import type { DomainSeeder } from './_types';

const stub = (key: string): DomainSeeder =>
  ({ key, label: key, routes: [], markerDoc: '', plan: async () => [], seed: async () => ({ created: 0, skipped: 0, notes: [] }), cleanup: async () => ({ removed: {}, warnings: [] }) });

const all = [stub('contracts'), stub('assets'), stub('equity')];

describe('selectDomains', () => {
  it('ไม่ระบุ DOMAINS = เอาทุกโดเมนตามลำดับเดิม', () => {
    expect(selectDomains(all, undefined).map((d) => d.key)).toEqual(['contracts', 'assets', 'equity']);
  });

  it('เลือกได้ตาม csv และคงลำดับของ registry ไม่ใช่ลำดับที่พิมพ์', () => {
    expect(selectDomains(all, 'equity,contracts').map((d) => d.key)).toEqual(['contracts', 'equity']);
  });

  it('ตัดช่องว่างและตัวพิมพ์ใหญ่ให้', () => {
    expect(selectDomains(all, ' Assets , EQUITY ').map((d) => d.key)).toEqual(['assets', 'equity']);
  });

  it('ชื่อที่ไม่รู้จัก = โยน พร้อมบอกรายชื่อที่มี', () => {
    expect(() => selectDomains(all, 'assets,ไม่มีอยู่')).toThrow(/ไม่มีอยู่/);
  });
});

describe('orderForCleanup', () => {
  it('ล้างย้อนลำดับการสร้าง เพราะโดเมนหลังพึ่ง FK ของโดเมนหน้า', () => {
    expect(orderForCleanup(all).map((d) => d.key)).toEqual(['equity', 'assets', 'contracts']);
  });

  it('ไม่แก้ array ต้นฉบับ', () => {
    orderForCleanup(all);
    expect(all.map((d) => d.key)).toEqual(['contracts', 'assets', 'equity']);
  });
});
```

- [ ] **Step 3: รันเทสให้เห็นว่าไม่ผ่าน**

Run: `npm --prefix apps/api test -- test-pack`
Expected: FAIL — `Cannot find module './_context'` และ `Cannot find module './_registry'`

- [ ] **Step 4: เขียน `_types.ts`**

```ts
import type { PrismaService } from '../../prisma/prisma.service';

/** ข้อมูลอ้างอิงที่ทุกโดเมนใช้ร่วมกัน — resolve ครั้งเดียวตอนเริ่ม */
export interface SeedRefs {
  branchId: string;
  branchName: string;
  /** สาขาที่สอง — ใช้กับโอนย้ายสต็อก; null เมื่อมีสาขาเดียว (โดเมนนั้นจะข้ามเอง) */
  secondBranchId: string | null;
  salespersonId: string;
  /**
   * BRANCH_MANAGER (ถ้ามี) หรือ OWNER — ผู้บันทึก/ผู้ตรวจทั่วไป
   * ⚠️ ไม่การันตีว่าต่างจาก ownerId — ระบบที่มี OWNER คนเดียว (ไม่มี BM) จะได้คนเดียวกัน
   * ทั้งสองช่อง; งานที่ต้องแยกผู้ทำ/ผู้อนุมัติ (4-eyes) ต้องเช็ค reviewerId !== ownerId เอง
   */
  reviewerId: string;
  /** OWNER เท่านั้น — ผู้อนุมัติทั่วไป (อาจเป็นคนเดียวกับ reviewerId — ดูหมายเหตุด้านบน) */
  ownerId: string;
  shopCompanyId: string | null;
  financeCompanyId: string | null;
}

export interface SeedContext {
  prisma: PrismaService;
  refs: SeedRefs;
  dryRun: boolean;
  /** เที่ยงคืนของวันไทยวันนี้ */
  today: Date;
  /** YYYYMMDD ตามเวลาไทย — ใช้ประกอบเลขเอกสาร TEST- */
  dateStr: string;
}

/** หนึ่งบรรทัดที่ dry-run พิมพ์ออกมา */
export interface PlanRow {
  label: string;
  detail: string;
}

export interface SeedStat {
  created: number;
  skipped: number;
  /** ข้อความไทยที่ orchestrator พิมพ์ใต้ชื่อโดเมน เช่น เหตุผลที่ข้าม */
  notes: string[];
}

export interface CleanupStat {
  /** ชื่อสิ่งที่ลบ → จำนวน เช่น { 'ใบค่าใช้จ่าย': 4 } */
  removed: Record<string, number>;
  /** คำเตือนที่ต้องเด้งให้คนกดเห็น เช่น ตารางที่รอดข้าม factory reset */
  warnings: string[];
}

export interface DomainSeeder {
  /** ชื่อสั้นสำหรับ DOMAINS= — ตัวพิมพ์เล็ก ขีดกลาง */
  key: string;
  /** ชื่อไทยสำหรับพิมพ์บนหน้าจอ */
  label: string;
  /** route ที่โดเมนนี้ปลดล็อก — Task 13 ใช้ generate ตารางใน README */
  routes: string[];
  /** วิธีที่ cleanup ค้นแถวของโดเมนนี้ (ข้อความไทย) — Task 13 ใช้ generate ตาราง KEEP/WIPE */
  markerDoc: string;
  /** dry-run: บอกว่าจะสร้างอะไร ห้ามเขียน DB */
  plan(ctx: SeedContext): Promise<PlanRow[]>;
  seed(ctx: SeedContext): Promise<SeedStat>;
  cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat>;
}
```

- [ ] **Step 5: เขียน `_context.ts`**

```ts
import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedRefs } from './_types';

/** marker ของเอกสารที่เลขถูก DocNumberService คุม — อยู่ในฟิลด์ข้อความ ห้ามไปแตะเลข */
export const TEST_NOTE_MARKER = '[ทดสอบระบบ]';
/** marker ของทะเบียนหลัก — อยู่ที่ชื่อ */
export const TEST_NAME_PREFIX = 'ทดสอบระบบ';
/** marker ของเลขเอกสารที่ seeder สร้างเอง */
export const TEST_DOC_PREFIX = 'TEST-';

export const testNote = (what: string): string => `${TEST_NOTE_MARKER} ${what}`;
export const testName = (what: string): string => `${TEST_NAME_PREFIX} ${what}`;

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** YYYYMMDD ตามเวลาไทย — ไม่ขึ้นกับ TZ ของ runtime (Cloud Run Job เป็น UTC) */
export function bkkDateStr(now: Date): string {
  const t = new Date(now.getTime() + BKK_OFFSET_MS);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** เที่ยงคืนของวันไทยวันนั้น (เก็บเป็น UTC midnight ของวันเดียวกัน — พอสำหรับวันครบกำหนด) */
export function bkkMidnight(now: Date): Date {
  const t = new Date(now.getTime() + BKK_OFFSET_MS);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export async function resolveRefs(prisma: PrismaService): Promise<SeedRefs> {
  const [branches, sales, reviewer, owner, shopCo, financeCo] = await Promise.all([
    prisma.branch.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
      take: 2,
    }),
    prisma.user.findFirst({
      where: { role: 'SALES', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
    // reviewer: เลือก BRANCH_MANAGER ก่อนเสมอ (คนละคนกับ ownerId โดยธรรมชาติ) แล้วค่อย fallback
    // เป็น OWNER เมื่อไม่มี BM เลย — ทุก query ใส่ orderBy ให้ได้คนเดิมทุกรอบ ไม่แล้วแต่ Postgres
    // ⚠️ interface นี้ **ไม่การันตี** ว่า reviewerId ≠ ownerId: ระบบที่มีผู้ใช้ OWNER คนเดียว
    // (ไม่มี BM) จะได้คนเดียวกันทั้งสองช่อง — โดเมนที่ต้องการ 4-eyes ต้องเช็คเองก่อนใช้
    (async () =>
      (await prisma.user.findFirst({
        where: { role: 'BRANCH_MANAGER', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })) ??
      prisma.user.findFirst({
        where: { role: 'OWNER', deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }))(),
    prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.companyInfo.findFirst({
      where: { companyCode: 'SHOP', deletedAt: null },
      select: { id: true },
    }),
    prisma.companyInfo.findFirst({
      where: { companyCode: 'FINANCE', deletedAt: null },
      select: { id: true },
    }),
  ]);

  const missing: string[] = [];
  if (!branches.length) missing.push('สาขา');
  if (!sales) missing.push('ผู้ใช้ role SALES');
  if (!reviewer) missing.push('ผู้ใช้ role OWNER หรือ BRANCH_MANAGER');
  if (!owner) missing.push('ผู้ใช้ role OWNER');
  if (missing.length) {
    throw new Error(`สร้างข้อมูลทดสอบไม่ได้ — ขาดข้อมูลอ้างอิง: ${missing.join(', ')}`);
  }

  return {
    branchId: branches[0].id,
    branchName: branches[0].name,
    secondBranchId: branches[1]?.id ?? null,
    salespersonId: sales!.id,
    reviewerId: reviewer!.id,
    ownerId: owner!.id,
    shopCompanyId: shopCo?.id ?? null,
    financeCompanyId: financeCo?.id ?? null,
  };
}
```

- [ ] **Step 6: เขียน `_registry.ts`**

```ts
import type { DomainSeeder } from './_types';
import { todosSeeder } from './todos.seed';

/**
 * ลำดับใน array นี้ = ลำดับการสร้าง (โดเมนหลังพึ่ง FK ของโดเมนหน้าได้)
 * cleanup เดินย้อนลำดับนี้เสมอ
 */
export const ALL_DOMAINS: DomainSeeder[] = [todosSeeder];

export function selectDomains(all: DomainSeeder[], csv: string | undefined): DomainSeeder[] {
  if (!csv || !csv.trim()) return [...all];
  const want = new Set(csv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  const known = new Set(all.map((d) => d.key));
  const unknown = [...want].filter((k) => !known.has(k));
  if (unknown.length) {
    throw new Error(`ไม่รู้จักโดเมน: ${unknown.join(', ')} — ที่มีให้เลือก: ${all.map((d) => d.key).join(', ')}`);
  }
  return all.filter((d) => want.has(d.key));
}

export function orderForCleanup(domains: DomainSeeder[]): DomainSeeder[] {
  return [...domains].reverse();
}
```

- [ ] **Step 7: เขียน `todos.seed.ts`**

```ts
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';
import { TEST_NOTE_MARKER, testNote } from './_context';

/** 3 สถานะหลักของกระดานงาน + หนึ่งใบเลยกำหนดเพื่อดูป้ายเตือน */
const ROWS: Array<{ title: string; status: 'TODO' | 'DOING' | 'REVIEW'; priority: 'LOW' | 'MEDIUM' | 'HIGH'; dueInDays: number }> = [
  { title: 'ตรวจสลิปลูกค้าค้างชำระ', status: 'TODO', priority: 'HIGH', dueInDays: -2 },
  { title: 'ตามเอกสารซัพพลายเออร์', status: 'DOING', priority: 'MEDIUM', dueInDays: 3 },
  { title: 'สรุปยอดขายประจำสัปดาห์', status: 'REVIEW', priority: 'LOW', dueInDays: 7 },
];

const titleOf = (t: string) => testNote(t);

export const todosSeeder: DomainSeeder = {
  key: 'todos',
  label: 'กระดานงาน (Todo)',
  routes: ['/todos'],
  markerDoc: `Todo.title ขึ้นต้นด้วย "${TEST_NOTE_MARKER}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({ label: titleOf(r.title), detail: `${r.status} · ${r.priority} · ครบกำหนดใน ${r.dueInDays} วัน` }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    for (const r of ROWS) {
      const title = titleOf(r.title);
      const exists = await ctx.prisma.todo.findFirst({ where: { title, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.todo.create({
        data: {
          title,
          description: testNote('ใบงานสำหรับทดสอบระบบ — ลบได้'),
          status: r.status,
          priority: r.priority,
          dueDate: new Date(ctx.today.getTime() + r.dueInDays * 24 * 60 * 60 * 1000),
          createdById: ctx.refs.reviewerId,
          assigneeId: ctx.refs.salespersonId,
          branchId: ctx.refs.branchId,
          tags: ['ทดสอบระบบ'],
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const where = { title: { startsWith: TEST_NOTE_MARKER }, deletedAt: null } as const;
    const rows = await ctx.prisma.todo.findMany({ where, select: { id: true, title: true } });
    if (!dryRun && rows.length) {
      await ctx.prisma.todo.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date() } });
    }
    return { removed: { 'ใบงาน': rows.length }, warnings: [] };
  },
};
```

- [ ] **Step 8: เขียน `seed-test-pack.cli.ts`**

```ts
/**
 * สร้างชุดข้อมูลทดสอบทั้งระบบ — orchestrator ของ test-pack
 *
 * Spec: docs/superpowers/specs/2026-08-26-full-system-test-data-pack-design.md
 *
 * เฟส 1-2 (โดเมนทั้งหมดใน registry) เขียน Prisma ตรง — ไม่มี JE
 * เฟส 3 (DRIVE=1) เรียก service จริง — เพิ่มใน Task 12
 *
 * Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack
 * Live:     CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *           [ALLOW_PROD_SEED=YES_I_AM_SURE NODE_ENV=production] [DOMAINS=a,b] \
 *           npm --prefix apps/api run seed:test-pack
 */
import { PrismaService } from '../prisma/prisma.service';
import { bkkDateStr, bkkMidnight, resolveRefs } from './test-pack/_context';
import { ALL_DOMAINS, selectDomains } from './test-pack/_registry';
import type { SeedContext } from './test-pack/_types';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error('Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run seed:test-pack');
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_SEED !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[seed-test-pack] DRY-RUN mode (default). To create, re-run with:');
    console.log(`  CONFIRM_SEED=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_SEED=${REQUIRED_CONSENT}] npm --prefix apps/api run seed:test-pack`);
    console.log('');
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to seed in NODE_ENV=production without ALLOW_PROD_SEED=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  let domains;
  try {
    domains = selectDomains(ALL_DOMAINS, process.env.DOMAINS);
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[seed-test-pack] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'} | โดเมน: ${domains.length}`);
  console.log('');

  const failures: string[] = [];
  let totalCreated = 0;
  let totalSkipped = 0;

  try {
    const now = new Date();
    const refs = await resolveRefs(prisma);
    const ctx: SeedContext = { prisma, refs, dryRun, today: bkkMidnight(now), dateStr: bkkDateStr(now) };

    for (const d of domains) {
      console.log(`── ${d.label} (${d.key})`);
      try {
        if (dryRun) {
          const rows = await d.plan(ctx);
          for (const r of rows) console.log(`   • ${r.label} — ${r.detail}`);
          console.log(`   รวม ${rows.length} แถว`);
        } else {
          const stat = await d.seed(ctx);
          totalCreated += stat.created;
          totalSkipped += stat.skipped;
          for (const n of stat.notes) console.log(`   ℹ ${n}`);
          console.log(`   สร้าง ${stat.created} · ข้าม ${stat.skipped} (มีอยู่แล้ว)`);
        }
      } catch (err) {
        // โดเมนหนึ่งพังต้องไม่ล้มทั้งชุด — บันทึกไว้แล้วเดินต่อ
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${d.key}: ${msg}`);
        console.log(`   ✗ ล้มเหลว — ${msg}`);
      }
      console.log('');
    }

    console.log('[seed-test-pack] ===== SUMMARY =====');
    if (dryRun) {
      console.log('  DRY-RUN — ไม่ได้เขียนอะไรลง DB');
    } else {
      console.log(`  สร้างทั้งหมด : ${totalCreated} แถว`);
      console.log(`  ข้าม        : ${totalSkipped} แถว (รันซ้ำ)`);
    }
    if (failures.length) {
      console.log(`  ล้มเหลว     : ${failures.length} โดเมน`);
      for (const f of failures) console.log(`    - ${f}`);
    }
    console.log('');
    console.log('  ล้างข้อมูล : npm --prefix apps/api run cleanup:test-pack');
  } finally {
    await prisma.$disconnect();
  }

  if (failures.length) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-test-pack] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 9: เพิ่ม npm scripts**

แก้ `apps/api/package.json` — เพิ่มต่อจากบรรทัด `"cleanup:test-contracts:help": ...`:

```json
    "seed:test-pack": "npx -y tsx src/cli/seed-test-pack.cli.ts",
    "seed:test-pack:help": "echo 'Dry-run default: EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack. To write: CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_SEED=YES_I_AM_SURE NODE_ENV=production] [DOMAINS=assets,equity] [DRIVE=1] npm --prefix apps/api run seed:test-pack'",
```

> ใช้ `tsx` ไม่ใช่ `node dist/...` เพราะ Task 12 ต้อง resolve NestJS decorator metadata — `factory:reset` ใช้ pattern เดียวกันอยู่แล้ว

- [ ] **Step 10: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- test-pack`
Expected: PASS — 6 เทสใน 2 ไฟล์

- [ ] **Step 11: ตรวจ TypeScript**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: ไม่มี error

- [ ] **Step 12: ลอง dry-run จริง**

Run: `EXPECTED_DB_NAME=<ชื่อ db ที่ต่ออยู่> npm --prefix apps/api run seed:test-pack`
Expected: พิมพ์หัวข้อ `── กระดานงาน (Todo) (todos)` ตามด้วย 3 บรรทัด และปิดท้ายว่า `DRY-RUN — ไม่ได้เขียนอะไรลง DB`

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/cli/test-pack apps/api/src/cli/seed-test-pack.cli.ts apps/api/package.json
git commit -m "feat(test-pack): โครง DomainSeeder + orchestrator ขาสร้าง + โดเมน todos"
```

---

### Task 2: Orchestrator ขาล้าง

**Files:**
- Create: `apps/api/src/cli/cleanup-test-pack.cli.ts`
- Modify: `apps/api/package.json` (scripts block)

**Interfaces:**
- Consumes: `ALL_DOMAINS` · `selectDomains` · `orderForCleanup` (Task 1) · `resolveRefs` · `bkkMidnight` · `bkkDateStr` (Task 1) · `DomainSeeder.cleanup(ctx, dryRun): Promise<CleanupStat>` (Task 1)
- Produces: ไม่มี export ที่ task อื่นใช้ (เป็น entry point)

- [ ] **Step 1: เขียน `cleanup-test-pack.cli.ts`**

```ts
/**
 * ล้างชุดข้อมูลทดสอบทั้งระบบ — คู่กับ seed-test-pack.cli.ts
 *
 * เดิน cleanup ของแต่ละโดเมน "ย้อนลำดับการสร้าง" เพราะโดเมนหลังถือ FK ของโดเมนหน้า
 * พิมพ์รายการที่จะลบทั้งสองโหมด — dry-run คือด่านสุดท้ายของคนกดก่อนยืนยัน
 *
 * Dry-run:  EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack
 * Live:     CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *           [ALLOW_PROD_CLEANUP=YES_I_AM_SURE NODE_ENV=production] [DOMAINS=a,b] \
 *           npm --prefix apps/api run cleanup:test-pack
 */
import { PrismaService } from '../prisma/prisma.service';
import { bkkDateStr, bkkMidnight, resolveRefs } from './test-pack/_context';
import { ALL_DOMAINS, orderForCleanup, selectDomains } from './test-pack/_registry';
import type { SeedContext } from './test-pack/_types';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: EXPECTED_DB_NAME required');
    console.error('Re-run with: EXPECTED_DB_NAME=<db-name> npm --prefix apps/api run cleanup:test-pack');
    process.exit(1);
  }

  const dryRun = process.env.CONFIRM_CLEANUP !== REQUIRED_CONSENT;
  if (dryRun) {
    console.log('[cleanup-test-pack] DRY-RUN mode (default). To remove, re-run with:');
    console.log(`  CONFIRM_CLEANUP=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> [ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}] npm --prefix apps/api run cleanup:test-pack`);
    console.log('');
  }
  if (!dryRun && process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_CLEANUP !== REQUIRED_CONSENT) {
    console.error(`ERROR: Refusing to clean up in NODE_ENV=production without ALLOW_PROD_CLEANUP=${REQUIRED_CONSENT}`);
    process.exit(1);
  }

  let domains;
  try {
    domains = orderForCleanup(selectDomains(ALL_DOMAINS, process.env.DOMAINS));
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const prisma = new PrismaService();
  const [{ current_database: actualDb }] = await (prisma as any).$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  if (actualDb !== expectedDb) {
    console.error(`ERROR: DB mismatch: connected="${actualDb}" expected="${expectedDb}". Aborting.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[cleanup-test-pack] DB: "${actualDb}" | mode: ${dryRun ? 'DRY-RUN' : 'LIVE'} | โดเมน: ${domains.length}`);
  console.log('');

  const failures: string[] = [];
  const allWarnings: string[] = [];
  const grandTotal: Record<string, number> = {};

  try {
    const now = new Date();
    const refs = await resolveRefs(prisma);
    const ctx: SeedContext = { prisma, refs, dryRun, today: bkkMidnight(now), dateStr: bkkDateStr(now) };

    for (const d of domains) {
      console.log(`── ${d.label} (${d.key})`);
      try {
        const stat = await d.cleanup(ctx, dryRun);
        const entries = Object.entries(stat.removed).filter(([, n]) => n > 0);
        if (!entries.length) {
          console.log('   ไม่พบข้อมูลทดสอบ');
        } else {
          for (const [what, n] of entries) {
            console.log(`   ${dryRun ? 'จะลบ' : 'ลบแล้ว'} ${what}: ${n}`);
            grandTotal[what] = (grandTotal[what] ?? 0) + n;
          }
        }
        for (const w of stat.warnings) {
          console.log(`   ⚠️  ${w}`);
          allWarnings.push(`${d.label}: ${w}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${d.key}: ${msg}`);
        console.log(`   ✗ ล้มเหลว — ${msg}`);
      }
      console.log('');
    }

    console.log('[cleanup-test-pack] ===== SUMMARY =====');
    const total = Object.values(grandTotal).reduce((a, b) => a + b, 0);
    console.log(`  ${dryRun ? 'จะลบทั้งหมด' : 'ลบแล้วทั้งหมด'} : ${total} แถว`);
    for (const [what, n] of Object.entries(grandTotal)) console.log(`    ${what}: ${n}`);
    if (allWarnings.length) {
      console.log('');
      console.log('  ⚠️  คำเตือน:');
      for (const w of allWarnings) console.log(`    - ${w}`);
    }
    if (failures.length) {
      console.log(`  ล้มเหลว : ${failures.length} โดเมน`);
      for (const f of failures) console.log(`    - ${f}`);
    }
    console.log('');
    console.log('  ของที่ล้างไม่ได้โดยธรรมชาติ: audit_logs (immutable) · ช่องว่างของเลขเอกสาร');
    if (dryRun) {
      console.log('');
      console.log(`  ตรวจรายการข้างบนแล้วค่อยรันจริงด้วย CONFIRM_CLEANUP=${REQUIRED_CONSENT}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  if (failures.length) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[cleanup-test-pack] FATAL:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```

- [ ] **Step 2: เพิ่ม npm scripts**

แก้ `apps/api/package.json` — เพิ่มต่อจาก `seed:test-pack:help`:

```json
    "cleanup:test-pack": "npx -y tsx src/cli/cleanup-test-pack.cli.ts",
    "cleanup:test-pack:help": "echo 'Dry-run default: EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack. To remove: CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_CLEANUP=YES_I_AM_SURE NODE_ENV=production] [DOMAINS=assets] npm --prefix apps/api run cleanup:test-pack'",
```

- [ ] **Step 3: ตรวจ TypeScript**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: ไม่มี error

- [ ] **Step 4: พิสูจน์ round-trip บน DB จริง**

```bash
DB=<ชื่อ db>
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB npm --prefix apps/api run seed:test-pack
EXPECTED_DB_NAME=$DB npm --prefix apps/api run cleanup:test-pack
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=$DB npm --prefix apps/api run cleanup:test-pack
EXPECTED_DB_NAME=$DB npm --prefix apps/api run cleanup:test-pack
```
Expected: รอบสร้าง `สร้างทั้งหมด : 3 แถว` · dry-run แรก `จะลบทั้งหมด : 3` · รันจริง `ลบแล้วทั้งหมด : 3` · dry-run สุดท้าย `ไม่พบข้อมูลทดสอบ`

- [ ] **Step 5: พิสูจน์ re-run safe**

```bash
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB npm --prefix apps/api run seed:test-pack
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB npm --prefix apps/api run seed:test-pack
```
Expected: รอบแรก `สร้าง 3 · ข้าม 0` · รอบสอง `สร้าง 0 · ข้าม 3`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/cli/cleanup-test-pack.cli.ts apps/api/package.json
git commit -m "feat(test-pack): orchestrator ขาล้าง + พิสูจน์ round-trip กับโดเมน todos"
```

---

### Task 3: โดเมน `contracts` (ห่อ seeder เดิม)

**Files:**
- Create: `apps/api/src/cli/test-pack/contracts.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts` (เพิ่มเข้า `ALL_DOMAINS` เป็นตัว**แรก**)

**Interfaces:**
- Consumes: `seedTestContracts(prisma, refs, opts)` · `cleanupTestContracts(prisma, opts)` · `TEST_CONTRACT_PREFIX` · `TEST_CUSTOMER_ADDRESS` · `TEST_IMEI_PREFIX` จาก `../seed-test-contracts.cli` และ `../cleanup-test-contracts.cli` (มีอยู่แล้ว ห้ามแก้)
- Produces: `contractsSeeder: DomainSeeder`

> `seedTestContracts` ต้องการ `Refs` รูปของมันเอง (`branchId` `branchName` `salespersonId` `reviewerId` `interestConfigId` `shopCompanyId` `financeCompanyId`) ซึ่ง**ต่างจาก `SeedRefs` ของ test-pack** — ตัว adapter อยู่ในไฟล์นี้ ไม่ไปแก้ของเดิม

- [ ] **Step 1: เขียน `contracts.seed.ts`**

```ts
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';
import { cleanupTestContracts } from '../cleanup-test-contracts.cli';
import { TEST_CONTRACT_PREFIX, TEST_CUSTOMER_ADDRESS, TEST_IMEI_PREFIX, seedTestContracts } from '../seed-test-contracts.cli';

/** จำนวน scenario ของ seeder เดิม — ตรงกับ SCENARIOS.length ใน seed-test-contracts.cli.ts */
const CONTRACT_COUNT = 7;

/**
 * seedTestContracts ต้องการ Refs รูปของตัวเอง (มี interestConfigId ที่ SeedRefs ไม่มี)
 * แปลงตรงนี้ที่เดียว — ไม่ไปแก้ไฟล์เดิมซึ่งยังต้องรันด้วยตัวเองได้อยู่
 */
async function adaptRefs(ctx: SeedContext) {
  const ic = await ctx.prisma.interestConfig.findFirst({ select: { id: true } });
  return {
    branchId: ctx.refs.branchId,
    branchName: ctx.refs.branchName,
    salespersonId: ctx.refs.salespersonId,
    reviewerId: ctx.refs.reviewerId,
    interestConfigId: ic?.id ?? null,
    shopCompanyId: ctx.refs.shopCompanyId,
    financeCompanyId: ctx.refs.financeCompanyId,
  };
}

export const contractsSeeder: DomainSeeder = {
  key: 'contracts',
  label: 'สัญญาผ่อน + เครื่องว่าง + ลูกค้าเปล่า',
  routes: ['/payments', '/contracts', '/contracts/:id', '/overdue', '/collections', '/letters', '/repossessions', '/early-payoff', '/pos', '/receipts', '/finance/contract-cancellation'],
  markerDoc: `Contract.contractNumber ขึ้นต้น "${TEST_CONTRACT_PREFIX}" · Customer.addressCurrent = "${TEST_CUSTOMER_ADDRESS}" · Product.imeiSerial ขึ้นต้น "${TEST_IMEI_PREFIX}" (สัญญาที่เปิดผ่าน UI ระหว่างเทสจะได้เลขจริง BCP- แต่ถูกกวาดตามลูกค้า/เครื่อง)`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const refs = await adaptRefs(ctx);
    await seedTestContracts(ctx.prisma, refs, { count: CONTRACT_COUNT, dryRun: true });
    return [
      { label: `สัญญาทดสอบ ${CONTRACT_COUNT} ใบ`, detail: 'ครบกำหนดวันนี้ · ค้าง 1/2/3 งวด · งวดอนาคต · TERMINATED รอยึด · ใกล้ปิดยอด (รายละเอียดพิมพ์ด้านบนจาก seeder เดิม)' },
      { label: 'เครื่องว่าง 3 เครื่อง', detail: 'มือถือใหม่ · มือสอง · หูฟัง (IN_STOCK)' },
      { label: 'ลูกค้าเปล่า 2 คน', detail: 'ไม่มีสัญญา — สำหรับลูกค้าใหม่ / trade-in / จอง' },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const refs = await adaptRefs(ctx);
    const r = await seedTestContracts(ctx.prisma, refs, { count: CONTRACT_COUNT, dryRun: false });
    return {
      created: r.created + r.productsCreated + r.blankCustomersCreated,
      skipped: 0,
      notes: [`เลขสัญญา: ${r.contractNumbers[0] ?? '-'} .. ${r.contractNumbers[r.contractNumbers.length - 1] ?? '-'}`],
    };
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    // ⚠️ ห้ามลดรูปกลับเป็น delegate เปล่า ๆ — ดูหมายเหตุ "ทำไม wrapper ต้องกวาด JE
    // ของใบขายเอง" ใต้ code block นี้
    // เก็บ id ใบขายทดสอบ "ก่อน" delegate — marker ชุดเดียวกับ CLI แต่ไม่กรอง deletedAt
    // (CLI กำลังจะ soft-delete ในรอบนี้ / รอบก่อนอาจลบไปแล้วแต่ JE ค้าง / ใบขายที่ถูก
    // void มี deletedAt อยู่แล้ว)
    const [testCustomers, testProducts] = await Promise.all([
      ctx.prisma.customer.findMany({ where: { addressCurrent: TEST_CUSTOMER_ADDRESS }, select: { id: true } }),
      ctx.prisma.product.findMany({ where: { imeiSerial: { startsWith: TEST_IMEI_PREFIX } }, select: { id: true } }),
    ]);
    const testCustomerIds = testCustomers.map((c) => c.id);
    const testProductIds = testProducts.map((p) => p.id);
    const testContracts = await ctx.prisma.contract.findMany({
      where: {
        OR: [
          { contractNumber: { startsWith: TEST_CONTRACT_PREFIX } },
          ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
          ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const saleWhereOr = [
      ...(testProductIds.length ? [{ productId: { in: testProductIds } }] : []),
      ...(testCustomerIds.length ? [{ customerId: { in: testCustomerIds } }] : []),
      ...(testContracts.length ? [{ contractId: { in: testContracts.map((c) => c.id) } }] : []),
    ];
    const sales = saleWhereOr.length
      ? await ctx.prisma.sale.findMany({ where: { OR: saleWhereOr }, select: { id: true, saleNumber: true } })
      : [];

    const r = await cleanupTestContracts(ctx.prisma, { dryRun });

    // กวาด JE ของใบขาย (metadata.saleId) + ใบกลับรายการของมัน (metadata.reversesEntryId
    // — mirror จาก void sale "จงใจไม่ carry saleId") — query หลัง delegate กันนับซ้ำ
    const saleJes = sales.length
      ? await ctx.prisma.journalEntry.findMany({
          where: { OR: sales.map((s) => ({ metadata: { path: ['saleId'], equals: s.id } as never })) },
          select: { id: true, metadata: true },
        })
      : [];
    const saleJeIds = saleJes.map((j) => j.id);
    const mirrorJes = saleJeIds.length
      ? await ctx.prisma.journalEntry.findMany({
          where: { OR: saleJeIds.map((id) => ({ metadata: { path: ['reversesEntryId'], equals: id } as never })) },
          select: { id: true },
        })
      : [];
    const jeIds = [...new Set([...saleJeIds, ...mirrorJes.map((j) => j.id)])];

    if (jeIds.length) {
      const affected = new Set<string>();
      for (const je of saleJes) {
        const saleId = (je.metadata as Record<string, unknown> | null)?.saleId;
        const sale = sales.find((s) => s.id === saleId);
        if (sale) affected.add(sale.saleNumber);
      }
      console.log(`  รายการบัญชีใบขาย (metadata.saleId): ${saleJeIds.length} ใบ + ใบกลับรายการ ${mirrorJes.length} ใบ จากใบขาย:`);
      for (const n of affected) console.log(`    ${n}`);
      if (dryRun) {
        console.log(`  (dry-run) จะลบถาวร ${jeIds.length} รายการบัญชีใบขาย — ยังไม่ลบ`);
      } else {
        // Sale ไม่มีคอลัมน์ journalEntryId (ตรวจ schema 2026-08-26) ⇒ ล้างเฉพาะ
        // FK Restrict สองตัวตามลำดับบังคับเดียวกับ CLI เดิม
        await ctx.prisma.$transaction(async (tx) => {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        });
      }
    }

    return {
      removed: {
        'สัญญา': r.contracts,
        'งวดชำระ': r.payments,
        'ตารางงวด': r.installmentSchedules,
        'ใบเสร็จ': r.receipts,
        'รายการบัญชี (ลบถาวร)': r.journalEntries,
        'รายการบัญชีใบขาย (ลบถาวร)': jeIds.length,
        'ใบขาย': r.sales,
        'ลูกหนี้ไฟแนนซ์': r.financeReceivables,
        'ค่าคอม': r.salesCommissions,
        'รับซื้อมือสอง': r.tradeIns,
        'รายการยึด': r.repossessions,
        'หนังสือทวง': r.letters,
        'คำขอยกเลิกสัญญา': r.cancellations,
        'เครื่องทดสอบ': r.products,
        'ลูกค้าทดสอบ': r.customers,
      },
      warnings: [],
    };
  },
};
```

> **ทำไม wrapper ต้องกวาด JE ของใบขายเอง (รูที่ปิด 2026-08-26):** `cleanupTestContracts`
> รู้จักแต่ JE ที่ stamp `metadata.contractId` — แต่ JE ของใบขาย (`ShopCashSaleTemplate`
> ต่อชิ้น, `ShopExternalFinanceSaleTemplate`, `ShopExternalFinanceReceiptTemplate` —
> รวมใบขายจากการแปลงใบจอง/ยืนยันออเดอร์ออนไลน์) stamp `metadata.saleId`.
> CLI เดิม soft-delete ตัวใบขายจนหน้าจอสะอาด แต่ทิ้ง JE ค้างในงบทดลองถาวร —
> หน้าจอกับสมุดบัญชีขัดกัน. wrapper จึงเก็บ id ใบขายก่อน delegate แล้วลบ JE เหล่านั้น
> (พร้อม mirror จาก void ซึ่งไม่ carry `saleId` — ตามด้วย `reversesEntryId`) หลัง delegate.
> ใครลอก code block นี้แบบตัด wrapper ทิ้ง = เปิดรูเดิมกลับมา. ห้ามแก้ CLI เดิม —
> มันต้องรันเดี่ยวได้เหมือนเดิม.

- [ ] **Step 2: เพิ่มเข้า registry เป็นตัวแรก**

แก้ `_registry.ts`:

```ts
import type { DomainSeeder } from './_types';
import { contractsSeeder } from './contracts.seed';
import { todosSeeder } from './todos.seed';

export const ALL_DOMAINS: DomainSeeder[] = [contractsSeeder, todosSeeder];
```

- [ ] **Step 3: ตรวจ TypeScript**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: ไม่มี error

- [ ] **Step 4: ตรวจว่า dry-run ไม่เขียน DB**

Run: `EXPECTED_DB_NAME=$DB npm --prefix apps/api run seed:test-pack`
แล้วนับสัญญา: `SELECT count(*) FROM contracts WHERE contract_number LIKE 'TEST-%';`
Expected: ตัวเลขเท่าเดิมก่อนรัน (seeder เดิม dry-run แค่พิมพ์)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli/test-pack/contracts.seed.ts apps/api/src/cli/test-pack/_registry.ts
git commit -m "feat(test-pack): ห่อ seed/cleanup-test-contracts เดิมเป็นโดเมน contracts"
```

---

### Task 4: `_helpers.ts` + โดเมน `expenses` + `payroll`

**Files:**
- Create: `apps/api/src/cli/test-pack/_helpers.ts`
- Create: `apps/api/src/cli/test-pack/_helpers.spec.ts`
- Create: `apps/api/src/cli/test-pack/expenses.seed.ts`
- Create: `apps/api/src/cli/test-pack/payroll.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `SeedContext` · `DomainSeeder` (Task 1) · `testNote` · `TEST_NOTE_MARKER` (Task 1)
- Produces: `nextDocNumber(prisma, prefixLetters, dateStr, width?): Promise<string>` · `sumLine(unitPrice: number, qty: number, vatPct: number): { amountBeforeVat: Prisma.Decimal; vatAmount: Prisma.Decimal; total: Prisma.Decimal }` (จาก `_helpers.ts` — รับ number literal จากตาราง ROWS แต่คำนวณ/คืนค่าเป็น `Prisma.Decimal` ตาม Global Constraint ห้าม float กับจำนวนเงิน; แสดงผลค่อย `.toNumber()` ที่จุด format) · `expensesSeeder: DomainSeeder` · `payrollSeeder: DomainSeeder`

**เลขเอกสาร — ทำไมถึง mirror ไม่ใช่เรียก service:** `DocNumberService.next()` ต้องการ DI ของ `SettingsService`
ซึ่งจะลาก Nest เข้ามาในเฟส 2 ที่ตั้งใจให้เขียน Prisma ตรง ๆ `nextDocNumber` จึงคัดเฉพาะแกนของมัน
(`findFirst({ where: { number: { startsWith } }, orderBy: { number: 'desc' } })` แล้ว +1 — **ไม่กรอง `deletedAt`
เหมือนกัน** จึงไม่มีทางเกิดเลขซ้ำหลัง cleanup) ความเสี่ยงเดียวคือ OWNER เปลี่ยน format ผ่าน SystemConfig
แล้ว prefix ต่างกัน — ซึ่งทำให้ **ไม่ชนกัน** ไม่ใช่ชนกัน

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน — `_helpers.spec.ts`**

```ts
import { Prisma } from '@prisma/client';

import { nextNumberFrom, sumLine } from './_helpers';

describe('nextNumberFrom', () => {
  it('เริ่มที่ 0001 เมื่อยังไม่มีเลขในวันนั้น', () => {
    expect(nextNumberFrom('EX-20260826-', null)).toBe('EX-20260826-0001');
  });

  it('เดินต่อจากเลขล่าสุด (max+1 ไม่ใช่ count+1)', () => {
    expect(nextNumberFrom('EX-20260826-', 'EX-20260826-0042')).toBe('EX-20260826-0043');
  });

  it('เลขเสียกลับไปเริ่มที่ 0001 แทนที่จะได้ NaN', () => {
    expect(nextNumberFrom('EX-20260826-', 'EX-20260826-abcd')).toBe('EX-20260826-0001');
  });

  it('รองรับความกว้างอื่น เช่น RT- ที่ใช้ 5 หลัก', () => {
    expect(nextNumberFrom('RT-202608-', 'RT-202608-00007', 5)).toBe('RT-202608-00008');
  });
});

describe('sumLine', () => {
  // ยืนยันด้วย .toString() (ค่าที่เก็บจริง) — ห้ามใช้ .toFixed(2) เพราะมันปัดเศษใน assertion เอง:
  // ถ้า round2 หายไปจนได้ 23.3331 มา .toFixed(2) ยังพิมพ์ '23.33' แล้วเทสผ่านทั้งที่ค่าผิด
  it('คิดยอดก่อน VAT และ VAT แยกกัน ปัด 2 ตำแหน่ง — คืนค่าเป็น Prisma.Decimal', () => {
    const s = sumLine(1000, 3, 7);
    expect(s.amountBeforeVat).toBeInstanceOf(Prisma.Decimal);
    expect(s.vatAmount).toBeInstanceOf(Prisma.Decimal);
    expect(s.total).toBeInstanceOf(Prisma.Decimal);
    expect(s.amountBeforeVat.toString()).toBe('3000');
    expect(s.vatAmount.toString()).toBe('210');
    expect(s.total.toString()).toBe('3210');
  });

  it('VAT 0 = ไม่มีภาษี (ฝั่ง SHOP ไม่จด VAT)', () => {
    const s = sumLine(1500, 2, 0);
    expect(s.amountBeforeVat.toString()).toBe('3000');
    expect(s.vatAmount.toString()).toBe('0');
    expect(s.total.toString()).toBe('3000');
  });

  it('ปัดเศษ VAT แบบ 2 ตำแหน่ง ไม่ปล่อยทศนิยมลอย (333.33 × 7% → 23.33)', () => {
    const s = sumLine(333.33, 1, 7);
    expect(s.amountBeforeVat.toString()).toBe('333.33');
    expect(s.vatAmount.toString()).toBe('23.33');
    expect(s.total.toString()).toBe('356.66');
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าไม่ผ่าน**

Run: `npm --prefix apps/api test -- _helpers`
Expected: FAIL — `Cannot find module './_helpers'`

- [ ] **Step 3: เขียน `_helpers.ts`**

```ts
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service';

/** ปัดเงิน 2 ตำแหน่ง half-up ใน Decimal — Global Constraint: ห้ามใช้ float กับจำนวนเงิน */
const round2 = (n: Prisma.Decimal): Prisma.Decimal =>
  n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * คำนวณยอดต่อบรรทัด — ราคาต่อหน่วยเป็นราคาก่อน VAT เสมอ (EXCLUSIVE)
 * รับ number literal จากตาราง ROWS ได้ แต่คูณ/ปัด/บวกใน Prisma.Decimal ทั้งหมด
 * และคืน Prisma.Decimal — ส่งเข้า create() ของคอลัมน์ Decimal ได้ตรง ๆ
 * (แสดงผลค่อย .toNumber() ที่จุด format เท่านั้น ห้ามเอาไปคำนวณต่อแบบ float)
 */
export function sumLine(
  unitPrice: number,
  qty: number,
  vatPct: number,
): { amountBeforeVat: Prisma.Decimal; vatAmount: Prisma.Decimal; total: Prisma.Decimal } {
  const amountBeforeVat = round2(new Prisma.Decimal(unitPrice).mul(qty));
  const vatAmount = round2(amountBeforeVat.mul(vatPct).div(100));
  return { amountBeforeVat, vatAmount, total: round2(amountBeforeVat.plus(vatAmount)) };
}

/**
 * เลขถัดไปจากเลขล่าสุด — pure จึงเทสได้โดยไม่ต้องแตะ DB
 * mirror แกนของ DocNumberService.next(): max+1 ไม่ใช่ count+1
 */
export function nextNumberFrom(prefix: string, lastNumber: string | null, width = 4): string {
  const lastSeq = lastNumber ? parseInt(lastNumber.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(width, '0')}`;
}

/**
 * เลขเอกสารถัดไปของ ExpenseDocument (EX- / PR-) — mirror DocNumberService.next()
 * โดยไม่ต้องลาก DI เข้าเฟส 2 · **ไม่กรอง deletedAt เหมือนของจริง** จึงไม่มีทางเกิดเลขซ้ำหลัง cleanup
 * โมเดลอื่น (OtherIncome / EquityDocument / FixedAsset) ทำ findFirst ของตัวเองแล้วส่งเข้า nextNumberFrom
 */
export async function nextDocNumber(
  prisma: PrismaService,
  prefixLetters: string,
  dateStr: string,
  width = 4,
): Promise<string> {
  const prefix = `${prefixLetters}-${dateStr}-`;
  const last = await prisma.expenseDocument.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  return nextNumberFrom(prefix, last?.number ?? null, width);
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- _helpers`
Expected: PASS — 7 เทส (nextNumberFrom 4 + sumLine 3)

- [ ] **Step 5: เขียน `expenses.seed.ts`**

```ts
import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextDocNumber, sumLine } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * R2 — เพดานคือ PENDING_APPROVAL เท่านั้น
 * ACCRUAL/POSTED โพสต์ JE ⇒ ต้องให้ผู้ทดสอบกด post เองในหน้าจอ
 */
const ROWS: Array<{
  key: string;
  status: 'DRAFT' | 'PENDING_APPROVAL';
  vendorName: string;
  category: string;
  unitPrice: number;
  qty: number;
  vatPct: number;
  whtPct: number;
  desc: string;
}> = [
  { key: 'rent', status: 'DRAFT', vendorName: 'ทดสอบระบบ ผู้ให้เช่าอาคาร', category: 'ค่าเช่า', unitPrice: 25000, qty: 1, vatPct: 7, whtPct: 5, desc: 'ค่าเช่าร้าน (ร่าง — มี VAT + หัก ณ ที่จ่าย 5%)' },
  { key: 'utility', status: 'DRAFT', vendorName: 'ทดสอบระบบ การไฟฟ้า', category: 'ค่าสาธารณูปโภค', unitPrice: 3800, qty: 1, vatPct: 7, whtPct: 0, desc: 'ค่าไฟฟ้า (ร่าง — มี VAT ไม่มี WHT)' },
  { key: 'approval', status: 'PENDING_APPROVAL', vendorName: 'ทดสอบระบบ ร้านวัสดุ', category: 'ค่าซ่อมแซม', unitPrice: 12500, qty: 1, vatPct: 7, whtPct: 3, desc: 'ค่าซ่อมแซมร้าน (รออนุมัติ — ทดสอบสิทธิ์ผู้อนุมัติ)' },
  { key: 'zero', status: 'DRAFT', vendorName: 'ทดสอบระบบ ผู้ขายรายย่อย', category: 'ค่าใช้จ่ายเบ็ดเตล็ด', unitPrice: 0, qty: 1, vatPct: 0, whtPct: 0, desc: 'เคสขอบ — ยอด 0 บาท ไม่มี VAT' },
];

const noteOf = (key: string) => testNote(`ค่าใช้จ่าย/${key}`);

export const expensesSeeder: DomainSeeder = {
  key: 'expenses',
  label: 'ค่าใช้จ่าย',
  routes: ['/expenses', '/expenses/:id', '/expenses/new', '/expenses/:id/voucher', '/expenses/ap-aging', '/expenses/daily-summary', '/expenses/favorites'],
  markerDoc: `ExpenseDocument.note ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (เลข EX- ปล่อยตามลำดับจริง ห้ามใส่ TEST- เพราะจะพัง sequence)`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => {
      const s = sumLine(r.unitPrice, r.qty, r.vatPct);
      return { label: `EX ${r.key}`, detail: `${r.status} · ${r.desc} · ยอดรวม ฿${s.total.toNumber().toLocaleString('th-TH')}` };
    });
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    for (const r of ROWS) {
      const note = noteOf(r.key);
      const exists = await ctx.prisma.expenseDocument.findFirst({ where: { note, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const s = sumLine(r.unitPrice, r.qty, r.vatPct);
      const whtAmount = s.amountBeforeVat
        .mul(r.whtPct)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const number = await nextDocNumber(ctx.prisma, 'EX', ctx.dateStr);
      await ctx.prisma.expenseDocument.create({
        data: {
          number,
          documentType: 'EXPENSE',
          branchId: ctx.refs.branchId,
          documentDate: ctx.today,
          vendorName: r.vendorName,
          description: r.desc,
          subtotal: s.amountBeforeVat,
          vatAmount: s.vatAmount,
          withholdingTax: whtAmount,
          whtFormType: r.whtPct > 0 ? 'PND3' : null,
          totalAmount: s.total,
          netPayment: s.total.minus(whtAmount),
          status: r.status,
          note,
          createdById: ctx.refs.reviewerId,
          expenseDetail: {
            create: {
              lines: {
                create: [
                  {
                    lineNo: 1,
                    category: r.category,
                    description: r.desc,
                    quantity: r.qty,
                    unitPrice: r.unitPrice,
                    vatPercent: r.vatPct,
                    whtPercent: r.whtPct,
                    whtFormType: r.whtPct > 0 ? 'PND3' : null,
                    supplierName: r.vendorName,
                    amountBeforeVat: s.amountBeforeVat,
                    vatAmount: s.vatAmount,
                    whtAmount,
                  },
                ],
              },
            },
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const docs = await ctx.prisma.expenseDocument.findMany({
      where: { note: { startsWith: TEST_NOTE_MARKER }, documentType: 'EXPENSE', deletedAt: null },
      select: { id: true, number: true, journalEntryId: true },
    });
    const jeIds = docs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && docs.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jeIds.length) {
          // FK sweep ก่อน hard-delete JE — Postgres default FK = NO ACTION จะ abort ทั้ง tx
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.expenseDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { journalEntryId: null } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.expenseDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { deletedAt: new Date() } });
      });
    }
    return { removed: { 'ใบค่าใช้จ่าย': docs.length, 'รายการบัญชีของใบค่าใช้จ่าย (ลบถาวร)': jeIds.length }, warnings: [] };
  },
};
```

- [ ] **Step 6: เขียน `payroll.seed.ts`**

```ts
import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextDocNumber } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * ใบเงินเดือน 1 ใบต่อฝั่ง — SHOP (พนักงานสาขา) และ FINANCE (ส่วนกลาง)
 * ตาม .claude/rules/accounting.md หัวข้อ Payroll: entityScope เป็นตัวเลือกผังบัญชี
 * R2 — DRAFT เท่านั้น (POSTED โพสต์ JE เงินเดือน + ปกส. + ภ.ง.ด.1)
 */
const SCOPES: Array<{ scope: 'SHOP' | 'FINANCE'; label: string; lines: Array<{ name: string; base: number; sso: number; wht: number }> }> = [
  {
    scope: 'SHOP',
    label: 'พนักงานสาขา',
    lines: [
      { name: 'ทดสอบระบบ พนักงานขาย ก', base: 15000, sso: 750, wht: 0 },
      { name: 'ทดสอบระบบ พนักงานขาย ข', base: 13000, sso: 650, wht: 0 },
    ],
  },
  {
    scope: 'FINANCE',
    label: 'ส่วนกลาง',
    lines: [{ name: 'ทดสอบระบบ พนักงานบัญชี', base: 28000, sso: 750, wht: 420 }],
  },
];

const noteOf = (scope: string) => testNote(`เงินเดือน/${scope}`);
/** งวดเงินเดือนของเดือนปัจจุบัน — YYYY-MM */
const periodOf = (today: Date) => `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

export const payrollSeeder: DomainSeeder = {
  key: 'payroll',
  label: 'เงินเดือน',
  routes: ['/finance/sso-report', '/finance/wht-report', '/finance/wht-annual'],
  markerDoc: `ExpenseDocument.note ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" และ documentType = PAYROLL`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    return SCOPES.map((s) => ({
      label: `PR ${s.scope}`,
      detail: `DRAFT · ${s.label} ${s.lines.length} คน · งวด ${periodOf(ctx.today)} · รวม ฿${s.lines.reduce((a, l) => a.plus(l.base), new Prisma.Decimal(0)).toNumber().toLocaleString('th-TH')}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const period = periodOf(ctx.today);
    for (const s of SCOPES) {
      const note = noteOf(s.scope);
      const exists = await ctx.prisma.expenseDocument.findFirst({ where: { note, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const gross = s.lines.reduce((a, l) => a.plus(l.base), new Prisma.Decimal(0));
      const totalSso = s.lines.reduce((a, l) => a.plus(l.sso), new Prisma.Decimal(0));
      const totalWht = s.lines.reduce((a, l) => a.plus(l.wht), new Prisma.Decimal(0));
      const number = await nextDocNumber(ctx.prisma, 'PR', ctx.dateStr);
      await ctx.prisma.expenseDocument.create({
        data: {
          number,
          documentType: 'PAYROLL',
          branchId: ctx.refs.branchId,
          documentDate: ctx.today,
          description: `เงินเดือน ${s.label} งวด ${period}`,
          subtotal: gross,
          vatAmount: 0,
          withholdingTax: totalWht,
          totalAmount: gross,
          netPayment: gross.minus(totalSso).minus(totalWht),
          status: 'DRAFT',
          note,
          createdById: ctx.refs.reviewerId,
          payroll: {
            create: {
              payrollPeriod: period,
              entityScope: s.scope,
              lines: {
                create: s.lines.map((l) => ({
                  employeeName: l.name,
                  baseSalary: l.base,
                  ssoEmployee: l.sso,
                  whtAmount: l.wht,
                  netPaid: new Prisma.Decimal(l.base).minus(l.sso).minus(l.wht),
                })),
              },
            },
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const docs = await ctx.prisma.expenseDocument.findMany({
      where: { note: { startsWith: TEST_NOTE_MARKER }, documentType: 'PAYROLL', deletedAt: null },
      select: { id: true, number: true, journalEntryId: true },
    });
    const jeIds = docs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && docs.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jeIds.length) {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.expenseDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { journalEntryId: null } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.expenseDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { deletedAt: new Date() } });
      });
    }
    return { removed: { 'ใบเงินเดือน': docs.length, 'รายการบัญชีของใบเงินเดือน (ลบถาวร)': jeIds.length }, warnings: [] };
  },
};
```

- [ ] **Step 7: ยืนยันชื่อฟิลด์ของ `PayrollLine`**

Run: `awk '/^model PayrollLine /,/^}/' apps/api/prisma/schema.prisma`
Expected (ตรวจแล้วตอนเขียนแผน): `employeeName` · `baseSalary` · `ssoEmployee` · **`whtAmount`** (ไม่ใช่ `withholdingTax` — ชื่อนั้นอยู่บน `ExpenseDocument` ระดับใบ) · `netPaid`
`userId` เป็น optional และมี `@@unique([payroll_id, user_id])` — ปล่อย null ได้หลายแถวเพราะ Postgres ถือว่า NULL ต่างกันเสมอ

- [ ] **Step 8: เพิ่มเข้า registry**

แก้ `_registry.ts` — เพิ่ม import และใส่ต่อจาก `contractsSeeder`:

```ts
export const ALL_DOMAINS: DomainSeeder[] = [contractsSeeder, expensesSeeder, payrollSeeder, todosSeeder];
```

- [ ] **Step 9: ตรวจ TypeScript + รันเทส**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json && npm --prefix apps/api test -- test-pack`
Expected: ไม่มี error · เทสผ่านทั้งหมด

- [ ] **Step 10: พิสูจน์ round-trip เฉพาะสองโดเมนนี้**

```bash
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=expenses,payroll npm --prefix apps/api run seed:test-pack
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=expenses,payroll npm --prefix apps/api run cleanup:test-pack
```
Expected: สร้าง 6 แถว (4 ค่าใช้จ่าย + 2 เงินเดือน) แล้วลบครบ 6

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนค่าใช้จ่าย + เงินเดือน (DRAFT/รออนุมัติ เท่านั้น ตาม R2)"
```

---

### Task 5: โดเมน `other-income` + `assets`

**Files:**
- Create: `apps/api/src/cli/test-pack/other-income.seed.ts`
- Create: `apps/api/src/cli/test-pack/assets.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `nextNumberFrom` · `sumLine` · **`round2`** (Task 4) · `testNote` · `TEST_NOTE_MARKER` (Task 1)
- Produces: `otherIncomeSeeder: DomainSeeder` · `assetsSeeder: DomainSeeder`

**Step 0 ของ task นี้: export `round2` จาก `_helpers.ts`** — ตอนนี้เป็น `const round2` ที่ไม่ได้ export
เปลี่ยนเป็น `export const round2 = (n: Prisma.Decimal): Prisma.Decimal => n.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);`
(แก้คำเดียว ไม่แตะพฤติกรรม) เพราะสองโดเมนนี้ต้องปัดเงินนอก `sumLine`

**`sumLine` คืน `Prisma.Decimal` แล้ว (Task 4 fix round 1)** ⇒ เอาไป `.toLocaleString()` ตรง ๆ ไม่ได้
ต้อง `.toNumber().toLocaleString('th-TH')` **เฉพาะตอน format ข้อความเท่านั้น** ห้ามแปลงเป็น number
แล้วคำนวณต่อ

**ข้อจำกัดที่ต้องเคารพ:** `OtherIncome.companyId` บังคับ ⇒ ถ้า `ctx.refs.financeCompanyId` เป็น null ให้คืน
`SeedStat` ที่ `created: 0` พร้อม note ภาษาไทย **ห้าม throw** (โดเมนอื่นต้องเดินต่อได้)
`FixedAsset.assetCode` และ `docNo` เป็น `@unique` ทั้งคู่ ⇒ ต้องกันซ้ำด้วย max+1 เหมือนกัน

- [ ] **Step 1: เขียน `other-income.seed.ts`**

```ts
import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextNumberFrom, round2, sumLine } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** R2 — เพดานคือ READY (POSTED โพสต์ JE + ออกใบเสร็จ RT-) */
const ROWS: Array<{
  key: string;
  status: 'DRAFT' | 'READY';
  accountCode: string;
  accountName: string;
  counterparty: string;
  unitAmount: number;
  vatPct: number;
  whtPct: number;
}> = [
  { key: 'bank-interest', status: 'DRAFT', accountCode: '42-1102', accountName: 'ดอกเบี้ยเงินฝาก', counterparty: 'ทดสอบระบบ ธนาคาร', unitAmount: 1250, vatPct: 0, whtPct: 15 },
  { key: 'late-fee', status: 'DRAFT', accountCode: '42-1103', accountName: 'ค่าปรับชำระล่าช้า', counterparty: 'ทดสอบระบบ ลูกค้าจ่ายค่าปรับอย่างเดียว', unitAmount: 100, vatPct: 0, whtPct: 0 },
  { key: 'ready', status: 'READY', accountCode: '42-1105', accountName: 'กำไรจากการจำหน่ายสินทรัพย์', counterparty: 'ทดสอบระบบ ผู้ซื้อทรัพย์สิน', unitAmount: 8000, vatPct: 7, whtPct: 0 },
];

const noteOf = (key: string) => testNote(`รายได้อื่น/${key}`);

export const otherIncomeSeeder: DomainSeeder = {
  key: 'other-income',
  label: 'รายได้อื่น',
  routes: ['/other-income', '/other-income/:id', '/other-income/new', '/other-income/:id/edit', '/other-income/daily-sheet', '/other-income/pending-approval', '/other-income/templates'],
  markerDoc: `OtherIncome.customerNote ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (เลข OI- ปล่อยตามลำดับจริง)`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => {
      const s = sumLine(r.unitAmount, 1, r.vatPct);
      // .toNumber() เฉพาะตอน format — ห้ามเอาไปคำนวณต่อ
      return { label: `OI ${r.key}`, detail: `${r.status} · ${r.accountCode} ${r.accountName} · ฿${s.total.toNumber().toLocaleString('th-TH')}${r.whtPct ? ` · หัก ณ ที่จ่าย ${r.whtPct}%` : ''}` };
    });
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    if (!ctx.refs.financeCompanyId) {
      stat.notes.push('ข้ามทั้งโดเมน — ไม่พบนิติบุคคล FINANCE (OtherIncome.companyId บังคับ)');
      return stat;
    }
    for (const r of ROWS) {
      const customerNote = noteOf(r.key);
      const exists = await ctx.prisma.otherIncome.findFirst({ where: { customerNote, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const s = sumLine(r.unitAmount, 1, r.vatPct);
      // WHT คิดจากฐานก่อน VAT (V17) — Decimal ล้วน ห้าม float
      const whtAmount = round2(s.amountBeforeVat.mul(r.whtPct).div(100));
      const prefix = `OI-${ctx.dateStr}-`;
      const last = await ctx.prisma.otherIncome.findFirst({ where: { docNumber: { startsWith: prefix } }, orderBy: { docNumber: 'desc' }, select: { docNumber: true } });
      await ctx.prisma.otherIncome.create({
        data: {
          docNumber: nextNumberFrom(prefix, last?.docNumber ?? null),
          companyId: ctx.refs.financeCompanyId,
          status: r.status,
          issueDate: ctx.today,
          priceType: 'EXCLUSIVE',
          counterpartyName: r.counterparty,
          paymentAccountCode: '11-1101',
          incomeGross: s.amountBeforeVat,
          vatAmount: s.vatAmount,
          whtAmount,
          totalAmount: s.total,
          netReceived: round2(s.total.minus(whtAmount)),
          customerNote,
          createdById: ctx.refs.reviewerId,
          items: {
            create: [
              {
                lineNo: 1,
                accountCode: r.accountCode,
                accountName: r.accountName,
                description: r.accountName,
                quantity: 1,
                unitAmount: r.unitAmount,
                vatPct: r.vatPct,
                whtPct: r.whtPct,
                amountBeforeVat: s.amountBeforeVat,
                vatAmount: s.vatAmount,
                whtAmount,
              },
            ],
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const marked = await ctx.prisma.otherIncome.findMany({
      where: { customerNote: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, docNumber: true, journalEntryId: true },
    });
    // ใบกลับรายการ (`<เลขเดิม>-R`) **เขียนทับ `customerNote` เป็น "กลับรายการ: ..."** ⇒ marker หาย
    // ตามด้วย marker ไม่เจอ แต่ตามด้วย FK `reversesId` ได้เป๊ะ — ถ้าไม่กวาด จะเหลือทั้งใบ -R
    // และ JE กลับรายการค้างในสมุด (ทั้งที่ทั้งคู่เกิดจากใบทดสอบ)
    const reversals = marked.length
      ? await ctx.prisma.otherIncome.findMany({
          where: { reversesId: { in: marked.map((d) => d.id) }, deletedAt: null },
          select: { id: true, docNumber: true, journalEntryId: true },
        })
      : [];
    const docs = [...marked, ...reversals];
    const jeIds = docs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.docNumber}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && docs.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jeIds.length) {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.otherIncome.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { journalEntryId: null } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.otherIncome.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { deletedAt: new Date() } });
      });
    }
    return { removed: { 'ใบรายได้อื่น': docs.length, 'รายการบัญชีของรายได้อื่น (ลบถาวร)': jeIds.length }, warnings: [] };
  },
};
```

- [ ] **Step 2: เขียน `assets.seed.ts`**

```ts
import { Prisma } from '@prisma/client';
import { TEST_NOTE_MARKER, testNote } from './_context';
import { nextNumberFrom, round2, sumLine } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** ปัด 4 ตำแหน่งสำหรับอัตราค่าเสื่อม — คอลัมน์เป็น @db.Decimal(12, 4) */
const round4 = (n: Prisma.Decimal): Prisma.Decimal =>
  n.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

/**
 * R2 — DRAFT เท่านั้น (POSTED โพสต์ JE ซื้อทรัพย์สิน แล้วเข้าคิวค่าเสื่อมรายเดือน)
 * แถวที่สองตั้ง vatAccount = 11-4102 เพื่อทดสอบ flow "ใบกำกับมาถึงแล้ว"
 * (.claude/rules/accounting.md — Asset VAT 11-4102 deferred → 11-4101 transfer)
 */
/**
 * รหัสบัญชีต้องตรงกับ CATEGORY_CHART ใน asset-purchase.template.ts เป๊ะ ๆ:
 *   EQUIPMENT 12-2101/12-2102/53-1601 · IMPROVEMENT 12-2103/12-2104/53-1602
 *   FURNITURE 12-2105/12-2106/53-1603 · VEHICLE 12-2107/12-2108/53-1604
 * (ฉบับแรกของแผนสลับ FURNITURE กับ IMPROVEMENT — แก้แล้ว 2026-08-26)
 */
const ROWS: Array<{
  key: string;
  name: string;
  category: 'EQUIPMENT' | 'FURNITURE' | 'VEHICLE' | 'IMPROVEMENT';
  basePrice: number;
  months: number;
  hasVat: boolean;
  vatAccount: string | null;
  coaCost: string;
  coaDepr: string;
  coaExpense: string;
}> = [
  { key: 'aircon', name: 'ทดสอบระบบ เครื่องปรับอากาศสาขา', category: 'EQUIPMENT', basePrice: 32000, months: 60, hasVat: true, vatAccount: '11-4101', coaCost: '12-2101', coaDepr: '12-2102', coaExpense: '53-1601' },
  { key: 'shelf', name: 'ทดสอบระบบ ชั้นวางสินค้า (ใบกำกับยังไม่มา)', category: 'FURNITURE', basePrice: 18000, months: 60, hasVat: true, vatAccount: '11-4102', coaCost: '12-2105', coaDepr: '12-2106', coaExpense: '53-1603' },
  { key: 'novat', name: 'ทดสอบระบบ ป้ายหน้าร้าน (ไม่มี VAT)', category: 'IMPROVEMENT', basePrice: 9500, months: 36, hasVat: false, vatAccount: null, coaCost: '12-2103', coaDepr: '12-2104', coaExpense: '53-1602' },
];

const descOf = (key: string) => testNote(`ทรัพย์สิน/${key}`);

export const assetsSeeder: DomainSeeder = {
  key: 'assets',
  label: 'ทรัพย์สินถาวร',
  routes: ['/assets', '/assets/:id', '/assets/new', '/assets/:id/edit', '/assets/register', '/assets/depreciation', '/assets/transfers', '/assets/:id/dispose', '/assets/audit', '/assets/:id/audit', '/assets/period-close', '/assets/journal', '/assets/summary-report', '/assets/:id/schedule'],
  markerDoc: `FixedAsset.description ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" · docNo เดินตามลำดับ ASSET-YYMM- จริง · assetCode ใช้ลำดับแยก "TESTASSET-" โดยตั้งใจ เพราะรหัสจริงเป็นรายหมวด (COMP-001) ซึ่งจะถูกเผาถาวรถ้าเอาไปตั้งให้แถวทดสอบที่ถูก soft-delete`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => {
      const s = sumLine(r.basePrice, 1, r.hasVat ? 7 : 0);
      return { label: `ASSET ${r.key}`, detail: `DRAFT · ${r.name} · ฿${r.basePrice.toLocaleString('th-TH')} · ${r.months} เดือน${r.vatAccount === '11-4102' ? ' · VAT รอใบกำกับ (11-4102)' : ''} · รวม VAT ฿${s.total.toNumber().toLocaleString('th-TH')}` };
    });
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    // ASSET-YYMM-NNNN ตามรูปแบบในคอมเมนต์ของ schema
    const ym = `${String(ctx.today.getUTCFullYear()).slice(2)}${String(ctx.today.getUTCMonth() + 1).padStart(2, '0')}`;
    const docPrefix = `ASSET-${ym}-`;
    const codePrefix = 'TESTASSET-';
    for (const r of ROWS) {
      const description = descOf(r.key);
      const exists = await ctx.prisma.fixedAsset.findFirst({ where: { description, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      const [lastDoc, lastCode] = await Promise.all([
        ctx.prisma.fixedAsset.findFirst({ where: { docNo: { startsWith: docPrefix } }, orderBy: { docNo: 'desc' }, select: { docNo: true } }),
        ctx.prisma.fixedAsset.findFirst({ where: { assetCode: { startsWith: codePrefix } }, orderBy: { assetCode: 'desc' }, select: { assetCode: true } }),
      ]);
      // Decimal ล้วน — base ยังเป็น literal แต่กันคนแก้ทีหลังใส่ค่าที่ไม่ใช่ literal แล้วสืบทอด float
      const base = new Prisma.Decimal(r.basePrice);
      const vat = r.hasVat ? round2(base.mul(7).div(100)) : new Prisma.Decimal(0);
      const monthlyDepr = round4(base.div(r.months));
      await ctx.prisma.fixedAsset.create({
        data: {
          assetCode: nextNumberFrom(codePrefix, lastCode?.assetCode ?? null, 3),
          docNo: nextNumberFrom(docPrefix, lastDoc?.docNo ?? null),
          name: r.name,
          description,
          category: r.category,
          branchId: ctx.refs.branchId,
          basePrice: r.basePrice,
          hasVat: r.hasVat,
          vatAmount: vat,
          vatAccount: r.vatAccount,
          purchaseCost: r.basePrice,
          usefulLifeMonths: r.months,
          monthlyDepr,
          dailyDepr: round4(base.div(new Prisma.Decimal(r.months).div(12).mul(365))),
          netBookValue: r.basePrice,
          coaCostAccount: r.coaCost,
          coaDeprAccount: r.coaDepr,
          coaExpenseAccount: r.coaExpense,
          purchaseDate: ctx.today,
          supplierName: 'ทดสอบระบบ ผู้ขายทรัพย์สิน',
          status: 'DRAFT',
          createdById: ctx.refs.reviewerId,
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.fixedAsset.findMany({
      where: { description: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, assetCode: true, docNo: true, invoiceTransferJournalEntryId: true },
    });
    // JE ของทรัพย์สินมี 2 ทาง: โอน VAT 11-4102→11-4101 มี FK บนตาราง ส่วน **JE ซื้อทรัพย์สิน
    // ตอน post ไม่มี FK** — `AssetPurchaseTemplate` stamp `metadata.assetId` + `flow: 'asset-purchase'`
    // ⇒ กวาดทาง metadata เหมือนที่ใบจองทำ ไม่งั้นผู้ทดสอบที่กด post ในหน้าจอจะทิ้ง JE ค้างในสมุด
    const metaJes = rows.length
      ? await ctx.prisma.journalEntry.findMany({
          where: { OR: rows.map((r) => ({ metadata: { path: ['assetId'], equals: r.id } as never })) },
          select: { id: true },
        })
      : [];
    const jeIds = [
      ...rows.map((r) => r.invoiceTransferJournalEntryId).filter((x): x is string => !!x),
      ...metaJes.map((j) => j.id),
    ].filter((id, i, all) => all.indexOf(id) === i);
    for (const r of rows) console.log(`     ${r.docNo} (${r.assetCode})${r.invoiceTransferJournalEntryId ? ' (มี JE โอน VAT)' : ''}`);
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        // ค่าเสื่อมที่ cron เคยลงให้ต้องออกก่อน ไม่งั้น FK ค้าง
        await tx.depreciationEntry.deleteMany({ where: { assetId: { in: rows.map((r) => r.id) } } });
        if (jeIds.length) {
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.fixedAsset.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { invoiceTransferJournalEntryId: null } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.fixedAsset.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date() } });
      });
    }
    return { removed: { 'ทรัพย์สิน': rows.length, 'รายการบัญชีของทรัพย์สิน (ลบถาวร)': jeIds.length }, warnings: [] };
  },
};
```

- [ ] **Step 3: ยืนยันชื่อ relation ของค่าเสื่อม**

Run: `awk '/^model DepreciationEntry /,/^}/' apps/api/prisma/schema.prisma | grep -E 'assetId|journalEntryId'`
Expected: มี `assetId` — ถ้าชื่อต่างให้แก้ `cleanup` ตามชื่อจริง และถ้ามี `journalEntryId` บังคับ (ไม่ optional)
ให้เพิ่มการกวาด JE ของค่าเสื่อมด้วยรูปแบบเดียวกับ `jeIds` ข้างบน

- [ ] **Step 4: เพิ่มเข้า registry**

```ts
export const ALL_DOMAINS: DomainSeeder[] = [contractsSeeder, expensesSeeder, payrollSeeder, otherIncomeSeeder, assetsSeeder, todosSeeder];
```

- [ ] **Step 5: ตรวจ TypeScript**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: ไม่มี error

- [ ] **Step 6: พิสูจน์ round-trip**

```bash
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=other-income,assets npm --prefix apps/api run seed:test-pack
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=other-income,assets npm --prefix apps/api run cleanup:test-pack
```
Expected: สร้าง 6 แถว แล้วลบครบ 6

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนรายได้อื่น + ทรัพย์สินถาวร (DRAFT/READY ตาม R2)"
```

---

### Task 6: โดเมน `equity` (ผู้ถือหุ้น + เอกสารส่วนของผู้ถือหุ้น)

**Files:**
- Create: `apps/api/src/cli/test-pack/equity.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `nextNumberFrom` (Task 4) · `testName` · `testNote` · `TEST_NAME_PREFIX` · `TEST_NOTE_MARKER` (Task 1)
- Produces: `equitySeeder: DomainSeeder`

**คำเตือนบังคับ:** `shareholders` อยู่ใน `KEEP_TABLES` ของ factory reset ⇒ `cleanup` ต้อง**คืน warning เสมอ**
เมื่อพบผู้ถือหุ้นทดสอบ เพราะถ้าลืมล้าง มันจะรอดข้าม factory reset ไปปนทะเบียน บอจ.5 จริงในวัน go-live

**D2 — เอกสารต้องกดปุ่มต่อได้จริง (fix round 1, 2026-08-26):** ทุก txnType ที่ seed (CAP_INC/DIV_DEC/DRAW)
อยู่ใน `NEEDS_SHAREHOLDERS` ⇒ เอกสารที่ไม่มี `EquityShareholderLine` ตกด่าน `SH_REQUIRED` เป็นทางตัน —
seed จึงสร้างบรรทัดผู้ถือหุ้น **nested ใน create เดียวกัน** เสมอ (แตกยอดตามสัดส่วน 60/30/10 ใน `Prisma.Decimal`
ล้วน). เอกสาร **DRAW @ READY** มีไว้เพราะเป็น txnType เดียวในชุดที่**โพสต์ได้ทันทีโดยไม่ต้องแนบไฟล์มติ**
(ไม่อยู่ใน `NEEDS_RESOLUTION` ⇒ V8 ไม่บังคับ; ต้องการแค่บรรทัดผู้ถือหุ้น + `paymentAccountCode`) — นี่คือแถวที่
ทำให้โดเมนนี้ผ่าน D2. ส่วน CAP_INC/DIV_DEC ผู้ทดสอบต้องอัปโหลดไฟล์มติที่ประชุมเองก่อนโพสต์ (ขั้นอัปโหลดคือสิ่งที่
ต้องทดสอบอยู่แล้ว) — **ห้าม seed แถว `EquityAttachment` หลอก**: ไฟล์จริงอยู่ S3, แถว metadata เปล่าทำปุ่ม
"ดูเอกสาร" พัง. Re-run บนสภาพแวดล้อมที่เคย seed รุ่นก่อน fix จะ**เติมบรรทัดให้เอกสารเดิมที่ไม่มีบรรทัด**แทนการ
ปล่อยเป็นทางตัน (heal path ใน branch `exists`).

- [ ] **Step 1: เขียน `equity.seed.ts`**

```ts
import { Prisma } from '@prisma/client';

import { TEST_NAME_PREFIX, TEST_NOTE_MARKER, testName, testNote } from './_context';
import { nextNumberFrom, round2 } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const SHAREHOLDERS: Array<{
  name: string;
  shares: number;
  pct: number;
  type: 'INDIVIDUAL' | 'JURISTIC_TH' | 'JURISTIC_FOREIGN';
}> = [
  { name: 'ผู้ถือหุ้นบุคคล ก', shares: 6000, pct: 60, type: 'INDIVIDUAL' },
  { name: 'ผู้ถือหุ้นบุคคล ข', shares: 3000, pct: 30, type: 'INDIVIDUAL' },
  { name: 'ผู้ถือหุ้นนิติบุคคลไทย', shares: 1000, pct: 10, type: 'JURISTIC_TH' },
];

/** แตกยอดรวมตามสัดส่วน % — Decimal ล้วนตาม Global Constraint (ห้าม float กับเงิน) */
const splitByPct = (total: Prisma.Decimal, pct: number): Prisma.Decimal =>
  round2(total.mul(pct).div(100));

/** บรรทัดผู้ถือหุ้นของเอกสาร — holderKey คือชื่อใน SHAREHOLDERS (ยังไม่เติม prefix) */
interface LineSeed {
  holderKey: string;
  amount: Prisma.Decimal;
  premium?: Prisma.Decimal;
}

const CAP_INC_PAR_TOTAL = new Prisma.Decimal(1_000_000);
const DIV_DEC_TOTAL = new Prisma.Decimal(300_000);
const DRAW_TOTAL = new Prisma.Decimal(50_000);

const capIncLines: LineSeed[] = SHAREHOLDERS.map((s) => {
  const par = splitByPct(CAP_INC_PAR_TOTAL, s.pct);
  return { holderKey: s.name, amount: par, premium: splitByPct(par, 10) };
});
const divDecLines: LineSeed[] = SHAREHOLDERS.map((s) => ({
  holderKey: s.name,
  amount: splitByPct(DIV_DEC_TOTAL, s.pct),
}));
/** DRAW = ผู้ถือหุ้นใหญ่รายเดียว — txnType เดียวที่โพสต์ได้โดยไม่ต้องแนบไฟล์มติ (D2) */
const drawLines: LineSeed[] = [{ holderKey: SHAREHOLDERS[0].name, amount: DRAW_TOTAL }];

/**
 * R2 — เพดานคือ READY (POSTED โพสต์ JE ทุนจดทะเบียน/ปันผล)
 * ทุกเอกสารต้องมีบรรทัดผู้ถือหุ้น (NEEDS_SHAREHOLDERS — ไม่มีบรรทัด = SH_REQUIRED ทางตัน ผิด D2).
 * DRAW อยู่ในชุดเพราะเป็น txnType เดียวที่ seed แล้ว "กดโพสต์ได้ทันที": ต้องมีผู้ถือหุ้น + ช่องทางเงิน
 * แต่ไม่อยู่ใน NEEDS_RESOLUTION ⇒ ไม่บังคับแนบไฟล์มติ (V8). ส่วน CAP_INC/DIV_DEC ผู้ทดสอบต้อง
 * อัปโหลดไฟล์มติเองก่อนโพสต์ — ห้าม seed แถว EquityAttachment หลอก (ไฟล์จริงอยู่ S3, แถว
 * metadata เปล่าทำปุ่มดูเอกสารพัง) เพราะขั้นอัปโหลดคือสิ่งที่ต้องทดสอบอยู่แล้ว
 */
const DOCS: Array<{
  key: string;
  txnType: 'CAP_INC' | 'DIV_DEC' | 'DRAW';
  status: 'DRAFT' | 'READY';
  desc: string;
  /** CAP_INC/DIV_DEC อยู่ใน NEEDS_RESOLUTION — ใส่เลขที่/วันที่มติไว้ให้ เหลือแค่แนบไฟล์ */
  withResolution: boolean;
  /** เฉพาะ txnType ใน NEEDS_PAYMENT (CAP_INC, DRAW) — DIV_DEC ไม่ใช้ช่องทางเงิน */
  withPayment: boolean;
  lines: LineSeed[];
}> = [
  {
    key: 'cap-inc',
    txnType: 'CAP_INC',
    status: 'DRAFT',
    desc: 'เพิ่มทุนจดทะเบียน (ร่าง)',
    withResolution: true,
    withPayment: true,
    lines: capIncLines,
  },
  {
    key: 'div-dec',
    txnType: 'DIV_DEC',
    status: 'READY',
    desc: 'ประกาศจ่ายเงินปันผล (รออนุมัติ)',
    withResolution: true,
    withPayment: false,
    lines: divDecLines,
  },
  {
    key: 'draw',
    txnType: 'DRAW',
    status: 'READY',
    desc: 'ถอนใช้ส่วนตัวผู้ถือหุ้นใหญ่ (โพสต์ได้ทันที)',
    withResolution: false,
    withPayment: true,
    lines: drawLines,
  },
];

const descOf = (key: string) => testNote(`ส่วนของผู้ถือหุ้น/${key}`);

const sumOf = (lines: LineSeed[]): Prisma.Decimal =>
  lines.reduce((s, ln) => s.plus(ln.amount), new Prisma.Decimal(0));

/** payload บรรทัด — ชื่อคอลัมน์ตรง schema: shareholderId/shareholderName/lineNo/amount/premium */
const lineCreateData = (lines: LineSeed[], holderIds: Map<string, string>) =>
  lines.map((ln, i) => ({
    shareholderId: holderIds.get(ln.holderKey)!,
    shareholderName: testName(ln.holderKey),
    lineNo: i + 1,
    amount: ln.amount,
    ...(ln.premium ? { premium: ln.premium } : {}),
  }));

export const equitySeeder: DomainSeeder = {
  key: 'equity',
  label: 'ส่วนของผู้ถือหุ้น',
  routes: [
    '/finance/equity',
    '/finance/equity/new',
    '/finance/equity/:id',
    '/finance/equity/:id/edit',
    '/finance/dividend-register',
    '/finance/equity-statement',
  ],
  markerDoc: `EquityDocument.description ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" · Shareholder.name ขึ้นต้นด้วย "${TEST_NAME_PREFIX}" (⚠️ shareholders เป็น KEEP table — factory reset ไม่ล้างให้)`,

  async plan(): Promise<PlanRow[]> {
    return [
      ...SHAREHOLDERS.map((s) => ({
        label: testName(s.name),
        detail: `${s.shares.toLocaleString('th-TH')} หุ้น · ${s.pct}% · ${s.type}`,
      })),
      ...DOCS.map((d) => ({
        label: `EQ ${d.key}`,
        detail:
          `${d.status} · ${d.txnType} · ${d.desc} · บรรทัดผู้ถือหุ้น ${d.lines.length} รายการ ` +
          `รวม ${sumOf(d.lines).toNumber().toLocaleString('th-TH')} บาท`,
      })),
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    if (!ctx.refs.financeCompanyId) {
      stat.notes.push('ข้ามเอกสาร — ไม่พบนิติบุคคล FINANCE (EquityDocument.companyId บังคับ)');
    }

    /** ชื่อใน SHAREHOLDERS (ยังไม่เติม prefix) → Shareholder.id — บรรทัดเอกสารต้องอ้าง id จริง */
    const holderIds = new Map<string, string>();
    for (const s of SHAREHOLDERS) {
      const name = testName(s.name);
      const exists = await ctx.prisma.shareholder.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        holderIds.set(s.name, exists.id);
        stat.skipped += 1;
        continue;
      }
      const created = await ctx.prisma.shareholder.create({
        data: {
          name,
          shares: s.shares,
          sharePct: s.pct,
          type: s.type,
          note: testNote('ผู้ถือหุ้นสำหรับทดสอบ — ลบก่อนใช้จริง'),
        },
        select: { id: true },
      });
      holderIds.set(s.name, created.id);
      stat.created += 1;
    }

    if (!ctx.refs.financeCompanyId) return stat;

    const prefix = `EQ-${ctx.dateStr}-`;
    for (const d of DOCS) {
      const description = descOf(d.key);
      const exists = await ctx.prisma.equityDocument.findFirst({
        where: { description, deletedAt: null },
        select: { id: true, docNumber: true, _count: { select: { lines: true } } },
      });
      if (exists) {
        // เอกสารรุ่นก่อน fix D2 ไม่มีบรรทัดผู้ถือหุ้น (ทางตัน SH_REQUIRED) — เติมให้แทนการปล่อยไว้
        if (exists._count.lines === 0) {
          await ctx.prisma.equityShareholderLine.createMany({
            data: lineCreateData(d.lines, holderIds).map((ln) => ({
              ...ln,
              documentId: exists.id,
            })),
          });
          stat.notes.push(
            `เติมบรรทัดผู้ถือหุ้นให้ ${exists.docNumber} (เอกสารรุ่นเก่าไม่มีบรรทัด)`,
          );
        }
        stat.skipped += 1;
        continue;
      }
      const last = await ctx.prisma.equityDocument.findFirst({
        where: { docNumber: { startsWith: prefix } },
        orderBy: { docNumber: 'desc' },
        select: { docNumber: true },
      });
      await ctx.prisma.equityDocument.create({
        data: {
          docNumber: nextNumberFrom(prefix, last?.docNumber ?? null),
          companyId: ctx.refs.financeCompanyId,
          txnType: d.txnType,
          status: d.status,
          txnDate: ctx.today,
          description,
          ...(d.withResolution
            ? { resolutionNo: `TEST-MTG-${ctx.dateStr}`, resolutionDate: ctx.today }
            : {}),
          ...(d.withPayment ? { paymentAccountCode: '11-1201' } : {}),
          makerId: ctx.refs.reviewerId,
          lines: { create: lineCreateData(d.lines, holderIds) },
        },
      });
      stat.created += 1;
    }

    stat.notes.push(
      'เอกสาร CAP_INC/DIV_DEC ต้องแนบไฟล์มติที่ประชุมก่อนโพสต์ (V8 — ขั้นอัปโหลดไฟล์คือสิ่งที่ต้องทดสอบ) · เอกสาร DRAW โพสต์ได้ทันทีไม่ต้องแนบไฟล์',
    );
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const docs = await ctx.prisma.equityDocument.findMany({
      where: { description: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, docNumber: true, journalEntryId: true, reverseJournalEntryId: true },
    });
    const holders = await ctx.prisma.shareholder.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX }, deletedAt: null },
      select: { id: true, name: true },
    });
    const docIds = docs.map((d) => d.id);
    const lineCount = docIds.length
      ? await ctx.prisma.equityShareholderLine.count({ where: { documentId: { in: docIds } } })
      : 0;
    const jeIds = docs
      .flatMap((d) => [d.journalEntryId, d.reverseJournalEntryId])
      .filter((x): x is string => !!x);
    for (const d of docs) console.log(`     ${d.docNumber}`);
    for (const h of holders) console.log(`     ผู้ถือหุ้น "${h.name}"`);

    if (!dryRun && (docs.length || holders.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        if (docs.length) {
          // FK ชื่อ documentId ไม่ใช่ equityDocumentId — บรรทัดไม่มี deletedAt จึง hard delete ได้
          await tx.equityShareholderLine.deleteMany({ where: { documentId: { in: docIds } } });
          if (jeIds.length) {
            await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.equityDocument.updateMany({
              where: { id: { in: docIds } },
              data: { journalEntryId: null, reverseJournalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
          }
          await tx.equityDocument.updateMany({
            where: { id: { in: docIds } },
            data: { deletedAt: new Date() },
          });
        }
        if (holders.length) {
          await tx.shareholder.updateMany({
            where: { id: { in: holders.map((h) => h.id) } },
            data: { deletedAt: new Date() },
          });
        }
      });
    }

    return {
      removed: {
        เอกสารส่วนของผู้ถือหุ้น: docs.length,
        'บรรทัดผู้ถือหุ้นในเอกสาร (ลบถาวร)': lineCount,
        ผู้ถือหุ้นทดสอบ: holders.length,
        'รายการบัญชีส่วนของผู้ถือหุ้น (ลบถาวร)': jeIds.length,
      },
      warnings: holders.length
        ? [
            'ตาราง shareholders อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้ ผู้ถือหุ้นทดสอบจะรอดข้าม factory reset ไปปนทะเบียน บอจ.5 จริง',
          ]
        : [],
    };
  },
};
```

- [ ] **Step 2: ยืนยันชื่อ FK ของ `EquityShareholderLine`**

Run: `awk '/^model EquityShareholderLine /,/^}/' apps/api/prisma/schema.prisma | grep -E 'documentId|shareholder|deletedAt'`
Expected (ตรวจซ้ำ 2026-08-26): FK ชี้ไป `EquityDocument` ชื่อ **`documentId`** (ไม่ใช่ `equityDocumentId`) ·
มี `shareholderId` + `shareholderName` (snapshot) + `lineNo` (`@@unique([documentId, lineNo])` และ
`@@unique([documentId, shareholderId])` = V_SH_UNIQUE ระดับ DB) · เงิน 4 คอลัมน์ `amount`/`premium`/`paid`/`wht`
(`Decimal(12,2)` default 0 — seed ตั้งเฉพาะที่เกี่ยวข้อง: `premium` เฉพาะ CAP_INC) · **ไม่มี `deletedAt`** ⇒ hard delete ถูกแล้ว

- [ ] **Step 3: เพิ่มเข้า registry (ต่อจาก `assetsSeeder`)**

```ts
export const ALL_DOMAINS: DomainSeeder[] = [contractsSeeder, expensesSeeder, payrollSeeder, otherIncomeSeeder, assetsSeeder, equitySeeder, todosSeeder];
```

- [ ] **Step 4: ตรวจ TypeScript + round-trip**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=equity npm --prefix apps/api run seed:test-pack
EXPECTED_DB_NAME=$DB DOMAINS=equity npm --prefix apps/api run cleanup:test-pack
```
Expected: สร้าง 6 แถว (3 ผู้ถือหุ้น + 3 เอกสาร — บรรทัดผู้ถือหุ้น 7 บรรทัดสร้าง nested ใน create เดียวกัน
ไม่นับแยกใน `created`) · seed พิมพ์ note ภาษาไทยบอกว่า CAP_INC/DIV_DEC ต้องแนบไฟล์มติก่อนโพสต์ ส่วน DRAW
โพสต์ได้ทันที · dry-run cleanup แสดง **⚠️ คำเตือนเรื่อง KEEP_TABLES** + นับ `'บรรทัดผู้ถือหุ้นในเอกสาร (ลบถาวร)': 7`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนส่วนของผู้ถือหุ้น + คำเตือน shareholders รอดข้าม factory reset"
```

---

### Task 7: โดเมน `suppliers-po` + `stock-ops`

**Files:**
- Create: `apps/api/src/cli/test-pack/suppliers-po.seed.ts`
- Create: `apps/api/src/cli/test-pack/stock-ops.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `nextNumberFrom` (Task 4) · `testName` · `testNote` · `TEST_NAME_PREFIX` · `TEST_NOTE_MARKER` · `TEST_DOC_PREFIX` (Task 1)
- Produces: `suppliersPoSeeder: DomainSeeder` · `stockOpsSeeder: DomainSeeder`

**ทั้งสองโดเมนไม่โพสต์ JE เลย** (ตรวจแล้วใน spec §3 R2) ⇒ seed สถานะไหนก็ได้
**คำเตือนบังคับ:** `suppliers` และ `purchase_orders` อยู่ใน `KEEP_TABLES` ⇒ `cleanup` ต้องคืน warning
**เครื่องที่ใช้:** ทั้งสองโดเมนต้องมี `Product` ที่ IMEI ขึ้นต้น `TEST-` ⇒ ต้องรัน `contracts` ก่อน
(registry เรียงให้แล้ว) ถ้าไม่พบ ให้ข้ามพร้อม note ไม่ throw

**กวาดแถวที่หลุด marker (fix round 1, 2026-08-26 — ห้ามตัดสองบล็อกนี้ออกจาก `cleanup`):**
การใช้งานเอกสารทดสอบสร้างแถวลูกที่**ไม่มี marker ติดตัว** 2 จุด — (1) QC รับของบน PO ทดสอบสร้าง
`Product` (`po-receiving.service.ts` — ถ้าไม่กวาดคือ**สต็อกผี**ที่แยกไม่ออกจากของจริง) และ
(2) ยืนยันรับโอนสร้าง `BranchReceiving` + `BranchReceivingItem` (`branch-receiving.service.ts`).
ทั้งคู่ตามได้ด้วย FK ตรง ไม่ต้องเดา marker: `Product.poId → PurchaseOrder.id` และ
`BranchReceiving.transferId → StockTransfer.id` (`@unique`) / `BranchReceivingItem.receivingId`.
ทุกตารางมี `deletedAt` ⇒ soft delete ล้วน. เครื่องที่กวาดต้องพิมพ์ IMEI+ชื่อออกจอเสมอ (ทั้ง dry-run
และของจริง — มันไม่มี marker ให้ผู้สั่งล้างตรวจเองทีหลัง) และเครื่องที่ไม่ใช่ `IN_STOCK` แล้ว
ต้องเด้ง warning ให้คนตัดสินก่อน. หมายเหตุ: `GoodsReceiving`/`GoodsReceivingItem` ไม่ใช่รูที่สาม —
`GoodsReceiving.poId` ชี้ PO ตรง ๆ และบล็อก `grs` ใน cleanup กวาดอยู่แล้ว

- [ ] **Step 1: เขียน `suppliers-po.seed.ts`** *(บล็อกนี้ sync กับโค้ดที่ commit แล้ว — fix round 2, 2026-08-26)*

> ⚠️ จุดที่ **จงใจ** ต่างจาก probe ตาม marker ปกติ: idempotency probe อยู่ที่ `notes` (marker)
> แต่การจองเลข `poNumber` เป็น max+1 **โดยไม่กรอง `deletedAt`** — `poNumber` เป็น `@unique`
> เต็มตาราง แถวที่ soft delete แล้วยังถือเลขอยู่ ถ้าใช้เลขตายตัว/probe เฉพาะแถวเป็นจะชน P2002
> ทันทีหลัง cleanup (deviation ที่อนุมัติแล้ว) · เงินคูณใน `Prisma.Decimal` เท่านั้น
> (ห้าม `p.qty * p.unitPrice` แบบ float)

```ts
import { Prisma } from '@prisma/client';

import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, testName, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const SUPPLIERS: Array<{ name: string; phone: string; isRepairCenter: boolean }> = [
  { name: 'ซัพพลายเออร์มือถือ', phone: '021110001', isRepairCenter: false },
  { name: 'ศูนย์ซ่อมพันธมิตร', phone: '021110002', isRepairCenter: true },
];

/**
 * ใบสั่งซื้อ 2 ใบ — สั่งแล้วรอรับของ กับ รับบางส่วนแล้ว
 * ค่า POStatus จริง: DRAFT APPROVED ORDERED PENDING PARTIALLY_RECEIVED FULLY_RECEIVED CANCELLED
 * (**ไม่มี `PARTIAL`** — ชื่อเต็มคือ PARTIALLY_RECEIVED)
 *
 * ไม่โพสต์ JE — โมดูล purchase-orders ทั้งสายไม่แตะสมุดบัญชี
 */
const POS: Array<{
  key: string;
  status: 'ORDERED' | 'PARTIALLY_RECEIVED';
  qty: number;
  unitPrice: number;
  note: string;
}> = [
  { key: 'ordered', status: 'ORDERED', qty: 5, unitPrice: 12000, note: 'ใบสั่งซื้อรอรับของ' },
  {
    key: 'partial',
    status: 'PARTIALLY_RECEIVED',
    qty: 3,
    unitPrice: 21000,
    note: 'ใบสั่งซื้อรับของบางส่วนแล้ว',
  },
];

export const suppliersPoSeeder: DomainSeeder = {
  key: 'suppliers-po',
  label: 'ซัพพลายเออร์ + ใบสั่งซื้อ',
  routes: ['/suppliers', '/suppliers/:id', '/purchase-orders', '/purchase-orders/qc'],
  markerDoc: `Supplier.name ขึ้นต้น "${TEST_NAME_PREFIX}" · PurchaseOrder.poNumber ขึ้นต้น "${TEST_DOC_PREFIX}" (⚠️ ทั้งสองตารางเป็น KEEP — factory reset ไม่ล้างให้)`,

  async plan(): Promise<PlanRow[]> {
    return [
      ...SUPPLIERS.map((s) => ({
        label: testName(s.name),
        detail: s.isRepairCenter ? 'ศูนย์ซ่อม (isRepairCenter = true)' : 'ซัพพลายเออร์ทั่วไป',
      })),
      ...POS.map((p) => ({
        label: `${TEST_DOC_PREFIX}PO ${p.key}`,
        detail: `${p.status} · ${p.qty} ชิ้น × ฿${p.unitPrice.toLocaleString('th-TH')}`,
      })),
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const supplierIds: string[] = [];

    for (const s of SUPPLIERS) {
      const name = testName(s.name);
      const found = await ctx.prisma.supplier.findFirst({
        where: { name, deletedAt: null },
        select: { id: true },
      });
      if (found) {
        supplierIds.push(found.id);
        stat.skipped += 1;
        continue;
      }
      const created = await ctx.prisma.supplier.create({
        data: {
          name,
          phone: s.phone,
          isRepairCenter: s.isRepairCenter,
          notes: testNote('ซัพพลายเออร์สำหรับทดสอบ — ลบได้'),
        },
        select: { id: true },
      });
      supplierIds.push(created.id);
      stat.created += 1;
    }

    const prefix = `${TEST_DOC_PREFIX}PO-${ctx.dateStr}-`;
    for (const p of POS) {
      // idempotency probe ที่ notes (marker) — ไม่ใช่ที่เลขเอกสาร เพราะเลขเป็น running number
      const notes = testNote(p.note);
      const exists = await ctx.prisma.purchaseOrder.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // poNumber เป็น @unique เต็มตาราง (ไม่ใช่ partial) — แถวที่ soft delete ไปแล้วยังถือเลขอยู่
      // ⇒ จองเลขแบบ max+1 โดย "ไม่กรอง deletedAt" (doctrine เดียวกับ nextDocNumber ใน _helpers)
      const last = await ctx.prisma.purchaseOrder.findFirst({
        where: { poNumber: { startsWith: prefix } },
        orderBy: { poNumber: 'desc' },
        select: { poNumber: true },
      });
      await ctx.prisma.purchaseOrder.create({
        data: {
          poNumber: nextNumberFrom(prefix, last?.poNumber ?? null),
          supplierId: supplierIds[0],
          orderDate: ctx.today,
          // ห้ามคูณเงินเป็น float — Global Constraint: เงินต้องเป็น Prisma.Decimal
          totalAmount: new Prisma.Decimal(p.unitPrice).mul(p.qty),
          status: p.status,
          notes,
          createdById: ctx.refs.reviewerId,
          // ฟิลด์ของ POItem ยืนยันจาก prisma/seed.ts (poItemsData) — brand/model/color/storage/category/quantity/unitPrice/receivedQty
          items: {
            create: [
              {
                brand: 'ทดสอบระบบ',
                model: 'รุ่นทดสอบ',
                storage: '128GB',
                category: 'PHONE_NEW',
                quantity: p.qty,
                unitPrice: p.unitPrice,
                receivedQty: p.status === 'PARTIALLY_RECEIVED' ? 1 : 0,
              },
            ],
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const pos = await ctx.prisma.purchaseOrder.findMany({
      where: { poNumber: { startsWith: `${TEST_DOC_PREFIX}PO-` }, deletedAt: null },
      select: { id: true, poNumber: true },
    });
    // เครื่องที่ QC รับเข้าจาก PO ทดสอบ (po-receiving.service.ts) ไม่มี marker ติดตัว —
    // ตามได้จาก FK ตรง Product.poId เท่านั้น ถ้าไม่กวาดตรงนี้จะเหลือเป็นสต็อกผีถาวร
    const products = pos.length
      ? await ctx.prisma.product.findMany({
          where: { poId: { in: pos.map((p) => p.id) }, deletedAt: null },
          select: { id: true, imeiSerial: true, name: true, status: true },
        })
      : [];
    const suppliers = await ctx.prisma.supplier.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const p of pos) console.log(`     ${p.poNumber}`);
    // เครื่องพวกนี้ไม่มี marker — บรรทัดนี้คือโอกาสเดียวที่ผู้สั่งล้าง (ทั้ง dry-run และของจริง)
    // จะเห็นว่ากำลังจะลบเครื่องไหนบ้าง
    for (const p of products)
      console.log(
        `     เครื่องจาก PO ทดสอบ: ${p.imeiSerial ?? '(ไม่มี IMEI)'} "${p.name}" [${p.status}]`,
      );
    for (const s of suppliers) console.log(`     ซัพพลายเออร์ "${s.name}"`);

    // เครื่องที่ไม่ใช่ IN_STOCK แล้ว = ผู้ทดสอบเอาไปขาย/จอง/เปิดสัญญาต่อ — อาจมีเอกสารอื่นชี้อยู่
    // ต้องเด้งเตือนให้คนตัดสิน ไม่ใช่ลบเงียบ ๆ
    const movedProducts = products.filter((p) => p.status !== 'IN_STOCK');

    if (!dryRun && (pos.length || suppliers.length)) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        if (pos.length) {
          const poIds = pos.map((p) => p.id);
          // ทุกตารางในสายนี้มี deletedAt ⇒ soft delete ทั้งหมด (กฎ .claude/rules/database.md)
          const grs = await tx.goodsReceiving.findMany({
            where: { poId: { in: poIds } },
            select: { id: true },
          });
          if (grs.length) {
            await tx.goodsReceivingItem.updateMany({
              where: { receivingId: { in: grs.map((g) => g.id) } },
              data: { deletedAt: now },
            });
            await tx.goodsReceiving.updateMany({
              where: { id: { in: grs.map((g) => g.id) } },
              data: { deletedAt: now },
            });
          }
          // เครื่องที่รับเข้าจาก PO ทดสอบ — soft delete พร้อมใบในทรานแซกชันเดียวกัน
          // (ไม่มี hard delete ในสายนี้ จึงไม่มีปัญหาลำดับ FK)
          if (products.length) {
            await tx.product.updateMany({
              where: { id: { in: products.map((pr) => pr.id) } },
              data: { deletedAt: now },
            });
          }
          await tx.pOItem.updateMany({ where: { poId: { in: poIds } }, data: { deletedAt: now } });
          await tx.purchaseOrder.updateMany({
            where: { id: { in: poIds } },
            data: { deletedAt: now },
          });
        }
        if (suppliers.length) {
          await tx.supplier.updateMany({
            where: { id: { in: suppliers.map((s) => s.id) } },
            data: { deletedAt: now },
          });
        }
      });
    }

    // ถ้อยคำต้องตรงกับสิ่งที่เกิดจริง: dry-run = ยังไม่ได้ลบ (ให้ตรวจก่อนยืนยัน),
    // live = ลบไปแล้วในทรานแซกชันข้างบน (ให้ตามเช็คเอกสารที่ยังชี้ถึงเครื่อง)
    const warnings: string[] = movedProducts.map((p) =>
      dryRun
        ? `เครื่อง ${p.imeiSerial ?? p.name} จาก PO ทดสอบไม่ได้อยู่สถานะ IN_STOCK แล้ว (สถานะปัจจุบัน: ${p.status}) — อาจมีใบขาย/สัญญา/การจองชี้อยู่ ตรวจก่อนยืนยันการล้าง`
        : `เครื่อง ${p.imeiSerial ?? p.name} จาก PO ทดสอบไม่ได้อยู่สถานะ IN_STOCK (สถานะล่าสุด: ${p.status}) และถูกลบ (soft delete) ไปแล้วในรอบนี้ — ตรวจใบขาย/สัญญา/การจองที่ยังชี้ถึงเครื่องนี้`,
    );
    if (pos.length || suppliers.length)
      warnings.push(
        'ตาราง suppliers + purchase_orders อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้จะรอดข้ามไปปนทะเบียนจริง',
      );
    return {
      removed: {
        ใบสั่งซื้อ: pos.length,
        เครื่องรับเข้าจากใบสั่งซื้อ: products.length,
        ซัพพลายเออร์ทดสอบ: suppliers.length,
      },
      warnings,
    };
  },
};
```

- [ ] **Step 2: ยืนยัน `POStatus` + ฟิลด์ของ `POItem` (ตรวจแล้วตอนเขียนแผน — ยืนยันซ้ำ)**

Run:
```bash
awk '/^enum POStatus /,/^}/' apps/api/prisma/schema.prisma
awk '/^model POItem /,/^}/' apps/api/prisma/schema.prisma | grep -E '^\s+[a-zA-Z]+\s'
```
Expected: `POStatus` = `DRAFT APPROVED ORDERED PENDING PARTIALLY_RECEIVED FULLY_RECEIVED CANCELLED`
(**ไม่มี `PARTIAL`**) · `POItem` มี `brand` `model` `color` `storage` `category` `quantity` `unitPrice` `receivedQty`
และ **มี `deletedAt`** ⇒ cleanup ต้อง soft delete

- [ ] **Step 3: เขียน `stock-ops.seed.ts`** *(บล็อกนี้ sync กับโค้ดที่ commit แล้ว — fix round 2, 2026-08-26)*

> ⚠️ จุดที่ **จงใจ** ต่างจาก probe ตาม marker ปกติ: `countNumber` จองเลขแบบ max+1 โดยไม่กรอง
> `deletedAt` (doctrine เดียวกับ `poNumber` — `@unique` เต็มตาราง; probe ความซ้ำอยู่ที่ `notes`) ·
> `ReorderPoint` ใช้ "กู้คืน" แทนสร้างใหม่ เพราะ `@@unique([brand, model, storage, category,
> branchId])` เป็นแบบเต็มตาราง — แถวที่ถูก soft delete ยังถือ tuple อยู่ (deviation ที่อนุมัติแล้ว;
> แถวที่กู้คืนนับเป็น skipped ไม่ใช่ created) · ใบปรับปรุงสต็อกมีด่าน 4-eyes: `SeedRefs`
> **ไม่การันตี** ว่า `reviewerId ≠ ownerId` จึงต้องเช็คเองก่อนสร้าง (ระบบผู้อนุมัติคนเดียว =
> ข้ามพร้อม note ไม่ใช่ยัดคนเดียวกันสองคอลัมน์)

```ts
import { TEST_DOC_PREFIX, TEST_NOTE_MARKER, testNote } from './_context';
import { nextNumberFrom } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * ไม่โพสต์ JE — seed สถานะไหนก็ได้
 * ใช้เครื่องทดสอบที่โดเมน contracts สร้างไว้ (IMEI ขึ้นต้น TEST-) เท่านั้น
 * ห้ามแตะเครื่องจริง เพราะการโอนย้าย/ปรับสต็อกเปลี่ยน branchId และ status ของเครื่อง
 *
 * ทุกตารางในโดเมนนี้ (StockCount · StockCountItem · StockTransfer · StockAdjustment ·
 * StockAlert · ReorderPoint · BranchReceiving · BranchReceivingItem) **มี deletedAt ทั้งหมด**
 * ⇒ cleanup ใช้ soft delete ล้วน (BranchReceiving เกิดตอนผู้ทดสอบกดยืนยันรับโอน — ไม่มี marker
 * แต่ตามได้จาก FK ตรง transferId)
 */
export const stockOpsSeeder: DomainSeeder = {
  key: 'stock-ops',
  label: 'งานสต็อก (โอนย้าย · นับ · ปรับปรุง · แจ้งเตือน)',
  routes: [
    '/stock',
    '/stock/products',
    '/stock/transfers',
    '/stock/count',
    '/stock/adjustments',
    '/stock/alerts',
    '/stock/workflow',
    '/inventory',
  ],
  markerDoc: `StockCount.countNumber ขึ้นต้น "${TEST_DOC_PREFIX}" · StockTransfer/StockAdjustment.notes และ ReorderPoint/StockAlert.model ขึ้นต้นด้วย marker ทดสอบ`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const products = await ctx.prisma.product.findMany({
      where: { imeiSerial: { startsWith: 'TEST-' }, status: 'IN_STOCK', deletedAt: null },
      select: { id: true },
      take: 2,
    });
    const rows: PlanRow[] = [];
    if (!products.length) {
      rows.push({
        label: 'ข้าม',
        detail: 'ยังไม่มีเครื่องทดสอบ IN_STOCK — รันโดเมน contracts ก่อน',
      });
      return rows;
    }
    rows.push({
      label: `${TEST_DOC_PREFIX}COUNT`,
      detail: 'ใบนับสต็อกที่กำลังนับ (มีรายการรอกระทบยอด)',
    });
    if (ctx.refs.reviewerId === ctx.refs.ownerId)
      rows.push({
        label: 'ข้ามปรับปรุงสต็อก',
        detail: 'ไม่มีผู้อนุมัติคนที่สอง — สร้างรายการ 4-eyes (ผู้ปรับ ≠ ผู้อนุมัติ) ไม่ได้',
      });
    else
      rows.push({
        label: 'ปรับปรุงสต็อก',
        detail: 'เหตุผล CORRECTION 1 รายการ (ผู้ปรับ ≠ ผู้อนุมัติ)',
      });
    rows.push({
      label: 'จุดสั่งซื้อ + แจ้งเตือน',
      detail: 'ReorderPoint 1 + StockAlert 1 (ACTIVE)',
    });
    if (ctx.refs.secondBranchId)
      rows.push({ label: 'โอนย้ายสาขา', detail: 'PENDING 1 เครื่อง (รอสาขาปลายทางรับ)' });
    else rows.push({ label: 'ข้ามโอนย้าย', detail: 'มีสาขาเดียว — โอนย้ายต้องมี 2 สาขา' });
    return rows;
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const products = await ctx.prisma.product.findMany({
      where: { imeiSerial: { startsWith: 'TEST-' }, status: 'IN_STOCK', deletedAt: null },
      select: { id: true, status: true },
      take: 2,
    });
    if (!products.length) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ยังไม่มีเครื่องทดสอบสถานะ IN_STOCK (รันโดเมน contracts ก่อน)',
      );
      return stat;
    }

    // 1) ใบนับสต็อก — ฟิลด์ items ยืนยันจาก prisma/seed.ts (sc-001)
    //    countNumber เป็น @unique เต็มตาราง — จองเลขแบบ max+1 ไม่กรอง deletedAt
    //    (doctrine เดียวกับ nextDocNumber ใน _helpers) และ probe ความซ้ำที่ notes (marker)
    const countPrefix = `${TEST_DOC_PREFIX}COUNT-${ctx.dateStr}-`;
    const countNotes = testNote('ใบนับสต็อกสำหรับทดสอบ');
    const countExists = await ctx.prisma.stockCount.findFirst({
      where: { notes: countNotes, deletedAt: null },
      select: { id: true },
    });
    if (countExists) {
      stat.skipped += 1;
    } else {
      const lastCount = await ctx.prisma.stockCount.findFirst({
        where: { countNumber: { startsWith: countPrefix } },
        orderBy: { countNumber: 'desc' },
        select: { countNumber: true },
      });
      await ctx.prisma.stockCount.create({
        data: {
          countNumber: nextNumberFrom(countPrefix, lastCount?.countNumber ?? null),
          branchId: ctx.refs.branchId,
          countedById: ctx.refs.salespersonId,
          status: 'IN_PROGRESS',
          startedAt: ctx.today,
          notes: countNotes,
          items: { create: products.map((p) => ({ productId: p.id, expectedStatus: p.status })) },
        },
      });
      stat.created += 1;
    }

    // 2) ปรับปรุงสต็อก — CORRECTION ไม่เปลี่ยนสถานะเครื่อง จึงปลอดภัยที่สุดสำหรับข้อมูลเทส
    //    (เหตุผล DAMAGED ต้องแนบรูปหลักฐาน T5-C14; FOUND ต้องมาจากสถานะใน FOUND_POLICY)
    //    4-eyes: ผู้ปรับต้องคนละคนกับผู้อนุมัติ — SeedRefs **ไม่การันตี** ว่า reviewerId ≠ ownerId
    //    (ระบบที่มี OWNER คนเดียวไม่มี BM ได้คนเดียวกันทั้งสองช่อง) จึงต้องเช็คเองก่อนสร้าง
    //    ห้ามลดมาตรฐานด้วยการยัดคนเดียวกันลงทั้งสองคอลัมน์
    if (ctx.refs.reviewerId === ctx.refs.ownerId) {
      stat.notes.push(
        'ข้ามใบปรับปรุงสต็อก — สภาพแวดล้อมนี้ไม่มีผู้อนุมัติคนที่สอง (ผู้ปรับกับผู้อนุมัติจะเป็นคนเดียวกัน) จึงสร้างรายการ 4-eyes ไม่ได้',
      );
    } else {
      const adjNote = testNote('ปรับปรุงสต็อกสำหรับทดสอบ');
      const adjExists = await ctx.prisma.stockAdjustment.findFirst({
        where: { notes: adjNote, deletedAt: null },
        select: { id: true },
      });
      if (adjExists) {
        stat.skipped += 1;
      } else {
        await ctx.prisma.stockAdjustment.create({
          data: {
            productId: products[0].id,
            branchId: ctx.refs.branchId,
            reason: 'CORRECTION',
            previousStatus: products[0].status,
            notes: adjNote,
            adjustedById: ctx.refs.reviewerId,
            approvedById: ctx.refs.ownerId,
          },
        });
        stat.created += 1;
      }
    }

    // 3) จุดสั่งซื้อ + แจ้งเตือน — StockAlert.reorderPointId เป็น FK บังคับ ⇒ สร้าง ReorderPoint นำ
    //    ReorderPoint มี @@unique([brand, model, storage, category, branchId]) แบบเต็มตาราง
    //    (ไม่ใช่ partial) — แถวที่ cleanup soft delete ไปแล้วยังถือ tuple อยู่ ⇒ probe โดยไม่กรอง
    //    deletedAt แล้ว "กู้คืน" แทนการสร้างซ้ำ ไม่งั้น seed หลัง cleanup ชน P2002
    const alertModel = `${TEST_DOC_PREFIX}รุ่นแจ้งเตือน`;
    const rpAny = await ctx.prisma.reorderPoint.findFirst({
      where: { model: alertModel },
      select: { id: true, deletedAt: true },
    });
    if (rpAny && !rpAny.deletedAt) {
      stat.skipped += 1;
    } else if (rpAny) {
      await ctx.prisma.reorderPoint.update({ where: { id: rpAny.id }, data: { deletedAt: null } });
      const restored = await ctx.prisma.stockAlert.updateMany({
        where: { reorderPointId: rpAny.id },
        data: { deletedAt: null },
      });
      if (restored.count === 0) {
        await ctx.prisma.stockAlert.create({
          data: {
            reorderPointId: rpAny.id,
            brand: 'ทดสอบระบบ',
            model: alertModel,
            storage: '128GB',
            category: 'PHONE_NEW',
            branchId: ctx.refs.branchId,
            currentStock: 1,
            minQuantity: 2,
            reorderQuantity: 5,
            status: 'ACTIVE',
          },
        });
        stat.created += 1; // แจ้งเตือนใบนี้เป็นแถวใหม่จริง — ไม่มีแถวเดิมให้กู้
      }
      // แถวที่ "กู้คืน" ไม่ใช่แถวที่สร้างใหม่ — นับเป็น skipped พร้อมบอกจำนวนตรง ๆ
      stat.skipped += 1 + restored.count;
      stat.notes.push(
        `กู้คืนจุดสั่งซื้อ 1 แถว + แจ้งเตือน ${restored.count} แถวที่เคยถูกล้าง ` +
          '(unique constraint กันสร้างแถวใหม่ซ้ำ — แถวกู้คืนนับเป็น skipped ไม่ใช่ created)',
      );
    } else {
      const rp = await ctx.prisma.reorderPoint.create({
        data: {
          brand: 'ทดสอบระบบ',
          model: alertModel,
          storage: '128GB',
          category: 'PHONE_NEW',
          branchId: ctx.refs.branchId,
          minQuantity: 2,
          reorderQuantity: 5,
        },
        select: { id: true },
      });
      await ctx.prisma.stockAlert.create({
        data: {
          reorderPointId: rp.id,
          brand: 'ทดสอบระบบ',
          model: alertModel,
          storage: '128GB',
          category: 'PHONE_NEW',
          branchId: ctx.refs.branchId,
          currentStock: 1,
          minQuantity: 2,
          reorderQuantity: 5,
          status: 'ACTIVE',
        },
      });
      stat.created += 2;
    }

    // 4) โอนย้ายสาขา — ต้องมีสาขาที่สอง
    if (!ctx.refs.secondBranchId) {
      stat.notes.push('ข้ามการโอนย้ายสาขา — ระบบมีสาขาเดียว');
    } else {
      const trNote = testNote('โอนย้ายสาขาสำหรับทดสอบ — รอสาขาปลายทางรับ');
      const exists = await ctx.prisma.stockTransfer.findFirst({
        where: { notes: trNote, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
      } else {
        await ctx.prisma.stockTransfer.create({
          data: {
            productId: products[0].id,
            fromBranchId: ctx.refs.branchId,
            toBranchId: ctx.refs.secondBranchId,
            transferredBy: ctx.refs.reviewerId,
            status: 'PENDING',
            notes: trNote,
          },
        });
        stat.created += 1;
      }
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const alertModel = `${TEST_DOC_PREFIX}รุ่นแจ้งเตือน`;
    const [counts, transfers, adjustments, rps] = await Promise.all([
      ctx.prisma.stockCount.findMany({
        where: { countNumber: { startsWith: `${TEST_DOC_PREFIX}COUNT-` }, deletedAt: null },
        select: { id: true, countNumber: true },
      }),
      ctx.prisma.stockTransfer.findMany({
        where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
        select: { id: true },
      }),
      ctx.prisma.stockAdjustment.findMany({
        where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
        select: { id: true },
      }),
      ctx.prisma.reorderPoint.findMany({
        where: { model: alertModel, deletedAt: null },
        select: { id: true },
      }),
    ]);
    const alerts = rps.length
      ? await ctx.prisma.stockAlert.findMany({
          where: { reorderPointId: { in: rps.map((r) => r.id) }, deletedAt: null },
          select: { id: true },
        })
      : [];
    // ใบตรวจรับสาขาที่เกิดจากการกดยืนยันรับโอนของทดสอบ (branch-receiving.service.ts)
    // ไม่มี marker ติดตัว — ตามได้จาก FK ตรง BranchReceiving.transferId (@unique) เท่านั้น
    // ถ้าไม่กวาดตรงนี้จะเหลือใบตรวจรับค้างชี้ไปที่ใบโอนที่ถูกลบไปแล้ว
    const receivings = transfers.length
      ? await ctx.prisma.branchReceiving.findMany({
          where: { transferId: { in: transfers.map((t) => t.id) }, deletedAt: null },
          select: { id: true, transferId: true },
        })
      : [];
    const receivingItems = receivings.length
      ? await ctx.prisma.branchReceivingItem.findMany({
          where: { receivingId: { in: receivings.map((r) => r.id) }, deletedAt: null },
          select: { id: true },
        })
      : [];
    for (const c of counts) console.log(`     ${c.countNumber}`);
    // ใบตรวจรับสาขาไม่มี marker ติดตัว — บรรทัดนี้คือโอกาสเดียวที่ผู้สั่งล้าง (ทั้ง dry-run
    // และของจริง) จะเห็นว่ากำลังกวาดใบไหน (pattern เดียวกับเครื่องจาก PO ใน suppliers-po)
    for (const r of receivings)
      console.log(`     ใบตรวจรับสาขา ${r.id} (ของใบโอนย้าย ${r.transferId})`);

    if (!dryRun) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        if (counts.length) {
          await tx.stockCountItem.updateMany({
            where: { stockCountId: { in: counts.map((c) => c.id) } },
            data: { deletedAt: now },
          });
          await tx.stockCount.updateMany({
            where: { id: { in: counts.map((c) => c.id) } },
            data: { deletedAt: now },
          });
        }
        // ลูก → แม่ → ใบโอน (soft delete ทั้งหมด — ไม่มี FK abort แต่คงลำดับให้อ่านตรงกับโครงสร้าง)
        if (receivingItems.length)
          await tx.branchReceivingItem.updateMany({
            where: { id: { in: receivingItems.map((i) => i.id) } },
            data: { deletedAt: now },
          });
        if (receivings.length)
          await tx.branchReceiving.updateMany({
            where: { id: { in: receivings.map((r) => r.id) } },
            data: { deletedAt: now },
          });
        if (transfers.length)
          await tx.stockTransfer.updateMany({
            where: { id: { in: transfers.map((t) => t.id) } },
            data: { deletedAt: now },
          });
        if (adjustments.length)
          await tx.stockAdjustment.updateMany({
            where: { id: { in: adjustments.map((a) => a.id) } },
            data: { deletedAt: now },
          });
        // แจ้งเตือนต้องออกก่อนจุดสั่งซื้อ — reorderPointId เป็น FK บังคับ
        if (alerts.length)
          await tx.stockAlert.updateMany({
            where: { id: { in: alerts.map((a) => a.id) } },
            data: { deletedAt: now },
          });
        if (rps.length)
          await tx.reorderPoint.updateMany({
            where: { id: { in: rps.map((r) => r.id) } },
            data: { deletedAt: now },
          });
      });
    }
    return {
      removed: {
        ใบนับสต็อก: counts.length,
        ใบโอนย้ายสาขา: transfers.length,
        ใบตรวจรับสาขา: receivings.length,
        รายการตรวจรับสาขา: receivingItems.length,
        ใบปรับปรุงสต็อก: adjustments.length,
        แจ้งเตือนสต็อก: alerts.length,
        จุดสั่งซื้อ: rps.length,
      },
      warnings: [],
    };
  },
};
```

- [ ] **Step 4: ยืนยันว่าทุกตารางในโดเมนนี้เป็น soft delete จริง**

Run:
```bash
for m in StockCount StockCountItem StockTransfer StockAdjustment StockAlert ReorderPoint BranchReceiving BranchReceivingItem; do
  printf "%-18s " "$m"
  awk "/^model $m /,/^}/" apps/api/prisma/schema.prisma | grep -q deletedAt && echo soft || echo hard
done
```
Expected (ตรวจแล้วตอนเขียนแผน): **soft ทั้ง 8 ตัว** — ถ้าตัวไหนขึ้น hard ให้เปลี่ยนบรรทัดนั้นใน `cleanup` เป็น `deleteMany`

- [ ] **Step 5: เพิ่มเข้า registry (ต่อจาก `equitySeeder`)**

```ts
export const ALL_DOMAINS: DomainSeeder[] = [
  contractsSeeder, expensesSeeder, payrollSeeder, otherIncomeSeeder, assetsSeeder, equitySeeder,
  suppliersPoSeeder, stockOpsSeeder, todosSeeder,
];
```

- [ ] **Step 6: ตรวจ TypeScript + round-trip**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=contracts,suppliers-po,stock-ops npm --prefix apps/api run seed:test-pack
EXPECTED_DB_NAME=$DB DOMAINS=suppliers-po,stock-ops npm --prefix apps/api run cleanup:test-pack
```
Expected: cleanup dry-run แสดงคำเตือน KEEP_TABLES ของ suppliers

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนซัพพลายเออร์/ใบสั่งซื้อ + งานสต็อก"
```

---

### Task 8: โดเมน `bookings` + `online-orders` + `applications`

**Files:**
- Create: `apps/api/src/cli/test-pack/bookings.seed.ts`
- Create: `apps/api/src/cli/test-pack/online-orders.seed.ts`
- Create: `apps/api/src/cli/test-pack/applications.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `TEST_DOC_PREFIX` · `testNote` · `TEST_NOTE_MARKER` (Task 1)
- Produces: `bookingsSeeder` · `onlineOrdersSeeder` · `applicationsSeeder` (ทั้งหมดเป็น `DomainSeeder`)

**เพดานสถานะที่ห้ามข้าม (R2):**
- `Booking` → `PENDING_DEPOSIT` เท่านั้น (`PAID` โพสต์ `ShopBookingDepositTemplate` ⇒ `S21-2002`)
- `OnlineOrder` → `PENDING_PAYMENT` / `PENDING_BANK_REVIEW` (`PAID` เดินต่อไปสร้าง `Sale` ซึ่งโพสต์ JE)
- `OnlineInstallmentApplication` → สถานะไหนก็ได้ (ไม่โพสต์ JE)

- [ ] **Step 1: เขียน `bookings.seed.ts`**

```ts
import { TEST_DOC_PREFIX, TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const DAY = 24 * 60 * 60 * 1000;

/** R2 — PENDING_DEPOSIT เท่านั้น · ใบที่สองเลยกำหนดเพื่อทดสอบ cron ตัดใบจองหมดอายุ */
const ROWS: Array<{ key: string; deposit: number; total: number; expiresInDays: number; note: string }> = [
  { key: 'normal', deposit: 2000, total: 25900, expiresInDays: 5, note: 'ใบจองปกติ รอรับมัดจำ' },
  { key: 'expired', deposit: 1000, total: 9900, expiresInDays: -3, note: 'ใบจองเลยวันหมดอายุ — รอ cron ตัดเป็น EXPIRED' },
];

export const bookingsSeeder: DomainSeeder = {
  key: 'bookings',
  label: 'ใบจอง',
  routes: ['/bookings'],
  markerDoc: `Booking.bookingNumber ขึ้นต้น "${TEST_DOC_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `${TEST_DOC_PREFIX}BK ${r.key}`,
      detail: `PENDING_DEPOSIT · มัดจำ ฿${r.deposit.toLocaleString('th-TH')} / รวม ฿${r.total.toLocaleString('th-TH')} · ${r.note}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({
      where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }

    for (const r of ROWS) {
      const bookingNumber = `${TEST_DOC_PREFIX}BK-${ctx.dateStr}-${r.key}`;
      const exists = await ctx.prisma.booking.findFirst({ where: { bookingNumber, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.booking.create({
        data: {
          bookingNumber,
          customerId: customer.id,
          branchId: ctx.refs.branchId,
          status: 'PENDING_DEPOSIT',
          depositAmount: r.deposit,
          totalAmount: r.total,
          expireDate: new Date(ctx.today.getTime() + r.expiresInDays * DAY),
          notes: testNote(r.note),
          createdById: ctx.refs.salespersonId,
          items: { create: [{ description: 'ทดสอบระบบ สินค้าที่จอง', unitPrice: r.total, amount: r.total }] },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.booking.findMany({
      where: { bookingNumber: { startsWith: `${TEST_DOC_PREFIX}BK-` }, deletedAt: null },
      select: { id: true, bookingNumber: true, convertedToSaleId: true },
    });
    for (const r of rows) console.log(`     ${r.bookingNumber}${r.convertedToSaleId ? ' ⚠️ แปลงเป็นใบขายแล้ว' : ''}`);

    // JE ของใบจอง (รับมัดจำ / ริบ / คืน) stamp metadata.bookingId — ไม่มี FK บนตาราง
    const jes = rows.length
      ? await ctx.prisma.journalEntry.findMany({
          where: { OR: rows.map((r) => ({ metadata: { path: ['bookingId'], equals: r.id } as never })) },
          select: { id: true },
        })
      : [];

    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        if (jes.length) {
          const jeIds = jes.map((j) => j.id);
          await tx.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
          await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
        }
        await tx.bookingItem.deleteMany({ where: { bookingId: { in: rows.map((r) => r.id) } } });
        await tx.booking.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date() } });
      });
    }
    return {
      removed: { 'ใบจอง': rows.length, 'รายการบัญชีมัดจำใบจอง (ลบถาวร)': jes.length },
      warnings: rows.some((r) => r.convertedToSaleId)
        ? ['มีใบจองที่ถูกแปลงเป็นใบขายแล้ว — ยกเลิกใบขายนั้นก่อนล้าง ไม่งั้นใบขายจะชี้ไปใบจองที่ถูกลบ']
        : [],
    };
  },
};
```

- [ ] **Step 2: เขียน `online-orders.seed.ts`**

```ts
import { Prisma } from '@prisma/client';
import { TEST_DOC_PREFIX, TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const DAY = 24 * 60 * 60 * 1000;

/** R2 — หยุดก่อน PAID เพราะ PAID เดินต่อไปสร้าง Sale ซึ่งโพสต์ JE */
const ROWS: Array<{ key: string; status: 'PENDING_PAYMENT' | 'PENDING_BANK_REVIEW'; shipping: 'BRANCH_PICKUP' | 'KERRY'; channel: 'PROMPTPAY_QR' | 'BANK_TRANSFER'; note: string }> = [
  { key: 'await-pay', status: 'PENDING_PAYMENT', shipping: 'BRANCH_PICKUP', channel: 'PROMPTPAY_QR', note: 'รอลูกค้าชำระ (รับที่สาขา)' },
  { key: 'slip-review', status: 'PENDING_BANK_REVIEW', shipping: 'KERRY', channel: 'BANK_TRANSFER', note: 'แนบสลิปแล้ว รอตรวจสลิป — ใช้ทดสอบ /slip-review' },
];

export const onlineOrdersSeeder: DomainSeeder = {
  key: 'online-orders',
  label: 'ออเดอร์ออนไลน์ + การจองเครื่อง',
  routes: ['/online-orders', '/product-holds', '/slip-review'],
  markerDoc: `OnlineOrder.orderNumber ขึ้นต้น "${TEST_DOC_PREFIX}" · ProductReservation.sessionId ขึ้นต้น "${TEST_DOC_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({ label: `${TEST_DOC_PREFIX}ORD ${r.key}`, detail: `${r.status} · ${r.shipping} · ${r.channel} · ${r.note}` }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const [customer, products] = await Promise.all([
      ctx.prisma.customer.findFirst({ where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null }, select: { id: true } }),
      ctx.prisma.product.findMany({ where: { imeiSerial: { startsWith: 'TEST-' }, status: 'IN_STOCK', deletedAt: null }, select: { id: true, cashPrice: true }, take: 2 }),
    ]);
    if (!customer || products.length < ROWS.length) {
      stat.notes.push(`ข้ามทั้งโดเมน — ต้องมีลูกค้าทดสอบ 1 คน + เครื่องทดสอบ IN_STOCK ${ROWS.length} เครื่อง (รันโดเมน contracts ก่อน)`);
      return stat;
    }

    for (const [i, r] of ROWS.entries()) {
      const orderNumber = `${TEST_DOC_PREFIX}ORD-${ctx.dateStr}-${r.key}`;
      const exists = await ctx.prisma.onlineOrder.findFirst({ where: { orderNumber }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // ส่ง Decimal ผ่านตรง ๆ — Prisma รับ Decimal ให้คอลัมน์ Decimal อยู่แล้ว
      // ห้ามแปลงเป็น number (Global Constraints: Money = Decimal)
      const price = products[i].cashPrice ?? new Prisma.Decimal(0);
      const reservation = await ctx.prisma.productReservation.create({
        data: {
          productId: products[i].id,
          customerId: customer.id,
          sessionId: `${TEST_DOC_PREFIX}SESSION-${ctx.dateStr}-${r.key}`,
          expiresAt: new Date(ctx.today.getTime() + 2 * DAY),
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      await ctx.prisma.onlineOrder.create({
        data: {
          orderNumber,
          customerId: customer.id,
          productId: products[i].id,
          reservationId: reservation.id,
          productPrice: price,
          totalAmount: price,
          shippingMethod: r.shipping,
          paymentChannel: r.channel,
          status: r.status,
          ...(r.status === 'PENDING_BANK_REVIEW' ? { bankSlipUrl: 'https://example.invalid/test-slip.jpg' } : {}),
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const orders = await ctx.prisma.onlineOrder.findMany({
      where: { orderNumber: { startsWith: `${TEST_DOC_PREFIX}ORD-` }, deletedAt: null },
      select: { id: true, orderNumber: true, reservationId: true },
    });
    const reservations = await ctx.prisma.productReservation.findMany({
      where: { sessionId: { startsWith: `${TEST_DOC_PREFIX}SESSION-` } },
      select: { id: true },
    });
    for (const o of orders) console.log(`     ${o.orderNumber}`);

    if (!dryRun && (orders.length || reservations.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        // OnlineOrder มี deletedAt ⇒ soft delete
        if (orders.length) {
          await tx.onlineOrder.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { deletedAt: new Date() } });
        }
        // ProductReservation ไม่มี deletedAt ⇒ hard delete — และ **ต้องเอาออกจริง**
        // ไม่ใช่แค่ซ่อน เพราะแถวที่ยัง ACTIVE จะทำให้ assertProductNotHeld ชั้น 3
        // บล็อกการลบ/แก้ IMEI/คืนเครื่องเข้าคลังของเครื่องนั้นตลอดไป
        if (reservations.length) {
          await tx.productReservation.deleteMany({ where: { id: { in: reservations.map((r) => r.id) } } });
        }
      });
    }
    return { removed: { 'ออเดอร์ออนไลน์': orders.length, 'การจองเครื่อง': reservations.length }, warnings: [] };
  },
};
```

- [ ] **Step 3: เขียน `applications.seed.ts`**

```ts
import { TEST_DOC_PREFIX, testNote } from './_context';
import { TEST_CUSTOMER_ADDRESS } from '../seed-test-contracts.cli';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** ไม่โพสต์ JE — seed สถานะไหนก็ได้ */
const ROWS: Array<{
  key: string;
  fullName: string;
  down: number;
  months: number;
  monthly: number;
}> = [
  { key: 'new', fullName: 'ทดสอบระบบ ผู้สมัครผ่อน 1', down: 3000, months: 10, monthly: 2590 },
  { key: 'review', fullName: 'ทดสอบระบบ ผู้สมัครผ่อน 2', down: 5000, months: 12, monthly: 1890 },
];

/**
 * marker ของใบตรวจเครดิตทดสอบ — CreditCheck ไม่มีคอลัมน์ unique ที่ seeder ตั้งเอง
 * (contractId เป็น @unique แต่จงใจปล่อย null) จึงใช้ข้อความใน reviewNotes เป็นตัวชี้
 * ทั้ง probe กันซ้ำและ cleanup (precedent เดียวกับ suppliers-po ที่ probe ด้วย notes)
 */
const CC_REVIEW_NOTE = testNote('ใบตรวจเครดิตรอตรวจ — สร้างโดยชุดข้อมูลทดสอบ');

export const applicationsSeeder: DomainSeeder = {
  key: 'applications',
  label: 'ใบสมัครผ่อนออนไลน์ + ตรวจเครดิต',
  routes: ['/installment-applications', '/customer-intake'],
  markerDoc: `OnlineInstallmentApplication.applicationNumber ขึ้นต้น "${TEST_DOC_PREFIX}" · CreditCheck.reviewNotes = "${CC_REVIEW_NOTE}"`,

  async plan(): Promise<PlanRow[]> {
    return [
      ...ROWS.map((r) => ({
        label: `${TEST_DOC_PREFIX}APP ${r.key}`,
        detail: `${r.fullName} · ดาวน์ ฿${r.down.toLocaleString('th-TH')} · ${r.months} งวด × ฿${r.monthly.toLocaleString('th-TH')}`,
      })),
      {
        label: 'CreditCheck pending',
        detail: 'ใบตรวจเครดิต PENDING ×1 — แนบลูกค้าทดสอบ ไม่ผูกสัญญา (contractId เป็น @unique)',
      },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const products = await ctx.prisma.product.findMany({
      where: { imeiSerial: { startsWith: 'TEST-' }, deletedAt: null },
      select: { id: true },
      take: 1,
    });
    if (!products.length) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีเครื่องทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    for (const [i, r] of ROWS.entries()) {
      const applicationNumber = `${TEST_DOC_PREFIX}APP-${ctx.dateStr}-${r.key}`;
      // applicationNumber เป็น @unique เต็มตาราง — probe โดยไม่กรอง deletedAt แล้วกู้คืน
      // แถวที่เคยถูกล้าง (restore-instead-of-recreate) กัน P2002 หลัง seed → cleanup → seed
      const exists = await ctx.prisma.onlineInstallmentApplication.findFirst({
        where: { applicationNumber },
        select: { id: true, deletedAt: true },
      });
      if (exists && !exists.deletedAt) {
        stat.skipped += 1;
        continue;
      }
      if (exists) {
        // กู้คืนแล้ว reset กลับสภาพเริ่มต้นที่ seed ไว้ — tester อาจทิ้งสถานะ APPROVED +
        // contractId ที่ชี้สัญญาซึ่งโดเมน contracts ล้างไปแล้ว (ลิงก์ตาย); เคลียร์ผลตรวจ
        // ทั้งชุดให้ใบสมัครที่กู้คืนมาสดจริงเหมือนแถวที่เพิ่งสร้าง
        await ctx.prisma.onlineInstallmentApplication.update({
          where: { id: exists.id },
          data: {
            deletedAt: null,
            status: 'SUBMITTED',
            contractId: null,
            scheduledAt: null,
            reviewedAt: null,
            reviewedById: null,
            rejectReason: null,
          },
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืน ${applicationNumber} ที่เคยถูกล้าง (reset เป็น SUBMITTED · แถวกู้คืนนับเป็น skipped ไม่ใช่ created)`,
        );
        continue;
      }
      await ctx.prisma.onlineInstallmentApplication.create({
        data: {
          applicationNumber,
          productId: products[0].id,
          fullName: r.fullName,
          phone: `0891000${String(i + 1).padStart(3, '0')}`,
          nationalId: `0000000000${String(i + 1).padStart(3, '0')}`,
          proposedDownPayment: r.down,
          proposedTotalMonths: r.months,
          proposedMonthlyPayment: r.monthly,
        },
      });
      stat.created += 1;
    }

    // CreditCheck ×1 สถานะ PENDING (aiScore/aiSummary ปล่อย null แบบ cc-007 ใน dev seed) —
    // ให้หน้า /customer-intake มีรายการที่ยังมีงานต่อ. contractId จงใจปล่อย null:
    // คอลัมน์เป็น @unique — ผูกสัญญาทดสอบ = เผา slot ตรวจเครดิตของสัญญานั้น + เสี่ยง P2002
    const testCustomer = await ctx.prisma.customer.findFirst({
      where: { addressCurrent: TEST_CUSTOMER_ADDRESS, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!testCustomer) {
      stat.notes.push('ข้าม CreditCheck — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    const ccExists = await ctx.prisma.creditCheck.findFirst({
      where: { reviewNotes: CC_REVIEW_NOTE, deletedAt: null },
      select: { id: true },
    });
    if (ccExists) {
      stat.skipped += 1;
    } else {
      await ctx.prisma.creditCheck.create({
        data: {
          customerId: testCustomer.id,
          status: 'PENDING',
          reviewNotes: CC_REVIEW_NOTE,
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.onlineInstallmentApplication.findMany({
      where: { applicationNumber: { startsWith: `${TEST_DOC_PREFIX}APP-` }, deletedAt: null },
      select: { id: true, applicationNumber: true },
    });
    for (const r of rows) console.log(`     ${r.applicationNumber}`);
    if (!dryRun && rows.length) {
      // มี deletedAt ⇒ soft delete
      await ctx.prisma.onlineInstallmentApplication.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    const ccRows = await ctx.prisma.creditCheck.findMany({
      where: { reviewNotes: CC_REVIEW_NOTE, deletedAt: null },
      select: { id: true },
    });
    if (!dryRun && ccRows.length) {
      // CreditCheck มี deletedAt ⇒ soft delete
      await ctx.prisma.creditCheck.updateMany({
        where: { id: { in: ccRows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { ใบสมัครผ่อนออนไลน์: rows.length, ใบตรวจเครดิต: ccRows.length },
      warnings: [],
    };
  },
};
```

- [ ] **Step 4: ยืนยันฟิลด์ที่อาจไม่ตรง**

Run:
```bash
awk '/^model OnlineInstallmentApplication /,/^}/' apps/api/prisma/schema.prisma | grep -E 'nationalId|status|deletedAt'
awk '/^model BookingItem /,/^}/' apps/api/prisma/schema.prisma | grep -E '^\s+[a-zA-Z]+\s'
awk '/^model OnlineOrder /,/^}/' apps/api/prisma/schema.prisma | grep deletedAt
```
Expected: ถ้าโมเดลไหนมี `deletedAt` ให้เปลี่ยน cleanup จาก hard delete เป็น soft delete
`BookingItem` ต้องมี `description` `unitPrice` `amount` — ถ้ามี `productId` บังคับด้วย ให้ผูกเครื่องทดสอบเข้าไป

- [ ] **Step 5: เพิ่มเข้า registry (ต่อจาก `stockOpsSeeder`)**

```ts
  suppliersPoSeeder, stockOpsSeeder, bookingsSeeder, onlineOrdersSeeder, applicationsSeeder, todosSeeder,
```

- [ ] **Step 6: ตรวจ TypeScript + round-trip**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=contracts,bookings,online-orders,applications npm --prefix apps/api run seed:test-pack
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=bookings,online-orders,applications npm --prefix apps/api run cleanup:test-pack
```
Expected: สร้าง 6 แถว (2 ใบจอง + 2 ออเดอร์ + 2 ใบสมัคร) + 2 การจองเครื่อง แล้วลบครบ

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนใบจอง + ออเดอร์ออนไลน์ + ใบสมัครผ่อน (หยุดก่อนเงินขยับ)"
```

---

### Task 9: โดเมน `repair` + `inspections` + `device-swap`

**Files:**
- Create: `apps/api/src/cli/test-pack/repair.seed.ts`
- Create: `apps/api/src/cli/test-pack/inspections.seed.ts`
- Create: `apps/api/src/cli/test-pack/device-swap.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `TEST_DOC_PREFIX` · `testNote` · `TEST_NOTE_MARKER` (Task 1)
- Produces: `repairSeeder` · `inspectionsSeeder` · `deviceSwapSeeder` (ทั้งหมดเป็น `DomainSeeder`)

**เพดาน:** `RepairTicket` ปิดที่ `READY_FOR_PICKUP` (การปิดใบ `CLOSED` สร้าง `ExpenseDocument`/`OtherIncome` อัตโนมัติ
— ให้ผู้ทดสอบกดเอง) · `ContractExchangeRequest` = รออนุมัติเท่านั้น (finalize โพสต์ JE ทั้งชุด A.1-A.5)
**Prerequisite:** `Inspection.templateId` บังคับ ⇒ ถ้าไม่มี `InspectionTemplate` ให้ข้ามพร้อม note

- [ ] **Step 1: เขียน `repair.seed.ts`**

```ts
import { TEST_DOC_PREFIX, TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** R2 — ปิดที่ READY_FOR_PICKUP · CLOSED สร้างเอกสารบัญชีอัตโนมัติ ให้คนกดเอง */
const ROWS: Array<{ key: string; status: 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_PICKUP'; payer: 'SHOP' | 'CUSTOMER'; warranty: 'IN_SHOP_WARRANTY' | 'OUT_OF_WARRANTY' | 'WALK_IN'; defect: string; cost: number }> = [
  { key: 'open', status: 'OPEN', payer: 'SHOP', warranty: 'IN_SHOP_WARRANTY', defect: 'จอไม่ติด — รับเครื่องเข้าระบบแล้ว', cost: 0 },
  { key: 'inprogress', status: 'IN_PROGRESS', payer: 'CUSTOMER', warranty: 'OUT_OF_WARRANTY', defect: 'แบตเสื่อม — ส่งศูนย์ซ่อมแล้ว', cost: 1200 },
  { key: 'ready', status: 'READY_FOR_PICKUP', payer: 'SHOP', warranty: 'WALK_IN', defect: 'เปลี่ยนกระจกหลัง — ซ่อมเสร็จรอลูกค้ามารับ', cost: 850 },
];

export const repairSeeder: DomainSeeder = {
  key: 'repair',
  label: 'ใบซ่อม / ประกัน',
  routes: ['/insurance', '/insurance/:id', '/insurance/new', '/insurance/warranty-check', '/insurance/exchange-requests'],
  markerDoc: `RepairTicket.ticketNumber ขึ้นต้น "${TEST_DOC_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({ label: `${TEST_DOC_PREFIX}RT ${r.key}`, detail: `${r.status} · ผู้จ่าย ${r.payer} · ${r.warranty} · ${r.defect}` }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({
      where: { name: { startsWith: 'ทดสอบ' }, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    const repairSupplier = await ctx.prisma.supplier.findFirst({
      where: { isRepairCenter: true, deletedAt: null },
      select: { id: true },
    });

    for (const r of ROWS) {
      const ticketNumber = `${TEST_DOC_PREFIX}RT-${ctx.dateStr}-${r.key}`;
      const exists = await ctx.prisma.repairTicket.findFirst({ where: { ticketNumber }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.repairTicket.create({
        data: {
          ticketNumber,
          status: r.status,
          customerId: customer.id,
          deviceBrand: 'ทดสอบระบบ',
          deviceModel: 'รุ่นทดสอบ',
          deviceImei: `TEST-RT-${r.key}`,
          defectDescription: r.defect,
          warrantyStatus: r.warranty,
          repairSupplierId: repairSupplier?.id ?? null,
          estimatedCost: r.cost || null,
          actualCost: r.status === 'READY_FOR_PICKUP' ? r.cost : null,
          payer: r.payer,
          notes: testNote('ใบซ่อมสำหรับทดสอบ'),
          branchId: ctx.refs.branchId,
          createdById: ctx.refs.salespersonId,
          ...(r.status !== 'OPEN' ? { sentToRepairAt: ctx.today } : {}),
          ...(r.status === 'READY_FOR_PICKUP' ? { repairedAt: ctx.today } : {}),
        },
      });
      stat.created += 1;
    }
    if (!repairSupplier) stat.notes.push('ไม่พบซัพพลายเออร์ที่เป็นศูนย์ซ่อม — ใบซ่อมถูกสร้างโดยไม่ผูกศูนย์ซ่อม (รันโดเมน suppliers-po ก่อนถ้าต้องการ)');
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.repairTicket.findMany({
      where: { ticketNumber: { startsWith: `${TEST_DOC_PREFIX}RT-` }, deletedAt: null },
      select: {
        id: true,
        ticketNumber: true,
        expenseDocumentId: true,
        otherIncomeId: true,
        replacementContractId: true,
      },
    });
    // log สถานะเกิดตอนผู้ทดสอบกดเปลี่ยนสถานะ (repair-ticket-lifecycle.service.ts) — ไม่มี marker
    // ติดตัว ตามได้จาก FK ticketId เท่านั้น และไม่มี deletedAt (append-only log) ⇒ hard delete
    const logs = rows.length
      ? await ctx.prisma.repairStatusLog.findMany({
          where: { ticketId: { in: rows.map((r) => r.id) } },
          select: { id: true, ticketId: true },
        })
      : [];
    // ปิดใบซ่อม (CLOSED) สร้าง ExpenseDocument (payer SHOP) / OtherIncome (payer CUSTOMER)
    // โดยไม่มี marker ทดสอบ — โดเมน expenses/other-income กรองด้วย note marker จึงมองไม่เห็น
    // ⇒ ตามจาก FK ตรงบนใบซ่อม (expenseDocumentId/otherIncomeId — @unique ทั้งคู่) แล้วกวาด
    // ด้วยลำดับเดียวกับสองโดเมนนั้นเป๊ะ (JE hard-delete ก่อน แล้วค่อย soft-delete เอกสาร)
    const expenseIds = rows.map((r) => r.expenseDocumentId).filter((x): x is string => !!x);
    const otherIncomeIds = rows.map((r) => r.otherIncomeId).filter((x): x is string => !!x);
    const expenseDocs = expenseIds.length
      ? await ctx.prisma.expenseDocument.findMany({
          where: { id: { in: expenseIds }, deletedAt: null },
          select: { id: true, number: true, journalEntryId: true },
        })
      : [];
    const oiMarked = otherIncomeIds.length
      ? await ctx.prisma.otherIncome.findMany({
          where: { id: { in: otherIncomeIds }, deletedAt: null },
          select: { id: true, docNumber: true, journalEntryId: true },
        })
      : [];
    // mirror other-income.seed.ts: ใบกลับรายการ (-R) เขียนทับ customerNote ⇒ ตามด้วย FK reversesId
    const oiReversals = oiMarked.length
      ? await ctx.prisma.otherIncome.findMany({
          where: { reversesId: { in: oiMarked.map((d) => d.id) }, deletedAt: null },
          select: { id: true, docNumber: true, journalEntryId: true },
        })
      : [];
    const oiDocs = [...oiMarked, ...oiReversals];
    const expenseJeIds = expenseDocs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    const oiJeIds = oiDocs.map((d) => d.journalEntryId).filter((x): x is string => !!x);
    for (const r of rows) {
      const logCount = logs.filter((l) => l.ticketId === r.id).length;
      const extra = [
        r.expenseDocumentId ? 'มีใบค่าใช้จ่าย (กวาดด้วย)' : '',
        r.otherIncomeId ? 'มีใบรายได้อื่น (กวาดด้วย)' : '',
        r.replacementContractId ? 'มีสัญญาทดแทน' : '',
        logCount ? `log สถานะ ${logCount} รายการ (ลบถาวร)` : '',
      ]
        .filter(Boolean)
        .join(' + ');
      console.log(`     ${r.ticketNumber}${extra ? ` (${extra})` : ''}`);
    }
    // เอกสารพวกนี้ไม่มี marker — บรรทัดนี้คือช่องทางเดียวที่ผู้รันเห็นเลขเอกสารก่อนมันถูกกวาด
    // ⇒ พิมพ์เสมอทั้ง dry-run และ live
    for (const d of expenseDocs)
      console.log(`     ใบค่าใช้จ่ายจากใบซ่อม ${d.number}${d.journalEntryId ? ' (มี JE)' : ''}`);
    for (const d of oiDocs)
      console.log(`     ใบรายได้อื่นจากใบซ่อม ${d.docNumber}${d.journalEntryId ? ' (มี JE)' : ''}`);
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        // FK expenseDocumentId/otherIncomeId อยู่ฝั่ง repair_tickets (ON DELETE SET NULL) และ
        // เอกสารถูก soft delete เท่านั้น ⇒ constraint ไม่มีวันทำงาน — คง FK บนใบซ่อมไว้เป็น
        // ร่องรอยตรวจย้อน (ใบซ่อมเองก็ถูก soft delete ในรอบเดียวกัน)
        if (expenseDocs.length) {
          if (expenseJeIds.length) {
            await tx.journalPostAuditLog.deleteMany({
              where: { journalEntryId: { in: expenseJeIds } },
            });
            await tx.expenseDocument.updateMany({
              where: { id: { in: expenseDocs.map((d) => d.id) } },
              data: { journalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: expenseJeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: expenseJeIds } } });
          }
          await tx.expenseDocument.updateMany({
            where: { id: { in: expenseDocs.map((d) => d.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (oiDocs.length) {
          if (oiJeIds.length) {
            await tx.journalPostAuditLog.deleteMany({
              where: { journalEntryId: { in: oiJeIds } },
            });
            await tx.otherIncome.updateMany({
              where: { id: { in: oiDocs.map((d) => d.id) } },
              data: { journalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: oiJeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: oiJeIds } } });
          }
          await tx.otherIncome.updateMany({
            where: { id: { in: oiDocs.map((d) => d.id) } },
            data: { deletedAt: new Date() },
          });
        }
        // RepairStatusLog ไม่มี deletedAt (เป็น log) ⇒ hard · RepairTicket มี ⇒ soft
        await tx.repairStatusLog.deleteMany({ where: { ticketId: { in: rows.map((r) => r.id) } } });
        await tx.repairTicket.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: new Date() },
        });
      });
    }
    return {
      removed: {
        ใบซ่อม: rows.length,
        'log สถานะใบซ่อม (ลบถาวร)': logs.length,
        'ใบค่าใช้จ่ายจากใบซ่อม (ไม่มี marker — ตามจาก FK)': expenseDocs.length,
        'ใบรายได้อื่นจากใบซ่อม (ไม่มี marker — ตามจาก FK)': oiDocs.length,
        'รายการบัญชีของเอกสารใบซ่อม (ลบถาวร)': expenseJeIds.length + oiJeIds.length,
      },
      warnings: rows.some((r) => r.replacementContractId)
        ? [
            'ใบซ่อมบางใบผูกสัญญาทดแทน (replacementContractId) จาก flow เปลี่ยนเครื่อง — สัญญานั้นไม่มี marker ทดสอบและ cleanup นี้ไม่แตะ ต้องยกเลิกในหน้าจอเอง',
          ]
        : [],
    };
  },
};
```

> **หมายเหตุ (fix round 1, 2026-08-26) — ทำไมต้องมี sweep เอกสารจากใบซ่อม:** การปิดใบซ่อม (CLOSED)
> สร้าง `ExpenseDocument` (payer SHOP) / `OtherIncome` (payer CUSTOMER) โดยไม่มี marker ทดสอบ
> (`repair-ticket-lifecycle.service.ts:379,405`) — โดเมน expenses/other-income กรองด้วย note marker
> จึงมองไม่เห็นตลอดกาล และถ้าผู้ทดสอบโพสต์ JE จะค้างในสมุดถาวร ⇒ ตามจาก FK ตรงบนใบซ่อม
> (`RepairTicket.expenseDocumentId`/`otherIncomeId` — `String? @unique`, FK อยู่ฝั่ง `repair_tickets`,
> `ON DELETE SET NULL`; เอกสารถูก soft delete เท่านั้น constraint จึงไม่ทำงาน — ไม่ต้อง null FK).
> ลำดับกวาด JE ต้อง mirror expenses/other-income เป๊ะ (journalPostAuditLog → null journalEntryId →
> journalLine → journalEntry) + ใบกลับรายการ -R ของ OtherIncome ตามด้วย `reversesId`.
> เลขเอกสารต้องพิมพ์ทั้ง dry-run และ live — เป็นช่องทางเดียวที่ผู้รันเห็นมัน (ไม่มี marker).
> **ผู้ที่คัดลอกบล็อกเวอร์ชันก่อนหน้า (ไม่มี sweep นี้) จะเปิดรูเดิมกลับมา.**

- [ ] **Step 2: เขียน `inspections.seed.ts`** *(บล็อกนี้ sync กับโค้ดที่ commit แล้ว — fix round 2, 2026-08-26)*

```ts
import { TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

export const inspectionsSeeder: DomainSeeder = {
  key: 'inspections',
  label: 'ใบตรวจสภาพเครื่อง',
  routes: ['/inspections', '/inspections/:id'],
  markerDoc: `Inspection.notes ขึ้นต้นด้วย "${TEST_NOTE_MARKER}"`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const template = await ctx.prisma.inspectionTemplate.findFirst({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!template)
      return [
        {
          label: 'ข้าม',
          detail: 'ยังไม่มี InspectionTemplate ในระบบ (Inspection.templateId บังคับ)',
        },
      ];
    return [
      { label: 'ใบตรวจ 1', detail: `ใช้เทมเพลต "${template.name}" — รอตรวจ` },
      { label: 'ใบตรวจ 2', detail: `ใช้เทมเพลต "${template.name}" — ตรวจแล้ว (เกรด B)` },
    ];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const [template, products] = await Promise.all([
      ctx.prisma.inspectionTemplate.findFirst({
        where: { deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      ctx.prisma.product.findMany({
        where: { imeiSerial: { startsWith: 'TEST-' }, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 2,
      }),
    ]);
    if (!template) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ยังไม่มี InspectionTemplate (Inspection.templateId บังคับ) สร้างเทมเพลตในหน้าตั้งค่าก่อน',
      );
      return stat;
    }
    if (products.length < 2) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ต้องมีเครื่องทดสอบอย่างน้อย 2 เครื่อง (รันโดเมน contracts ก่อน)',
      );
      return stat;
    }
    for (const [i, p] of products.entries()) {
      const notes = testNote(`ใบตรวจสภาพ/${i + 1}`);
      const exists = await ctx.prisma.inspection.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // ใบที่สอง = ตรวจเสร็จแล้ว (ให้ตรงกับ plan) — Inspection ไม่โพสต์อะไร สถานะไหนก็ได้
      const done = i === 1;
      await ctx.prisma.inspection.create({
        data: {
          productId: p.id,
          templateId: template.id,
          inspectorId: ctx.refs.salespersonId,
          notes,
          ...(done
            ? { isCompleted: true, inspectedAt: ctx.today, overallGrade: 'B' as const }
            : {}),
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.inspection.findMany({
      where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, notes: true },
    });
    // ผลตรวจรายข้อเกิดตอนผู้ทดสอบกรอกผลผ่านหน้าจอ — ไม่มี marker ติดตัว ตามได้จาก FK
    // inspectionId เท่านั้น ⇒ พิมพ์ identity ให้คนสั่งล้างเห็น (ทั้ง dry-run และของจริง)
    const results = rows.length
      ? await ctx.prisma.inspectionResult.findMany({
          where: { inspectionId: { in: rows.map((r) => r.id) }, deletedAt: null },
          select: { id: true, inspectionId: true },
        })
      : [];
    for (const r of rows) {
      const n = results.filter((x) => x.inspectionId === r.id).length;
      console.log(`     ${r.notes ?? r.id}${n ? ` (ผลตรวจรายข้อ ${n} ข้อ)` : ''}`);
    }
    if (!dryRun && rows.length) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        // InspectionResult มี deletedAt เหมือนกัน ⇒ soft ทั้งคู่ — กรอง deletedAt: null
        // ให้ตรงกับ findMany ที่ใช้รายงานข้างบน (ไม่งั้น re-stamp แถวที่ผู้ทดสอบลบผ่าน
        // หน้าจอไปแล้ว และตัวเลขที่รายงานไม่ตรงกับแถวที่เปลี่ยนจริง)
        await tx.inspectionResult.updateMany({
          where: { inspectionId: { in: rows.map((r) => r.id) }, deletedAt: null },
          data: { deletedAt: now },
        });
        await tx.inspection.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { deletedAt: now },
        });
      });
    }
    return { removed: { ใบตรวจสภาพ: rows.length, ผลตรวจรายข้อ: results.length }, warnings: [] };
  },
};
```

- [ ] **Step 3: เขียน `device-swap.seed.ts`** *(บล็อกนี้ sync กับโค้ดที่ commit แล้ว — fix round 2, 2026-08-26)*

```ts
import { TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * คำขอเปลี่ยนเครื่อง 1 ใบ สถานะรออนุมัติ
 * R2 — ห้าม finalize (finalize โพสต์ JE ชุด A.1-A.5 + SHOP leg)
 *
 * ใบที่ seed ไม่ระบุ mode ⇒ default PRICED โดยไม่มี snapshot แผนผ่อน — ตรงกับรูป
 * "legacy in-flight PENDING" ที่ approvePriced รองรับอยู่แล้ว (`usedSnapshot =
 * req.newTotalMonths != null` เป็น false ⇒ clone งวดคงเหลือจากสัญญาเดิม) จึงกดอนุมัติ
 * จากหน้าจอได้จริงโดยไม่ crash
 */
export const deviceSwapSeeder: DomainSeeder = {
  key: 'device-swap',
  label: 'คำขอเปลี่ยนเครื่อง',
  routes: ['/defect-exchange', '/insurance/exchange-requests', '/insurance/exchange-request/new'],
  // ⚠ โมเดลนี้ไม่มีฟิลด์ชื่อ `reason` — ช่องข้อความที่มีจริงคือ conditionNote /
  // rejectionReason / cancelReason · เลือก conditionNote เพราะเป็นคำบรรยายสภาพเครื่อง
  // ตอนยื่นคำขอ (สองตัวหลังถูกเขียนโดย flow ปฏิเสธ/ยกเลิก ไม่ใช่ตอนสร้าง)
  markerDoc: `ContractExchangeRequest.conditionNote ขึ้นต้นด้วย "${TEST_NOTE_MARKER}"`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    const contract = await ctx.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: 'TEST-' }, status: 'ACTIVE', deletedAt: null },
      select: { contractNumber: true },
      orderBy: { contractNumber: 'asc' },
    });
    return contract
      ? [{ label: 'คำขอเปลี่ยนเครื่อง', detail: `รออนุมัติ · สัญญา ${contract.contractNumber}` }]
      : [{ label: 'ข้าม', detail: 'ยังไม่มีสัญญาทดสอบสถานะ ACTIVE (รันโดเมน contracts ก่อน)' }];
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const contract = await ctx.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: 'TEST-' }, status: 'ACTIVE', deletedAt: null },
      select: { id: true, productId: true },
      orderBy: { contractNumber: 'asc' },
    });
    // เครื่องปลายทางของ swap ต้องเป็นมือถือ ไม่ใช่หูฟังทดสอบ (เครื่องว่างของโดเมน contracts
    // มี ACCESSORY ปนอยู่) + orderBy ให้ได้เครื่องเดิมทุกรอบ
    const newProduct = await ctx.prisma.product.findFirst({
      where: {
        imeiSerial: { startsWith: 'TEST-' },
        status: 'IN_STOCK',
        category: { in: ['PHONE_NEW', 'PHONE_USED'] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!contract?.productId || !newProduct) {
      stat.notes.push(
        'ข้ามทั้งโดเมน — ต้องมีสัญญาทดสอบ ACTIVE ที่ผูกเครื่อง + มือถือทดสอบ IN_STOCK 1 เครื่อง (รันโดเมน contracts ก่อน)',
      );
      return stat;
    }
    const conditionNote = testNote('คำขอเปลี่ยนเครื่องสำหรับทดสอบ — เครื่องเดิมมีตำหนิ');
    const exists = await ctx.prisma.contractExchangeRequest.findFirst({
      where: { conditionNote, deletedAt: null },
      select: { id: true },
    });
    if (exists) {
      stat.skipped += 1;
      return stat;
    }
    await ctx.prisma.contractExchangeRequest.create({
      data: {
        oldContractId: contract.id,
        oldProductId: contract.productId,
        newProductId: newProduct.id,
        requestedById: ctx.refs.salespersonId,
        conditionNote,
        deviceCondition: 'B',
      },
    });
    stat.created += 1;
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.contractExchangeRequest.findMany({
      where: { conditionNote: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: { id: true, status: true, newContractId: true },
    });
    // ใบที่ถูกอนุมัติแล้วมีสัญญาใหม่ EXCH- (ไม่มี marker) เกาะอยู่ — soft delete คำขอตอนนั้น
    // จะตัดเส้นทางยกเลิกเปลี่ยนเครื่องของหน้าจอ (ExchangeCancelService หา request ไม่เจอ)
    // ทิ้งสัญญา EXCH- ค้างถาวร ⇒ ข้ามเฉพาะใบที่สัญญาใหม่ยัง "ไม่ถูกยกเลิก".
    // การยกเลิกในหน้าจอ (markCanceled — contract-exchange-cancel.service.ts:489-501) เขียน
    // status: 'CANCELED' + canceledAt/canceledById/cancelReason/cancelWindow แต่ **ไม่เคย
    // null `newContractId`** ⇒ ห้ามใช้ newContractId เดี่ยว ๆ เป็นเงื่อนไขข้าม (ใบที่ยกเลิก
    // แล้วจะถูกข้ามซ้ำ + เตือนซ้ำตลอดกาล — คำเตือนกลายเป็นทางตัน). ใบ CANCELED ล้างได้
    // เพราะเหตุผลเดิมของการข้าม (รักษาเส้นทางยกเลิกของหน้าจอ) หมดไปแล้ว: flow ยกเลิก
    // จัดการสัญญา EXCH- เรียบร้อย (FINALIZED → status CANCELED, PRE_FINALIZE → soft delete)
    const blocked = rows.filter((r) => r.newContractId && r.status !== 'CANCELED');
    const sweepable = rows.filter((r) => !r.newContractId || r.status === 'CANCELED');
    // ตั้งชื่อสัญญา EXCH- ด้วยเลขสัญญาจริง (ไม่กรอง deletedAt — ใช้รายงานเท่านั้น)
    const withNewContract = rows.filter((r) => r.newContractId);
    const namedContracts = withNewContract.length
      ? await ctx.prisma.contract.findMany({
          where: {
            id: { in: withNewContract.map((r) => r.newContractId).filter((x): x is string => !!x) },
          },
          select: { id: true, contractNumber: true },
        })
      : [];
    const contractName = (id: string | null) =>
      namedContracts.find((c) => c.id === id)?.contractNumber ?? id ?? '(ไม่ทราบ)';
    for (const r of rows)
      console.log(
        `     คำขอ ${r.id} [${r.status}]${
          r.newContractId
            ? r.status === 'CANCELED'
              ? ` — ยกเลิกในหน้าจอแล้ว (สัญญา ${contractName(r.newContractId)} ถูกปิดโดย flow ยกเลิก) ⇒ ล้างได้`
              : ` — มีสัญญาใหม่ ${contractName(r.newContractId)} เกาะอยู่ (ข้าม ไม่ล้าง)`
            : ''
        }`,
      );
    if (!dryRun && sweepable.length) {
      await ctx.prisma.contractExchangeRequest.updateMany({
        where: { id: { in: sweepable.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { คำขอเปลี่ยนเครื่อง: sweepable.length },
      warnings: [
        // ข้ามเฉพาะใบที่สัญญาใหม่ยังไม่ถูกยกเลิก (ดูคอมเมนต์บน) — หลังกดยกเลิกในหน้าจอ
        // newContractId ยังค้างบนคำขอ (markCanceled ไม่ null ให้) แต่สถานะเป็น CANCELED
        // ⇒ cleanup รอบถัดไปกวาดใบนั้นให้เอง — ข้อความต้องสัญญาเท่าที่เป็นจริงเท่านั้น
        ...blocked.map(
          (r) =>
            `คำขอ ${r.id} ถูกอนุมัติแล้วและสัญญาใหม่ ${contractName(r.newContractId)} ยังไม่ถูกยกเลิก — ไม่ล้างให้ เพราะคำขอใบนี้คือเส้นทางเดียวที่หน้าจอใช้ยกเลิกสัญญา EXCH- (ซึ่งไม่มี marker ทดสอบ): กดยกเลิกเปลี่ยนเครื่องในหน้าจอก่อน (คำขอจะกลายเป็น CANCELED และ flow ยกเลิกจัดการสัญญา EXCH- ให้เอง) แล้วรัน cleanup ซ้ำ — รอบถัดไปจะล้างคำขอที่ยกเลิกแล้วให้อัตโนมัติ`,
        ),
        // approvePriced โคลน PDPAConsent ให้สัญญาใหม่ (contract-exchange.service.ts:654) —
        // pdpa_consents อยู่ใน KEEP_TABLES ของ factory reset เพราะเป็นหลักฐานความยินยอมตาม
        // กฎหมาย ⇒ ห้ามให้เครื่องมือ cleanup ลบเอง เตือนให้คนตรวจแทน — การยกเลิกเปลี่ยน
        // เครื่องก็ไม่ลบแถวโคลนนี้ จึงต้องเตือนรวมสัญญาของใบที่ยกเลิกแล้ว (sweepable) ด้วย
        ...(withNewContract.length
          ? [
              `สัญญาใหม่จากการอนุมัติ (${withNewContract
                .map((r) => contractName(r.newContractId))
                .join(
                  ', ',
                )}) อาจมีแถว PDPAConsent ที่ถูกโคลนจากสัญญาเดิมค้างอยู่ — เป็นหลักฐานความยินยอมตามกฎหมาย cleanup นี้จะไม่ลบให้ ต้องให้คนตรวจสอบก่อนลบเอง`,
            ]
          : []),
      ],
    };
  },
};
```

> **หมายเหตุ (fix round 1, 2026-08-26) — ทำไมข้ามใบที่อนุมัติแล้ว + เตือน PDPA:** (1) soft delete
> คำขอที่มี `newContractId` จะตัดเส้นทางยกเลิกเปลี่ยนเครื่องของหน้าจอ (`ExchangeCancelService`
> หา request ไม่เจอ) ทิ้งสัญญา EXCH- (ไม่มี marker) ค้างถาวร ⇒ ข้าม + เตือนพร้อม id คำขอ/เลขสัญญา
> ให้กดยกเลิกในหน้าจอก่อนแล้วรัน cleanup ซ้ำ. (2) `approvePriced` โคลน `PDPAConsent` ให้สัญญาใหม่
> (`contract-exchange.service.ts:654`) — `pdpa_consents` อยู่ใน KEEP_TABLES ของ factory reset
> เพราะเป็นหลักฐานความยินยอมตามกฎหมาย ⇒ **ห้ามลบอัตโนมัติ** เตือนให้คนตรวจก่อนลบเองเท่านั้น.
> **ผู้ที่คัดลอกบล็อกเวอร์ชันก่อนหน้า (soft delete ทุกใบ ไม่มี warning) จะเปิดรูเดิมกลับมา.**

> **หมายเหตุ (fix round 2, 2026-08-26) — ใบที่ยกเลิกแล้วต้องล้างได้:** การยกเลิกในหน้าจอ
> (`markCanceled` — `contract-exchange-cancel.service.ts:489-501`) เขียน `status: 'CANCELED'` +
> `canceledAt/canceledById/cancelReason/cancelWindow` แต่**ไม่เคย null `newContractId`** ⇒ เงื่อนไขข้าม
> ที่ดูแค่ `newContractId` จะข้ามใบเดิมซ้ำ + เตือนซ้ำตลอดกาล (คำเตือน "กดยกเลิกแล้วรันซ้ำ" กลายเป็นทางตัน).
> ใบ CANCELED ล้างได้ เพราะเหตุผลเดิมของการข้าม (รักษาเส้นทางยกเลิกของหน้าจอ) หมดไปแล้ว —
> flow ยกเลิกจัดการสัญญา EXCH- เรียบร้อย (FINALIZED → CANCELED, PRE_FINALIZE → soft delete)
> ⇒ ข้ามเฉพาะ `newContractId && status !== 'CANCELED'`. **ผู้ที่คัดลอกบล็อกเวอร์ชันก่อนหน้าจะเปิดทางตันเดิมกลับมา.**

- [ ] **Step 4: ยืนยันฟิลด์ที่อาจไม่ตรง**

Run:
```bash
awk '/^model ContractExchangeRequest /,/^}/' apps/api/prisma/schema.prisma | grep -E 'reason|status|deletedAt'
awk '/^model Inspection /,/^}/' apps/api/prisma/schema.prisma | grep -E 'notes|deletedAt'
awk '/^model RepairTicket /,/^}/' apps/api/prisma/schema.prisma | grep deletedAt
```
Expected: ถ้า `ContractExchangeRequest` ไม่มีฟิลด์ `reason` ให้เปลี่ยน marker ไปที่ฟิลด์ข้อความที่มีจริง
และปรับ `markerDoc` ให้ตรง · ถ้า `RepairTicket` มี `deletedAt` ให้ soft delete แทน hard delete

- [ ] **Step 5: เพิ่มเข้า registry (ต่อจาก `applicationsSeeder`)**

```ts
  bookingsSeeder, onlineOrdersSeeder, applicationsSeeder, inspectionsSeeder, repairSeeder, deviceSwapSeeder, todosSeeder,
```

- [ ] **Step 6: ตรวจ TypeScript + round-trip**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=contracts,suppliers-po,inspections,repair,device-swap npm --prefix apps/api run seed:test-pack
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DOMAINS=inspections,repair,device-swap npm --prefix apps/api run cleanup:test-pack
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนใบซ่อม + ใบตรวจสภาพ + คำขอเปลี่ยนเครื่อง"
```

---

### Task 10: โดเมน `commissions` + `external-finance` + `saving-plans` + `trade-in`

**Files:**
- Create: `apps/api/src/cli/test-pack/commissions.seed.ts`
- Create: `apps/api/src/cli/test-pack/external-finance.seed.ts`
- Create: `apps/api/src/cli/test-pack/saving-plans.seed.ts`
- Create: `apps/api/src/cli/test-pack/trade-in.seed.ts`
- Modify: `apps/api/src/cli/test-pack/_registry.ts`

**Interfaces:**
- Consumes: `TEST_DOC_PREFIX` · `TEST_NAME_PREFIX` · `TEST_NOTE_MARKER` · `testName` · `testNote` (Task 1)
- Produces: `commissionsSeeder` · `externalFinanceSeeder` · `savingPlansSeeder` · `tradeInSeeder`

**เพดาน:** `TradeIn` หยุดที่ `APPRAISED` (`ACCEPTED` โพสต์ JE ผ่าน `trade-in-lifecycle.service.ts`) ·
`external-finance` สร้าง**เฉพาะทะเบียนบริษัท** — ใบขาย+ลูกหนี้ให้เฟส 3 เป็นคนสร้างผ่าน service จริง

- [ ] **Step 1: เขียน `commissions.seed.ts`**

```ts
import { Prisma } from '@prisma/client';
import { TEST_NOTE_MARKER, testNote } from './_context';
import { round2 } from './_helpers';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/** ค่าคอม = ยอดขาย × อัตรา — Decimal ล้วน (Global Constraint: ห้าม float กับจำนวนเงิน) */
const commissionOf = (saleAmount: number, rate: number): Prisma.Decimal =>
  round2(new Prisma.Decimal(saleAmount).mul(rate));

/** ไม่โพสต์ JE — ครอบ 3 สถานะที่ด่านยกเลิกใบขาย (G4) ใช้ตัดสิน */
const ROWS: Array<{ key: string; status: 'PENDING' | 'APPROVED' | 'PAID'; saleAmount: number; rate: number }> = [
  { key: 'pending', status: 'PENDING', saleAmount: 25900, rate: 0.02 },
  { key: 'approved', status: 'APPROVED', saleAmount: 34900, rate: 0.02 },
  { key: 'paid', status: 'PAID', saleAmount: 18900, rate: 0.03 },
];

const periodOf = (today: Date) => `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

export const commissionsSeeder: DomainSeeder = {
  key: 'commissions',
  label: 'ค่าคอมมิชชั่น',
  routes: ['/commissions'],
  markerDoc: `SalesCommission.note ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (ถ้าโมเดลไม่มี note ให้ใช้ period = "TEST-YYYY-MM")`,

  async plan(ctx: SeedContext): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `ค่าคอม ${r.key}`,
      detail: `${r.status} · ยอดขาย ฿${r.saleAmount.toLocaleString('th-TH')} × ${(r.rate * 100).toFixed(0)}% = ฿${commissionOf(r.saleAmount, r.rate).toNumber().toLocaleString('th-TH')} · งวด ${periodOf(ctx.today)}`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const period = `TEST-${periodOf(ctx.today)}`;
    for (const r of ROWS) {
      const exists = await ctx.prisma.salesCommission.findFirst({
        where: { period, salespersonId: ctx.refs.salespersonId, commissionAmount: commissionOf(r.saleAmount, r.rate), deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.salesCommission.create({
        data: {
          salespersonId: ctx.refs.salespersonId,
          period,
          saleAmount: r.saleAmount,
          commissionRate: r.rate,
          commissionAmount: commissionOf(r.saleAmount, r.rate),
          status: r.status,
        },
      });
      stat.created += 1;
    }

    // รอบจ่ายร่าง 1 ใบ — ทดสอบด่าน G4b ของการยกเลิกใบขาย
    const payoutExists = await ctx.prisma.commissionPayout.findFirst({
      where: { salespersonId: ctx.refs.salespersonId, period, deletedAt: null },
      select: { id: true },
    });
    if (payoutExists) {
      stat.skipped += 1;
    } else {
      const totalSales = ROWS.reduce((a, r) => a.plus(r.saleAmount), new Prisma.Decimal(0));
      await ctx.prisma.commissionPayout.create({
        data: {
          salespersonId: ctx.refs.salespersonId,
          period,
          totalSales,
          totalCommission: ROWS.reduce((a, r) => a.plus(commissionOf(r.saleAmount, r.rate)), new Prisma.Decimal(0)),
          status: 'DRAFT',
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const period = { startsWith: 'TEST-' } as const;
    const [commissions, payouts] = await Promise.all([
      ctx.prisma.salesCommission.findMany({ where: { period, deletedAt: null }, select: { id: true } }),
      ctx.prisma.commissionPayout.findMany({ where: { period, deletedAt: null }, select: { id: true } }),
    ]);
    if (!dryRun) {
      const now = new Date();
      await ctx.prisma.$transaction(async (tx) => {
        if (commissions.length) await tx.salesCommission.updateMany({ where: { id: { in: commissions.map((c) => c.id) } }, data: { deletedAt: now } });
        if (payouts.length) await tx.commissionPayout.updateMany({ where: { id: { in: payouts.map((p) => p.id) } }, data: { deletedAt: now } });
      });
    }
    return { removed: { 'ค่าคอม': commissions.length, 'รอบจ่ายค่าคอม': payouts.length }, warnings: [] };
  },
};
```

> **marker ของโดเมนนี้อยู่ที่ `period` ไม่ใช่ฟิลด์ข้อความ** — `period` เป็น String อิสระ (เช่น `2026-08`)
> การใส่ `TEST-` นำหน้าทำให้ค้นได้เป๊ะและแยกจากงวดจริงเด็ดขาด · แก้ `markerDoc` ให้ตรงตามนี้ตอนเขียนจริง

- [ ] **Step 2: เขียน `external-finance.seed.ts`**

> **ทำไม cleanup ต้องกวาดค่าคอม (fix round 1, 2026-08-26):** `ExternalFinanceCommission` ที่ staff คีย์มือระหว่างเทสอ้างบริษัททดสอบด้วย FK required (`externalFinanceCompanyId`) และมีคอลัมน์ `journalEntryId` — ถ้าไม่กวาด (JE hard-delete ตามลำดับเดียวกับ `repair.seed.ts`: audit log → ปลด FK → lines → entries แล้วค่อย soft-delete แถวค่าคอม) แถว+JE จะค้างถาวรเพราะค่าคอมไม่มี marker ของตัวเอง

```ts
import { Prisma } from '@prisma/client';

import { TEST_NAME_PREFIX, testName, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * สร้างเฉพาะ "ทะเบียนบริษัทไฟแนนซ์ภายนอก"
 * ใบขาย + FinanceReceivable ต้องเกิดจาก SaleWriterService ในเฟส 3 เท่านั้น (R2)
 * เพราะการขายผ่านไฟแนนซ์ภายนอกโพสต์ Dr S11-3101 และการรับเงินโพสต์ Dr S51-1106 —
 * และ FinanceReceivable.receivedAmount เป็นการเซ็ตทับ (JE คิดจากส่วนต่าง) ⇒ ยอดที่ seed
 * ตรง ๆ ไม่มีวันขึ้นสมุด
 */
const ROWS: Array<{ name: string; rate: number }> = [
  { name: 'ไฟแนนซ์ภายนอก ก', rate: 0.05 },
  { name: 'ไฟแนนซ์ภายนอก ข', rate: 0.08 },
];

export const externalFinanceSeeder: DomainSeeder = {
  key: 'external-finance',
  label: 'บริษัทไฟแนนซ์ภายนอก',
  routes: ['/external-finance-companies/:id', '/finance-receivable'],
  markerDoc: `ExternalFinanceCompany.name ขึ้นต้น "${TEST_NAME_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: testName(r.name),
      detail: `ค่าธรรมเนียมตั้งต้น ${(r.rate * 100).toFixed(0)}% — ลูกหนี้จะเกิดตอนขายจริงในเฟส 3`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    for (const r of ROWS) {
      const name = testName(r.name);
      // name เป็น @unique เต็มตาราง (ไม่ใช่ partial) — แถวที่ cleanup soft delete ไปแล้ว
      // ยังถือชื่ออยู่ ⇒ probe โดยไม่กรอง deletedAt แล้ว "กู้คืน" แทนการสร้างซ้ำ
      // ไม่งั้น seed หลัง cleanup ชน P2002
      const any = await ctx.prisma.externalFinanceCompany.findUnique({
        where: { name },
        select: { id: true, deletedAt: true },
      });
      if (any && !any.deletedAt) {
        stat.skipped += 1;
        continue;
      }
      if (any) {
        // กู้คืน + รีเซ็ตกลับค่าตั้งต้น — ผู้ทดสอบอาจแก้อัตรา/เบอร์/โน้ตไปก่อนถูกล้าง
        await ctx.prisma.externalFinanceCompany.update({
          where: { id: any.id },
          data: {
            deletedAt: null,
            isActive: true,
            defaultCommissionRate: new Prisma.Decimal(r.rate),
            contactPhone: '021230000',
            notes: testNote('บริษัทไฟแนนซ์สำหรับทดสอบ — ลบได้'),
          },
        });
        stat.skipped += 1;
        stat.notes.push(
          `กู้คืน "${name}" ที่เคยถูกล้าง (ชื่อเป็น unique เต็มตาราง — แถวกู้คืนนับเป็น skipped ไม่ใช่ created)`,
        );
        continue;
      }
      await ctx.prisma.externalFinanceCompany.create({
        data: {
          name,
          defaultCommissionRate: new Prisma.Decimal(r.rate),
          contactPhone: '021230000',
          notes: testNote('บริษัทไฟแนนซ์สำหรับทดสอบ — ลบได้'),
        },
      });
      stat.created += 1;
    }
    stat.notes.push(
      'ลูกหนี้ไฟแนนซ์ (/finance-receivable) จะมีของก็ต่อเมื่อรันด้วย DRIVE=1 หรือขายผ่านหน้าจอ POS เอง',
    );
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    // กุญแจกวาดค่าคอมคือ "บริษัททดสอบทุกแถว" รวมที่เคยถูก soft delete ไปรอบก่อน —
    // ค่าคอมไม่มี marker ของตัวเอง ตามได้จาก FK externalFinanceCompanyId (required) เท่านั้น
    // ถ้ากรอง deletedAt ตรงนี้ ค่าคอมที่อ้างบริษัทซึ่งถูกล้างไปแล้วจะเป็นกำพร้าตลอดกาล
    const companies = await ctx.prisma.externalFinanceCompany.findMany({
      where: { name: { startsWith: TEST_NAME_PREFIX } },
      select: { id: true, name: true, deletedAt: true },
    });
    const liveCompanies = companies.filter((c) => !c.deletedAt);
    for (const c of liveCompanies) console.log(`     "${c.name}"`);

    // ค่าคอมที่ staff คีย์มือระหว่างเทส (accrue → external-finance-commission.service.ts)
    // อ้างบริษัททดสอบด้วย FK ตรง — แถวมี journalEntryId ได้ ⇒ ต้องกวาด JE ของมันด้วย
    // ไม่งั้นใบ JE ค้างในสมุดถาวรหลังบริษัททดสอบหายไปแล้ว
    const commissionName = new Map(companies.map((c) => [c.id, c.name]));
    const commissions = companies.length
      ? await ctx.prisma.externalFinanceCommission.findMany({
          where: {
            externalFinanceCompanyId: { in: companies.map((c) => c.id) },
            deletedAt: null,
          },
          select: {
            id: true,
            externalFinanceCompanyId: true,
            commissionAmount: true,
            status: true,
            journalEntryId: true,
          },
        })
      : [];
    const jeIds = commissions.map((c) => c.journalEntryId).filter((x): x is string => !!x);
    // ค่าคอมไม่มี marker ติดตัว — บรรทัดนี้คือช่องทางเดียวที่ผู้รันเห็น identity ของมันก่อน
    // ถูกกวาด ⇒ พิมพ์เสมอทั้ง dry-run และ live
    for (const c of commissions) {
      console.log(
        `     ค่าคอมไฟแนนซ์ภายนอก ฿${c.commissionAmount.toFixed(2)} · ${c.status} · "${
          commissionName.get(c.externalFinanceCompanyId) ?? c.externalFinanceCompanyId
        }"${c.journalEntryId ? ' (มี JE — ลบถาวร)' : ''}`,
      );
    }

    if (!dryRun && (liveCompanies.length || commissions.length)) {
      await ctx.prisma.$transaction(async (tx) => {
        if (commissions.length) {
          // ลำดับกวาด JE เดียวกับ repair.seed.ts เป๊ะ: audit log → ปลด FK บนแถวเจ้าของ →
          // journal_lines → journal_entries — สลับลำดับ = abort ทั้ง tx บน DB จริง
          if (jeIds.length) {
            await tx.journalPostAuditLog.deleteMany({
              where: { journalEntryId: { in: jeIds } },
            });
            await tx.externalFinanceCommission.updateMany({
              where: { id: { in: commissions.map((c) => c.id) } },
              data: { journalEntryId: null },
            });
            await tx.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
          }
          await tx.externalFinanceCommission.updateMany({
            where: { id: { in: commissions.map((c) => c.id) } },
            data: { deletedAt: new Date() },
          });
        }
        if (liveCompanies.length) {
          await tx.externalFinanceCompany.updateMany({
            where: { id: { in: liveCompanies.map((c) => c.id) } },
            data: { deletedAt: new Date() },
          });
        }
      });
    }
    return {
      removed: {
        บริษัทไฟแนนซ์ภายนอก: liveCompanies.length,
        'ค่าคอมไฟแนนซ์ภายนอก (ไม่มี marker — ตามจาก FK บริษัท)': commissions.length,
        'รายการบัญชีของค่าคอมไฟแนนซ์ (ลบถาวร)': jeIds.length,
      },
      warnings: liveCompanies.length
        ? [
            'ตาราง external_finance_companies อยู่ใน KEEP_TABLES ของ factory reset — ถ้าไม่ล้างตอนนี้จะรอดข้าม factory reset ไปปนทะเบียนจริงตอนใช้งานจริง',
          ]
        : [],
    };
  },
};
```

- [ ] **Step 3: เขียน `saving-plans.seed.ts`**

```ts
import { TEST_DOC_PREFIX } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

const DAY = 24 * 60 * 60 * 1000;

/** ไม่โพสต์ JE */
const ROWS: Array<{ key: string; status: 'ACTIVE' | 'COMPLETED'; target: number; monthly: number; months: number; saved: number }> = [
  { key: 'active', status: 'ACTIVE', target: 25900, monthly: 2590, months: 10, saved: 5180 },
  { key: 'done', status: 'COMPLETED', target: 9900, monthly: 1650, months: 6, saved: 9900 },
];

export const savingPlansSeeder: DomainSeeder = {
  key: 'saving-plans',
  label: 'แผนออมเครื่อง',
  routes: ['/saving-plans'],
  markerDoc: `SavingPlan.planNumber ขึ้นต้น "${TEST_DOC_PREFIX}"`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({ label: `${TEST_DOC_PREFIX}SP ${r.key}`, detail: `${r.status} · เป้า ฿${r.target.toLocaleString('th-TH')} · ออมแล้ว ฿${r.saved.toLocaleString('th-TH')}` }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({ where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null }, select: { id: true } });
    if (!customer) {
      stat.notes.push('ข้ามทั้งโดเมน — ยังไม่มีลูกค้าทดสอบ (รันโดเมน contracts ก่อน)');
      return stat;
    }
    for (const r of ROWS) {
      const planNumber = `${TEST_DOC_PREFIX}SP-${ctx.dateStr}-${r.key}`;
      const exists = await ctx.prisma.savingPlan.findFirst({ where: { planNumber, deletedAt: null }, select: { id: true } });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      // จำนวนงวด ไม่ใช่จำนวนเงิน — Math.round ตรงนี้ถูกต้อง ไม่เข้าข้อห้าม Decimal
      const installments = Math.round(r.saved / r.monthly);
      await ctx.prisma.savingPlan.create({
        data: {
          planNumber,
          customerId: customer.id,
          targetProductModel: 'ทดสอบระบบ รุ่นเป้าหมาย',
          targetAmount: r.target,
          monthlyAmount: r.monthly,
          durationMonths: r.months,
          totalSaved: r.saved,
          status: r.status,
          startedAt: new Date(ctx.today.getTime() - installments * 30 * DAY),
          nextPaymentDueAt: r.status === 'ACTIVE' ? new Date(ctx.today.getTime() + 7 * DAY) : null,
          completedAt: r.status === 'COMPLETED' ? ctx.today : null,
          payments: {
            create: Array.from({ length: installments }, (_, i) => ({
              amount: r.monthly,
              paidAt: new Date(ctx.today.getTime() - (installments - i) * 30 * DAY),
              paymentMethod: 'CASH',
            })),
          },
        },
      });
      stat.created += 1;
    }
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.savingPlan.findMany({
      where: { planNumber: { startsWith: `${TEST_DOC_PREFIX}SP-` }, deletedAt: null },
      select: { id: true, planNumber: true },
    });
    for (const r of rows) console.log(`     ${r.planNumber}`);
    if (!dryRun && rows.length) {
      await ctx.prisma.$transaction(async (tx) => {
        await tx.savingPlanPayment.deleteMany({ where: { savingPlanId: { in: rows.map((r) => r.id) } } });
        await tx.savingPlan.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date() } });
      });
    }
    return { removed: { 'แผนออมเครื่อง': rows.length }, warnings: [] };
  },
};
```

- [ ] **Step 4: เขียน `trade-in.seed.ts`**

> **ทำไมต้องมีคำเตือน BUYBACK (fix round 1, 2026-08-26):** แถว seed ใช้ flow EXCHANGE โดยเจตนา — `accept()` ของ BUYBACK โพสต์ JE `shop-trade-in:<id>` ที่ไม่มี marker/metadata ให้ cleanup กวาดถึง ⇒ ประกาศไว้ใน seed notes + markerDoc และเตือนรายแถวใน cleanup แทนการเพิ่ม sweep (ห้ามเปลี่ยน flow ที่ seed และห้ามเดา metadata sweep)

```ts
import { Prisma } from '@prisma/client';

import { TEST_NOTE_MARKER, testNote } from './_context';
import type { CleanupStat, DomainSeeder, PlanRow, SeedContext, SeedStat } from './_types';

/**
 * R2 — หยุดที่ APPRAISED
 * ACCEPTED สร้าง Product เข้าสต็อก (+ JE รับซื้อถ้าเป็น BUYBACK) ผ่าน
 * trade-in-lifecycle.service.ts ⇒ ให้ผู้ทดสอบกดรับซื้อเองผ่านหน้าจอ
 *
 * flow ปล่อยเป็น default (EXCHANGE) โดยเจตนา: accept() ของ EXCHANGE **ไม่โพสต์ JE**
 * (JE รับซื้อโพสต์เฉพาะ BUYBACK — trade-in-lifecycle.service.ts) ⇒ ผู้ทดสอบกดรับซื้อ
 * ระหว่างเทสได้โดย cleanup ไม่ทิ้ง JE ค้างในสมุด — JE `shop-trade-in:<id>` ไม่มี marker
 * และไม่มี saleId/contractId ใน metadata จึงไม่มีเส้นทางกวาดใดมองเห็นมัน
 *
 * เครื่องที่ accept สร้าง (Product) ได้ marker ผ่าน imeiSerial = imei ของรายการนี้
 * ("TEST-TRADEIN-…") ⇒ ถูกกวาดโดยโดเมน contracts (Product.imeiSerial LIKE 'TEST-%')
 */
const ROWS: Array<{
  key: string;
  status: 'PENDING_APPRAISAL' | 'APPRAISED';
  brand: string;
  model: string;
  estimated: number;
  offered: number | null;
}> = [
  {
    key: 'pending',
    status: 'PENDING_APPRAISAL',
    brand: 'ทดสอบระบบ',
    model: 'รุ่นเทิร์น A',
    estimated: 4500,
    offered: null,
  },
  {
    key: 'appraised',
    status: 'APPRAISED',
    brand: 'ทดสอบระบบ',
    model: 'รุ่นเทิร์น B',
    estimated: 7200,
    offered: 6800,
  },
];

export const tradeInSeeder: DomainSeeder = {
  key: 'trade-in',
  label: 'รับซื้อเครื่องมือสอง',
  routes: ['/trade-in'],
  markerDoc:
    `TradeIn.notes ขึ้นต้นด้วย "${TEST_NOTE_MARKER}" (เครื่องที่เกิดจากการกดรับซื้อระหว่างเทสได้ ` +
    `imeiSerial "TEST-" — กวาดโดยโดเมน contracts) · แถว seed เป็น flow EXCHANGE โดยเจตนา: ` +
    `การกดรับซื้อ flow BUYBACK โพสต์ JE "shop-trade-in:<id>" ที่ไม่มี marker/metadata ให้ cleanup ` +
    `กวาดถึง — รายการทดสอบที่เป็น BUYBACK ต้องให้ฝ่ายบัญชีกลับรายการ JE เองก่อนรัน cleanup`,

  async plan(): Promise<PlanRow[]> {
    return ROWS.map((r) => ({
      label: `เทิร์น ${r.key}`,
      detail: `${r.status} · ${r.model} · ประเมิน ฿${r.estimated.toLocaleString('th-TH')}${
        r.offered ? ` · เสนอ ฿${r.offered.toLocaleString('th-TH')}` : ''
      }`,
    }));
  },

  async seed(ctx: SeedContext): Promise<SeedStat> {
    const stat: SeedStat = { created: 0, skipped: 0, notes: [] };
    const customer = await ctx.prisma.customer.findFirst({
      where: { name: { startsWith: 'ทดสอบระบบ ลูกค้าใหม่' }, deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!customer) {
      // customerId เป็น optional บน TradeIn (ผู้ขาย walk-in) — สร้างต่อได้ ไม่ต้องข้ามโดเมน
      stat.notes.push(
        'ไม่มีลูกค้าทดสอบ — สร้างเป็นรายการ walk-in ไม่ผูกลูกค้า (รันโดเมน contracts ก่อนถ้าต้องการผูก)',
      );
    }
    for (const r of ROWS) {
      const notes = testNote(`รับซื้อมือสอง/${r.key}`);
      // probe ด้วย notes marker รายแถว — ไม่มีคอลัมน์ unique ที่ seeder แตะ (voucherNumber
      // ว่าง, imei ไม่ unique บน trade_ins) ⇒ สร้างใหม่หลัง cleanup ได้ตรง ๆ ไม่ต้องมีขากู้คืน
      const exists = await ctx.prisma.tradeIn.findFirst({
        where: { notes, deletedAt: null },
        select: { id: true },
      });
      if (exists) {
        stat.skipped += 1;
        continue;
      }
      await ctx.prisma.tradeIn.create({
        data: {
          customerId: customer?.id ?? null,
          branchId: ctx.refs.branchId,
          deviceBrand: r.brand,
          deviceModel: r.model,
          deviceStorage: '128GB',
          deviceCondition: 'B',
          imei: `TEST-TRADEIN-${r.key}`,
          // เงินเป็น Prisma.Decimal เสมอ — Global Constraint
          estimatedValue: new Prisma.Decimal(r.estimated),
          offeredPrice: r.offered !== null ? new Prisma.Decimal(r.offered) : null,
          status: r.status,
          // สถานะต้องเล่าเรื่องเดียวกับที่ appraise() ของจริงเขียน (T5-C17):
          // ผู้ตีราคา + ล็อกราคา + เวลาตีครั้งแรก · basePriceAtAppraisal ปล่อย null
          // (แบรนด์ทดสอบไม่มีแถวในตารางราคากลาง — ตรงกับ path "ไม่พบ valuation" ของจริง)
          ...(r.status === 'APPRAISED'
            ? {
                appraisedById: ctx.refs.reviewerId,
                appraisalLocked: true,
                firstAppraisedAt: ctx.today,
              }
            : {}),
          sellerName: 'ทดสอบระบบ ผู้ขายมือสอง',
          sellerPhone: '0895550001',
          notes,
        },
      });
      stat.created += 1;
    }
    stat.notes.push(
      'แถวทดสอบใช้ flow EXCHANGE โดยเจตนา — การกดรับซื้อ flow BUYBACK โพสต์ JE "shop-trade-in:<id>" ' +
        'ที่ cleanup กวาดไม่ถึง (ไม่มี marker/metadata) ห้ามสลับแถวทดสอบเป็น BUYBACK',
    );
    return stat;
  },

  async cleanup(ctx: SeedContext, dryRun: boolean): Promise<CleanupStat> {
    const rows = await ctx.prisma.tradeIn.findMany({
      where: { notes: { startsWith: TEST_NOTE_MARKER }, deletedAt: null },
      select: {
        id: true,
        status: true,
        imei: true,
        deviceModel: true,
        productId: true,
        flow: true,
      },
    });
    // identity ให้คนตรวจก่อน/หลังลบ — พิมพ์ทั้ง dry-run และโหมดจริง
    for (const r of rows) {
      console.log(
        `     ${r.imei ?? '(ไม่มี IMEI)'} · ${r.deviceModel} · ${r.status}${
          r.productId ? ' (รับซื้อแล้ว — มีเครื่องเข้าสต็อก)' : ''
        }`,
      );
    }
    const accepted = rows.filter((r) => r.productId);
    // flow BUYBACK ตอนรับซื้อโพสต์ JE "shop-trade-in:<id>" โดยไม่มี marker/metadata ให้กวาด
    // (trade-in-lifecycle.service.ts) — pack กวาดไม่ถึงโดยเจตนา จึงเตือนรายแถวแทน
    const buybacks = rows.filter((r) => r.flow === 'BUYBACK');
    if (!dryRun && rows.length) {
      await ctx.prisma.tradeIn.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { deletedAt: new Date() },
      });
    }
    return {
      removed: { รายการรับซื้อมือสอง: rows.length },
      warnings: [
        ...(accepted.length
          ? [
              `รายการที่รับซื้อแล้ว ${accepted.length} รายการมีเครื่องเข้าสต็อก (IMEI TEST-) — เครื่องถูกกวาดโดยโดเมน contracts; ถ้ารัน cleanup เฉพาะโดเมน trade-in เครื่องจะยังค้างในสต็อก`,
            ]
          : []),
        ...buybacks.map((r) => {
          const name = `${r.imei ?? '(ไม่มี IMEI)'} · ${r.deviceModel}`;
          return r.productId
            ? `รายการเทิร์น ${name} เป็น flow BUYBACK และรับซื้อไปแล้ว — JE "shop-trade-in:<id>" ค้างในสมุดโดย pack กวาดไม่ถึง ต้องให้ฝ่ายบัญชีกลับรายการ JE เองก่อนรัน cleanup จริง`
            : `รายการเทิร์น ${name} เป็น flow BUYBACK — ถ้ากดรับซื้อจะโพสต์ JE "shop-trade-in:<id>" ที่ pack กวาดไม่ถึง ต้องให้ฝ่ายบัญชีกลับรายการ JE เองก่อนรัน cleanup จริง`;
        }),
      ],
    };
  },
};
```

- [ ] **Step 5: ยืนยันฟิลด์ที่อาจไม่ตรง**

Run:
```bash
awk '/^model SalesCommission /,/^}/' apps/api/prisma/schema.prisma | grep -E 'period|note|deletedAt'
awk '/^model SavingPlanPayment /,/^}/' apps/api/prisma/schema.prisma | grep -E 'paymentMethod|deletedAt'
awk '/^model TradeIn /,/^}/' apps/api/prisma/schema.prisma | grep deletedAt
```
Expected: `SavingPlanPayment.paymentMethod` เป็น `String` (ไม่ใช่ enum) จึงใส่ `'CASH'` ได้ —
ถ้าเป็น enum ให้ใช้ค่าจาก `PaymentMethod` (`CASH` มีอยู่แล้ว) · ถ้าโมเดลไหนไม่มี `deletedAt` ให้เปลี่ยนเป็น hard delete

- [ ] **Step 6: เพิ่มเข้า registry — ครบ 19 โดเมน**

```ts
export const ALL_DOMAINS: DomainSeeder[] = [
  contractsSeeder,
  expensesSeeder, payrollSeeder, otherIncomeSeeder, assetsSeeder, equitySeeder,
  suppliersPoSeeder, stockOpsSeeder,
  bookingsSeeder, onlineOrdersSeeder, applicationsSeeder,
  inspectionsSeeder, repairSeeder, deviceSwapSeeder,
  commissionsSeeder, externalFinanceSeeder, savingPlansSeeder, tradeInSeeder,
  todosSeeder,
];
```

- [ ] **Step 7: ตรวจ TypeScript + รันเต็มชุด**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
EXPECTED_DB_NAME=$DB npm --prefix apps/api run seed:test-pack
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB npm --prefix apps/api run seed:test-pack
EXPECTED_DB_NAME=$DB npm --prefix apps/api run cleanup:test-pack
```
Expected: dry-run แสดงครบ 19 โดเมน · live สร้าง ~55 แถว · cleanup dry-run เห็นครบทุกโดเมน

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/cli/test-pack
git commit -m "feat(test-pack): โดเมนค่าคอม + ไฟแนนซ์ภายนอก + แผนออม + รับซื้อมือสอง — ครบ 19 โดเมน"
```

---

### Task 11: Preflight

**Files:**
- Create: `apps/api/src/cli/test-pack/_preflight.ts`
- Create: `apps/api/src/cli/test-pack/_preflight.spec.ts`
- Modify: `apps/api/src/cli/seed-test-pack.cli.ts` (เรียก preflight ก่อนวนโดเมน)

**Interfaces:**
- Consumes: `PrismaService` · `SeedRefs` (Task 1)
- Produces: `DRIVE_REQUIRED_ACCOUNTS: string[]` · `missingAccounts(required: string[], present: string[]): string[]` · `runPreflight(prisma, refs, opts): Promise<{ ok: boolean; problems: string[] }>`

**บัญชีที่เฟส 3 ต้องมี** (ตรวจจาก `shop-coa.csv` แล้วว่ามีจริงทั้งหมด ณ 2026-08-26 — ผัง SHOP 72 บัญชี):
`S11-3101` ลูกหนี้บริษัทไฟแนนซ์ภายนอก · `S51-1106` ค่าธรรมเนียมบริษัทไฟแนนซ์ · `S21-2002` เงินมัดจำ ·
`S11-3001` · `S11-3002` · `S41-1101` · `S50-1101` · `S11-2001` · `11-2101` · `21-1101` · `21-1102` ·
`11-2106` · `21-2102` · `11-1101` · `11-2103` · `21-2101`
ถ้าขาดตัวใดตัวหนึ่ง = **prod ยังไม่ได้รัน `seed:coa` หลัง deploy** ซึ่งเป็นสาเหตุที่พบซ้ำ ๆ ในโปรเจคนี้

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน — `_preflight.spec.ts`**

```ts
import { DRIVE_REQUIRED_ACCOUNTS, missingAccounts } from './_preflight';

describe('missingAccounts', () => {
  it('คืนรหัสที่ขาด เรียงตามลำดับที่ต้องการ', () => {
    expect(missingAccounts(['S11-3101', 'S51-1106', 'S21-2002'], ['S21-2002'])).toEqual(['S11-3101', 'S51-1106']);
  });

  it('มีครบ = คืน array ว่าง', () => {
    expect(missingAccounts(['11-1101'], ['11-1101', '11-2101'])).toEqual([]);
  });
});

describe('DRIVE_REQUIRED_ACCOUNTS', () => {
  it('มีบัญชีใหม่สามตัวที่ prod ต้องรัน seed:coa ถึงจะมี', () => {
    expect(DRIVE_REQUIRED_ACCOUNTS).toEqual(expect.arrayContaining(['S11-3101', 'S51-1106', 'S21-2002']));
  });

  it('ไม่มีรหัสซ้ำ', () => {
    expect(new Set(DRIVE_REQUIRED_ACCOUNTS).size).toBe(DRIVE_REQUIRED_ACCOUNTS.length);
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าไม่ผ่าน**

Run: `npm --prefix apps/api test -- _preflight`
Expected: FAIL — `Cannot find module './_preflight'`

- [ ] **Step 3: เขียน `_preflight.ts`**

```ts
import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedRefs } from './_types';

/** บัญชีที่แผนเดินเรื่อง (เฟส 3) แตะ — ขาดตัวใดตัวหนึ่ง = ยังไม่ได้รัน seed:coa */
export const DRIVE_REQUIRED_ACCOUNTS: string[] = [
  '11-1101', '11-2101', '11-2103', '11-2106', '21-1101', '21-1102', '21-2101', '21-2102',
  'S11-1101', 'S11-2001', 'S11-3001', 'S11-3002', 'S11-3101', 'S21-2002', 'S41-1101', 'S50-1101', 'S51-1106',
];

export function missingAccounts(required: string[], present: string[]): string[] {
  const have = new Set(present);
  return required.filter((c) => !have.has(c));
}

export async function runPreflight(
  prisma: PrismaService,
  refs: SeedRefs,
  opts: { drive: boolean; postDate: Date },
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

  // ข้อ 2 — ข้อมูลอ้างอิง (resolveRefs โยนไปแล้วถ้าขาด branch/user; ที่นี่ตรวจนิติบุคคล)
  if (!refs.shopCompanyId) problems.push('ไม่พบนิติบุคคล SHOP ใน company_info');
  if (!refs.financeCompanyId) problems.push('ไม่พบนิติบุคคล FINANCE ใน company_info');

  if (!opts.drive) return { ok: problems.length === 0, problems };

  // ข้อ 3 — ผังบัญชีครบไหม
  const rows = await prisma.chartOfAccount.findMany({
    where: { code: { in: DRIVE_REQUIRED_ACCOUNTS }, deletedAt: null },
    select: { code: true },
  });
  const missing = missingAccounts(DRIVE_REQUIRED_ACCOUNTS, rows.map((r) => r.code));
  if (missing.length) {
    problems.push(
      `ผังบัญชีขาด ${missing.length} รหัส: ${missing.join(', ')} — รัน "npm --prefix apps/api run seed:coa" ก่อน แล้วค่อยรันใหม่`,
    );
  }

  // ข้อ 4 — งวดบัญชีของวันที่จะโพสต์ต้องเปิดทั้งสองฝั่ง
  const year = opts.postDate.getUTCFullYear();
  const month = opts.postDate.getUTCMonth() + 1;
  for (const [name, companyId] of [['SHOP', refs.shopCompanyId], ['FINANCE', refs.financeCompanyId]] as const) {
    if (!companyId) continue;
    const period = await prisma.accountingPeriod.findFirst({
      where: { companyId, year, month },
      select: { status: true },
    });
    if (period && period.status !== 'OPEN') {
      problems.push(
        `งวดบัญชี ${year}-${String(month).padStart(2, '0')} ของ ${name} สถานะ ${period.status} — เปิดงวดก่อน หรือใช้ POST_DATE=YYYY-MM-DD ชี้ไปเดือนที่ยังเปิด`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- _preflight`
Expected: PASS — 4 เทส

- [ ] **Step 5: ยืนยันชื่อฟิลด์ของ `AccountingPeriod`**

Run: `awk '/^model AccountingPeriod /,/^}/' apps/api/prisma/schema.prisma | grep -E 'year|month|status|companyId'`
Expected: มี `year` `month` `status` `companyId` — ถ้าเก็บเป็น `periodStart` แทน ให้แก้ query ตามจริง

- [ ] **Step 6: เรียก preflight จาก orchestrator**

แก้ `seed-test-pack.cli.ts` — หลัง `const refs = await resolveRefs(prisma);` และก่อน `for (const d of domains)`:

```ts
    const drive = process.env.DRIVE === '1';
    const postDate = process.env.POST_DATE ? new Date(`${process.env.POST_DATE}T00:00:00.000Z`) : bkkMidnight(now);
    const pre = await runPreflight(prisma, refs, { drive, postDate });
    if (!pre.ok) {
      console.error('[seed-test-pack] PREFLIGHT ไม่ผ่าน:');
      for (const p of pre.problems) console.error(`  ✗ ${p}`);
      await prisma.$disconnect();
      process.exit(1);
    }
```

เพิ่ม import: `import { runPreflight } from './test-pack/_preflight';`

- [ ] **Step 7: ตรวจ TypeScript + ลอง preflight ล้ม**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
EXPECTED_DB_NAME=$DB DRIVE=1 POST_DATE=2020-01-01 npm --prefix apps/api run seed:test-pack
```
Expected: ออกด้วย exit 1 พร้อมข้อความว่างวด 2020-01 ปิดอยู่ หรือผังบัญชีขาด (แล้วแต่สภาพ DB)
ถ้างวดปี 2020 ไม่มีแถวเลย preflight จะผ่าน (ไม่มีแถว = ยังไม่เคยปิด) — ให้ลองเดือนที่ปิดจริงแทน

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/cli/test-pack apps/api/src/cli/seed-test-pack.cli.ts
git commit -m "feat(test-pack): preflight ตรวจผังบัญชี + งวดเปิด ก่อนเดินเรื่อง"
```

---

### Task 12: โหมดเดินเรื่อง (เฟส 3)

**Files:**
- Create: `apps/api/src/cli/test-pack/_module.ts`
- Create: `apps/api/src/cli/test-pack/_drive.ts`
- Modify: `apps/api/src/cli/seed-test-pack.cli.ts` (เรียก `runDrive` หลังวนโดเมนจบ เมื่อ `DRIVE=1`)

**Interfaces:**
- Consumes: `SeedContext` (Task 1) · `runPreflight` (Task 11) · service จริงจาก feature modules
- Produces: `TestPackModule` (class) · `runDrive(ctx: SeedContext): Promise<DriveResult>` · `DriveResult { steps: Array<{ name: string; ok: boolean; detail: string }> }`

**R3 บังคับ:** `_module.ts` **ห้าม import `AppModule`** — import เฉพาะ feature module ที่ต้องใช้
ถ้า Nest บ่นว่า provider ตัวไหน resolve ไม่ได้ ให้เพิ่ม **module ต้นทางของ provider นั้น** เข้ามา
**ห้ามแก้ด้วยการ import `AppModule` เพื่อความสะดวก** (จะลากทั้ง `ScheduleModule.forRoot()` เข้ามา)

- [ ] **Step 1: อ่านลายเซ็นจริงของ service ที่จะเรียก**

Run:
```bash
sed -n '341,350p' apps/api/src/modules/contracts/contract-workflow.service.ts
sed -n '91,112p' apps/api/src/modules/payments/services/payment-receipt-orchestrator.ts
sed -n '175,182p;471,478p' apps/api/src/modules/sales/services/sale-writer.service.ts
sed -n '386,396p' apps/api/src/modules/bookings/bookings.service.ts
grep -rn "async post(" apps/api/src/modules/expense-documents/*.service.ts apps/api/src/modules/other-income/*.service.ts apps/api/src/modules/assets/*.service.ts apps/api/src/modules/equity/*.service.ts
```
Expected (ตรวจแล้วตอนเขียนแผน):
- `ContractWorkflowService.activate(id: string)` — **ไม่มีพารามิเตอร์ผู้กระทำ** (ข้อจำกัดที่รู้อยู่แล้ว ดู accounting.md)
- `PaymentReceiptOrchestrator.recordPayment(contractId, installmentNo, amount, paymentMethod, recordedById, evidenceUrl?, notes?, transactionRef?, depositAccountCode?, ...)` — positional ล้วน
- `SaleWriterService.createCashSale(dto, salespersonId, netAmount, discount)` และ `createExternalFinanceSale(dto, salespersonId, netAmount, discount)`
- `BookingsService.payDeposit(id, dto, user)` — `user` เป็นออบเจกต์ผู้ใช้ที่ guard ปกติใส่มาให้ ⇒ ต้องประกอบเอง
จดลายเซ็นของ `post()` ทั้ง 4 โมดูลไว้ใช้ใน Step 3

- [ ] **Step 2: เขียน `_module.ts`**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ContractsModule } from '../../modules/contracts/contracts.module';
import { PaymentsModule } from '../../modules/payments/payments.module';
import { SalesModule } from '../../modules/sales/sales.module';
import { BookingsModule } from '../../modules/bookings/bookings.module';
import { ExpenseDocumentsModule } from '../../modules/expense-documents/expense-documents.module';
import { OtherIncomeModule } from '../../modules/other-income/other-income.module';
// ⚠ เอกพจน์ทั้งคู่ — modules/assets/ มีแต่ไฟล์ spec ลอย ไม่มี module
import { AssetModule } from '../../modules/asset/asset.module';
import { EquityModule } from '../../modules/equity/equity.module';

/**
 * โมดูลสำหรับโหมดเดินเรื่องเท่านั้น
 *
 * R3 — ห้าม import AppModule เด็ดขาด: app.module.ts:170 มี ScheduleModule.forRoot()
 * ซึ่งจะลงทะเบียน cron ทั้งหมด (2A accrual 00:01, ECL 00:30, VAT 60 วัน 02:00)
 * ตอนที่ createApplicationContext เรียก onApplicationBootstrap — และไม่มี env ปิด cron
 * (grep DISABLE_CRON / CRON_ENABLED แล้วไม่เจอเลย)
 *
 * ScheduleModule.forRoot() อยู่ที่ app.module.ts ที่เดียว ⇒ ไม่ import = ไม่มี cron
 *
 * หมายเหตุเรื่อง BullMQ (ตรวจแล้ว ไม่ใช่ความเสี่ยง): ContractsModule และ
 * ExpenseDocumentsModule import NotificationsModule จริง แต่ NotificationsModule
 * import แค่ Prisma/Integrations/PDPA — ส่วน NotificationQueueModule.register()
 * ถูกเรียกจาก app.module.ts ที่เดียว และไม่มีใครนอกโมดูลนั้นฉีด NotificationQueueService
 * ⇒ ไม่มีทาง resolve ไปถึง Redis
 */
@Module({
  imports: [
    PrismaModule,
    ContractsModule,
    PaymentsModule,
    SalesModule,
    BookingsModule,
    ExpenseDocumentsModule,
    OtherIncomeModule,
    AssetModule,
    EquityModule,
  ],
})
export class TestPackModule {}
```

- [ ] **Step 3: ลองสร้าง context ให้ผ่านก่อนเขียน `_drive.ts`**

สร้างไฟล์ชั่วคราว `apps/api/src/cli/test-pack/_smoke.ts`:

```ts
import { NestFactory } from '@nestjs/core';
import { TestPackModule } from './_module';

async function main() {
  const app = await NestFactory.createApplicationContext(TestPackModule, { logger: ['error', 'warn'] });
  console.log('TestPackModule bootstrap OK');
  await app.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `npx -y tsx apps/api/src/cli/test-pack/_smoke.ts`
Expected: `TestPackModule bootstrap OK` และ **process จบเอง**
ถ้าค้างไม่จบ = มี worker/cron ติดมา ⇒ ไล่หา import ที่ลาก `NotificationsModule` หรือ `ScheduleModule` เข้ามา
ถ้า Nest บ่น `Nest can't resolve dependencies of X` ⇒ เพิ่ม module ต้นทางของ X เข้า `imports`
เมื่อผ่านแล้ว **ลบ `_smoke.ts` ทิ้ง**

- [ ] **Step 4: เขียน `_drive.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { ContractWorkflowService } from '../../modules/contracts/contract-workflow.service';
import { PaymentReceiptOrchestrator } from '../../modules/payments/services/payment-receipt-orchestrator';
import { TestPackModule } from './_module';
import type { SeedContext } from './_types';

export interface DriveStep {
  name: string;
  ok: boolean;
  detail: string;
}
export interface DriveResult {
  steps: DriveStep[];
}

/**
 * เฟส 3 — เดินเรื่องผ่าน service จริง เพื่อให้ JE มาจากโค้ด production (R1)
 *
 * แต่ละก้าวจับ error ของตัวเอง: ก้าวหนึ่งพังต้องไม่ล้มก้าวถัดไป และไม่ล้มเฟส 1-2
 * ที่ commit ไปแล้ว
 */
export async function runDrive(ctx: SeedContext): Promise<DriveResult> {
  const steps: DriveStep[] = [];
  const app = await NestFactory.createApplicationContext(TestPackModule, { logger: ['error', 'warn'] });

  const run = async (name: string, fn: () => Promise<string>) => {
    try {
      steps.push({ name, ok: true, detail: await fn() });
    } catch (err) {
      steps.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  try {
    // ── ก้าว 1: เปิดสัญญาผ่อน 1 ใบ → JE 1A + SHOP leg → คิวรอจ่าย INTER-CO มีของ
    const workflow = app.get(ContractWorkflowService);
    await run('เปิดสัญญาผ่อน', async () => {
      const c = await ctx.prisma.contract.findFirst({
        where: { contractNumber: { startsWith: 'TEST-' }, status: 'DRAFT', deletedAt: null },
        select: { id: true, contractNumber: true },
      });
      if (!c) return 'ข้าม — ไม่พบสัญญาทดสอบสถานะ DRAFT ให้เปิด';
      await workflow.activate(c.id);
      return `เปิดสัญญา ${c.contractNumber} แล้ว — ตรวจคิวที่ /accounting/intercompany`;
    });

    // ── ก้าว 2: รับชำระ 2 งวด → JE 2B + ใบเสร็จ
    const orchestrator = app.get(PaymentReceiptOrchestrator);
    await run('รับชำระค่างวด', async () => {
      const c = await ctx.prisma.contract.findFirst({
        where: { contractNumber: { startsWith: 'TEST-' }, status: 'ACTIVE', deletedAt: null },
        select: { id: true, contractNumber: true },
      });
      if (!c) return 'ข้าม — ไม่พบสัญญาทดสอบสถานะ ACTIVE';
      // ต้องบันทึกตามลำดับงวด (คำสั่งเจ้าของ 2026-08-19) ⇒ ไล่จากงวดค้างที่เก่าที่สุด
      const due = await ctx.prisma.payment.findMany({
        where: { contractId: c.id, status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] }, deletedAt: null },
        orderBy: { installmentNo: 'asc' },
        select: { installmentNo: true, amountDue: true, lateFee: true },
        take: 2,
      });
      if (!due.length) return 'ข้าม — ไม่มีงวดค้างให้รับชำระ';
      let n = 0;
      for (const p of due) {
        // Decimal arithmetic — ห้าม Number() (Global Constraints: Money = Decimal)
        // recordPayment รับ amount เป็น number ⇒ แปลงเป็น number ที่ขอบสุดท้ายเท่านั้น
        // หลังบวกด้วย Decimal แล้ว (ไม่ใช่แปลงก่อนบวก ซึ่งเสีย precision)
        const amount = new Prisma.Decimal(p.amountDue).plus(p.lateFee ?? 0).toNumber();
        await orchestrator.recordPayment(c.id, p.installmentNo, amount, 'CASH', ctx.refs.reviewerId, undefined, '[ทดสอบระบบ] รับชำระจากโหมดเดินเรื่อง', undefined, '11-1101');
        n += 1;
      }
      return `รับชำระ ${n} งวดของสัญญา ${c.contractNumber} — ตรวจใบเสร็จที่ /receipts`;
    });

    // ── ก้าว 3-6: ขายสด · ขายผ่านไฟแนนซ์ภายนอก · รับมัดจำใบจอง · post เอกสารบัญชี 4 ใบ
    // เขียนตามลายเซ็นที่จดไว้จาก Step 1 — โครงเดียวกับสองก้าวข้างบน:
    //   await run('<ชื่อก้าว>', async () => { ...หาแถวที่ seed ไว้... ; await service.method(...); return '<สรุปไทย>'; });
    // ก้าวที่หาแถวไม่เจอให้ return ข้อความขึ้นต้นว่า "ข้าม — " ไม่ใช่ throw
  } finally {
    await app.close();
  }

  return { steps };
}
```

- [ ] **Step 5: เติมก้าว 3-6 ให้ครบตามลายเซ็นที่จดไว้**

ก้าวที่ต้องเพิ่ม (ทั้งหมดใช้ `run(...)` แบบเดียวกับก้าว 1-2):

| ก้าว | หาแถวจากอะไร | เรียกอะไร | สรุปที่ return |
|---|---|---|---|
| ขายสด POS | `Product` ที่ IMEI ขึ้นต้น `TEST-` และ `status = 'IN_STOCK'` | `SaleWriterService.createCashSale(dto, ctx.refs.salespersonId, netAmount, 0)` | `ขายสดแล้ว <saleNumber> — ตรวจที่ /sales และ /shop/accounting` |
| ขายผ่านไฟแนนซ์ภายนอก | เครื่อง `TEST-` อีกเครื่อง + `ExternalFinanceCompany` ที่ชื่อขึ้นต้น `ทดสอบระบบ` | `SaleWriterService.createExternalFinanceSale(dto, ctx.refs.salespersonId, netAmount, 0)` | `ขายผ่านไฟแนนซ์แล้ว — ลูกหนี้ S11-3101 ตรวจที่ /finance-receivable` |
| รับมัดจำใบจอง | `Booking` ที่เลขขึ้นต้น `TEST-BK-` และ `status = 'PENDING_DEPOSIT'` (เลือกใบ `normal` ไม่ใช่ใบ `expired`) | `BookingsService.payDeposit(id, dto, user)` | `รับมัดจำใบจอง <bookingNumber> — S21-2002 ตรวจที่ /shop/accounting` |
| post เอกสารบัญชี | ใบที่ marker `[ทดสอบระบบ]` ของ expense / other-income / asset / equity อย่างละ 1 ใบ | `post()` ของแต่ละโมดูล | `ลงบัญชีแล้ว <docNumber>` ต่อใบ |

`user` ที่ `BookingsService.payDeposit` ต้องการ ให้ประกอบจากผู้ใช้จริง:

```ts
const actor = await ctx.prisma.user.findUnique({
  where: { id: ctx.refs.ownerId },
  select: { id: true, role: true, branchId: true },
});
```
แล้วส่ง `actor` เข้าไป — ถ้า type ไม่ตรง ให้ดูว่า controller ส่งอะไรเข้ามา (`@CurrentUser()`) แล้วประกอบให้เหมือน

- [ ] **Step 6: ต่อ `runDrive` เข้า orchestrator**

แก้ `seed-test-pack.cli.ts` — หลังลูปโดเมนจบ ก่อน `console.log('[seed-test-pack] ===== SUMMARY =====')`:

```ts
    if (!dryRun && drive) {
      console.log('── เฟส 3: เดินเรื่องผ่าน service จริง');
      const { steps } = await runDrive(ctx);
      for (const s of steps) console.log(`   ${s.ok ? '✓' : '✗'} ${s.name} — ${s.detail}`);
      console.log('');
    } else if (dryRun && drive) {
      console.log('── เฟส 3 ถูกข้ามใน DRY-RUN (เดินเรื่องจริงต้องเขียน DB)');
      console.log('');
    }
```

เพิ่ม import: `import { runDrive } from './test-pack/_drive';`

- [ ] **Step 7: ตรวจ TypeScript + รันเต็มพร้อมเดินเรื่อง**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=$DB DRIVE=1 npm --prefix apps/api run seed:test-pack
```
Expected: เห็นบล็อก `── เฟส 3` พร้อม ✓ ทุกก้าว (หรือ `ข้าม —` ที่อธิบายเหตุผล) และ **process จบเอง ไม่ค้าง**

- [ ] **Step 8: พิสูจน์ว่าสมุดมีตัวเลขจริงและสมดุลทั้งสองฝั่ง**

เปิด `/finance/general-journal` แล้ว `/shop/accounting` แท็บงบทดลอง หรือยิง API:
```
GET /expenses/ledger/trial-balance?scope=ALL
```
Expected: `isAllBalanced = true` และ **ทั้ง `perScope.shop` และ `perScope.finance` มียอดไม่เป็นศูนย์**
(ถ้ายังเป็นศูนย์ทั้งคู่ = เฟส 3 ไม่ได้ทำงานจริง ไม่ใช่ "ผ่าน")

- [ ] **Step 9: พิสูจน์ว่า cleanup กวาด JE ของเฟส 3 คืนได้**

```bash
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=$DB npm --prefix apps/api run cleanup:test-pack
```
แล้วเรียก `GET /expenses/ledger/trial-balance?scope=ALL` อีกครั้ง
Expected: ทุกบัญชีกลับเป็น 0.00 · ถ้ามีบัญชีค้าง ให้ดูว่า JE ใบไหนไม่ถูกกวาด แล้วเติมทางกวาดในโดเมนที่เป็นเจ้าของ
**ห้ามแก้ด้วยการลบ JE แบบเหวี่ยงแห**

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/cli/test-pack apps/api/src/cli/seed-test-pack.cli.ts
git commit -m "feat(test-pack): โหมดเดินเรื่องผ่าน service จริง (TestPackModule ไม่มี cron)"
```

---

### Task 13: เอกสาร checklist ที่ generate จาก registry

**Files:**
- Create: `apps/api/src/cli/test-pack/_docgen.ts`
- Modify: `apps/api/src/cli/seed-test-pack.cli.ts` (รองรับ `DOCGEN=1`)
- Create: `docs/guides/FULL-SYSTEM-TEST-CHECKLIST/README.md` (ผลลัพธ์จากการรัน)

**Interfaces:**
- Consumes: `ALL_DOMAINS` (Task 1) — ใช้ `key` `label` `routes` `markerDoc`
- Produces: `renderChecklistReadme(domains: DomainSeeder[], allRoutes: string[]): string`

**เหตุผล:** MD ข้อ 6-7 สั่งให้มีตาราง route + ตารางวิธีลบ ถ้าเขียนมือ มันจะล้าสมัยทันทีที่เพิ่มโดเมน
generate จาก registry แทน ⇒ เอกสารกับโค้ดหลุดกันไม่ได้

- [ ] **Step 1: เขียนเทสที่ยังไม่ผ่าน — `_docgen.spec.ts`**

```ts
import { renderChecklistReadme } from './_docgen';
import type { DomainSeeder } from './_types';

const stub = (key: string, routes: string[]): DomainSeeder =>
  ({ key, label: `ป้าย ${key}`, routes, markerDoc: `marker ของ ${key}`, plan: async () => [], seed: async () => ({ created: 0, skipped: 0, notes: [] }), cleanup: async () => ({ removed: {}, warnings: [] }) });

describe('renderChecklistReadme', () => {
  const domains = [stub('assets', ['/assets']), stub('todos', ['/todos'])];

  it('มีทุกโดเมนพร้อม markerDoc', () => {
    const md = renderChecklistReadme(domains, ['/assets', '/todos', '/login']);
    expect(md).toContain('marker ของ assets');
    expect(md).toContain('marker ของ todos');
  });

  it('ลิสต์ route ที่ไม่มีโดเมนไหนครอบ เพื่อไม่ให้ตกสำรวจ', () => {
    const md = renderChecklistReadme(domains, ['/assets', '/todos', '/login']);
    expect(md).toContain('/login');
    expect(md).toContain('ไม่มีโดเมน seed ครอบ');
  });

  it('route ที่มีโดเมนครอบแล้วไม่ไปโผล่ในลิสต์ที่ไม่ครอบ', () => {
    const md = renderChecklistReadme(domains, ['/assets']);
    const section = md.split('ไม่มีโดเมน seed ครอบ')[1] ?? '';
    expect(section).not.toContain('/assets');
  });
});
```

- [ ] **Step 2: รันเทสให้เห็นว่าไม่ผ่าน**

Run: `npm --prefix apps/api test -- _docgen`
Expected: FAIL — `Cannot find module './_docgen'`

- [ ] **Step 3: เขียน `_docgen.ts`**

```ts
import type { DomainSeeder } from './_types';

/** สร้าง README ของ checklist จาก registry — เอกสารกับโค้ดจึงหลุดกันไม่ได้ */
export function renderChecklistReadme(domains: DomainSeeder[], allRoutes: string[]): string {
  const covered = new Set(domains.flatMap((d) => d.routes));
  const uncovered = allRoutes.filter((r) => !covered.has(r)).sort();

  const domainRows = domains
    .map((d) => `| \`${d.key}\` | ${d.label} | ${d.routes.length} | ${d.markerDoc} |`)
    .join('\n');

  const routeRows = domains
    .flatMap((d) => d.routes.map((r) => `| \`${r}\` | ${d.label} (\`${d.key}\`) |`))
    .join('\n');

  return `# คู่มือทดสอบทั้งระบบ — ตารางครอบคลุม

> **ไฟล์นี้ generate จากโค้ด อย่าแก้ด้วยมือ**
> สร้างใหม่ด้วย: \`DOCGEN=1 npm --prefix apps/api run seed:test-pack\`
> แหล่งข้อมูล: \`apps/api/src/cli/test-pack/_registry.ts\` (\`routes\` + \`markerDoc\` ของแต่ละโดเมน)

## 1. โดเมนและวิธีล้าง

| โดเมน | ชื่อ | จำนวน route | วิธีที่ cleanup ค้นแถว |
|---|---|---|---|
${domainRows}

ล้างทั้งหมด: \`CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack\`
ล้างรายโดเมน: เพิ่ม \`DOMAINS=<key>\`

## 2. route → โดเมนที่ทำให้มีข้อมูล

| route | โดเมน |
|---|---|
${routeRows}

## 3. route ที่ไม่มีโดเมน seed ครอบ (${uncovered.length} route)

ต้องทดสอบด้วยการ **ทำจริงบนหน้าจอ** หรือเป็นรายงาน/หน้าสาธารณะที่ไม่มีข้อมูลของตัวเอง

${uncovered.map((r) => `- \`${r}\``).join('\n')}
`;
}
```

- [ ] **Step 4: รันเทสให้ผ่าน**

Run: `npm --prefix apps/api test -- _docgen`
Expected: PASS — 3 เทส

- [ ] **Step 5: ต่อ `DOCGEN=1` เข้า orchestrator**

แก้ `seed-test-pack.cli.ts` — ใส่ **ก่อน** การเช็ค `EXPECTED_DB_NAME` (docgen ไม่แตะ DB):

```ts
  if (process.env.DOCGEN === '1') {
    const { writeFileSync, mkdirSync } = await import('fs');
    const { renderChecklistReadme } = await import('./test-pack/_docgen');
    const { readFileSync } = await import('fs');
    const appTsx = readFileSync('apps/web/src/App.tsx', 'utf8');
    const routes = [...new Set([...appTsx.matchAll(/path="([^"]*)"/g)].map((m) => m[1]))]
      .filter((r) => r && r !== '*' && !r.startsWith('/settings') && r !== ':itemId');
    mkdirSync('docs/guides/FULL-SYSTEM-TEST-CHECKLIST', { recursive: true });
    writeFileSync('docs/guides/FULL-SYSTEM-TEST-CHECKLIST/README.md', renderChecklistReadme(ALL_DOMAINS, routes), 'utf8');
    console.log(`[seed-test-pack] เขียน docs/guides/FULL-SYSTEM-TEST-CHECKLIST/README.md แล้ว (${routes.length} route)`);
    return;
  }
```

- [ ] **Step 6: รัน docgen จริง**

Run: `DOCGEN=1 npm --prefix apps/api run seed:test-pack`
Expected: พิมพ์ว่าเขียนไฟล์แล้วพร้อมจำนวน route ประมาณ 180 (213 ลบ `/settings/**` 31 ลบ `*` และ `:itemId`)
เปิดไฟล์ตรวจว่าตารางครบ 19 โดเมน และหัวข้อ 3 มีเฉพาะ route ที่ไม่มีโดเมนครอบจริง ๆ

- [ ] **Step 7: ตรวจ TypeScript**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: ไม่มี error

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/cli/test-pack apps/api/src/cli/seed-test-pack.cli.ts docs/guides/FULL-SYSTEM-TEST-CHECKLIST
git commit -m "feat(test-pack): generate ตารางครอบคลุม route + วิธีล้าง จาก registry"
```

---

## รอบแก้หลัง scrutinize (2026-08-26)

แผนฉบับแรกถูกไล่โค้ดจริงแล้วพบ 8 จุด — แก้ครบแล้วทั้งหมด บันทึกไว้กัน regression:

| # | สิ่งที่พบ | ที่มา | แก้เป็น |
|---|---|---|---|
| 1 | `_module.ts` import `AssetsModule` จาก `modules/assets/assets.module` — **ไม่มีไฟล์** | `modules/assets/` มีแต่ `asset-invoice-received-template.spec.ts` | `AssetModule` จาก `modules/asset/asset.module` |
| 2 | `device-swap` ใช้ `ContractExchangeRequest.reason` — **ไม่มีฟิลด์นี้** | ช่องข้อความจริง: `conditionNote` / `rejectionReason` / `cancelReason` | `conditionNote` (3 จุด + `markerDoc`) |
| 3 | `equity` cleanup ใช้ FK `equityDocumentId` | ชื่อจริงคือ `documentId` | แก้ + ยืนยันว่าโมเดลไม่มี `deletedAt` ⇒ hard delete ถูกแล้ว |
| 4 | hard delete บนโมเดลที่มี `deletedAt` **9 จุด** | `StockCount` `StockCountItem` `StockTransfer` `StockAdjustment` `POItem` `GoodsReceiving(+Item)` `RepairTicket` `OnlineOrder` `OnlineInstallmentApplication` `InspectionResult` ล้วนเป็น soft | เปลี่ยนเป็น `updateMany({ deletedAt })` + เพิ่มกฎลง Global Constraints |
| 5 | `POStatus` ไม่มีค่า `PARTIAL` | ค่าจริงคือ `PARTIALLY_RECEIVED` | แก้ + ถอด `as never` + เติมฟิลด์ `POItem` จาก `seed.ts` |
| 6 | ตาราง "โมดูลไหนโพสต์ JE" มาจาก grep ที่มี false negative | pattern `Template\.execute` มองไม่เห็น `this.template.execute` ⇒ `other-income`/`asset` ขึ้นว่าไม่โพสต์ทั้งที่โพสต์ | เปลี่ยน pattern + เขียนกำกับว่า grep เป็นแค่รายชื่อไฟล์ที่ต้องไปอ่าน (spec §3 R2) |
| 7 | R3 เตือนเรื่อง BullMQ เกินจริง | `NotificationQueueModule.register()` ถูกเรียกจาก `app.module.ts` ที่เดียว และไม่มีใครฉีด `NotificationQueueService` | ตัดคำเตือนออก เหลือเหตุผลเดียวที่จริง (`ScheduleModule.forRoot()`) |
| 8 | `StockAdjustment` + `StockAlert` หายจาก Task 7 ทั้งที่ spec §6 สัญญาไว้ | `StockAlert.reorderPointId` เป็น FK บังคับ ผมเลยตัดเงียบ ๆ | เติมครบ + สร้าง `ReorderPoint` นำ (harvest จาก `seed.ts`) |

**รากของ 1-5 เป็นเรื่องเดียว** — เดาชื่อฟิลด์แทนที่จะอ่าน `prisma/seed.ts` ⇒ เพิ่ม **Task 0** เป็นด่านแรกของแผน

---

## Self-Review

**1. Spec coverage**

| spec § | task ที่ทำ |
|---|---|
| §2 D1 ขยายครบทุกโดเมน | Task 3-10 (19 โดเมน) — Task 0 harvest ของจริงจาก `prisma/seed.ts` ให้ 7 โดเมนก่อน |
| §2 D2 สถานะกลาง | เพดานสถานะระบุในทุก task ของโดเมน |
| §2 D3 ไม่แตะแชท | ไม่มีโดเมนแชทใน registry · Task 13 หัวข้อ 3 ลิสต์ route แชทเป็น "ไม่มีโดเมนครอบ" |
| §2 D4 2-3 แถว/โดเมน | ทุก `ROWS` ยาว 2-4 |
| §2 D5 modular | Task 1 (`DomainSeeder`) |
| §2 D6 โหมดเดินเรื่อง | Task 12 |
| §3 R1 ห้ามเขียน JE เอง | Global Constraints + ไม่มี task ไหนเรียก `journalEntry.create` |
| §3 R2 เพดานก่อนเงินขยับ | Task 5/8/10 ระบุเพดานพร้อมเหตุผลต่อโดเมน |
| §3 R3 ห้าม AppModule | Task 12 Step 2-3 (มี smoke test พิสูจน์ว่า process จบเอง) |
| §4 โครงสร้าง | Task 1 · File Structure |
| §5 3 เฟส | Task 1-10 = เฟส 1-2 · Task 12 = เฟส 3 |
| §6 ตารางโดเมน | Task 3-10 |
| §7 แผนเดินเรื่อง | Task 12 Step 4-5 |
| §8 preflight 4 ข้อ | Task 11 |
| §9 marker 3 ชั้น | Task 1 `_context.ts` + `markerDoc` ทุกโดเมน |
| §10 cleanup + FK sweep | Task 2 + `cleanup` ทุกโดเมน · คำเตือน KEEP_TABLES ที่ equity / suppliers-po / external-finance |
| §12 นอกขอบเขต | Task 13 หัวข้อ 3 |
| §13 ความเสี่ยง | Task 12 Step 9 (พิสูจน์ล้าง JE คืน) · ทุกโดเมน re-run safe |
| §14 checklist README | Task 13 |

**2. Placeholder scan** — ทุก step ที่แก้โค้ดมีโค้ดจริง ยกเว้น Task 12 Step 5 ซึ่งเป็น **ตารางสั่งงานที่ระบุ
service · พารามิเตอร์ · ข้อความ return ครบ** โดยตั้งใจ เพราะลายเซ็นของ DTO ทั้งสี่ต้องอ่านจากโค้ดจริง
ใน Step 1 ก่อน (การเดา DTO ลงไปในแผนจะกลายเป็นโค้ดผิดที่ดูเหมือนถูก)

**3. Type consistency** — `DomainSeeder` · `SeedContext` · `SeedRefs` · `PlanRow` · `SeedStat` ·
`CleanupStat` ใช้ชื่อเดียวกันทุก task · `nextNumberFrom` ประกาศใน Task 4 ใช้ต่อใน Task 5-6 ·
`ctx.refs.secondBranchId` ประกาศใน Task 1 ใช้ใน Task 7 · `TEST_DOC_PREFIX` / `TEST_NAME_PREFIX` /
`TEST_NOTE_MARKER` ประกาศใน Task 1 ใช้ทุก task

**จุดที่แผนสั่งให้ตรวจ schema ก่อนเขียน (ไม่ใช่ placeholder — เป็นการกันโค้ดผิด):** Task 4 Step 7 ·
Task 5 Step 3 · Task 6 Step 2 · Task 7 Step 2 · Task 8 Step 4 · Task 9 Step 4 · Task 10 Step 5 ·
Task 11 Step 5 · Task 12 Step 1 — ทั้งหมดมีคำสั่ง `awk` ที่รันได้จริงพร้อมสิ่งที่คาดหวัง
