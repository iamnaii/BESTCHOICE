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
export type ProductHoldAction = 'DELETE' | 'CHANGE_IDENTITY';

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
};

/** รับได้ทั้ง PrismaService และ tx client — ระบุเฉพาะ 3 ตารางที่ใช้ ทำให้ mock ในเทสง่าย */
export type ProductHoldClient = Pick<
  Prisma.TransactionClient,
  'contract' | 'productReservation' | 'onlineOrder'
>;

export interface ProductHoldSubject {
  id: string;
  status: ProductStatus;
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

  const remedy = HELD_STATUS_REMEDY[product.status];
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
