# Stock Go-Live (เริ่มใช้คลัง+จัดซื้อจริงบน DB ที่ยังทดสอบ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ล้างคลังให้เป็น 0 (รวม TTFY 604 เครื่อง) ด้วย CLI ที่ย้อนกลับได้ + วางรั้วกันเครื่องทดสอบ↔ลูกค้าจริงข้ามฝั่ง + ให้ `factory:reset` ปฏิเสธเมื่อมีของจริง ตาม spec `docs/superpowers/specs/2026-09-05-stock-go-live-design.md`

**Architecture:** util เดียว `test-data-markers.ts` เป็นแหล่งความจริงของ "อะไรคือข้อมูลทดสอบ" (predicate + Prisma where fragment ที่พิสูจน์ว่าเท่ากัน) — CLI ล้างคลัง (`planWipe` อ่าน → `applyWipe` เขียน ใน Serializable tx เดียว, soft-delete ด้วย timestamp เดียว), รั้ว `assertSameTestSide` ที่ 3 chokepoint (POS / เปิดสัญญา / ใบจอง), และ guard ของ factory reset ต่างก็ import จาก util นี้ ไม่มีสำเนาที่สอง

**Tech Stack:** NestJS 11 + Prisma 6 (PostgreSQL) · jest สำหรับ unit spec (`*.spec.ts`) · vitest สำหรับ DB-backed spec (`*.integration.spec.ts` — jest ignore) · tsx สำหรับ CLI

## Global Constraints

- ค่า marker **ห้ามเปลี่ยน** (cleanup เดิมกวาดด้วยค่าเหล่านี้): `TEST-` · `ทดสอบระบบ` · `[ทดสอบระบบ]` · `ข้อมูลทดสอบระบบ — ลบได้` · `TEST-COUNT-` · `TEST-รุ่นแจ้งเตือน`
- **ไม่**เพิ่มคอลัมน์ `isTest` · **ไม่มี** flag ปิดรั้ว · **ไม่มี** UI ใหม่ · **ไม่แตะ GL/JE** (spec §7)
- Runtime code (`src/modules/**`, `src/utils/**`) **ห้าม import จาก `src/cli/**`** — ทิศทางคือ cli → utils
- ชื่อ env ของ CLI: `EXPECTED_DB_NAME` (บังคับ) · `CONFIRM_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE` · `ALLOW_PROD_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE` · `ONLY_BRANCH_ID=<uuid>` (optional) · guard factory reset: `ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE`
- ชื่อ DB จริงบน prod = `bestchoice`
- Soft-delete เท่านั้น (`deleted_at = wipedAt` ค่าเดียวทั้งรอบ) · AuditLog `action = 'STOCK_GO_LIVE_WIPE'`, `entity = 'product'`
- ข้อความ error เป็นไทย และชี้ทางที่ทำได้จริง (`.claude/rules/coding-standards.md`)
- เงินใช้ `Prisma.Decimal` — ห้าม `Number()` ยกเว้นตอนพิมพ์
- Prettier: semi, singleQuote, printWidth 100, tabWidth 2
- Branch งาน: `feat/stock-go-live-2026-09` (spec commit `95705089f` อยู่บน branch นี้แล้ว) · commit ท้ายด้วย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- คำสั่งรัน (Git Bash, cwd = repo root): unit `cd apps/api && npx jest <path>` · type `./tools/check-types.sh api` · integration `cd apps/api && npx vitest run --no-file-parallelism <path>` (ต้องมี `DATABASE_URL` ชี้ DB dev จริง — ดู `apps/api/.env`)

---

## File Structure

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `apps/api/src/utils/test-data-markers.ts` (ใหม่) + `.spec.ts` | ค่าคงที่ marker · predicate ต่อตาราง · Prisma where fragment (null-safe) · `assertSameTestSide` | 1 |
| `apps/api/src/cli/test-pack/_context.ts` · `apps/api/src/cli/test-pack/stock-ops.seed.ts` · `apps/api/src/cli/seed-test-contracts.cli.ts` | เปลี่ยนมา import ค่าคงที่จาก util (ค่าเท่าเดิม) | 1 |
| `apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts` (ใหม่) | `planWipe` / `applyWipe` / `rollbackSql` / `formatPlan` — ตรรกะทั้งหมด ไม่แตะ process/env | 2 |
| `apps/api/src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts` (ใหม่) | พิสูจน์บน DB จริง + predicate ≡ where | 2 |
| `.github/workflows/deploy-gcp.yml` | glob ใหม่ให้ integration spec ข้างบน | 2 |
| `apps/api/src/cli/wipe-stock-go-live.cli.ts` (ใหม่) · `apps/api/package.json` | entry point: guards env, dry-run/live, พิมพ์แผน + rollback SQL | 3 |
| `apps/api/src/modules/sales/services/sale-creation.service.ts` + `sale-creation.service.spec.ts` (ใหม่) | รั้ว POS | 4 |
| `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts` + `.spec.ts` | รั้วเปิดสัญญา | 5 |
| `apps/api/src/modules/bookings/bookings.service.ts` + `__tests__/bookings.service.spec.ts` | รั้วใบจอง (create + convertToSale) | 6 |
| `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` + `.spec.ts` | auto-mark เครื่องเทิร์นจากลูกค้าทดสอบ | 7 |
| `apps/api/src/cli/stock-go-live/real-stock-guard.ts` (ใหม่) + `.spec.ts` · `apps/api/src/cli/factory-reset.cli.ts` | ด่าน 5 ของ factory reset | 8 |
| `docs/accounting/stock-go-live-runbook-2026-09.md` (ใหม่) · `docs/accounting/factory-reset-runbook-2026-08.md` · `.claude/CLAUDE.md` | runbook + กล่องเตือน + วินัย marker | 9 |

---

### Task 1: util `test-data-markers` — แหล่งความจริงเดียวของ "ข้อมูลทดสอบ"

**Files:**
- Create: `apps/api/src/utils/test-data-markers.ts`
- Create: `apps/api/src/utils/test-data-markers.spec.ts`
- Modify: `apps/api/src/cli/test-pack/_context.ts:4-9`
- Modify: `apps/api/src/cli/test-pack/stock-ops.seed.ts:1,11-12`
- Modify: `apps/api/src/cli/seed-test-contracts.cli.ts:45-58`

**Interfaces:**
- Consumes: nothing new (`@nestjs/common` `BadRequestException`, `@prisma/client` `Prisma` types)
- Produces (ทุก task หลังจากนี้ import จากไฟล์นี้):
  - consts `TEST_DOC_PREFIX`, `TEST_NAME_PREFIX`, `TEST_NOTE_MARKER`, `TEST_CUSTOMER_ADDRESS`, `TEST_STOCK_COUNT_PREFIX`, `TEST_ALERT_MODEL`
  - types `TestSideProduct { imeiSerial: string | null; name: string; po: { poNumber: string } | null }`, `TestSideCustomer { name: string; phone: string; addressCurrent: string | null }`
  - selects `TEST_SIDE_PRODUCT_SELECT`, `TEST_SIDE_CUSTOMER_SELECT`
  - predicates `isTestProduct(p)`, `isTestCustomer(c)`, `isTestSupplier`, `isTestPurchaseOrder`, `isTestNote`, `isTestStockCount`, `isTestAlertModel` → `boolean`
  - where fragments `testProductWhere`, `realProductWhere` (`Prisma.ProductWhereInput`), `testCustomerWhere`, `testPurchaseOrderWhere`, `realPurchaseOrderWhere`, `testNoteWhere`, `realNoteWhere`
  - `assertSameTestSide(customer: TestSideCustomer, product: TestSideProduct): void` — throws `BadRequestException`

- [ ] **Step 1: เขียน spec ที่ยังแดง**

`apps/api/src/utils/test-data-markers.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import {
  TEST_ALERT_MODEL,
  TEST_CUSTOMER_ADDRESS,
  TEST_DOC_PREFIX,
  TEST_NAME_PREFIX,
  TEST_NOTE_MARKER,
  TEST_STOCK_COUNT_PREFIX,
  assertSameTestSide,
  isTestAlertModel,
  isTestCustomer,
  isTestNote,
  isTestProduct,
  isTestPurchaseOrder,
  isTestStockCount,
  isTestSupplier,
} from './test-data-markers';

const realCustomer = { name: 'สมชาย ใจดี', phone: '0891234567', addressCurrent: 'กรุงเทพ' };
const testCustomer = {
  name: 'ทดสอบระบบ ลูกค้า 1',
  phone: 'TEST-0000001',
  addressCurrent: TEST_CUSTOMER_ADDRESS,
};
const realProduct = { imeiSerial: '356789012345678', name: 'iPhone 15 128GB', po: null };
const testProduct = { imeiSerial: 'TEST-0001', name: 'ทดสอบระบบ มือถือ', po: null };

describe('test-data-markers — ค่าคงที่ต้องไม่เปลี่ยน (cleanup เดิมกวาดด้วยค่าเหล่านี้)', () => {
  it('pins marker values', () => {
    expect(TEST_DOC_PREFIX).toBe('TEST-');
    expect(TEST_NAME_PREFIX).toBe('ทดสอบระบบ');
    expect(TEST_NOTE_MARKER).toBe('[ทดสอบระบบ]');
    expect(TEST_CUSTOMER_ADDRESS).toBe('ข้อมูลทดสอบระบบ — ลบได้');
    expect(TEST_STOCK_COUNT_PREFIX).toBe('TEST-COUNT-');
    expect(TEST_ALERT_MODEL).toBe('TEST-รุ่นแจ้งเตือน');
  });
});

describe('isTestProduct', () => {
  it('IMEI ขึ้นต้น TEST-', () => {
    expect(isTestProduct({ imeiSerial: 'TEST-001', name: 'iPhone', po: null })).toBe(true);
  });
  it('ชื่อขึ้นต้น ทดสอบระบบ', () => {
    expect(isTestProduct({ imeiSerial: '3567', name: 'ทดสอบระบบ มือถือ', po: null })).toBe(true);
  });
  it('อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ', () => {
    expect(
      isTestProduct({ imeiSerial: null, name: 'สายชาร์จ', po: { poNumber: 'TEST-PO-0001' } }),
    ).toBe(true);
  });
  it('ของจริง: IMEI จริง ชื่อจริง PO จริง', () => {
    expect(
      isTestProduct({ imeiSerial: '3567', name: 'iPhone', po: { poNumber: 'PO-20260905-0001' } }),
    ).toBe(false);
  });
  it('ของจริงไร้ IMEI ไม่มี PO', () => {
    expect(isTestProduct({ imeiSerial: null, name: 'เคสใส', po: null })).toBe(false);
  });
  it('คำว่า ทดสอบระบบ กลางชื่อ ไม่นับ (prefix เท่านั้น)', () => {
    expect(isTestProduct({ imeiSerial: null, name: 'เครื่อง ทดสอบระบบ', po: null })).toBe(false);
  });
});

describe('isTestCustomer', () => {
  it('ที่อยู่ปัจจุบัน = marker', () => {
    expect(isTestCustomer({ ...realCustomer, addressCurrent: TEST_CUSTOMER_ADDRESS })).toBe(true);
  });
  it('เบอร์ขึ้นต้น TEST-', () => {
    expect(isTestCustomer({ ...realCustomer, phone: 'TEST-0000009' })).toBe(true);
  });
  it('ลูกค้าจริง', () => {
    expect(isTestCustomer(realCustomer)).toBe(false);
  });
  it('ที่อยู่ null = จริง', () => {
    expect(isTestCustomer({ ...realCustomer, addressCurrent: null })).toBe(false);
  });
});

describe('predicate ตารางอื่น', () => {
  it('supplier ตามชื่อ', () => {
    expect(isTestSupplier({ name: 'ทดสอบระบบ ซัพพลายเออร์' })).toBe(true);
    expect(isTestSupplier({ name: 'บริษัท ซัพพลาย จำกัด' })).toBe(false);
  });
  it('PO ตามเลข', () => {
    expect(isTestPurchaseOrder({ poNumber: 'TEST-PO-0001' })).toBe(true);
    expect(isTestPurchaseOrder({ poNumber: 'PO-20260905-0001' })).toBe(false);
  });
  it('notes ตาม marker — null = จริง', () => {
    expect(isTestNote('[ทดสอบระบบ] โอน')).toBe(true);
    expect(isTestNote('โอนไปสาขา 2')).toBe(false);
    expect(isTestNote(null)).toBe(false);
    expect(isTestNote(undefined)).toBe(false);
  });
  it('stock count ตามเลข', () => {
    expect(isTestStockCount({ countNumber: 'TEST-COUNT-0001' })).toBe(true);
    expect(isTestStockCount({ countNumber: 'SC-2026-09-001' })).toBe(false);
  });
  it('alert model = ค่าตรงตัว ไม่ใช่ prefix', () => {
    expect(isTestAlertModel('TEST-รุ่นแจ้งเตือน')).toBe(true);
    expect(isTestAlertModel('TEST-รุ่นแจ้งเตือน 2')).toBe(false);
  });
});

describe('assertSameTestSide', () => {
  it('จริง ↔ จริง ผ่าน', () => {
    expect(() => assertSameTestSide(realCustomer, realProduct)).not.toThrow();
  });
  it('ทดสอบ ↔ ทดสอบ ผ่าน', () => {
    expect(() => assertSameTestSide(testCustomer, testProduct)).not.toThrow();
  });
  it('เครื่องทดสอบ → ลูกค้าจริง: BadRequest ระบุ IMEI + ที่อยู่ marker', () => {
    expect(() => assertSameTestSide(realCustomer, testProduct)).toThrow(BadRequestException);
    try {
      assertSameTestSide(realCustomer, testProduct);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('TEST-0001');
      expect(msg).toContain('เครื่องทดสอบระบบ');
      expect(msg).toContain(TEST_CUSTOMER_ADDRESS);
    }
  });
  it('เครื่องจริง → ลูกค้าทดสอบ: BadRequest ระบุชื่อลูกค้า + IMEI', () => {
    expect(() => assertSameTestSide(testCustomer, realProduct)).toThrow(BadRequestException);
    try {
      assertSameTestSide(testCustomer, realProduct);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('ทดสอบระบบ ลูกค้า 1');
      expect(msg).toContain('356789012345678');
      expect(msg).toContain('ลูกค้าทดสอบระบบ');
    }
  });
  it('เครื่องไร้ IMEI ใช้ชื่อในข้อความ', () => {
    try {
      assertSameTestSide(realCustomer, {
        imeiSerial: null,
        name: 'สายชาร์จ',
        po: { poNumber: 'TEST-PO-0001' },
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('สายชาร์จ');
    }
  });
});
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/utils/test-data-markers.spec.ts`
Expected: FAIL — `Cannot find module './test-data-markers'`

- [ ] **Step 3: เขียน util**

`apps/api/src/utils/test-data-markers.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * แหล่งความจริงเดียวของ "แถวไหนคือข้อมูลทดสอบ" — spec
 * docs/superpowers/specs/2026-09-05-stock-go-live-design.md §3
 *
 * prod ไม่มีคอลัมน์ isTest — มีแต่ marker ที่ test-pack / seed-test-contracts ประทับไว้ และ
 * `cleanup:test-pack` / `cleanup:test-contracts` กวาดด้วย marker ชุดเดียวกัน ⇒ ค่าคงที่ในไฟล์นี้
 * **ห้ามเปลี่ยน** (เทสต์ปักไว้) และห้ามมีสำเนาที่สอง: CLI ล้างคลัง, รั้วกันข้ามฝั่ง, guard ของ
 * factory reset และ test-pack ต้อง import จากที่นี่ทั้งหมด
 *
 * สองรูปต่อตาราง: predicate (ตัดสินจาก object ที่โหลดแล้ว — ใช้ที่รั้ว) กับ Prisma where
 * fragment (ใช้ใน query ของ CLI) — `wipe-stock-go-live.integration.spec.ts` ปักว่าสองรูป
 * ให้ผลตรงกันบน DB จริง
 */

/** marker ของเลขเอกสาร/IMEI ที่ seeder ตั้งเอง (เลขที่ DocNumberService คุมแก้ไม่ได้ ใช้ notes แทน) */
export const TEST_DOC_PREFIX = 'TEST-';
/** marker ของทะเบียนหลัก — อยู่ที่ชื่อ */
export const TEST_NAME_PREFIX = 'ทดสอบระบบ';
/** marker ในฟิลด์ข้อความ (notes) ของเอกสารที่เลขถูกระบบคุม */
export const TEST_NOTE_MARKER = '[ทดสอบระบบ]';
/** marker ลูกค้าทดสอบ — `Customer.addressCurrent` (seed-test-contracts + contracts.seed) */
export const TEST_CUSTOMER_ADDRESS = 'ข้อมูลทดสอบระบบ — ลบได้';
/** `StockCount.countNumber` ของ stock-ops.seed */
export const TEST_STOCK_COUNT_PREFIX = `${TEST_DOC_PREFIX}COUNT-`;
/** `ReorderPoint.model` / `StockAlert.model` ของ stock-ops.seed — เทียบค่าตรงตัว ไม่ใช่ prefix */
export const TEST_ALERT_MODEL = `${TEST_DOC_PREFIX}รุ่นแจ้งเตือน`;

/**
 * `po` เป็น required ในชนิด (ค่า null ได้) เพื่อบังคับให้ผู้เรียก include/select PO มาด้วย —
 * ไม่งั้นอุปกรณ์เสริมที่ไม่มี IMEI จาก PO ทดสอบจะถูกมองเป็นของจริง
 */
export interface TestSideProduct {
  imeiSerial: string | null;
  name: string;
  po: { poNumber: string } | null;
}

export interface TestSideCustomer {
  name: string;
  phone: string;
  addressCurrent: string | null;
}

/** select ขั้นต่ำสำหรับโหลดสินค้าเข้ารั้ว — ใช้กับ `prisma.product.findMany({ select })` */
export const TEST_SIDE_PRODUCT_SELECT = {
  id: true,
  imeiSerial: true,
  name: true,
  po: { select: { poNumber: true } },
} as const;

/** select ขั้นต่ำสำหรับโหลดลูกค้าเข้ารั้ว */
export const TEST_SIDE_CUSTOMER_SELECT = {
  id: true,
  name: true,
  phone: true,
  addressCurrent: true,
} as const;

// ─── predicates ──────────────────────────────────────────────────────────────

export function isTestProduct(p: TestSideProduct): boolean {
  return (
    (p.imeiSerial ?? '').startsWith(TEST_DOC_PREFIX) ||
    p.name.startsWith(TEST_NAME_PREFIX) ||
    (p.po?.poNumber ?? '').startsWith(TEST_DOC_PREFIX)
  );
}

export function isTestCustomer(c: TestSideCustomer): boolean {
  return c.addressCurrent === TEST_CUSTOMER_ADDRESS || c.phone.startsWith(TEST_DOC_PREFIX);
}

export function isTestSupplier(s: { name: string }): boolean {
  return s.name.startsWith(TEST_NAME_PREFIX);
}

export function isTestPurchaseOrder(po: { poNumber: string }): boolean {
  return po.poNumber.startsWith(TEST_DOC_PREFIX);
}

/** stock_transfers / stock_adjustments — marker อยู่ที่ notes; null = ของจริง */
export function isTestNote(notes: string | null | undefined): boolean {
  return (notes ?? '').startsWith(TEST_NOTE_MARKER);
}

export function isTestStockCount(c: { countNumber: string }): boolean {
  return c.countNumber.startsWith(TEST_STOCK_COUNT_PREFIX);
}

export function isTestAlertModel(model: string): boolean {
  return model === TEST_ALERT_MODEL;
}

// ─── Prisma where fragments (null-safe) ──────────────────────────────────────
//
// กับดัก SQL: `NOT (imei_serial LIKE 'TEST-%')` เป็น NULL เมื่อ imei_serial เป็น NULL ⇒ แถวหลุด
// ทั้งสองฝั่ง (ไม่ใช่ทั้ง "ทดสอบ" และไม่ใช่ "จริง") — ฝั่ง real ทุกตัวจึงต้อง OR กับ `= null`
// ให้ชัด (บทเรียนเดียวกับ wipe-test-stock.cli.ts)

export const testProductWhere: Prisma.ProductWhereInput = {
  OR: [
    { imeiSerial: { startsWith: TEST_DOC_PREFIX } },
    { name: { startsWith: TEST_NAME_PREFIX } },
    { po: { poNumber: { startsWith: TEST_DOC_PREFIX } } },
  ],
};

export const realProductWhere: Prisma.ProductWhereInput = {
  AND: [
    { OR: [{ imeiSerial: null }, { NOT: { imeiSerial: { startsWith: TEST_DOC_PREFIX } } }] },
    { NOT: { name: { startsWith: TEST_NAME_PREFIX } } },
    { OR: [{ poId: null }, { po: { NOT: { poNumber: { startsWith: TEST_DOC_PREFIX } } } }] },
  ],
};

export const testCustomerWhere: Prisma.CustomerWhereInput = {
  OR: [{ addressCurrent: TEST_CUSTOMER_ADDRESS }, { phone: { startsWith: TEST_DOC_PREFIX } }],
};

export const testPurchaseOrderWhere: Prisma.PurchaseOrderWhereInput = {
  poNumber: { startsWith: TEST_DOC_PREFIX },
};

export const realPurchaseOrderWhere: Prisma.PurchaseOrderWhereInput = {
  NOT: { poNumber: { startsWith: TEST_DOC_PREFIX } },
};

/** ตารางที่มี `notes String?` — stock_transfers, stock_adjustments */
export const testNoteWhere = {
  notes: { startsWith: TEST_NOTE_MARKER },
} satisfies Prisma.StockTransferWhereInput & Prisma.StockAdjustmentWhereInput;

export const realNoteWhere = {
  OR: [{ notes: null }, { NOT: { notes: { startsWith: TEST_NOTE_MARKER } } }],
} satisfies Prisma.StockTransferWhereInput & Prisma.StockAdjustmentWhereInput;

// ─── รั้วกันข้ามฝั่ง (spec §5) ────────────────────────────────────────────────

/**
 * เครื่องกับลูกค้าต้องอยู่ฝั่งเดียวกัน: ทดสอบ↔ทดสอบ หรือ จริง↔จริง — ผิดฝั่งโยน
 * `BadRequestException` ข้อความไทยที่ชี้ทางที่ทำได้จริง (หน้าแก้ไขลูกค้าแก้ที่อยู่ปัจจุบันได้;
 * IMEI ตั้งตอนรับของ). ไม่มี flag ปิด — หลังล้างข้อมูลทดสอบหมด ไม่มีอะไรถูก mark รั้วก็เงียบเอง
 */
export function assertSameTestSide(customer: TestSideCustomer, product: TestSideProduct): void {
  const testCustomer = isTestCustomer(customer);
  const testProduct = isTestProduct(product);
  if (testCustomer === testProduct) return;

  const label = product.imeiSerial ?? product.name;
  if (testProduct) {
    throw new BadRequestException(
      `เครื่อง ${label} เป็นเครื่องทดสอบระบบ ขายให้ลูกค้าจริงไม่ได้ — ` +
        `เลือกลูกค้าทดสอบ (ที่อยู่ปัจจุบัน = "${TEST_CUSTOMER_ADDRESS}")`,
    );
  }
  throw new BadRequestException(
    `ลูกค้า ${customer.name} เป็นลูกค้าทดสอบระบบ ขายเครื่องจริง ${label} ให้ไม่ได้ — ` +
      `เลือกเครื่องที่ IMEI ขึ้นต้น ${TEST_DOC_PREFIX} หรือแก้ที่อยู่ปัจจุบันของลูกค้าถ้าเป็นลูกค้าจริง`,
  );
}
```

- [ ] **Step 4: รันให้เขียว**

Run: `cd apps/api && npx jest src/utils/test-data-markers.spec.ts`
Expected: PASS (21 tests)

- [ ] **Step 5: ให้ test-pack import ค่าคงที่จาก util (ค่าเท่าเดิม — เทสต์ `_context.spec.ts` เดิมต้องเขียวเหมือนเดิม)**

`apps/api/src/cli/test-pack/_context.ts` — แทนที่บรรทัด 4-9 (สามค่าคงที่พร้อม comment) ด้วย:

```ts
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER } from '../../utils/test-data-markers';

/** ค่าคงที่ marker ย้ายไป `src/utils/test-data-markers.ts` (แหล่งเดียวกับรั้ว/CLI ล้างคลัง) — re-export ให้ผู้เรียกเดิม */
export { TEST_DOC_PREFIX, TEST_NAME_PREFIX, TEST_NOTE_MARKER };
```

(บรรทัด `import type` สองบรรทัดแรกของไฟล์คงไว้ — วาง `import` ใหม่ต่อจากนั้น)

`apps/api/src/cli/test-pack/stock-ops.seed.ts` — แทนที่บรรทัด 11-12:

```ts
const COUNT_NO_PREFIX = `${TEST_DOC_PREFIX}COUNT-`;
const ALERT_MODEL = `${TEST_DOC_PREFIX}รุ่นแจ้งเตือน`;
```

ด้วย:

```ts
const COUNT_NO_PREFIX = TEST_STOCK_COUNT_PREFIX;
const ALERT_MODEL = TEST_ALERT_MODEL;
```

และเพิ่ม import หลังบรรทัด 1:

```ts
import { TEST_ALERT_MODEL, TEST_STOCK_COUNT_PREFIX } from '../../utils/test-data-markers';
```

ถ้า `TEST_DOC_PREFIX` ในบรรทัด 1 ไม่ถูกใช้ที่อื่นในไฟล์แล้ว (grep `TEST_DOC_PREFIX` ในไฟล์) ให้ตัดออกจาก import บรรทัด 1 — ห้ามปล่อย unused import

`apps/api/src/cli/seed-test-contracts.cli.ts` — แทนที่บรรทัด 56-58:

```ts
export const TEST_CUSTOMER_ADDRESS = 'ข้อมูลทดสอบระบบ — ลบได้';
export const TEST_IMEI_PREFIX = 'TEST-';
export const TEST_CONTRACT_PREFIX = 'TEST-';
```

ด้วย:

```ts
export { TEST_CUSTOMER_ADDRESS };
export const TEST_IMEI_PREFIX = TEST_DOC_PREFIX;
export const TEST_CONTRACT_PREFIX = TEST_DOC_PREFIX;
```

และเพิ่ม import ต่อจากบรรทัด 47 (`import { loadLateFeeConfig, ... }`):

```ts
import { TEST_CUSTOMER_ADDRESS, TEST_DOC_PREFIX } from '../utils/test-data-markers';
```

- [ ] **Step 6: type-check + เทสต์ที่พึ่งค่าคงที่เดิม**

Run: `./tools/check-types.sh api`
Expected: `0 errors`

Run: `cd apps/api && npx jest src/cli/test-pack src/utils/test-data-markers.spec.ts`
Expected: PASS ทุกไฟล์ (`_context.spec.ts`, `_registry.spec.ts`, `_helpers.spec.ts`, `_preflight.spec.ts`, `_docgen.spec.ts` ยังเขียว)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/utils/test-data-markers.ts apps/api/src/utils/test-data-markers.spec.ts \
  apps/api/src/cli/test-pack/_context.ts apps/api/src/cli/test-pack/stock-ops.seed.ts \
  apps/api/src/cli/seed-test-contracts.cli.ts
git commit -m "feat(test-data): util marker ข้อมูลทดสอบ — แหล่งเดียวสำหรับ CLI ล้างคลัง/รั้ว/guard (spec 2026-09-05 §3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: ตรรกะล้างคลัง `planWipe` / `applyWipe` + integration spec บน DB จริง + CI glob

**Files:**
- Create: `apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts`
- Create: `apps/api/src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts`
- Modify: `.github/workflows/deploy-gcp.yml:279-295`

**Interfaces:**
- Consumes: Task 1 (`realProductWhere`, `testProductWhere`, `realPurchaseOrderWhere`, `realNoteWhere`, `TEST_STOCK_COUNT_PREFIX`, `TEST_ALERT_MODEL`, `isTestProduct`) · `assertProductNotHeld(client, { id, status, deletedAt }, 'DELETE')` จาก `apps/api/src/modules/products/product-hold.util.ts` (โยน `BadRequestException` เมื่อถูกถือครอง)
- Produces (Task 3 ใช้):
  - `planWipe(tx: Prisma.TransactionClient, wipedAt: Date, opts?: { branchId?: string }): Promise<WipePlan>` — อ่านอย่างเดียว
  - `applyWipe(tx, plan: WipePlan, actorUserId: string): Promise<WipeCounts>` — soft-delete + AuditLog
  - `rollbackSql(wipedAt: Date): string[]` — SQL หนึ่งบรรทัดต่อตารางใน `WIPED_TABLES`
  - `formatPlan(plan: WipePlan, mode: 'DRY-RUN' | 'LIVE', counts?: WipeCounts): string[]`
  - consts `STOCK_GO_LIVE_AUDIT_ACTION = 'STOCK_GO_LIVE_WIPE'`, `WIPED_TABLES`, `ON_SHELF_STATUSES`, `TRANSACTION_BOUND_STATUSES`, `INVENTORY_GL_ACCOUNTS`

- [ ] **Step 1: เขียน integration spec ที่ยังแดง**

`apps/api/src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts`:

```ts
/**
 * wipe:stock-go-live — พิสูจน์บน DB จริง (spec 2026-09-05 §4 + §9)
 *
 * เคส:
 *   1. predicate `isTestProduct` ≡ where fragment `testProductWhere`/`realProductWhere` บน DB จริง
 *      (รวมกับดัก NULL ของ imei_serial / po_id)
 *   2. planWipe เลือกเฉพาะ "ของบนชั้น" ที่ไม่ใช่ทดสอบ · ข้ามเครื่องที่ถูกถือ (จองเว็บ) + เก็บ PO ของมัน ·
 *      สถานะผูกธุรกรรมรายงานแยก · เอกสารเคลื่อนไหวเลือกตาม marker
 *   3. applyWipe: deleted_at ค่าเดียวทั้งรอบ · ตารางลูกตามหัว · ของทดสอบ/ที่ถูกถือไม่ถูกแตะ · AuditLog ·
 *      รันซ้ำ = no-op · rollback SQL คืนทุกแถว — ทั้งหมดใน tx เดียวแล้ว ROLL BACK (DB dev แชร์กัน —
 *      ห้าม commit การล้างจริง)
 *
 * Fixture ตั้งด้วย prisma.create ตรง ๆ (สถานะเริ่มต้นของแถว ไม่ใช่การเปลี่ยนสถานะผ่าน flow)
 * เครื่องที่ "ถูกถือ" ใช้ ProductReservation ACTIVE (ชั้น 3 ของ assertProductNotHeld) — ตั้งง่ายกว่าสัญญา
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && npx vitest run --no-file-parallelism \
 *     src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts
 * CI: glob `STOCK_GO_LIVE_FILES` ใน `.github/workflows/deploy-gcp.yml`
 *
 * Cleanup: sweep ตาม prefix `SGL-` ทั้งก่อนและหลัง (ซากรันที่ crash) — audit_logs immutable ปล่อยไว้
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyWipe,
  planWipe,
  rollbackSql,
  STOCK_GO_LIVE_AUDIT_ACTION,
} from '../wipe-stock-go-live';
import {
  isTestProduct,
  realProductWhere,
  testProductWhere,
  TEST_ALERT_MODEL,
  TEST_NOTE_MARKER,
  TEST_STOCK_COUNT_PREFIX,
} from '../../../utils/test-data-markers';

const prisma = new PrismaClient();
const PREFIX = 'SGL-';
const RUN = Date.now().toString(36).toUpperCase();
const tag = (s: string) => `${PREFIX}${RUN}-${s}`;
const dec = (s: string) => new Prisma.Decimal(s);

class Rollback extends Error {}

let adminId: string;
let shopCompanyId: string;
let branchId: string;

type P = { id: string };
let supplierReal: P, supplierTest: P, po1: P, po2: P, poTest: P, gr1: P, gr2: P;
let A: P, B: P, C: P, D: P, E: P, F: P, G: P, H: P;
let transferReal: P, transferTest: P, brReal: P, countReal: P, countTest: P;
let adjReal: P, adjTest: P, alertReal: P, alertTest: P;

async function product(data: Partial<Prisma.ProductUncheckedCreateInput> & { name: string }) {
  return prisma.product.create({
    data: {
      brand: 'SGL',
      model: tag('MODEL'),
      category: 'PHONE_NEW',
      costPrice: dec('1000.00'),
      branchId,
      status: 'IN_STOCK',
      ownedByCompanyId: shopCompanyId,
      stockInDate: new Date(),
      ...data,
    } as Prisma.ProductUncheckedCreateInput,
    select: { id: true },
  });
}

/** ล้างซาก SGL- ทุกรัน (RUN-independent) — ลำดับตาม FK */
async function sweep() {
  const products = await prisma.product.findMany({
    where: {
      OR: [
        { imeiSerial: { startsWith: PREFIX } },
        { imeiSerial: { startsWith: `TEST-${PREFIX}` } },
        { name: { startsWith: 'SGL ' } },
        { name: { startsWith: `ทดสอบระบบ ${PREFIX}` } },
        { legacyProductCode: { startsWith: `TTFY-${PREFIX}` } },
      ],
    },
    select: { id: true },
  });
  const pids = products.map((p) => p.id);
  await prisma.productReservation.deleteMany({ where: { productId: { in: pids } } });
  await prisma.stockCountItem.deleteMany({ where: { productId: { in: pids } } });
  await prisma.stockCount.deleteMany({
    where: {
      OR: [
        { countNumber: { startsWith: PREFIX } },
        { countNumber: { startsWith: `${TEST_STOCK_COUNT_PREFIX}${PREFIX}` } },
      ],
    },
  });
  await prisma.stockAdjustment.deleteMany({ where: { productId: { in: pids } } });
  await prisma.branchReceivingItem.deleteMany({ where: { productId: { in: pids } } });
  const transfers = await prisma.stockTransfer.findMany({
    where: { productId: { in: pids } },
    select: { id: true },
  });
  await prisma.branchReceiving.deleteMany({
    where: { transferId: { in: transfers.map((t) => t.id) } },
  });
  await prisma.stockTransfer.deleteMany({ where: { productId: { in: pids } } });
  await prisma.stockAlert.deleteMany({ where: { brand: 'SGL' } });
  await prisma.reorderPoint.deleteMany({ where: { brand: 'SGL' } });
  await prisma.product.deleteMany({ where: { id: { in: pids } } });
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      OR: [{ poNumber: { startsWith: PREFIX } }, { poNumber: { startsWith: `TEST-PO-${PREFIX}` } }],
    },
    select: { id: true },
  });
  const poIds = pos.map((p) => p.id);
  await prisma.goodsReceivingItem.deleteMany({ where: { receiving: { poId: { in: poIds } } } });
  await prisma.goodsReceiving.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.pOItem.deleteMany({ where: { poId: { in: poIds } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  await prisma.supplier.deleteMany({
    where: {
      OR: [{ name: { startsWith: PREFIX } }, { name: { startsWith: `ทดสอบระบบ ${PREFIX}` } }],
    },
  });
}

describe('wipe:stock-go-live — flow จริงบน DB จริง', () => {
  beforeAll(async () => {
    const shop = await prisma.companyInfo.findFirstOrThrow({
      where: { companyCode: 'SHOP', deletedAt: null },
    });
    shopCompanyId = shop.id;

    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' },
      });
    }
    adminId = admin.id;

    const branchName = '__stockgolive_branch__';
    const existing = await prisma.branch.findFirst({ where: { name: branchName, deletedAt: null } });
    branchId = existing
      ? existing.id
      : (
          await prisma.branch.create({
            data: { name: branchName, companyId: shopCompanyId, shopCashAccountCode: 'S11-1101' },
          })
        ).id;

    await sweep();

    supplierReal = await prisma.supplier.create({
      data: { name: tag('Supplier'), phone: '0200000000' },
      select: { id: true },
    });
    supplierTest = await prisma.supplier.create({
      data: { name: `ทดสอบระบบ ${tag('Supplier')}`, phone: '0200000001' },
      select: { id: true },
    });
    const po = (poNumber: string, supplierId: string) =>
      prisma.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          orderDate: new Date(),
          totalAmount: dec('2000.00'),
          createdById: adminId,
          items: { create: [{ quantity: 2, unitPrice: dec('1000.00') }] },
        },
        select: { id: true },
      });
    po1 = await po(tag('PO1'), supplierReal.id);
    po2 = await po(tag('PO2'), supplierReal.id);
    poTest = await po(`TEST-PO-${tag('X')}`, supplierTest.id);
    gr1 = await prisma.goodsReceiving.create({
      data: { grNumber: tag('GR1'), poId: po1.id, receivedById: adminId },
      select: { id: true },
    });
    gr2 = await prisma.goodsReceiving.create({
      data: { grNumber: tag('GR2'), poId: po2.id, receivedById: adminId },
      select: { id: true },
    });

    A = await product({
      name: 'SGL TTFY A',
      imeiSerial: tag('A'),
      legacyProductCode: `TTFY-${tag('A')}`,
      poId: po1.id,
    });
    B = await product({
      name: 'SGL Plain B',
      imeiSerial: tag('B'),
      category: 'PHONE_USED',
      status: 'PHOTO_PENDING',
    });
    C = await product({ name: 'SGL Test C', imeiSerial: `TEST-${tag('C')}`, isOnlineVisible: true });
    D = await product({ name: `ทดสอบระบบ ${tag('D')}`, imeiSerial: tag('D') });
    E = await product({ name: 'SGL Cable E', imeiSerial: null, category: 'ACCESSORY', poId: poTest.id });
    F = await product({ name: 'SGL Held F', imeiSerial: tag('F'), poId: po2.id });
    await prisma.productReservation.create({
      data: {
        productId: F.id,
        sessionId: tag('SESSION'),
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    G = await product({ name: 'SGL Sold G', imeiSerial: tag('G'), status: 'SOLD_CASH' });
    H = await product({ name: 'SGL Case H', imeiSerial: null, category: 'ACCESSORY', poId: po1.id });

    transferReal = await prisma.stockTransfer.create({
      data: { productId: A.id, fromBranchId: branchId, toBranchId: branchId, transferredBy: adminId },
      select: { id: true },
    });
    transferTest = await prisma.stockTransfer.create({
      data: {
        productId: C.id,
        fromBranchId: branchId,
        toBranchId: branchId,
        transferredBy: adminId,
        notes: `${TEST_NOTE_MARKER} โอนทดสอบ`,
      },
      select: { id: true },
    });
    brReal = await prisma.branchReceiving.create({
      data: {
        transferId: transferReal.id,
        receivedById: adminId,
        items: { create: [{ productId: A.id, status: 'PASS' }] },
      },
      select: { id: true },
    });
    countReal = await prisma.stockCount.create({
      data: {
        countNumber: tag('COUNT'),
        branchId,
        countedById: adminId,
        items: { create: [{ productId: A.id, expectedStatus: 'IN_STOCK' }] },
      },
      select: { id: true },
    });
    countTest = await prisma.stockCount.create({
      data: { countNumber: `${TEST_STOCK_COUNT_PREFIX}${tag('X')}`, branchId, countedById: adminId },
      select: { id: true },
    });
    adjReal = await prisma.stockAdjustment.create({
      data: {
        productId: A.id,
        branchId,
        reason: 'CORRECTION',
        previousStatus: 'IN_STOCK',
        adjustedById: adminId,
        approvedById: adminId,
      },
      select: { id: true },
    });
    adjTest = await prisma.stockAdjustment.create({
      data: {
        productId: C.id,
        branchId,
        reason: 'CORRECTION',
        previousStatus: 'IN_STOCK',
        adjustedById: adminId,
        approvedById: adminId,
        notes: `${TEST_NOTE_MARKER} ปรับทดสอบ`,
      },
      select: { id: true },
    });
    const rp = await prisma.reorderPoint.create({
      data: {
        brand: 'SGL',
        model: tag('RP'),
        category: 'PHONE_NEW',
        branchId,
        minQuantity: 1,
        reorderQuantity: 1,
      },
      select: { id: true },
    });
    const alert = (model: string) =>
      prisma.stockAlert.create({
        data: {
          reorderPointId: rp.id,
          brand: 'SGL',
          model,
          category: 'PHONE_NEW',
          branchId,
          currentStock: 0,
          minQuantity: 1,
          reorderQuantity: 1,
        },
        select: { id: true },
      });
    alertReal = await alert(tag('ALERT'));
    alertTest = await alert(TEST_ALERT_MODEL);
  }, 120_000);

  afterAll(async () => {
    await sweep();
    await prisma.$disconnect();
  });

  it('1. predicate isTestProduct ≡ where fragment บน DB จริง (รวมเคส imei/po เป็น NULL)', async () => {
    const ids = [A, B, C, D, E, F, G, H].map((p) => p.id);
    const rows = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, imeiSerial: true, name: true, po: { select: { poNumber: true } } },
    });
    const viaPredicate = rows.filter(isTestProduct).map((r) => r.id).sort();
    const viaTestWhere = (
      await prisma.product.findMany({
        where: { id: { in: ids }, AND: [testProductWhere] },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .sort();
    const viaRealWhere = (
      await prisma.product.findMany({
        where: { id: { in: ids }, AND: [realProductWhere] },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .sort();

    expect(viaPredicate).toEqual([C.id, D.id, E.id].sort());
    expect(viaTestWhere).toEqual(viaPredicate);
    expect(viaRealWhere).toEqual([A.id, B.id, F.id, G.id, H.id].sort());
    expect(viaTestWhere.length + viaRealWhere.length).toBe(ids.length); // ไม่มีแถวหลุดสองฝั่ง
  });

  it('2. planWipe — ของบนชั้นที่ไม่ใช่ทดสอบ / ข้ามที่ถูกถือ + เก็บ PO / ผูกธุรกรรมรายงานแยก / เอกสารตาม marker', async () => {
    const plan = await planWipe(prisma, new Date(), { branchId });

    expect(plan.products.map((p) => p.id).sort()).toEqual([A.id, B.id, H.id].sort());
    expect(plan.skipped.map((s) => s.id)).toEqual([F.id]);
    expect(plan.skipped[0].reason).toContain('จอง');
    expect(plan.bound.map((b) => b.id)).toEqual([G.id]);

    expect(plan.purchaseOrderIds).toContain(po1.id);
    expect(plan.purchaseOrderIds).not.toContain(po2.id);
    expect(plan.purchaseOrderIds).not.toContain(poTest.id);
    expect(plan.keptPurchaseOrders.map((k) => k.id)).toContain(po2.id);
    expect(plan.goodsReceivingIds).toContain(gr1.id);
    expect(plan.goodsReceivingIds).not.toContain(gr2.id);

    expect(plan.stockTransferIds).toEqual([transferReal.id]);
    expect(plan.branchReceivingIds).toEqual([brReal.id]);
    expect(plan.stockCountIds).toEqual([countReal.id]);
    expect(plan.stockAdjustmentIds).toEqual([adjReal.id]);
    expect(plan.stockAlertIds).toEqual([alertReal.id]);

    expect(plan.testProductsRemaining).toBe(3);
    expect(plan.testProductsOnlineVisible.map((p) => p.id)).toContain(C.id);
    expect(plan.glInventory.map((g) => g.code)).toEqual(['S11-2001', 'S11-2002', 'S11-2003']);
    expect(plan.tradeInProductCount).toBe(0);
  });

  it('3. applyWipe — timestamp เดียว · ตารางลูกตามหัว · ของทดสอบ/ที่ถูกถือรอด · audit · รันซ้ำ no-op · rollback คืนครบ', async () => {
    const wipedAt = new Date();
    const allProductIds = [A, B, C, D, E, F, G, H].map((p) => p.id);

    await expect(
      prisma.$transaction(
        async (tx) => {
          const plan = await planWipe(tx, wipedAt, { branchId });
          const counts = await applyWipe(tx, plan, adminId);
          expect(counts.products).toBe(3);
          expect(counts.stock_transfers).toBe(1);
          expect(counts.branch_receivings).toBe(1);
          expect(counts.branch_receiving_items).toBe(1);
          expect(counts.stock_counts).toBe(1);
          expect(counts.stock_count_items).toBe(1);
          expect(counts.stock_adjustments).toBe(1);
          expect(counts.stock_alerts).toBe(1);
          expect(counts.purchase_orders).toBeGreaterThanOrEqual(1);
          expect(counts.po_items).toBeGreaterThanOrEqual(1);
          expect(counts.goods_receivings).toBeGreaterThanOrEqual(1);

          const at = async (table: 'product' | 'purchaseOrder' | 'goodsReceiving' | 'stockTransfer' | 'branchReceiving' | 'stockCount' | 'stockAdjustment' | 'stockAlert', id: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const row = await (tx as any)[table].findUniqueOrThrow({ where: { id }, select: { deletedAt: true } });
            return (row.deletedAt as Date | null)?.getTime() ?? null;
          };
          for (const id of [A.id, B.id, H.id]) expect(await at('product', id)).toBe(wipedAt.getTime());
          for (const id of [C.id, D.id, E.id, F.id, G.id]) expect(await at('product', id)).toBeNull();
          expect(await at('purchaseOrder', po1.id)).toBe(wipedAt.getTime());
          expect(await at('purchaseOrder', po2.id)).toBeNull();
          expect(await at('purchaseOrder', poTest.id)).toBeNull();
          expect(await at('goodsReceiving', gr1.id)).toBe(wipedAt.getTime());
          expect(await at('goodsReceiving', gr2.id)).toBeNull();
          expect(await at('stockTransfer', transferReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockTransfer', transferTest.id)).toBeNull();
          expect(await at('branchReceiving', brReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockCount', countReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockCount', countTest.id)).toBeNull();
          expect(await at('stockAdjustment', adjReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockAdjustment', adjTest.id)).toBeNull();
          expect(await at('stockAlert', alertReal.id)).toBe(wipedAt.getTime());
          expect(await at('stockAlert', alertTest.id)).toBeNull();

          const poItems = await tx.pOItem.findMany({ where: { poId: po1.id }, select: { deletedAt: true } });
          expect(poItems.every((i) => i.deletedAt?.getTime() === wipedAt.getTime())).toBe(true);
          const countItems = await tx.stockCountItem.findMany({ where: { stockCountId: countReal.id }, select: { deletedAt: true } });
          expect(countItems.every((i) => i.deletedAt?.getTime() === wipedAt.getTime())).toBe(true);
          const brItems = await tx.branchReceivingItem.findMany({ where: { receivingId: brReal.id }, select: { deletedAt: true } });
          expect(brItems.every((i) => i.deletedAt?.getTime() === wipedAt.getTime())).toBe(true);

          const audit = await tx.auditLog.findFirst({
            where: { action: STOCK_GO_LIVE_AUDIT_ACTION, entityId: wipedAt.toISOString() },
          });
          expect(audit).toBeTruthy();
          expect(audit!.userId).toBe(adminId);
          const nv = audit!.newValue as { counts: Record<string, number>; skipped: { id: string }[] };
          expect(nv.counts.products).toBe(3);
          expect(nv.skipped.map((s) => s.id)).toEqual([F.id]);

          // รันซ้ำ = no-op (เป้าหมายหมดแล้ว; PO2 ยังถูกเก็บเพราะ F ยังถูกถือ)
          const again = await planWipe(tx, new Date(), { branchId });
          expect(again.products).toEqual([]);
          expect(again.stockTransferIds).toEqual([]);
          expect(again.stockCountIds).toEqual([]);
          expect(again.purchaseOrderIds).not.toContain(po1.id);
          expect(again.keptPurchaseOrders.map((k) => k.id)).toContain(po2.id);

          // rollback SQL คืนทุกแถว
          for (const sql of rollbackSql(wipedAt)) await tx.$executeRawUnsafe(sql);
          for (const id of allProductIds) expect(await at('product', id)).toBeNull();
          expect(await at('purchaseOrder', po1.id)).toBeNull();
          expect(await at('goodsReceiving', gr1.id)).toBeNull();
          expect(await at('stockTransfer', transferReal.id)).toBeNull();
          expect(await at('branchReceiving', brReal.id)).toBeNull();
          expect(await at('stockCount', countReal.id)).toBeNull();
          expect(await at('stockAdjustment', adjReal.id)).toBeNull();
          expect(await at('stockAlert', alertReal.id)).toBeNull();
          const poItemsBack = await tx.pOItem.findMany({ where: { poId: po1.id }, select: { deletedAt: true } });
          expect(poItemsBack.every((i) => i.deletedAt === null)).toBe(true);

          throw new Rollback();
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000, maxWait: 10_000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);

    // นอก tx: ไม่มีอะไร commit
    const after = await prisma.product.findMany({
      where: { id: { in: allProductIds } },
      select: { deletedAt: true },
    });
    expect(after.every((p) => p.deletedAt === null)).toBe(true);
  }, 120_000);
});
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts`
Expected: FAIL — `Failed to resolve import "../wipe-stock-go-live"`

- [ ] **Step 3: เขียนตรรกะ**

`apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts`:

```ts
/**
 * ล้างคลังก่อนเริ่มใช้จริง — spec docs/superpowers/specs/2026-09-05-stock-go-live-design.md §4
 *
 * แยก "อ่าน" (planWipe) กับ "เขียน" (applyWipe) ให้ CLI (wipe-stock-go-live.cli.ts) เรียกทั้งคู่
 * ใน Serializable tx เดียว — plan คำนวณ **ใน** tx เพื่อกันใบขายที่ commit ระหว่าง plan กับ apply.
 * ไฟล์นี้ไม่แตะ process.env / console — ให้ integration spec เรียกตรง ๆ ได้
 *
 * กติกา (spec §4.2-4.4):
 *   - สินค้า: ล้างเฉพาะ "ของบนชั้น" (ON_SHELF_STATUSES) ที่ไม่ใช่ทดสอบ และผ่านด่าน
 *     `assertProductNotHeld(..., 'DELETE')` — ติดด่าน = ข้าม+รายงาน ไม่ลบ
 *   - สถานะผูกธุรกรรม (TRANSACTION_BOUND_STATUSES) ไม่แตะ รายงานแยก
 *   - PO ที่ยังมีเครื่องที่ไม่ถูกล้างชี้อยู่ → เก็บ+รายงาน (ไม่ปล่อยให้เครื่องชี้ PO ที่ถูกลบ)
 *   - ทุกแถว soft-delete ด้วย `wipedAt` ค่าเดียว ⇒ rollback = UPDATE ... WHERE deleted_at = wipedAt
 *   - ไม่แตะ suppliers / reorder_points / inspections / imported_sales / trade_ins / GL
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { assertProductNotHeld } from '../../modules/products/product-hold.util';
import {
  realNoteWhere,
  realProductWhere,
  realPurchaseOrderWhere,
  testProductWhere,
  TEST_ALERT_MODEL,
  TEST_STOCK_COUNT_PREFIX,
} from '../../utils/test-data-markers';

export const STOCK_GO_LIVE_AUDIT_ACTION = 'STOCK_GO_LIVE_WIPE';
export const INVENTORY_GL_ACCOUNTS = ['S11-2001', 'S11-2002', 'S11-2003'] as const;

type StatusClass = 'SHELF' | 'BOUND';
/**
 * `satisfies Record<ProductStatus, ...>` — สถานะใหม่ใน enum จะ compile ไม่ผ่านจนกว่าจะตัดสินว่า
 * อยู่บนชั้น (ล้างได้) หรือผูกธุรกรรม (ไม่แตะ) — pattern เดียวกับ FOUND_POLICY
 */
export const STATUS_CLASS = {
  PO_RECEIVED: 'SHELF',
  QC_PENDING: 'SHELF',
  PHOTO_PENDING: 'SHELF',
  INSPECTION: 'SHELF',
  IN_STOCK: 'SHELF',
  REFURBISHED: 'SHELF',
  DAMAGED: 'SHELF',
  DEFECT_RETURN: 'SHELF',
  LOST: 'SHELF',
  WRITTEN_OFF: 'SHELF',
  RESERVED: 'BOUND',
  SOLD_INSTALLMENT: 'BOUND',
  SOLD_CASH: 'BOUND',
  SOLD_RESELL: 'BOUND',
  REPOSSESSED: 'BOUND',
} satisfies Record<ProductStatus, StatusClass>;

const statusesOf = (cls: StatusClass): ProductStatus[] =>
  (Object.keys(STATUS_CLASS) as ProductStatus[]).filter((s) => STATUS_CLASS[s] === cls);
export const ON_SHELF_STATUSES: ProductStatus[] = statusesOf('SHELF');
export const TRANSACTION_BOUND_STATUSES: ProductStatus[] = statusesOf('BOUND');

/** ตารางที่ถูก soft-delete ด้วย timestamp เดียว — ลำดับนี้ = ลำดับ rollback SQL */
export const WIPED_TABLES = [
  'products',
  'purchase_orders',
  'po_items',
  'goods_receivings',
  'goods_receiving_items',
  'stock_transfers',
  'branch_receivings',
  'branch_receiving_items',
  'stock_counts',
  'stock_count_items',
  'stock_adjustments',
  'stock_alerts',
] as const;
export type WipedTable = (typeof WIPED_TABLES)[number];
export type WipeCounts = Record<WipedTable, number>;

export type WipeClient = Prisma.TransactionClient;

export interface PlanProduct {
  id: string;
  imeiSerial: string | null;
  name: string;
  status: ProductStatus;
  category: string;
  branchName: string;
  /** 2dp string — ห้ามแปลงเป็น number นอกจากตอนพิมพ์ */
  costPrice: string;
  poId: string | null;
}
export interface SkippedProduct extends PlanProduct {
  reason: string;
}
export interface KeptPurchaseOrder {
  id: string;
  poNumber: string;
  reason: string;
}
export interface WipePlan {
  wipedAt: Date;
  branchId: string | null;
  products: PlanProduct[];
  skipped: SkippedProduct[];
  bound: PlanProduct[];
  purchaseOrderIds: string[];
  purchaseOrderNumbers: string[];
  keptPurchaseOrders: KeptPurchaseOrder[];
  goodsReceivingIds: string[];
  stockTransferIds: string[];
  branchReceivingIds: string[];
  stockCountIds: string[];
  stockAdjustmentIds: string[];
  stockAlertIds: string[];
  testProductsRemaining: number;
  testProductsOnlineVisible: { id: string; name: string; imeiSerial: string | null }[];
  tradeInProductCount: number;
  glInventory: { code: string; balance: string }[];
}
export interface WipeOptions {
  /** ล้างเฉพาะสาขา (สินค้า/โอน/นับ/ปรับ/แจ้งเตือน) — PO/ใบรับของไม่มีสาขา จึงเป็นทั้ง DB เสมอ */
  branchId?: string;
}

const PRODUCT_SELECT = {
  id: true,
  imeiSerial: true,
  name: true,
  status: true,
  category: true,
  costPrice: true,
  poId: true,
  deletedAt: true,
  branch: { select: { name: true } },
} satisfies Prisma.ProductSelect;
type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

const toPlanProduct = (p: ProductRow): PlanProduct => ({
  id: p.id,
  imeiSerial: p.imeiSerial,
  name: p.name,
  status: p.status,
  category: p.category,
  branchName: p.branch.name,
  costPrice: p.costPrice.toFixed(2),
  poId: p.poId,
});

export async function planWipe(
  tx: WipeClient,
  wipedAt: Date,
  opts: WipeOptions = {},
): Promise<WipePlan> {
  const branchScope = opts.branchId ? { branchId: opts.branchId } : {};

  // ── สินค้าบนชั้น (ผ่านด่านถือครองทีละเครื่อง) ─────────────────────────────
  const shelfRows = await tx.product.findMany({
    where: {
      deletedAt: null,
      status: { in: ON_SHELF_STATUSES },
      ...branchScope,
      AND: [realProductWhere],
    },
    select: PRODUCT_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const products: PlanProduct[] = [];
  const skipped: SkippedProduct[] = [];
  for (const row of shelfRows) {
    try {
      await assertProductNotHeld(
        tx,
        { id: row.id, status: row.status, deletedAt: row.deletedAt },
        'DELETE',
      );
      products.push(toPlanProduct(row));
    } catch (err) {
      if (!(err instanceof BadRequestException)) throw err;
      skipped.push({ ...toPlanProduct(row), reason: err.message });
    }
  }

  const boundRows = await tx.product.findMany({
    where: {
      deletedAt: null,
      status: { in: TRANSACTION_BOUND_STATUSES },
      ...branchScope,
      AND: [realProductWhere],
    },
    select: PRODUCT_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const bound = boundRows.map(toPlanProduct);

  // ── PO: เก็บทุกใบที่ยังมีเครื่อง live ที่ไม่ถูกล้างชี้อยู่ (ทั้ง DB ไม่ใช่เฉพาะสาขา) ──
  const wipeIds = products.map((p) => p.id);
  const survivorPoRows = await tx.product.findMany({
    where: { deletedAt: null, poId: { not: null }, id: { notIn: wipeIds } },
    select: { poId: true },
    distinct: ['poId'],
  });
  const survivorPoIds = new Set(survivorPoRows.map((r) => r.poId as string));
  const poRows = await tx.purchaseOrder.findMany({
    where: { deletedAt: null, ...realPurchaseOrderWhere },
    select: { id: true, poNumber: true },
    orderBy: { createdAt: 'asc' },
  });
  const purchaseOrderIds: string[] = [];
  const purchaseOrderNumbers: string[] = [];
  const keptPurchaseOrders: KeptPurchaseOrder[] = [];
  for (const po of poRows) {
    if (survivorPoIds.has(po.id)) {
      keptPurchaseOrders.push({
        id: po.id,
        poNumber: po.poNumber,
        reason: 'ยังมีเครื่องที่ไม่ถูกล้าง (ถูกถือ/ผูกธุรกรรม/ทดสอบ) ชี้มาที่ PO นี้',
      });
    } else {
      purchaseOrderIds.push(po.id);
      purchaseOrderNumbers.push(po.poNumber);
    }
  }
  const goodsReceivingIds = (
    await tx.goodsReceiving.findMany({
      where: { deletedAt: null, poId: { in: purchaseOrderIds } },
      select: { id: true },
    })
  ).map((r) => r.id);

  // ── เอกสารเคลื่อนไหว (ตาม marker) ────────────────────────────────────────
  const transferScope: Prisma.StockTransferWhereInput[] = opts.branchId
    ? [{ OR: [{ fromBranchId: opts.branchId }, { toBranchId: opts.branchId }] }]
    : [];
  const stockTransferIds = (
    await tx.stockTransfer.findMany({
      where: { deletedAt: null, AND: [realNoteWhere, ...transferScope] },
      select: { id: true },
    })
  ).map((r) => r.id);
  const branchReceivingIds = (
    await tx.branchReceiving.findMany({
      where: { deletedAt: null, transferId: { in: stockTransferIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const stockCountIds = (
    await tx.stockCount.findMany({
      where: {
        deletedAt: null,
        ...branchScope,
        NOT: { countNumber: { startsWith: TEST_STOCK_COUNT_PREFIX } },
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  const stockAdjustmentIds = (
    await tx.stockAdjustment.findMany({
      where: { deletedAt: null, ...branchScope, AND: [realNoteWhere] },
      select: { id: true },
    })
  ).map((r) => r.id);
  const stockAlertIds = (
    await tx.stockAlert.findMany({
      where: { deletedAt: null, ...branchScope, NOT: { model: TEST_ALERT_MODEL } },
      select: { id: true },
    })
  ).map((r) => r.id);

  // ── ข้อมูลประกอบสำหรับ dry-run ──────────────────────────────────────────
  const testProductsRemaining = await tx.product.count({
    where: { deletedAt: null, ...branchScope, AND: [testProductWhere] },
  });
  const testProductsOnlineVisible = await tx.product.findMany({
    where: { deletedAt: null, isOnlineVisible: true, ...branchScope, AND: [testProductWhere] },
    select: { id: true, name: true, imeiSerial: true },
  });
  const tradeInProductCount = await tx.tradeIn.count({
    where: { deletedAt: null, productId: { in: wipeIds } },
  });
  const glRows = await tx.$queryRaw<{ code: string; balance: string }[]>`
    SELECT coa.code AS code,
           COALESCE(SUM(CASE WHEN je.status = 'POSTED' AND je.deleted_at IS NULL
                             THEN jl.debit - jl.credit ELSE 0 END), 0)::text AS balance
    FROM chart_of_accounts coa
    LEFT JOIN journal_lines jl ON jl.account_code = coa.code AND jl.deleted_at IS NULL
    LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE coa.code IN (${Prisma.join([...INVENTORY_GL_ACCOUNTS])})
    GROUP BY coa.code
    ORDER BY coa.code`;
  const glMap = new Map(glRows.map((r) => [r.code, r.balance]));
  const glInventory = INVENTORY_GL_ACCOUNTS.map((code) => ({
    code,
    balance: glMap.get(code) ?? '0',
  }));

  return {
    wipedAt,
    branchId: opts.branchId ?? null,
    products,
    skipped,
    bound,
    purchaseOrderIds,
    purchaseOrderNumbers,
    keptPurchaseOrders,
    goodsReceivingIds,
    stockTransferIds,
    branchReceivingIds,
    stockCountIds,
    stockAdjustmentIds,
    stockAlertIds,
    testProductsRemaining,
    testProductsOnlineVisible,
    tradeInProductCount,
    glInventory,
  };
}

export async function applyWipe(
  tx: WipeClient,
  plan: WipePlan,
  actorUserId: string,
): Promise<WipeCounts> {
  const at = plan.wipedAt;
  const soft = { deletedAt: at };
  const productIds = plan.products.map((p) => p.id);

  const counts: WipeCounts = {
    products: (
      await tx.product.updateMany({ where: { id: { in: productIds }, deletedAt: null }, data: soft })
    ).count,
    purchase_orders: (
      await tx.purchaseOrder.updateMany({
        where: { id: { in: plan.purchaseOrderIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    po_items: (
      await tx.pOItem.updateMany({
        where: { poId: { in: plan.purchaseOrderIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    goods_receivings: (
      await tx.goodsReceiving.updateMany({
        where: { id: { in: plan.goodsReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    goods_receiving_items: (
      await tx.goodsReceivingItem.updateMany({
        where: { receivingId: { in: plan.goodsReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_transfers: (
      await tx.stockTransfer.updateMany({
        where: { id: { in: plan.stockTransferIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    branch_receivings: (
      await tx.branchReceiving.updateMany({
        where: { id: { in: plan.branchReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    branch_receiving_items: (
      await tx.branchReceivingItem.updateMany({
        where: { receivingId: { in: plan.branchReceivingIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_counts: (
      await tx.stockCount.updateMany({
        where: { id: { in: plan.stockCountIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_count_items: (
      await tx.stockCountItem.updateMany({
        where: { stockCountId: { in: plan.stockCountIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_adjustments: (
      await tx.stockAdjustment.updateMany({
        where: { id: { in: plan.stockAdjustmentIds }, deletedAt: null },
        data: soft,
      })
    ).count,
    stock_alerts: (
      await tx.stockAlert.updateMany({
        where: { id: { in: plan.stockAlertIds }, deletedAt: null },
        data: soft,
      })
    ).count,
  };

  // ใน tx เดียวกัน (atomic) — แลกกับไม่มี rowHash ตามกติกา database.md "AuditLog — ใน tx"
  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: STOCK_GO_LIVE_AUDIT_ACTION,
      entity: 'product',
      entityId: at.toISOString(),
      newValue: {
        wipedAt: at.toISOString(),
        branchId: plan.branchId,
        counts,
        skipped: plan.skipped.map((s) => ({
          id: s.id,
          imeiSerial: s.imeiSerial,
          name: s.name,
          status: s.status,
          reason: s.reason,
        })),
        bound: plan.bound.map((b) => ({
          id: b.id,
          imeiSerial: b.imeiSerial,
          name: b.name,
          status: b.status,
        })),
        keptPurchaseOrders: plan.keptPurchaseOrders,
        wipedPurchaseOrders: plan.purchaseOrderNumbers,
      } as Prisma.InputJsonValue,
    },
  });

  return counts;
}

/** SQL ย้อนกลับ — หนึ่งบรรทัดต่อตาราง; Postgres เทียบ timestamp(3) กับ ISO string ตรง ๆ ได้ */
export function rollbackSql(wipedAt: Date): string[] {
  const ts = wipedAt.toISOString();
  return WIPED_TABLES.map(
    (t) => `UPDATE "${t}" SET deleted_at = NULL WHERE deleted_at = '${ts}';`,
  );
}

const groupCount = <T>(rows: T[], key: (r: T) => string): [string, number][] => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

export function formatPlan(plan: WipePlan, mode: 'DRY-RUN' | 'LIVE', counts?: WipeCounts): string[] {
  const verb = mode === 'DRY-RUN' ? 'จะลบ' : 'ลบแล้ว';
  const out: string[] = [];
  out.push(`โหมด: ${mode}${plan.branchId ? ` · เฉพาะสาขา ${plan.branchId}` : ' · ทุกสาขา'}`);
  out.push('');
  out.push(`${verb} (soft-delete, timestamp เดียว = ${plan.wipedAt.toISOString()}):`);
  const table: [string, number][] = [
    ['products', counts?.products ?? plan.products.length],
    ['purchase_orders', counts?.purchase_orders ?? plan.purchaseOrderIds.length],
    ['goods_receivings', counts?.goods_receivings ?? plan.goodsReceivingIds.length],
    ['stock_transfers', counts?.stock_transfers ?? plan.stockTransferIds.length],
    ['branch_receivings', counts?.branch_receivings ?? plan.branchReceivingIds.length],
    ['stock_counts', counts?.stock_counts ?? plan.stockCountIds.length],
    ['stock_adjustments', counts?.stock_adjustments ?? plan.stockAdjustmentIds.length],
    ['stock_alerts', counts?.stock_alerts ?? plan.stockAlertIds.length],
  ];
  for (const [t, n] of table) out.push(`  ${String(n).padStart(8)}  ${t}`);
  if (counts) {
    out.push(
      `  (ตารางลูก: po_items ${counts.po_items} · goods_receiving_items ${counts.goods_receiving_items} · ` +
        `branch_receiving_items ${counts.branch_receiving_items} · stock_count_items ${counts.stock_count_items})`,
    );
  }
  out.push('');

  const cost = plan.products.reduce((acc, p) => acc.plus(p.costPrice), new Prisma.Decimal(0));
  out.push(`สินค้าที่${verb} ${plan.products.length} เครื่อง · ต้นทุนรวมที่จะหายจากภาพรวมคลัง ${cost.toFixed(2)} บาท`);
  for (const [k, n] of groupCount(plan.products, (p) => `สาขา ${p.branchName}`)) out.push(`  ${String(n).padStart(6)}  ${k}`);
  for (const [k, n] of groupCount(plan.products, (p) => `หมวด ${p.category}`)) out.push(`  ${String(n).padStart(6)}  ${k}`);
  for (const [k, n] of groupCount(plan.products, (p) => `สถานะ ${p.status}`)) out.push(`  ${String(n).padStart(6)}  ${k}`);
  out.push('');

  out.push(`เครื่องที่ข้าม (ติดด่านถือครอง — ไม่ลบ): ${plan.skipped.length}`);
  for (const s of plan.skipped) out.push(`  - ${s.imeiSerial ?? '(ไม่มี IMEI)'} ${s.name} [${s.status}] สาขา ${s.branchName}: ${s.reason}`);
  out.push(`เครื่องสถานะผูกธุรกรรม (ไม่แตะ — เคลียร์ผ่านเมนูยกเลิกใบขาย/ยกเลิกสัญญา/ยึดเครื่อง): ${plan.bound.length}`);
  for (const b of plan.bound) out.push(`  - ${b.imeiSerial ?? '(ไม่มี IMEI)'} ${b.name} [${b.status}] สาขา ${b.branchName}`);
  out.push(`PO ที่เก็บไว้เพราะยังมีเครื่องชี้อยู่: ${plan.keptPurchaseOrders.length}`);
  for (const k of plan.keptPurchaseOrders) out.push(`  - ${k.poNumber}: ${k.reason}`);
  out.push('');

  out.push(`เครื่องทดสอบที่เหลือ (marker TEST-/ทดสอบระบบ/PO ทดสอบ): ${plan.testProductsRemaining}`);
  if (plan.testProductsOnlineVisible.length) {
    out.push(`⚠️  เครื่องทดสอบที่ยังเปิดขายออนไลน์ (isOnlineVisible) — ปิดเองก่อนขายจริง: ${plan.testProductsOnlineVisible.length}`);
    for (const p of plan.testProductsOnlineVisible) out.push(`  - ${p.imeiSerial ?? '(ไม่มี IMEI)'} ${p.name}`);
  }
  if (plan.tradeInProductCount > 0) {
    out.push(`⚠️  เครื่องเทิร์นที่จะถูกล้าง ${plan.tradeInProductCount} เครื่อง — แถว trade_ins และ JE เทิร์นที่เคยโพสต์ไม่ถูกแตะ (งานของการล้างสมุดทดสอบ)`);
  }
  out.push('');
  out.push('GL สินค้าคงเหลือปัจจุบัน (CLI นี้ไม่แตะบัญชี — ตัวเลขนี้จะไม่ขยับ):');
  for (const g of plan.glInventory) out.push(`  ${g.code}  ${g.balance}`);
  return out;
}
```

- [ ] **Step 4: รันให้เขียว**

Run: `cd apps/api && npx vitest run --no-file-parallelism src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts`
Expected: PASS 3 tests

ถ้าเคส 1 ล้มที่ `viaTestWhere.length + viaRealWhere.length` = แปลว่า `realProductWhere` ยังมีกับดัก NULL — แก้ที่ util (Task 1) ไม่ใช่ที่ spec

- [ ] **Step 5: type-check**

Run: `./tools/check-types.sh api`
Expected: `0 errors` (ถ้าฟ้อง `pOItem` ไม่มี ให้ดูชื่อ delegate จริงด้วย `grep -n "pOItem\|poItem" apps/api/node_modules/.prisma/client/index.d.ts | head -3` — Prisma ตั้งชื่อ delegate ของ model `POItem` เป็น `pOItem`)

- [ ] **Step 6: CI glob**

`.github/workflows/deploy-gcp.yml` — หลังบรรทัด `SALES_FILES=$(ls src/modules/sales/__tests__/*.integration.spec.ts)` เพิ่ม:

```yaml
          # Stock go-live wipe (2026-09-05) — ตรรกะอยู่ใต้ src/cli/ ⇒ directory ใหม่ = glob ใหม่
          STOCK_GO_LIVE_FILES=$(ls src/cli/stock-go-live/__tests__/*.integration.spec.ts)
```

และในบล็อก `npx vitest run --no-file-parallelism $FILES \` แก้บรรทัดสุดท้าย `            $SALES_FILES` เป็น:

```yaml
            $SALES_FILES \
            $STOCK_GO_LIVE_FILES
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/cli/stock-go-live/wipe-stock-go-live.ts \
  apps/api/src/cli/stock-go-live/__tests__/wipe-stock-go-live.integration.spec.ts \
  .github/workflows/deploy-gcp.yml
git commit -m "feat(stock): ตรรกะล้างคลังก่อนใช้จริง planWipe/applyWipe + พิสูจน์บน DB จริง (spec 2026-09-05 §4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: CLI entry `wipe:stock-go-live` (guards env · dry-run/live · พิมพ์แผน + rollback SQL)

**Files:**
- Create: `apps/api/src/cli/wipe-stock-go-live.cli.ts`
- Modify: `apps/api/package.json:84-85` (เพิ่ม 2 scripts ต่อจาก `wipe:test-stock:help`)

**Interfaces:**
- Consumes: Task 2 (`planWipe`, `applyWipe`, `formatPlan`, `rollbackSql`)
- Produces: npm scripts `wipe:stock-go-live` / `wipe:stock-go-live:help` (runbook Task 9 อ้างอิง)

ไม่มี unit spec สำหรับ entry (แค่ต่อ env → ฟังก์ชันที่พิสูจน์แล้วใน Task 2) — ตรวจด้วย dry-run บน DB dev จริง (Step 3)

- [ ] **Step 1: เขียน entry**

`apps/api/src/cli/wipe-stock-go-live.cli.ts`:

```ts
/**
 * ล้างคลังก่อนเริ่มใช้จริง — spec docs/superpowers/specs/2026-09-05-stock-go-live-design.md §4
 * runbook: docs/accounting/stock-go-live-runbook-2026-09.md
 *
 * Dry-run (default):
 *   EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:stock-go-live
 * Live:
 *   CONFIRM_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> \
 *     [ALLOW_PROD_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE NODE_ENV=production] [ONLY_BRANCH_ID=<uuid>] \
 *     npm --prefix apps/api run wipe:stock-go-live
 *
 * - soft-delete ทั้งหมดด้วย timestamp เดียว (พิมพ์ rollback SQL ตอนจบ)
 * - plan + apply อยู่ใน Serializable tx เดียว — กันใบขายที่ commit ระหว่างสองขั้น
 * - ไม่แตะ GL / suppliers / reorder_points / trade_ins
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyWipe,
  formatPlan,
  planWipe,
  rollbackSql,
  STOCK_GO_LIVE_AUDIT_ACTION,
} from './stock-go-live/wipe-stock-go-live';

const REQUIRED_CONSENT = 'YES_I_AM_SURE';
const TAG = '[wipe-stock-go-live]';

async function main(): Promise<void> {
  const expectedDb = process.env.EXPECTED_DB_NAME;
  if (!expectedDb) {
    console.error('ERROR: ต้องระบุ EXPECTED_DB_NAME=<ชื่อ DB> ให้ตรงกับ current_database()');
    console.error('กันรันผิดฐาน — ชื่อ DB จริงบน prod คือ "bestchoice"');
    process.exit(1);
  }
  const write = process.env.CONFIRM_WIPE_STOCK_GO_LIVE === REQUIRED_CONSENT;
  if (!write) {
    console.log(`${TAG} DRY-RUN mode (default). ล้างจริงให้รันซ้ำด้วย:`);
    console.log(
      `  CONFIRM_WIPE_STOCK_GO_LIVE=${REQUIRED_CONSENT} EXPECTED_DB_NAME=<db> ` +
        `[ALLOW_PROD_WIPE_STOCK_GO_LIVE=${REQUIRED_CONSENT} NODE_ENV=production] ` +
        `[ONLY_BRANCH_ID=<uuid>] npm --prefix apps/api run wipe:stock-go-live`,
    );
    console.log('');
  }
  if (
    write &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_PROD_WIPE_STOCK_GO_LIVE !== REQUIRED_CONSENT
  ) {
    console.error(
      `ERROR: NODE_ENV=production ต้องมี ALLOW_PROD_WIPE_STOCK_GO_LIVE=${REQUIRED_CONSENT} ด้วย`,
    );
    process.exit(1);
  }
  const branchId = process.env.ONLY_BRANCH_ID || undefined;

  const prisma = new PrismaClient();
  try {
    const [{ current_database: actualDb }] = await prisma.$queryRaw<
      { current_database: string }[]
    >`SELECT current_database()`;
    if (actualDb !== expectedDb) {
      console.error(`ERROR: ต่อ DB "${actualDb}" แต่ EXPECTED_DB_NAME="${expectedDb}" — ยกเลิก`);
      process.exit(1);
    }
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { name: true },
      });
      if (!branch) {
        console.error(`ERROR: ไม่พบสาขา ONLY_BRANCH_ID=${branchId}`);
        process.exit(1);
      }
      console.log(`${TAG} เฉพาะสาขา: ${branch.name}`);
    }
    // ผู้ทำรายการใน AuditLog — CLI ไม่มี actor จึงใช้ OWNER คนแรก (pattern resolveRefs ใน test-pack)
    const owner = await prisma.user.findFirst({
      where: { role: 'OWNER', deletedAt: null },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      console.error('ERROR: ไม่มีผู้ใช้ role OWNER — AuditLog ต้องมี userId จริง');
      process.exit(1);
    }

    const wipedAt = new Date();
    console.log(`${TAG} DB: "${actualDb}" | ผู้ทำรายการ (audit): ${owner.email}`);
    console.log('');

    if (!write) {
      const plan = await planWipe(prisma, wipedAt, { branchId });
      for (const line of formatPlan(plan, 'DRY-RUN')) console.log(line);
      console.log('');
      console.log(`${TAG} DRY-RUN — ไม่ได้เขียนอะไรลง DB`);
      return;
    }

    const { plan, counts } = await prisma.$transaction(
      async (tx) => {
        const p = await planWipe(tx, wipedAt, { branchId });
        const c = await applyWipe(tx, p, owner.id);
        return { plan: p, counts: c };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 300_000,
        maxWait: 10_000,
      },
    );
    for (const line of formatPlan(plan, 'LIVE', counts)) console.log(line);
    console.log('');
    console.log(`${TAG} AuditLog: action=${STOCK_GO_LIVE_AUDIT_ACTION} entityId=${wipedAt.toISOString()}`);
    console.log(`${TAG} ย้อนกลับ (ถ้าจำเป็น) — รัน SQL ชุดนี้ผ่าน psql:`);
    for (const sql of rollbackSql(wipedAt)) console.log(`  ${sql}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`${TAG} FATAL:`, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: npm scripts**

`apps/api/package.json` — ต่อจากบรรทัด `"wipe:test-stock:help": ...` (บรรทัด 85) เพิ่ม:

```json
    "wipe:stock-go-live": "npx -y tsx src/cli/wipe-stock-go-live.cli.ts",
    "wipe:stock-go-live:help": "echo 'Dry-run default: EXPECTED_DB_NAME=<db> npm --prefix apps/api run wipe:stock-go-live. To wipe: CONFIRM_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE EXPECTED_DB_NAME=<db> [ALLOW_PROD_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE NODE_ENV=production] [ONLY_BRANCH_ID=<uuid>] npm --prefix apps/api run wipe:stock-go-live'",
```

(ระวังจุลภาคท้ายบรรทัดก่อนหน้าให้ JSON ยัง valid: `node -e "require('./apps/api/package.json')"` ต้องไม่ error)

- [ ] **Step 3: dry-run บน DB dev จริง**

Run (ชื่อ DB local อ่านจาก `DATABASE_URL` ใน `apps/api/.env` — ค่าเริ่มต้นของโปรเจคคือ `installment_db`):

```bash
EXPECTED_DB_NAME=installment_db npm --prefix apps/api run wipe:stock-go-live
```

Expected: พิมพ์หัว `DRY-RUN mode`, ตารางจำนวนต่อตาราง, กลุ่มสาขา/หมวด/สถานะ, รายการเครื่องที่ข้าม/ผูกธุรกรรม, GL 3 บรรทัด, ปิดท้าย `DRY-RUN — ไม่ได้เขียนอะไรลง DB` · exit 0 · `SELECT COUNT(*) FROM products WHERE deleted_at IS NOT NULL` ก่อน/หลังเท่ากัน

Run (env ผิด): `EXPECTED_DB_NAME=wrong_db npm --prefix apps/api run wipe:stock-go-live`
Expected: `ERROR: ต่อ DB "installment_db" แต่ EXPECTED_DB_NAME="wrong_db" — ยกเลิก` · exit 1

- [ ] **Step 4: type-check + Commit**

Run: `./tools/check-types.sh api` → `0 errors`

```bash
git add apps/api/src/cli/wipe-stock-go-live.cli.ts apps/api/package.json
git commit -m "feat(stock): CLI wipe:stock-go-live — dry-run default, Serializable tx, พิมพ์ rollback SQL (spec 2026-09-05 §4.1/4.4)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: รั้วกันข้ามฝั่งที่ POS (`SaleCreationService.create`)

**Files:**
- Modify: `apps/api/src/modules/sales/services/sale-creation.service.ts:1-13` (imports) และก่อนบล็อก `// T5-C8 pre-check` (บรรทัด ~66)
- Create: `apps/api/src/modules/sales/services/sale-creation.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`assertSameTestSide`, `TEST_SIDE_CUSTOMER_SELECT`, `TEST_SIDE_PRODUCT_SELECT`)
- Produces: private `assertSameTestSideForSale(dto)` — ตรวจเครื่องหลัก + ของแถมทุกชิ้นกับลูกค้า ก่อน dispatch ไป writer

- [ ] **Step 1: เขียน spec ที่ยังแดง**

`apps/api/src/modules/sales/services/sale-creation.service.spec.ts`:

```ts
/**
 * SaleCreationService — รั้วกันข้ามฝั่ง (spec 2026-09-05 §5.1 จุด POS)
 * เครื่อง TEST- ↔ ลูกค้าทดสอบ เท่านั้น / เครื่องจริง ↔ ลูกค้าจริง เท่านั้น — ตรวจทุกชิ้นในใบ
 */
import { BadRequestException } from '@nestjs/common';
import { SaleCreationService } from './sale-creation.service';
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';

const realCustomer = { id: 'cust-1', name: 'ลูกค้าจริง', phone: '0891234567', addressCurrent: 'กรุงเทพ' };
const testCustomer = {
  id: 'cust-t',
  name: 'ทดสอบระบบ ลูกค้า',
  phone: 'TEST-0000001',
  addressCurrent: TEST_CUSTOMER_ADDRESS,
};
const realProduct = { id: 'prod-1', imeiSerial: '356789012345678', name: 'iPhone 15', po: null };
const testProduct = { id: 'prod-t', imeiSerial: 'TEST-0001', name: 'ทดสอบระบบ มือถือ', po: null };
const testAccessory = { id: 'prod-acc', imeiSerial: null, name: 'สายชาร์จ', po: { poNumber: 'TEST-PO-0001' } };

const baseDto = {
  saleType: 'CASH',
  customerId: 'cust-1',
  productId: 'prod-1',
  branchId: 'br-1',
  sellingPrice: 10000,
  amountReceived: 10000,
};

function makeService(customer: unknown, products: unknown[]) {
  const prisma = {
    customer: {
      findFirst: jest.fn().mockResolvedValue(customer),
      findUnique: jest.fn().mockResolvedValue({ loyaltyBalance: 0, deletedAt: null }),
    },
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ wasPreviouslyDamaged: false, deletedAt: null, costPrice: null }),
      findMany: jest.fn().mockResolvedValue(products),
    },
  };
  const writer = {
    createCashSale: jest.fn().mockResolvedValue({ id: 'sale-1' }),
    createInstallmentSale: jest.fn().mockResolvedValue({ id: 'sale-2', contractId: 'c-1' }),
    createExternalFinanceSale: jest.fn().mockResolvedValue({ id: 'sale-3' }),
  };
  const service = new SaleCreationService(
    prisma as never,
    writer as never,
    {} as never,
    { notify: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, prisma, writer };
}

describe('SaleCreationService.create — test-data fence', () => {
  it('จริง ↔ จริง ผ่าน และ writer ถูกเรียก', async () => {
    const { service, writer, prisma } = makeService(realCustomer, [realProduct]);
    await service.create(baseDto as never, 'sp-1', 'OWNER');
    expect(writer.createCashSale).toHaveBeenCalledTimes(1);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['prod-1'] }, deletedAt: null },
        select: expect.objectContaining({ po: { select: { poNumber: true } } }),
      }),
    );
  });

  it('ทดสอบ ↔ ทดสอบ ผ่าน', async () => {
    const { service, writer } = makeService(testCustomer, [testProduct]);
    await service.create({ ...baseDto, customerId: 'cust-t', productId: 'prod-t' } as never, 'sp-1');
    expect(writer.createCashSale).toHaveBeenCalledTimes(1);
  });

  it('เครื่องทดสอบ → ลูกค้าจริง: BadRequest ก่อนถึง writer', async () => {
    const { service, writer } = makeService(realCustomer, [testProduct]);
    await expect(
      service.create({ ...baseDto, productId: 'prod-t' } as never, 'sp-1'),
    ).rejects.toThrow(/เครื่องทดสอบระบบ/);
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('เครื่องจริง → ลูกค้าทดสอบ: BadRequest', async () => {
    const { service, writer } = makeService(testCustomer, [realProduct]);
    await expect(service.create({ ...baseDto, customerId: 'cust-t' } as never, 'sp-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('ของแถมผิดฝั่ง (อุปกรณ์เสริมจาก PO ทดสอบ) ก็ต้องดัง', async () => {
    const { service, writer, prisma } = makeService(realCustomer, [realProduct, testAccessory]);
    await expect(
      service.create({ ...baseDto, bundleProductIds: ['prod-acc'] } as never, 'sp-1'),
    ).rejects.toThrow(/สายชาร์จ/);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['prod-1', 'prod-acc'] }, deletedAt: null } }),
    );
    expect(writer.createCashSale).not.toHaveBeenCalled();
  });

  it('ไม่พบลูกค้า → NotFound ไทย', async () => {
    const { service } = makeService(null, [realProduct]);
    await expect(service.create(baseDto as never, 'sp-1')).rejects.toThrow('ไม่พบลูกค้า');
  });
});
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/modules/sales/services/sale-creation.service.spec.ts`
Expected: FAIL — 4 เคสแรกผ่าน/ล้มแบบสุ่ม แต่ "เครื่องทดสอบ → ลูกค้าจริง" ต้อง FAIL ด้วย `writer.createCashSale` ถูกเรียก (ยังไม่มีรั้ว)

- [ ] **Step 3: วางรั้ว**

`apps/api/src/modules/sales/services/sale-creation.service.ts` — เพิ่ม import ต่อจากบรรทัด 13 (`import { SaleWarrantyNotifierService } ...`):

```ts
import {
  assertSameTestSide,
  TEST_SIDE_CUSTOMER_SELECT,
  TEST_SIDE_PRODUCT_SELECT,
} from '../../../utils/test-data-markers';
```

ใน `create()` — ก่อน comment `// T5-C8 pre-check (before sub-methods' own verifyProductInStock ...` แทรก:

```ts
    // test-data fence (spec 2026-09-05 §5.1): เครื่องทุกชิ้นในใบกับลูกค้าต้องอยู่ฝั่งเดียวกัน
    // — ตรวจก่อนแตะ tx ใด ๆ; ของแถมผิดฝั่งก็ต้องดัง
    await this.assertSameTestSideForSale(dto);
```

และเพิ่ม private method ท้าย class (ก่อน `}` ปิด class):

```ts
  /**
   * รั้วกันข้ามฝั่ง — โหลดลูกค้า + เครื่องหลัก + ของแถม ด้วย select ขั้นต่ำ (รวม po.poNumber
   * ที่ชนิดของ isTestProduct บังคับ) แล้วให้ util ตัดสิน. ไม่พบลูกค้า = NotFound ข้อความเดิม
   * ของโมดูลนี้ (writer จะโยนแบบเดียวกันอยู่แล้ว แต่รั้วต้องอ่านลูกค้าก่อน writer)
   */
  private async assertSameTestSideForSale(dto: CreateSaleDto): Promise<void> {
    const productIds = [dto.productId, ...(dto.bundleProductIds ?? [])].filter(
      (id): id is string => !!id,
    );
    if (productIds.length === 0) return;
    const [customer, products] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        select: TEST_SIDE_CUSTOMER_SELECT,
      }),
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: TEST_SIDE_PRODUCT_SELECT,
      }),
    ]);
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
    for (const product of products) assertSameTestSide(customer, product);
  }
```

- [ ] **Step 4: รันให้เขียว + เทสต์เดิมของโมดูล**

Run: `cd apps/api && npx jest src/modules/sales`
Expected: PASS ทั้ง `sale-creation.service.spec.ts` (6) และ `sale-writer.service.spec.ts` / `sale-void.service.spec.ts` เดิม

- [ ] **Step 5: type-check + Commit**

Run: `./tools/check-types.sh api` → `0 errors`

```bash
git add apps/api/src/modules/sales/services/sale-creation.service.ts \
  apps/api/src/modules/sales/services/sale-creation.service.spec.ts
git commit -m "feat(sales): รั้วกันเครื่องทดสอบ↔ลูกค้าจริงข้ามฝั่งที่ POS — ตรวจทุกชิ้นในใบ (spec 2026-09-05 §5.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: รั้วตอนเปิดสัญญาผ่อน (`ContractLifecycleService.create`)

**Files:**
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.ts:1-18` (import) และใน tx บรรทัด ~158-166 (`currentProduct` / `customerData`)
- Modify: `apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts` (fixture `mockProduct` + describe ใหม่)

**Interfaces:**
- Consumes: Task 1 (`assertSameTestSide`)
- Produces: —

- [ ] **Step 1: เพิ่มเทสต์ที่ยังแดง**

ใน `contract-lifecycle.service.spec.ts`:

(ก) เพิ่ม import ใต้ `import { ShopAccountResolver } ...`:

```ts
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';
```

(ข) เติม `po: null` ให้ `mockProduct` (ชนิดของ `assertSameTestSide` ต้องการ):

```ts
const mockProduct = {
  id: 'prod-1',
  status: 'IN_STOCK',
  category: 'PHONE_NEW',
  imeiSerial: '123456789012345',
  name: 'iPhone 15',
  po: null,
  deletedAt: null,
};
```

(ค) เพิ่ม describe ใหม่ท้ายไฟล์ (นอก describe เดิม — ใช้ `beforeEach` ของตัวเองไม่ได้ จึงคัดลอกวิธีสร้าง service จาก describe เดิม; ตัวแปร `prisma`/`tx`/`service` ประกาศใน describe เดิมด้วย `let` ระดับ describe ⇒ วางเคสใหม่ **ภายใน** describe เดิมแทน ต่อจากเคส `skips ShopDownPayment when downPayment = 0`):

```ts
  // ─── test-data fence (spec 2026-09-05 §5.1) ────────────────────────────────

  describe('test-data fence', () => {
    it('re-check ใน tx โหลด po.poNumber มาด้วย (ชนิดของ isTestProduct บังคับ)', async () => {
      await service.create({ ...baseDto } as any, 'sp-1');
      expect(tx.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ include: { po: { select: { poNumber: true } } } }),
      );
    });

    it('เครื่อง TEST- → ลูกค้าจริง: BadRequest ก่อนสร้างสัญญา', async () => {
      tx.product.findFirst.mockResolvedValue({ ...mockProduct, imeiSerial: 'TEST-0001' });
      await expect(service.create({ ...baseDto } as any, 'sp-1')).rejects.toThrow(/เครื่องทดสอบระบบ/);
      expect(tx.contract.create).not.toHaveBeenCalled();
    });

    it('เครื่องจริง → ลูกค้าทดสอบ (ที่อยู่ = marker): BadRequest', async () => {
      tx.customer.findUnique.mockResolvedValue({ ...mockCustomer, addressCurrent: TEST_CUSTOMER_ADDRESS });
      await expect(service.create({ ...baseDto } as any, 'sp-1')).rejects.toThrow(/ลูกค้าทดสอบระบบ/);
      expect(tx.contract.create).not.toHaveBeenCalled();
    });

    it('ทดสอบ ↔ ทดสอบ ผ่าน — สัญญาถูกสร้าง', async () => {
      tx.product.findFirst.mockResolvedValue({ ...mockProduct, imeiSerial: 'TEST-0001' });
      tx.customer.findUnique.mockResolvedValue({ ...mockCustomer, phone: 'TEST-0000001' });
      await service.create({ ...baseDto } as any, 'sp-1');
      expect(tx.contract.create).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/modules/contracts/services/contract-lifecycle.service.spec.ts -t "test-data fence"`
Expected: FAIL 3 เคส (include ยังไม่มี · เครื่อง TEST- ยังสร้างสัญญาได้ · ลูกค้าทดสอบยังสร้างได้)

- [ ] **Step 3: วางรั้ว**

`contract-lifecycle.service.ts` — เพิ่ม import ต่อจากบรรทัด 18 (`import { preemptReservationsInTx } ...`):

```ts
import { assertSameTestSide } from '../../../utils/test-data-markers';
```

ใน tx แทนที่บล็อก:

```ts
          const currentProduct = await tx.product.findFirst({
            where: { id: dto.productId, deletedAt: null },
          });
          if (!currentProduct || currentProduct.status !== 'IN_STOCK') {
            throw new BadRequestException('สินค้าไม่พร้อมขาย (อาจถูกจองแล้ว)');
          }

          // Fetch customer data for snapshot (isolation from future edits)
          const customerData = await tx.customer.findUnique({ where: { id: dto.customerId, deletedAt: null } });
```

ด้วย:

```ts
          const currentProduct = await tx.product.findFirst({
            where: { id: dto.productId, deletedAt: null },
            // test-data fence ต้องเห็น PO ต้นทาง (อุปกรณ์เสริมไร้ IMEI จาก PO ทดสอบ)
            include: { po: { select: { poNumber: true } } },
          });
          if (!currentProduct || currentProduct.status !== 'IN_STOCK') {
            throw new BadRequestException('สินค้าไม่พร้อมขาย (อาจถูกจองแล้ว)');
          }

          // Fetch customer data for snapshot (isolation from future edits)
          const customerData = await tx.customer.findUnique({ where: { id: dto.customerId, deletedAt: null } });
          // test-data fence (spec 2026-09-05 §5.1): เครื่องกับลูกค้าต้องอยู่ฝั่งเดียวกัน —
          // ที่เดียวกับด่าน IN_STOCK ใน tx (ไม่พบลูกค้า = ปล่อยให้ FK ล้มตามพฤติกรรมเดิม)
          if (customerData) assertSameTestSide(customerData, currentProduct);
```

- [ ] **Step 4: รันให้เขียว (ทั้งไฟล์ — เคส ShopDownPayment เดิมต้องไม่กระทบ)**

Run: `cd apps/api && npx jest src/modules/contracts/services/contract-lifecycle.service.spec.ts`
Expected: PASS ทั้งไฟล์

- [ ] **Step 5: type-check + Commit**

Run: `./tools/check-types.sh api` → `0 errors`

```bash
git add apps/api/src/modules/contracts/services/contract-lifecycle.service.ts \
  apps/api/src/modules/contracts/services/contract-lifecycle.service.spec.ts
git commit -m "feat(contracts): รั้วกันข้ามฝั่งตอนเปิดสัญญา — ที่เดียวกับด่าน IN_STOCK ใน tx (spec 2026-09-05 §5.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: รั้วใบจอง (`BookingsService.create` + `convertToSale`)

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts:1-27` (import), `create()` บรรทัด ~247-258, `convertToSale()` บรรทัด ~603-606 และ ~667-676
- Modify: `apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts` (mock + 3 เคสใหม่)

**Interfaces:**
- Consumes: Task 1 (`assertSameTestSide`, `TEST_SIDE_CUSTOMER_SELECT`, `TEST_SIDE_PRODUCT_SELECT`)
- Produces: —

- [ ] **Step 1: ปรับ mock + เพิ่มเทสต์ที่ยังแดง**

ใน `bookings.service.spec.ts`:

(ก) import ใต้ `import { ShopBookingRefundTemplate } ...`:

```ts
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';
```

(ข) ใน `beforeEach` แก้ `txProduct.findUnique` ให้มีฟิลด์ที่รั้วอ่าน:

```ts
    const txProduct = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'prod-1',
        status: 'IN_STOCK',
        deletedAt: null,
        imeiSerial: '356789012345678',
        name: 'iPhone 15',
        po: null,
      }),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
    };
```

(ค) ใน object `prisma` แก้ `customer` และเพิ่ม `product` ระดับ root:

```ts
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cust-1',
          name: 'ลูกค้าจริง',
          phone: '0891234567',
          addressCurrent: 'กรุงเทพ',
        }),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
```

(ง) เคส `convertToSale` เดิม 2 เคส (บรรทัด ~368 และ ~428) — เติม `customer` ใน object ที่ `prisma.booking.findFirst.mockResolvedValueOnce(...)` คืน (ต่อจาก `customerId: 'cust-1',`):

```ts
      customer: { id: 'cust-1', name: 'ลูกค้าจริง', phone: '0891234567', addressCurrent: 'กรุงเทพ' },
```

(จ) เพิ่มเคสใหม่ท้าย describe หลัก:

```ts
  // ─── test-data fence (spec 2026-09-05 §5.1) ────────────────────────────────

  it('create — รายการที่ผูกเครื่อง TEST- กับลูกค้าจริง → BadRequest ก่อนเปิด tx', async () => {
    prisma.product.findMany.mockResolvedValueOnce([
      { id: 'prod-t', imeiSerial: 'TEST-0001', name: 'ทดสอบระบบ มือถือ', po: null },
    ]);
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          items: [{ productId: 'prod-t', description: 'X', quantity: 1, unitPrice: 1000 }],
          depositAmount: 100,
        },
        'user-1',
        OWNER,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['prod-t'] }, deletedAt: null } }),
    );
  });

  it('create — รายการไม่ผูกเครื่อง (description อย่างเดียว) ไม่ query สินค้า', async () => {
    await service.create(
      {
        customerId: 'cust-1',
        branchId: 'br-1',
        items: [{ description: 'จองรุ่นที่ยังไม่มีของ', quantity: 1, unitPrice: 1000 }],
        depositAmount: 100,
      },
      'user-1',
      OWNER,
    );
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('convertToSale — ลูกค้าทดสอบ + เครื่องจริง → BadRequest, ไม่สร้าง Sale', async () => {
    prisma.booking.findFirst.mockResolvedValueOnce({
      id: 'bk-1',
      status: 'PAID',
      convertedToSaleId: null,
      bookingNumber: 'BK-20260517-0001',
      customerId: 'cust-t',
      customer: {
        id: 'cust-t',
        name: 'ทดสอบระบบ ลูกค้า',
        phone: 'TEST-0000001',
        addressCurrent: TEST_CUSTOMER_ADDRESS,
      },
      branchId: 'br-1',
      totalAmount: new Prisma.Decimal(40990),
      depositAmount: new Prisma.Decimal(40990),
      depositMethod: 'CASH',
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 40990, amount: 40990 }],
    });
    await expect(service.convertToSale('bk-1', {}, 'user-1', OWNER)).rejects.toThrow(
      /ลูกค้าทดสอบระบบ/,
    );
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
    expect(prisma._tx.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ include: { po: { select: { poNumber: true } } } }),
    );
  });
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/modules/bookings`
Expected: FAIL 2-3 เคสใหม่ (เคสเดิมยังผ่าน)

- [ ] **Step 3: วางรั้ว**

`bookings.service.ts` — import ต่อจากบรรทัด 27 (`import { ShopAccountResolver } ...`):

```ts
import {
  assertSameTestSide,
  TEST_SIDE_CUSTOMER_SELECT,
  TEST_SIDE_PRODUCT_SELECT,
} from '../../utils/test-data-markers';
```

ใน `create()` แทนที่:

```ts
    const [customer, branch] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        select: { id: true },
      }),
```

ด้วย:

```ts
    const [customer, branch] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        select: TEST_SIDE_CUSTOMER_SELECT,
      }),
```

และหลังบรรทัด `if (!branch) throw new NotFoundException('ไม่พบสาขา');` แทรก:

```ts
    // test-data fence (spec 2026-09-05 §5.1): รายการที่ผูกเครื่องจริงต้องอยู่ฝั่งเดียวกับลูกค้า
    // (รายการที่มีแต่ description ไม่มีเครื่อง — ไม่มีอะไรให้ตรวจ)
    const fencedProductIds = dto.items
      .map((item) => item.productId)
      .filter((id): id is string => !!id);
    if (fencedProductIds.length > 0) {
      const fencedProducts = await this.prisma.product.findMany({
        where: { id: { in: fencedProductIds }, deletedAt: null },
        select: TEST_SIDE_PRODUCT_SELECT,
      });
      for (const product of fencedProducts) assertSameTestSide(customer, product);
    }
```

ใน `convertToSale()` แทนที่:

```ts
    const booking = await this.prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });
```

ด้วย:

```ts
    const booking = await this.prisma.booking.findFirst({
      where: { id, deletedAt: null },
      include: { items: true, customer: { select: TEST_SIDE_CUSTOMER_SELECT } },
    });
```

และในบล็อก `// 2. Verify the product is still IN_STOCK` แทนที่:

```ts
      const product = await tx.product.findUnique({
        where: { id: firstItem.productId! },
      });
      if (!product || product.deletedAt || product.status !== 'IN_STOCK') {
        throw new BadRequestException(
          'สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว — กรุณาตรวจสอบสต็อก',
        );
      }
```

ด้วย:

```ts
      const product = await tx.product.findUnique({
        where: { id: firstItem.productId! },
        include: { po: { select: { poNumber: true } } },
      });
      if (!product || product.deletedAt || product.status !== 'IN_STOCK') {
        throw new BadRequestException(
          'สินค้าไม่พร้อมขาย หรือถูกขายไปแล้ว — กรุณาตรวจสอบสต็อก',
        );
      }
      // test-data fence (spec 2026-09-05 §5.1) — ตอนแปลงเป็นใบขายคือจุดที่เครื่องพบลูกค้าจริง
      assertSameTestSide(booking.customer, product);
```

- [ ] **Step 4: รันให้เขียว**

Run: `cd apps/api && npx jest src/modules/bookings`
Expected: PASS ทั้งไฟล์ (เคสเดิม + 3 เคสใหม่)

- [ ] **Step 5: type-check + Commit**

Run: `./tools/check-types.sh api` → `0 errors`

```bash
git add apps/api/src/modules/bookings/bookings.service.ts \
  apps/api/src/modules/bookings/__tests__/bookings.service.spec.ts
git commit -m "feat(bookings): รั้วกันข้ามฝั่งตอนสร้างใบจองและแปลงเป็นใบขาย (spec 2026-09-05 §5.1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: auto-mark เครื่องเทิร์นจากลูกค้าทดสอบ (`TradeInLifecycleService.accept`)

**Files:**
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts:29` (import) และใน `accept()` ก่อน `// ─── สร้าง Product (PHONE_USED → PHOTO_PENDING) ───` (บรรทัด ~403)
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts` (`makeTx` + 3 เคสใหม่)

**Interfaces:**
- Consumes: Task 1 (`isTestCustomer`, `TEST_NAME_PREFIX`, `TEST_SIDE_CUSTOMER_SELECT`)
- Produces: —

- [ ] **Step 1: ปรับ `makeTx` + เพิ่มเทสต์ที่ยังแดง**

ใน `trade-in-lifecycle.service.spec.ts`:

(ก) import ใต้ `import { ShopAccountResolver } ...`:

```ts
import { TEST_CUSTOMER_ADDRESS } from '../../../utils/test-data-markers';
```

(ข) ใน `makeTx()` เพิ่ม delegate ลูกค้า:

```ts
    customer: { findUnique: jest.fn().mockResolvedValue(null) },
```

(ค) เพิ่ม describe ใหม่ท้ายไฟล์ (สร้าง service แบบเดียวกับ describe เดิม — คัดลอกบล็อก `beforeEach` มาทั้งก้อน เพราะตัวแปรเป็น `let` ระดับ describe):

```ts
describe('TradeInLifecycleService.accept() — auto-mark เครื่องจากลูกค้าทดสอบ (spec 2026-09-05 §5.3)', () => {
  let service: TradeInLifecycleService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let tx: ReturnType<typeof makeTx>;

  const baseTradeIn = {
    id: 'ti-1',
    status: 'APPRAISED',
    deletedAt: null,
    flow: 'BUYBACK',
    branchId: 'br-1',
    offeredPrice: new Decimal(5000),
    estimatedValue: null,
    imei: '359000000000001',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 12',
    deviceColor: null,
    deviceStorage: null,
    deviceCondition: 'A',
    notes: null,
  };
  const acceptDto = { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'CASH' };

  beforeEach(() => {
    tx = makeTx();
    prisma = {
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    tx.product.create.mockResolvedValue({ id: 'p-new', brand: 'Apple', model: 'iPhone 12', storage: null });
    tx.tradeIn.update.mockResolvedValue({ id: 'ti-1', status: 'ACCEPTED' });
    service = new TradeInLifecycleService(
      prisma,
      { upload: jest.fn() } as any,
      { allocate: jest.fn() } as any,
      { findOrCreateByNaturalKey: jest.fn() } as any,
      { hash: jest.fn() } as any,
      { findOne: jest.fn(), checkImei: jest.fn() } as any,
      { lookupValuation: jest.fn().mockResolvedValue({ found: false }) } as any,
      { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-001', journalEntryId: 'je-1' }) } as any,
      { resolveOutflowCashAccount: jest.fn().mockResolvedValue('S11-1102') } as any,
    );
  });

  it('ลูกค้าทดสอบ (ที่อยู่ = marker) → ชื่อเครื่องขึ้นต้น "ทดสอบระบบ "', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({ ...baseTradeIn, customerId: 'cust-t' });
    tx.customer.findUnique.mockResolvedValue({
      id: 'cust-t',
      name: 'ทดสอบระบบ ลูกค้า',
      phone: '0890000000',
      addressCurrent: TEST_CUSTOMER_ADDRESS,
    });
    await service.accept('ti-1', acceptDto as any, 'u-1');
    const data = tx.product.create.mock.calls[0][0].data;
    expect(data.name).toBe('ทดสอบระบบ Apple iPhone 12');
    expect(data.imeiSerial).toBe('359000000000001'); // IMEI ไม่ถูกแตะ
  });

  it('ลูกค้าจริง → ชื่อเครื่องไม่เปลี่ยน', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({ ...baseTradeIn, customerId: 'cust-1' });
    tx.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      name: 'สมชาย',
      phone: '0891234567',
      addressCurrent: 'กรุงเทพ',
    });
    await service.accept('ti-1', acceptDto as any, 'u-1');
    expect(tx.product.create.mock.calls[0][0].data.name).toBe('Apple iPhone 12');
  });

  it('ผู้ขาย walk-in (ไม่มี customerId) → ไม่ query ลูกค้า ชื่อไม่เปลี่ยน', async () => {
    tx.tradeIn.findUnique.mockResolvedValue({ ...baseTradeIn, customerId: null });
    await service.accept('ti-1', acceptDto as any, 'u-1');
    expect(tx.customer.findUnique).not.toHaveBeenCalled();
    expect(tx.product.create.mock.calls[0][0].data.name).toBe('Apple iPhone 12');
  });
});
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts -t "auto-mark"`
Expected: FAIL เคสแรก (`name` = `'Apple iPhone 12'` ไม่มี prefix)

- [ ] **Step 3: auto-mark**

`trade-in-lifecycle.service.ts` — import ต่อจากบรรทัด 29 (`import { autofillProductPriceFromTemplate } ...`):

```ts
import {
  isTestCustomer,
  TEST_NAME_PREFIX,
  TEST_SIDE_CUSTOMER_SELECT,
} from '../../../utils/test-data-markers';
```

ใน `accept()` แทนที่:

```ts
      const nameParts = [
        tradeIn.deviceBrand,
        tradeIn.deviceModel,
        tradeIn.deviceColor,
        tradeIn.deviceStorage,
      ].filter(Boolean);
      const productName = nameParts.join(' ');
```

ด้วย:

```ts
      const nameParts = [
        tradeIn.deviceBrand,
        tradeIn.deviceModel,
        tradeIn.deviceColor,
        tradeIn.deviceStorage,
      ].filter(Boolean);
      // test-data fence auto-mark (spec 2026-09-05 §5.3): เครื่องที่รับซื้อจากลูกค้าทดสอบต้องมี
      // marker ติดตัวตั้งแต่เกิด ไม่งั้นคลังจะมองเป็นของจริง (IMEI ไม่แตะ — เป็นของจริงของเครื่องทดสอบ)
      const seller = tradeIn.customerId
        ? await tx.customer.findUnique({
            where: { id: tradeIn.customerId },
            select: TEST_SIDE_CUSTOMER_SELECT,
          })
        : null;
      const baseName = nameParts.join(' ');
      const productName = seller && isTestCustomer(seller) ? `${TEST_NAME_PREFIX} ${baseName}` : baseName;
```

- [ ] **Step 4: รันให้เขียว (ทั้งไฟล์)**

Run: `cd apps/api && npx jest src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts`
Expected: PASS ทั้งไฟล์ (เคส SHOP JE เดิมไม่มี `customerId` ⇒ ไม่ query ลูกค้า ⇒ ไม่กระทบ)

- [ ] **Step 5: type-check + Commit**

Run: `./tools/check-types.sh api` → `0 errors`

```bash
git add apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts \
  apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts
git commit -m "feat(trade-in): เครื่องเทิร์นจากลูกค้าทดสอบได้ชื่อขึ้นต้น ทดสอบระบบ อัตโนมัติ (spec 2026-09-05 §5.3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `factory:reset` ปฏิเสธเมื่อมีข้อมูลคลังของจริง (ด่าน 5)

**Files:**
- Create: `apps/api/src/cli/stock-go-live/real-stock-guard.ts`
- Create: `apps/api/src/cli/stock-go-live/real-stock-guard.spec.ts`
- Modify: `apps/api/src/cli/factory-reset.cli.ts:43-51` (import) และหลังบล็อก "ด่าน 4" ก่อน `const counts: Array<{ table: string; rows: number }> = [];` (บรรทัด ~221)

**Interfaces:**
- Consumes: Task 1 (`realProductWhere`, `realPurchaseOrderWhere`)
- Produces:
  - `countRealStock(prisma: Pick<PrismaClient, 'product' | 'goodsReceiving'>): Promise<{ realProducts: number; realGoodsReceivings: number }>`
  - `assertNoRealStock(counts, env = process.env): void` — โยน `RealStockPresentError` เว้นแต่ `env.ALLOW_WIPE_REAL_STOCK === 'YES_I_AM_SURE'`
  - `class RealStockPresentError extends Error`

- [ ] **Step 1: เขียน spec ที่ยังแดง**

`apps/api/src/cli/stock-go-live/real-stock-guard.spec.ts`:

```ts
import {
  ALLOW_WIPE_REAL_STOCK_ENV,
  assertNoRealStock,
  countRealStock,
  RealStockPresentError,
} from './real-stock-guard';

describe('real-stock-guard — ด่าน 5 ของ factory reset (spec 2026-09-05 §6)', () => {
  it('ไม่มีของจริง → ผ่านเงียบ', () => {
    expect(() => assertNoRealStock({ realProducts: 0, realGoodsReceivings: 0 }, {})).not.toThrow();
  });

  it('มีสินค้าจริง → โยนพร้อมตัวเลขและชื่อ env ที่ต้องตั้ง', () => {
    expect(() => assertNoRealStock({ realProducts: 604, realGoodsReceivings: 0 }, {})).toThrow(
      RealStockPresentError,
    );
    try {
      assertNoRealStock({ realProducts: 604, realGoodsReceivings: 2 }, {});
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('604');
      expect(msg).toContain('2');
      expect(msg).toContain('cleanup:test-pack');
      expect(msg).toContain(`${ALLOW_WIPE_REAL_STOCK_ENV}=YES_I_AM_SURE`);
    }
  });

  it('มีใบรับของจริงอย่างเดียวก็บล็อก', () => {
    expect(() => assertNoRealStock({ realProducts: 0, realGoodsReceivings: 1 }, {})).toThrow(
      RealStockPresentError,
    );
  });

  it('ตั้ง ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE → ผ่าน', () => {
    expect(() =>
      assertNoRealStock(
        { realProducts: 604, realGoodsReceivings: 2 },
        { [ALLOW_WIPE_REAL_STOCK_ENV]: 'YES_I_AM_SURE' },
      ),
    ).not.toThrow();
  });

  it('ค่าอื่นของ env ไม่นับ', () => {
    expect(() =>
      assertNoRealStock({ realProducts: 1, realGoodsReceivings: 0 }, { [ALLOW_WIPE_REAL_STOCK_ENV]: 'yes' }),
    ).toThrow(RealStockPresentError);
  });

  it('countRealStock นับเฉพาะแถว live ที่ไม่มี marker', async () => {
    const prisma = {
      product: { count: jest.fn().mockResolvedValue(7) },
      goodsReceiving: { count: jest.fn().mockResolvedValue(3) },
    };
    await expect(countRealStock(prisma as never)).resolves.toEqual({
      realProducts: 7,
      realGoodsReceivings: 3,
    });
    expect(prisma.product.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(prisma.goodsReceiving.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          po: { NOT: { poNumber: { startsWith: 'TEST-' } } },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: รันให้แดง**

Run: `cd apps/api && npx jest src/cli/stock-go-live/real-stock-guard.spec.ts`
Expected: FAIL — `Cannot find module './real-stock-guard'`

- [ ] **Step 3: เขียน guard**

`apps/api/src/cli/stock-go-live/real-stock-guard.ts`:

```ts
/**
 * ด่าน 5 ของ factory reset — spec docs/superpowers/specs/2026-09-05-stock-go-live-design.md §6
 *
 * factory reset ล้าง goods_receivings / stock_transfers / stock_counts / stock_adjustments /
 * stock_alerts ทั้งตารางโดยไม่ดู marker (factory-reset-tables.ts) — หลังเริ่มใช้คลัง/จัดซื้อจริง
 * การรันซ้ำ = ใบรับของจริงหายทั้งที่สินค้า/PO ยังอยู่. ด่านนี้นับ "ของจริง" (แถว live ที่ไม่มี marker
 * ทดสอบ) แล้วปฏิเสธ เว้นแต่ผู้รันพิมพ์ชื่อสิ่งที่จะเสียลง env เอง (consent ใหม่ ไม่ reuse
 * ALLOW_PROD_RESET). ทางล้างข้อมูลทดสอบหลังจากนี้ = cleanup:test-pack + cleanup:test-contracts
 */
import type { PrismaClient } from '@prisma/client';
import { realProductWhere, realPurchaseOrderWhere } from '../../utils/test-data-markers';

export const ALLOW_WIPE_REAL_STOCK_ENV = 'ALLOW_WIPE_REAL_STOCK';
export const REQUIRED_CONSENT = 'YES_I_AM_SURE';

export interface RealStockCounts {
  realProducts: number;
  realGoodsReceivings: number;
}

export type RealStockClient = Pick<PrismaClient, 'product' | 'goodsReceiving'>;

export class RealStockPresentError extends Error {}

export async function countRealStock(prisma: RealStockClient): Promise<RealStockCounts> {
  const [realProducts, realGoodsReceivings] = await Promise.all([
    prisma.product.count({ where: { deletedAt: null, AND: [realProductWhere] } }),
    prisma.goodsReceiving.count({ where: { deletedAt: null, po: realPurchaseOrderWhere } }),
  ]);
  return { realProducts, realGoodsReceivings };
}

export function assertNoRealStock(
  counts: RealStockCounts,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (counts.realProducts === 0 && counts.realGoodsReceivings === 0) return;
  if (env[ALLOW_WIPE_REAL_STOCK_ENV] === REQUIRED_CONSENT) return;
  throw new RealStockPresentError(
    `มีข้อมูลคลังของจริงอยู่ในระบบ — สินค้าจริง ${counts.realProducts} เครื่อง, ` +
      `ใบรับของจริง ${counts.realGoodsReceivings} ใบ (นับเฉพาะแถวที่ไม่มี marker ทดสอบ). ` +
      'factory reset จะล้าง goods_receivings/stock_* ทั้งตารางโดยไม่ดู marker ' +
      '⇒ ใบรับของจริงจะหายทั้งที่สินค้า/PO ยังอยู่. ' +
      'ทางล้างข้อมูลทดสอบหลังเริ่มใช้คลังจริงคือ cleanup:test-pack + cleanup:test-contracts เท่านั้น. ' +
      `ถ้าตั้งใจทิ้งของจริงทั้งหมดจริง ๆ ให้ตั้ง ${ALLOW_WIPE_REAL_STOCK_ENV}=${REQUIRED_CONSENT}`,
  );
}
```

- [ ] **Step 4: รันให้เขียว**

Run: `cd apps/api && npx jest src/cli/stock-go-live/real-stock-guard.spec.ts`
Expected: PASS 6 tests

- [ ] **Step 5: ต่อเข้า factory-reset.cli.ts**

เพิ่ม import ต่อจากบล็อก `import { ... } from './factory-reset-tables';` (บรรทัด 44-51):

```ts
import { assertNoRealStock, countRealStock, RealStockPresentError } from './stock-go-live/real-stock-guard';
```

หลังบล็อก "ด่าน 4" (จบที่ `process.exit(1); }` ของ `blocking.length > 0`) และก่อน `const counts: Array<{ table: string; rows: number }> = [];` แทรก:

```ts
    // ── ด่าน 5: มีข้อมูลคลังของจริงไหม (spec 2026-09-05 §6) ────────────────────
    // ทำงานทั้ง DRY_RUN / REHEARSE / รันจริง — ผู้รันต้องเห็นตั้งแต่ตอนดูแผน
    try {
      assertNoRealStock(await countRealStock(prisma));
    } catch (err) {
      if (!(err instanceof RealStockPresentError)) throw err;
      console.error(`ERROR: ${err.message}`);
      await prisma.$disconnect();
      process.exit(1);
    }
```

- [ ] **Step 6: ตรวจบน DB dev**

Run: `DRY_RUN=1 EXPECTED_DB_NAME=installment_db npm --prefix apps/api run factory:reset`
Expected (dev seed มีสินค้าที่ไม่มี marker): หยุดที่ `ERROR: มีข้อมูลคลังของจริงอยู่ในระบบ — สินค้าจริง N เครื่อง ...` exit 1

Run: `ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE DRY_RUN=1 EXPECTED_DB_NAME=installment_db npm --prefix apps/api run factory:reset`
Expected: ผ่านด่าน 5 ไปพิมพ์แผนตามเดิม ปิดท้าย `DRY_RUN — ไม่ได้เขียนอะไรลง DB`

- [ ] **Step 7: type-check + Commit**

Run: `./tools/check-types.sh api` → `0 errors`

```bash
git add apps/api/src/cli/stock-go-live/real-stock-guard.ts \
  apps/api/src/cli/stock-go-live/real-stock-guard.spec.ts apps/api/src/cli/factory-reset.cli.ts
git commit -m "feat(factory-reset): ด่าน 5 ปฏิเสธเมื่อมีสินค้า/ใบรับของจริง — ต้อง ALLOW_WIPE_REAL_STOCK (spec 2026-09-05 §6)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Runbook + กล่องเตือน factory-reset runbook + CLAUDE.md

**Files:**
- Create: `docs/accounting/stock-go-live-runbook-2026-09.md`
- Modify: `docs/accounting/factory-reset-runbook-2026-08.md:1-2` (แทรกกล่องหลังบรรทัดหัวเรื่อง)
- Modify: `.claude/CLAUDE.md:365` (`## Important Notes` — เพิ่ม bullet)

**Interfaces:**
- Consumes: ชื่อ script/env จาก Task 3 และ Task 8
- Produces: เอกสารที่เจ้าของใช้รันจริงบน prod

- [ ] **Step 1: เขียน runbook**

`docs/accounting/stock-go-live-runbook-2026-09.md`:

```markdown
# เริ่มใช้คลัง + จัดซื้อจริง (ล้างคลังเป็น 0) — Runbook

| | |
|---|---|
| วันที่เขียน | 2026-09-05 |
| Spec | `docs/superpowers/specs/2026-09-05-stock-go-live-design.md` |
| คำตัดสิน | เจ้าของ 2026-09-05 — คลังว่างเปล่า (รวม TTFY 604) · ขายจริงจากคลังจริงขนานกับการเทสส่วนอื่น · marker บน DB เดียว · เก็บซัพพลายเออร์ |
| เครื่องมือ | `npm --prefix apps/api run wipe:stock-go-live` (dry-run default) |
| ย้อนกลับ | SQL ต่อตารางที่ CLI พิมพ์ตอนจบ (`deleted_at = <wipedAt>` ค่าเดียวทั้งรอบ) |

> ⚠️ **หลังรันขั้น ⑤ แล้ว `factory:reset` จะปฏิเสธการรัน** (ด่าน 5 — มีของจริงในระบบ)
> ทางล้างข้อมูลทดสอบหลังจากนี้คือ `cleanup:test-pack` + `cleanup:test-contracts` เท่านั้น

## วินัย marker — อ่านก่อนเทสด้วยมือหลังจากนี้

ระบบตัดสิน "ทดสอบ" จาก marker เท่านั้น (ไม่มีคอลัมน์ isTest):

| อยากเทส | ต้องทำ |
|---|---|
| ลูกค้าทดสอบ | ที่อยู่ปัจจุบัน = `ข้อมูลทดสอบระบบ — ลบได้` (หรือเบอร์ขึ้นต้น `TEST-`) |
| เครื่องทดสอบ | IMEI ขึ้นต้น `TEST-` ตอนรับของ (หรือชื่อขึ้นต้น `ทดสอบระบบ`; อุปกรณ์เสริม: รับผ่าน PO ทดสอบ) |
| ซัพพลายเออร์ทดสอบ | ชื่อขึ้นต้น `ทดสอบระบบ` |
| โอน/ปรับสต็อกทดสอบ | หมายเหตุขึ้นต้น `[ทดสอบระบบ]` |

**ของที่ไม่มี marker = ของจริง** — รั้วจะไม่ให้ขายเครื่อง `TEST-` ให้ลูกค้าจริง และไม่ให้ขายเครื่องจริง
ให้ลูกค้าทดสอบ (ข้อความ error บอกวิธีแก้) · เครื่องเทิร์นจากลูกค้าทดสอบได้ชื่อ `ทดสอบระบบ …` เอง

## ขั้นตอน

### ① จุดกู้คืน ⚠️ ห้ามข้าม (PITR ปิด — นี่คือจุดเดียว)

```bash
gcloud sql backups create --instance=bestchoice-db --description="before stock go-live $(date +%F)"
```

### ② Deploy โค้ดงานนี้ก่อน

รั้ว (POS / เปิดสัญญา / ใบจอง) + ด่าน 5 ของ factory reset ต้องอยู่บน prod **ก่อน** ล้าง —
`gh run list --workflow deploy-gcp.yml --branch main` ต้องเขียวที่ commit ของงานนี้

### ③ Dry-run (ไม่เขียนอะไร)

ต่อ prod ผ่าน cloud-sql-proxy ตามสูตร `scripts/ops/` (พอร์ต 15432) แล้ว:

```bash
export DATABASE_URL="postgresql://bestchoice:<pw>@127.0.0.1:15432/bestchoice?schema=public"
export DATABASE_URL_FINANCE=""
EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run wipe:stock-go-live
```

อ่านให้ครบ 4 ตาราง:
1. **จะลบ** — จำนวนต่อตาราง + สินค้าแยกสาขา/หมวด/สถานะ + ต้นทุนรวม (คาด ~604 เครื่อง TTFY)
2. **เครื่องที่ข้าม** (ติดด่านถือครอง) — เครื่องที่สัญญา/ใบจอง/ออเดอร์ทดสอบถืออยู่ → เคลียร์ผ่านเมนู
   ยกเลิกใบขาย (`/sales` ปุ่มยกเลิก) / ยกเลิกสัญญา (`/finance/contract-cancellation`) / หน้ายึดเครื่อง
   หรือยอมรับให้ค้าง (รัน CLI ซ้ำภายหลังได้ — idempotent)
3. **เครื่องสถานะผูกธุรกรรม** (`SOLD_*`/`RESERVED`/`REPOSSESSED`) — ไม่ถูกแตะ ให้ตัดสินเป็นราย ๆ
4. **PO ที่เก็บไว้** เพราะข้อ 2-3 ยังชี้อยู่

### ④ ปิดเครื่องทดสอบที่ยังเปิดขายออนไลน์

dry-run พิมพ์รายการ `isOnlineVisible` ของเครื่องทดสอบ — ปิดที่หน้า `/stock/products` (สวิตช์ออนไลน์)
ก่อนขายจริง ลูกค้าหน้าเว็บจะได้ไม่เห็น

### ⑤ รันจริง

```bash
CONFIRM_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE ALLOW_PROD_WIPE_STOCK_GO_LIVE=YES_I_AM_SURE \
  NODE_ENV=production EXPECTED_DB_NAME=bestchoice npm --prefix apps/api run wipe:stock-go-live
```

**เก็บ output ทั้งก้อน** — บรรทัด `AuditLog: ... entityId=<wipedAt>` และชุด SQL ย้อนกลับ
(`ONLY_BRANCH_ID=<uuid>` ถ้าต้องการล้างทีละสาขา — PO/ใบรับของไม่มีสาขา จึงล้างทั้ง DB เสมอ)

### ⑥ ตรวจรับ

- `/stock` ภาพรวมคลัง = 0 ทุกสาขา (เหลือเฉพาะเครื่อง `TEST-`)
- `/purchase-orders/qc` คิว QC/ถ่ายรูป = 0 · `/purchase-orders` เปิดอยู่เฉพาะ `TEST-PO-*`
- `/stock/alerts` ว่าง · `/stock/transfers` ไม่มีใบจริงค้าง
- งบทดลอง SHOP ไม่ขยับ (CLI ไม่แตะบัญชี — เทียบ `S11-2001/2002/2003` กับที่ dry-run พิมพ์)
- `SELECT COUNT(*) FROM products WHERE deleted_at = '<wipedAt>'` = จำนวนที่ CLI รายงาน

### ⑦ เริ่มใช้จริง

1. ซัพพลายเออร์ (`/suppliers`) → 2. PO (`/purchase-orders`) หรือ "รับของตรง" เมื่อของมาก่อนใบ →
3. รับของ ใส่ IMEI จริงทุกเครื่อง → 4. มือสองเข้า `PHOTO_PENDING` ถ่าย 6 มุม (`/purchase-orders/qc`) /
มือใหม่+อุปกรณ์เข้า `IN_STOCK` ทันที → 5. ราคาเติมจากตารางกลางถ้ามี ไม่มีต้องตั้งเอง → 6. พิมพ์สติกเกอร์
(`/stickers`) → 7. ขาย

**บัญชี (รู้ไว้ ไม่ต้องทำอะไรในรอบนี้):** รับของไม่โพสต์ JE ⇒ `S11-200x` ไม่ขยับตามการซื้อ; ขายจริง
เครดิต `S11-200x` ⇒ ติดลบสะสมจนกว่าจะลง JE ยอดยกมาตาม spec `2026-08-24-shop-opening-balance-design.md`
(เหมือนสภาพหลัง factory reset) · "JE ตอนรับของ" รอผู้สอบเคาะ

### ⑧ ย้อนกลับ (ถ้าจำเป็น)

รัน SQL ชุดที่ CLI พิมพ์ตอนจบผ่าน psql (หนึ่งบรรทัดต่อตาราง รูป
`UPDATE "<table>" SET deleted_at = NULL WHERE deleted_at = '<wipedAt>';`) — ค่า `<wipedAt>` อยู่ใน
AuditLog `action = 'STOCK_GO_LIVE_WIPE'` (`entityId`) ถ้า output หาย
```

- [ ] **Step 2: กล่องเตือนใน factory-reset runbook**

`docs/accounting/factory-reset-runbook-2026-08.md` — แทรกหลังบรรทัด 1 (`# ล้างข้อมูลทดสอบก่อนเริ่มใช้งานจริง — Runbook`):

```markdown

> 🛑 **ตั้งแต่ 2026-09-05 สคริปต์นี้ปฏิเสธการรันเมื่อมีข้อมูลคลังของจริง** (ด่าน 5 —
> สินค้า/ใบรับของ live ที่ไม่มี marker ทดสอบ) เพราะมันล้าง `goods_receivings`/`stock_*` ทั้งตาราง
> โดยไม่ดู marker ⇒ ใบรับของจริงหายทั้งที่สินค้า/PO ยังอยู่. หลังเริ่มใช้คลังจริง ทางล้างข้อมูลทดสอบ
> คือ `cleanup:test-pack` + `cleanup:test-contracts` เท่านั้น · ข้ามด่านได้ด้วย
> `ALLOW_WIPE_REAL_STOCK=YES_I_AM_SURE` เฉพาะเมื่อตั้งใจทิ้งของจริงทั้งหมด · ดู
> `docs/accounting/stock-go-live-runbook-2026-09.md`
```

- [ ] **Step 3: CLAUDE.md**

`.claude/CLAUDE.md` — ใต้ `## Important Notes` เพิ่ม bullet แรก:

```markdown
- **เริ่มใช้คลัง+จัดซื้อจริงบน DB ที่ยังทดสอบ (2026-09-05)**: spec `docs/superpowers/specs/2026-09-05-stock-go-live-design.md` · runbook `docs/accounting/stock-go-live-runbook-2026-09.md` · แหล่งความจริงของ "ข้อมูลทดสอบ" = `apps/api/src/utils/test-data-markers.ts` (marker `TEST-` / `ทดสอบระบบ` / `[ทดสอบระบบ]` / ที่อยู่ลูกค้า `ข้อมูลทดสอบระบบ — ลบได้` — **ห้ามเปลี่ยนค่า, ห้ามมีสำเนา, ห้ามเพิ่มคอลัมน์ isTest**) · รั้ว `assertSameTestSide` ที่ POS/เปิดสัญญา/ใบจอง (ไม่มี flag ปิด) · `wipe:stock-go-live` ล้างคลังด้วย timestamp เดียว (ย้อนกลับได้) · **`factory:reset` ปฏิเสธเมื่อมีของจริง** (`ALLOW_WIPE_REAL_STOCK` ข้ามได้) — ของที่คีย์ทดสอบด้วยมือโดยไม่มี marker = ถือเป็นของจริง
```

- [ ] **Step 4: Commit**

```bash
git add docs/accounting/stock-go-live-runbook-2026-09.md \
  docs/accounting/factory-reset-runbook-2026-08.md .claude/CLAUDE.md
git commit -m "docs(stock): runbook เริ่มใช้คลังจริง + กล่องเตือน factory reset + วินัย marker ใน CLAUDE.md (spec 2026-09-05 §8)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## ปิดงาน (หลัง Task 9)

- [ ] รันชุดเต็มครั้งเดียว: `cd apps/api && npx jest` (unit ทั้งหมด) + `./tools/check-types.sh all` + integration ของงานนี้ (Task 2 Step 4) — ต้องเขียวทั้งหมดก่อนเปิด PR
- [ ] เปิด PR จาก `feat/stock-go-live-2026-09` → `main` (`gh pr create`) — body สรุปตาม spec §2 คำตัดสิน D1-D4 + ลิงก์ runbook + ประโยค "หลัง merge: deploy → ทำ runbook ①-⑥ บน prod" · ท้าย body: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- [ ] ยังไม่รัน CLI บน prod ใน PR นี้ — เป็นขั้น runbook ที่เจ้าของกดเอง (ต้อง backup ก่อน)
