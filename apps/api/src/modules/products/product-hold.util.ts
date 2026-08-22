import { BadRequestException } from '@nestjs/common';
import { ContractStatus, OnlineOrderStatus, Prisma, ProductStatus } from '@prisma/client';
import { productStatusLabel } from './product-status.util';

/**
 * ด่านเดียวของคำถาม "เครื่องนี้ยังถูกถือครองอยู่ไหม" — ใช้ร่วมกันทั้ง
 * `ProductsService.remove()` (ลบ) และ `ProductsService.update()` (แก้ IMEI/Serial)
 *
 * ทำไมสองการกระทำนี้ต้องใช้ตรรกะชุดเดียวกัน: ทั้งคู่ "ปลด IMEI ให้ว่าง" ในสายตา
 * partial unique index `products_imei_serial_active_unique ON products(imei_serial)
 * WHERE deleted_at IS NULL` — ลบ = ทั้งแถวหลุด index, แก้ IMEI = ค่าเดิมหลุด index
 * ⇒ สร้าง product ใหม่ด้วย IMEI เดิมแล้วขาย/จัดไฟแนนซ์ซ้ำได้ทั้งที่รายการแรกยังเดิน
 * (แก้ IMEI ยังตัดสาย สัญญา↔เครื่อง เงียบ ๆ ด้วย — MDM จะล็อกผิดเครื่อง)
 *
 * **การกระทำที่สาม (final review Phase 5 I-1): `RESTORE_TO_CONTRACT`** — "ชุบชีวิตสัญญาเดิม
 * กลับมาบนเครื่องเก่า" ตอนยกเลิกเปลี่ยนเครื่อง. คำถามเดียวกันเป๊ะ ("เครื่องนี้ถูกผูกไปที่อื่น
 * แล้วหรือยัง") แค่คนละทิศ: DELETE/CHANGE_IDENTITY ปลดเครื่องออกจากรายการที่ยังเดิน ส่วน
 * RESTORE เอาเครื่องกลับเข้ารายการที่หยุดไปแล้ว. ถ้าเครื่องเก่าถูกขาย/จอง/ผูกสัญญาใบใหม่ไป
 * แล้ว การ restore = เครื่องตัวเดียวมีทั้งใบขายของลูกค้า B และสัญญาผ่อนที่ยังเดินของลูกค้า A
 * ⇒ ต้องผ่านด่านเดียวกัน **ไม่ใช่เขียนกติกาชุดที่สอง**
 *
 * ต่างกันแค่ "สถานะไหนแปลว่าถูกผูกไปแล้ว" ซึ่งเป็นตารางต่อ action ในไฟล์นี้
 * (`RESTORE_ONLY_HELD_REMEDY`) ไม่ใช่ตรรกะคนละชุด: `SOLD_CASH`/`SOLD_RESELL` **จงใจ**
 * ไม่อยู่ใน `HELD_STATUS_REMEDY` (ลบ/แก้ IMEI ของเครื่องที่ขายสดจบแล้วทำได้) แต่สำหรับ
 * RESTORE มันคือเคสหลักที่ต้องปิด
 *
 * ห้ามเขียนด่านชุดที่สอง: เพิ่มเงื่อนไขใหม่ให้เติมในไฟล์นี้ที่เดียว
 */

/** สถานะสินค้าที่แปลว่า "เครื่องยังถูกถือครองอยู่" → ค่าใน map = ทางออกที่ต้องบอกผู้ใช้ */
const HELD_STATUS_REMEDY: Readonly<Partial<Record<ProductStatus, string>>> = {
  [ProductStatus.RESERVED]: 'ยกเลิกจองก่อน (หรือปล่อยให้การจองหมดอายุ) แล้วค่อยทำรายการนี้',
  [ProductStatus.SOLD_INSTALLMENT]:
    'จัดการผ่าน flow สัญญาก่อน — ยกเลิกสัญญา / ยึดเครื่อง / เปลี่ยนเครื่อง — แล้วค่อยทำรายการนี้ ' +
    '(ถ้าตัดหนี้สูญแล้วและไม่ได้เครื่องคืน เครื่องนี้ตั้งใจให้ลบ/แก้ไม่ได้ถาวร เพราะ IMEI ยังอยู่กับลูกค้า)',
  [ProductStatus.REPOSSESSED]:
    'เครื่องยึดยังอยู่ในมือกิจการ — ตีราคาใหม่เข้าสต็อกหรือขายต่อให้เรียบร้อยก่อน แล้วค่อยทำรายการนี้',
};

/**
 * สถานะสัญญาที่ถือว่า "จบแล้ว" — สัญญาสถานะอื่นยังถือเครื่องอยู่
 *
 * เจตนา: exclude list (notIn) ไม่ใช่ include list ของสถานะที่ยังเดิน — สถานะใหม่ที่เพิ่มใน
 * `ContractStatus` วันหลังจะถูกกันไว้โดยปริยาย ไม่หลุด guard เงียบ ๆ
 * TERMINATED/DEFAULT ไม่อยู่ในนี้โดยตั้งใจ: บอกเลิกสัญญาแล้วแต่ยังไม่ยึดเครื่องคืน (รอ JP5)
 */
export const FINISHED_CONTRACT_STATUSES: readonly ContractStatus[] = [
  ContractStatus.COMPLETED,
  ContractStatus.EARLY_PAYOFF,
  ContractStatus.CANCELED,
  ContractStatus.CLOSED_BAD_DEBT,
  ContractStatus.EXCHANGED,
  ContractStatus.DEFECT_EXCHANGED,
];

/**
 * สถานะออเดอร์ออนไลน์ที่ "ปล่อยเครื่องแล้ว" — exclude list ด้วยเหตุผลเดียวกับสัญญา
 *
 * - DRAFT / PENDING_PAYMENT: เงินยังไม่เข้า และตัว hold จริงคือ `ProductReservation`
 *   ซึ่งมีวันหมดอายุ + ถูกเช็คแยกอยู่แล้ว (ถ้านับสองสถานะนี้ ตะกร้าที่ถูกทิ้งจะบล็อกตลอดกาล)
 * - DELIVERED / COMPLETED: เครื่องถึงมือลูกค้าแล้ว
 * - CANCELLED / REFUNDED: จบแล้ว
 * - PAYMENT_RECEIVED_UNFULFILLABLE: แพ้ race — เครื่องถูกขายให้คนอื่นไปแล้ว ออเดอร์นี้รอคืนเงิน
 *   ไม่ได้ถือเครื่องตัวนี้อยู่
 *
 * ที่ยัง "ถือเครื่อง" จึงเหลือ PENDING_BANK_REVIEW / PAID / PACKING / SHIPPED
 * (PAID = เงินเข้าแล้วแต่ fulfilment ค้าง — เคสเดียวกับที่ `shop-reservation.service.ts`
 * ใช้บล็อกการจองซ้ำ)
 */
export const RELEASED_ONLINE_ORDER_STATUSES: readonly OnlineOrderStatus[] = [
  OnlineOrderStatus.DRAFT,
  OnlineOrderStatus.PENDING_PAYMENT,
  OnlineOrderStatus.DELIVERED,
  OnlineOrderStatus.COMPLETED,
  OnlineOrderStatus.CANCELLED,
  OnlineOrderStatus.REFUNDED,
  OnlineOrderStatus.PAYMENT_RECEIVED_UNFULFILLABLE,
];

/** การกระทำที่ต้องผ่านด่านนี้ + ความเสี่ยงที่ต้องอธิบายในข้อความ */
export type ProductHoldAction = 'DELETE' | 'CHANGE_IDENTITY' | 'RESTORE_TO_CONTRACT';

const ACTION_TEXT: Readonly<Record<ProductHoldAction, { verb: string; risk: string }>> = {
  DELETE: {
    verb: 'ลบไม่ได้',
    risk: 'ลบแล้ว IMEI จะว่างและถูกรับเครื่องเดิมเข้าสต็อกซ้ำได้',
  },
  CHANGE_IDENTITY: {
    verb: 'แก้ IMEI/Serial ไม่ได้',
    risk:
      'แก้แล้ว IMEI เดิมจะว่างทันทีและถูกรับเข้าสต็อกซ้ำได้ทั้งที่เครื่องยังผูกอยู่ ' +
      'อีกทั้งสาย สัญญา↔เครื่อง จะขาด (MDM ล็อกผิดเครื่อง)',
  },
  RESTORE_TO_CONTRACT: {
    verb: 'ยกเลิกเปลี่ยนเครื่องไม่ได้',
    risk:
      'ยกเลิกแล้วสัญญาเดิมจะกลับมาเดินบนเครื่องเก่าตัวนี้ ทั้งที่มีรายการอื่นถือเครื่องตัวเดียวกันอยู่ ' +
      'เท่ากับเครื่องเดียวมีทั้งใบขาย/ใบจองของอีกคน และสัญญาผ่อนที่ยังเดินอยู่',
  },
};

/**
 * ทางออกจริงเมื่อ restore ไม่ได้ — **ตรวจหน้าจอปลายทาง + `@Roles` แล้ว 2026-08-22**
 *
 * `POST /contracts/:id/request-cancellation` (OWNER/FM/SALES) **ยังไม่มีปุ่มบนหน้าจอ**
 * (grep แล้ว: ไม่มี caller ฝั่ง web) — มีแต่หน้าอนุมัติ `/finance/contract-cancellation`
 * (`GET /contracts/cancellations/pending` + approve/reject, OWNER/FM) ⇒ ข้อความต้องบอก
 * ตรง ๆ ว่าเปิดคำขอเองจากหน้าจอไม่ได้ ห้ามชี้ไปเมนูที่กดสร้างไม่ได้.
 * ส่วนเส้นทางยึดเครื่องกดได้จริง (`RepossessionOverlay` ในหน้าค่างวด → `POST /repossessions`,
 * OWNER — ต้องบอกเลิกสัญญาให้เป็น TERMINATED ก่อนตาม `jp5_require_terminated_status`)
 */
const RESTORE_REMEDY =
  'ยกเลิกเปลี่ยนเครื่องไม่ได้แล้ว — สัญญาใหม่ต้องเดินต่อ ' +
  'ถ้าต้องปิดสัญญาใหม่ ให้ใช้เส้นทางยึดเครื่อง (บอกเลิกสัญญาก่อน แล้วกด "ยึดเครื่อง" ที่หน้าค่างวด) ' +
  'หรือแจ้งเจ้าของ/ผจก.การเงิน เปิดคำขอยกเลิกสัญญา (ยังไม่มีปุ่มเปิดคำขอบนหน้าจอ — อนุมัติที่เมนู "เอกสารยกเลิกสัญญา")';

/**
 * สถานะที่ "ถูกผูกไปที่อื่นแล้ว" **เฉพาะ action `RESTORE_TO_CONTRACT`** — ทับค่าใน
 * `HELD_STATUS_REMEDY` เมื่อมีคีย์ตรงกัน ไม่ใช่ตารางแยกที่คลุมเรื่องเดียวกัน
 *
 * `SOLD_CASH`/`SOLD_RESELL` ไม่อยู่ในตารางกลางโดยตั้งใจ (ลบ/แก้ IMEI ของเครื่องที่ขายสด
 * จบแล้วทำได้) แต่เป็นเคส **หลัก** ของ I-1: Task 3 ทำให้ `REFURBISHED → IN_STOCK` เป็นปุ่ม
 * ชั้นหนึ่ง ⇒ เครื่องที่รับคืนจากการเปลี่ยนเครื่องถูกขายที่ POS ได้จริงภายในไม่กี่คลิก
 */
const RESTORE_ONLY_HELD_REMEDY: Readonly<Partial<Record<ProductStatus, string>>> = {
  [ProductStatus.SOLD_CASH]: `เครื่องเก่าถูกบันทึกขายสดไปแล้ว — ${RESTORE_REMEDY}`,
  [ProductStatus.SOLD_RESELL]: `เครื่องเก่าถูกบันทึกขายต่อไปแล้ว — ${RESTORE_REMEDY}`,
  [ProductStatus.SOLD_INSTALLMENT]:
    'เครื่องเก่าถูกเปิดสัญญาผ่อนใบใหม่ไปแล้ว — ปิดสัญญาใบนั้นให้เรียบร้อยก่อน (ยกเลิกสัญญา / ยึดเครื่อง) แล้วจึงยกเลิกเปลี่ยนเครื่อง',
  [ProductStatus.RESERVED]:
    'เครื่องเก่าถูกจองไว้ — ยกเลิกจอง/ยกเลิกออเดอร์ของเครื่องเก่าก่อน แล้วจึงยกเลิกเปลี่ยนเครื่อง',
  [ProductStatus.REPOSSESSED]:
    'เครื่องเก่าถูกยึดกลับมาจากสัญญาใบอื่น — จัดการเครื่องยึดใบนั้นให้จบก่อน แล้วจึงยกเลิกเปลี่ยนเครื่อง',
};

/** รับได้ทั้ง PrismaService และ tx client — ระบุเฉพาะ 3 ตารางที่ใช้ ทำให้ mock ในเทสง่าย */
export type ProductHoldClient = Pick<
  Prisma.TransactionClient,
  'contract' | 'productReservation' | 'onlineOrder'
>;

export interface ProductHoldSubject {
  id: string;
  status: ProductStatus;
  /**
   * แถวถูก soft-delete แล้วหรือยัง — optional เพราะผู้เรียกฝั่ง `ProductsService`
   * โหลดผ่าน `findOne()` ซึ่งปฏิเสธแถวที่ถูกลบไปแล้ว (ส่ง object เต็มมาก็มีค่านี้ติดมาเอง)
   * ⇒ ชั้นนี้เป็น no-op สำหรับสองการกระทำเดิม แต่จำเป็นสำหรับ `RESTORE_TO_CONTRACT`
   * ที่อ่านเครื่องเก่าตรง ๆ จาก tx (Prisma ไม่กรอง soft-delete ให้)
   */
  deletedAt?: Date | null;
}

/**
 * โยน `BadRequestException` (ข้อความไทย + ทางออก) เมื่อเครื่องยังถูกถือครองด้วยเหตุใดเหตุหนึ่ง:
 * 1. สถานะสินค้า (RESERVED / SOLD_INSTALLMENT / REPOSSESSED)
 * 2. มีสัญญาที่ยังไม่จบอ้างอิงอยู่ (กันสถานะเพี้ยน — IN_STOCK ทั้งที่สัญญายังเดิน)
 * 3. มีการจองบนเว็บที่ยัง ACTIVE และไม่หมดอายุ (flow จองไม่แตะ `product.status` เลย)
 * 4. มีออเดอร์ออนไลน์ที่ fulfilment ยังเปิด (จ่ายเงินแล้วแต่ของยังไม่ถึงมือ)
 */
export async function assertProductNotHeld(
  client: ProductHoldClient,
  product: ProductHoldSubject,
  action: ProductHoldAction,
  /** ป้ายฟิลด์ที่กำลังแก้ (จาก `changedIdentityFields`) — ใส่เพื่อให้ข้อความระบุฟิลด์ตรงตัว */
  subjectFields?: string[],
): Promise<void> {
  const { verb: defaultVerb, risk } = ACTION_TEXT[action];
  const verb =
    action === 'CHANGE_IDENTITY' && subjectFields?.length
      ? `แก้ ${subjectFields.join('/')} ไม่ได้`
      : defaultVerb;

  // ชั้น 0 — แถวถูกลบไปแล้ว: IMEI ของมันหลุด partial unique index ไปแล้ว จึงอาจมีเครื่อง
  // ใหม่ยึด slot นั้นไปเรียบร้อย และการผูกสัญญากลับเข้าแถวที่ถูกลบ = สัญญาชี้ไปแถวผี
  if (product.deletedAt) {
    throw new BadRequestException(
      `เครื่องนี้ถูกลบออกจากระบบไปแล้ว — ${verb} (${risk})` +
        (action === 'RESTORE_TO_CONTRACT'
          ? `: สัญญาจะชี้ไปยังแถวที่ถูกลบ และ IMEI ของมันอาจถูกเครื่องอื่นรับเข้าสต็อกไปแล้ว — ${RESTORE_REMEDY}`
          : ''),
    );
  }

  const remedy =
    (action === 'RESTORE_TO_CONTRACT' ? RESTORE_ONLY_HELD_REMEDY[product.status] : undefined) ??
    HELD_STATUS_REMEDY[product.status];
  if (remedy) {
    throw new BadRequestException(
      `สินค้าอยู่สถานะ ${productStatusLabel(product.status)} — ${verb}เพราะยังผูกกับรายการที่เดินอยู่ ` +
        `(${risk}): ${remedy}`,
    );
  }

  // กันสถานะเพี้ยน: สินค้าอาจเป็น IN_STOCK ทั้งที่ยังมีสัญญาค้างอยู่ (ข้อมูลเก่า / แก้มือ)
  const liveContract = await client.contract.findFirst({
    where: {
      productId: product.id,
      deletedAt: null,
      status: { notIn: [...FINISHED_CONTRACT_STATUSES] },
    },
    select: { contractNumber: true, status: true },
  });
  if (liveContract) {
    throw new BadRequestException(
      `สินค้ายังผูกกับสัญญา ${liveContract.contractNumber} (สถานะ ${liveContract.status}) — ${verb} ` +
        '(' + risk + ') ปิด/ยกเลิกสัญญา หรือยึดเครื่องให้เรียบร้อยก่อน',
    );
  }

  // การจองหน้าเว็บไม่เปลี่ยน product.status (shop-reservation.service.ts) — สถานะจึงมองไม่เห็น
  const reservation = await client.productReservation.findFirst({
    where: { productId: product.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: { expiresAt: true },
  });
  if (reservation) {
    throw new BadRequestException(
      `เครื่องนี้ถูกลูกค้าจองไว้บนเว็บ (การจองหมดอายุ ${reservation.expiresAt.toISOString()}) — ${verb} ` +
        '(' + risk + ') ยกเลิกการจอง หรือรอให้การจองหมดอายุก่อน',
    );
  }

  // ออเดอร์ออนไลน์ที่จ่ายเงินแล้วแต่ fulfilment ค้าง ก็ไม่แตะ product.status เช่นกัน
  const openOrder = await client.onlineOrder.findFirst({
    where: {
      productId: product.id,
      deletedAt: null,
      status: { notIn: [...RELEASED_ONLINE_ORDER_STATUSES] },
    },
    select: { orderNumber: true, status: true },
  });
  if (openOrder) {
    throw new BadRequestException(
      `เครื่องนี้ผูกกับออเดอร์ออนไลน์ ${openOrder.orderNumber} (สถานะ ${openOrder.status}) ที่ยังไม่จบ — ` +
        `${verb} (${risk}) จบการส่งของ ยกเลิก หรือคืนเงินออเดอร์ให้เรียบร้อยก่อน`,
    );
  }
}

/** ฟิลด์ระบุตัวเครื่อง — แก้แล้วสายเครื่อง↔รายการขาด (imeiSerial ยังปลด unique slot ด้วย) */
export const IDENTITY_FIELDS = ['imeiSerial', 'serialNumber'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

const IDENTITY_LABEL: Record<IdentityField, string> = {
  imeiSerial: 'IMEI',
  serialNumber: 'Serial Number',
};

/**
 * คืนป้ายชื่อฟิลด์ระบุตัวเครื่องที่ dto "เปลี่ยนค่าจริง" (ไม่ส่งมา = ไม่แตะ, ส่งค่าเดิม = ผ่าน)
 * ล้างค่า (null/'') นับเป็นการเปลี่ยน — เพราะปลด IMEI ออกจาก unique index เหมือนกัน
 */
export function changedIdentityFields(
  existing: Partial<Record<IdentityField, string | null>>,
  dto: Partial<Record<IdentityField, string | null>>,
): string[] {
  const norm = (v: string | null | undefined) => (v ?? '').trim();
  return IDENTITY_FIELDS.filter(
    (f) => dto[f] !== undefined && norm(dto[f]) !== norm(existing[f]),
  ).map((f) => IDENTITY_LABEL[f]);
}
