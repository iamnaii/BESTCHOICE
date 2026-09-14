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
  phone: string | null; // ผู้สนใจอัตโนมัติจากแชทยังไม่มีเบอร์
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
  return c.addressCurrent === TEST_CUSTOMER_ADDRESS || (c.phone ?? '').startsWith(TEST_DOC_PREFIX);
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
