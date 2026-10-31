import { ChatChannel, LineChannelType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildBrowserUrl } from '../../../utils/line-login.util';

/**
 * Task 20 C1 — ลูกค้าที่ LINE นี้ "พิสูจน์แล้ว" ว่าถือเบอร์ = แถว customer_line_links ช่อง FINANCE ที่ยังผูกอยู่
 * (ผู้เขียนแถวนี้มีทางเดียวคือ VerificationService หลังยืนยัน OTP ทาง SMS — Task 19).
 *
 * บอท OA ร้าน (SHOP) ใช้ฟังก์ชันนี้ก่อนตอบชื่อ/สัญญา/ยอด/งวด/ใบเสร็จ/QR ชำระ/สาขาของสัญญา และบริบท AI —
 * **ห้ามใช้ `customers.line_id_shop` เป็นหลักฐานตัวตน**: คอลัมน์นั้นเคยผูกได้ด้วยการพิมพ์เบอร์อย่างเดียว
 * (ทางนั้นถูกถอดแล้ว แต่ค่าที่เขียนไปก่อนหน้านี้ยังอยู่) และพนักงานพิมพ์เองได้.
 *
 * สมมติฐาน: OA ร้าน / OA การเงิน / LIFF อยู่ LINE provider เดียวกัน ⇒ userId เดียวกัน (สมมติฐานเดียวกับ
 * `liff-warranty`) — ถ้าไม่ใช่ จะไม่มี LINE ฝั่งร้านคนไหนผ่าน (fail closed ไม่ใช่รั่ว)
 */
/** แถว `customer_line_links` ช่อง FINANCE ที่ยังผูก = หลักฐาน OTP (ผู้เขียนทางเดียว `VerificationService.bind`) */
export const ACTIVE_FINANCE_LINK_WHERE = {
  channel: LineChannelType.FINANCE,
  unlinkedAt: null,
  deletedAt: null,
} satisfies Prisma.CustomerLineLinkWhereInput;

/**
 * "LINE นี้ยืนยัน OTP กับลูกค้าที่ยังอยู่" = แถว FINANCE ที่ยังผูก (`ACTIVE_FINANCE_LINK_WHERE`) ของลูกค้าที่ไม่ถูกลบ — **เกณฑ์เดียว**ของ
 * `findOtpVerifiedCustomerId` · `VerificationService.isLinked` (บอทการเงิน → `linkRoomToCustomer` ตั้ง verified_at) · ห้อง LINE การเงินใหม่
 * (`ChatRoomService.getOrCreate` · `RoomManagerService.getOrCreateRoom`) — Task 24 fix round 1 M-1/M-2 (เดิม isLinked ไม่ดู deleted_at ·
 * การสร้างห้องรับแถวทุกสถานะ) · ใช้กับ findUnique ตาม `lineUserId_channel` ได้ (กรองเพิ่มบน unique key)
 */
export const VERIFIED_FINANCE_LINK_WHERE = {
  ...ACTIVE_FINANCE_LINK_WHERE,
  customer: { deletedAt: null },
} satisfies Prisma.CustomerLineLinkWhereInput;

/**
 * Task 22 fix round 1 I-1 (ง) — ผู้ส่งข้อความการเงินทาง LINE ใส่ใน `customer: { select }` **แทน `lineIdFinance: true`** แล้วเรียก
 * `financeLineRecipient(customer)` ⇒ ปลายทาง = U-id ของแถว OTP ที่ยังผูกของ**ลูกค้าคนนั้น** (unique ต่อลูกค้า — take 1).
 * คอลัมน์ `customers.line_id_finance` แยกจากแถว OTP ได้ (ค่าที่พนักงาน/นำเข้าเขียนก่อน Task 22 · กู้ลูกค้าที่ถูกลบ) ⇒ ห้ามใช้เป็นปลายทาง
 */
export const FINANCE_LINE_RECIPIENT_SELECT = {
  lineLinks: { where: ACTIVE_FINANCE_LINK_WHERE, select: { lineUserId: true }, take: 1 },
} satisfies Prisma.CustomerSelect;

/** U-id ปลายทางข้อความการเงินของลูกค้า (ต้องเลือก `FINANCE_LINE_RECIPIENT_SELECT`) — ไม่มีแถว OTP = null ⇒ ไม่ส่งทาง LINE */
export function financeLineRecipient(
  customer: { lineLinks?: { lineUserId: string }[] } | null | undefined,
): string | null {
  return customer?.lineLinks?.[0]?.lineUserId ?? null;
}

/**
 * Task 24 RR-M2 — หน้าจอพนักงานที่เปิด/ปิดปุ่ม "ส่ง LINE" การเงิน (คิวทวงถาม · โหมดโฟกัส · แบนเนอร์นัดครบกำหนด) ใช้**เกณฑ์เดียวกับผู้ส่งจริง**:
 * เลือก `FINANCE_LINE_RECIPIENT_SELECT` ในลูกค้า แล้วส่งออกผ่านฟังก์ชันนี้ ⇒ `hasVerifiedLine` = มีแถว OTP ที่ยังผูก
 * (`financeLineRecipient` ไม่ว่าง) · ตัด `lineLinks` ทิ้ง — U-id ของแถวไม่ต้องไปถึงหน้าเว็บ · คอลัมน์ `lineIdFinance` ไม่ใช่เกณฑ์ (กติกาข้อ 9)
 */
export function withVerifiedFinanceLine<T extends { lineLinks?: { lineUserId: string }[] }>(
  customer: T,
): Omit<T, 'lineLinks'> & { hasVerifiedLine: boolean } {
  const { lineLinks, ...rest } = customer;
  return { ...rest, hasVerifiedLine: financeLineRecipient({ lineLinks }) !== null };
}

/**
 * Task 27 — ฟอร์มแก้ไขลูกค้าแสดงสถานะ "LINE น้องเบส (การเงิน)" แทนช่องพิมพ์ (`GET /customers/:id` · `/:id/detail`):
 * แถวเดียวกับ `FINANCE_LINE_RECIPIENT_SELECT` (`ACTIVE_FINANCE_LINK_WHERE` · take 1) + วันที่ผูกของแถวนั้น
 */
export const FINANCE_LINE_STATUS_SELECT = {
  lineLinks: {
    where: ACTIVE_FINANCE_LINK_WHERE,
    select: { lineUserId: true, linkedAt: true },
    take: 1,
  },
} satisfies Prisma.CustomerSelect;

export interface FinanceLineStatus {
  /** มีแถว OTP ที่ยังผูก — เกณฑ์เดียวกับผู้ส่ง (`financeLineRecipient`) และปุ่ม "ส่ง LINE" (`withVerifiedFinanceLine`) */
  verified: boolean;
  /** วันที่ลูกค้าผูกด้วย OTP (ISO) · ไม่ผูก = null */
  linkedAt: string | null;
}

/**
 * ส่งออก `financeLine` ให้หน้าจอพนักงาน (ต้องเลือก `FINANCE_LINE_STATUS_SELECT`) · ตัด `lineLinks` ทิ้ง — **ฟิลด์นี้**ไม่มี U-id ของแถว
 * (คอลัมน์ `lineIdFinance` ที่ผู้เรียกเลือกมาเองไม่ถูกแตะ — `GET /customers/:id` ยังคืนคอลัมน์นั้นตามเดิม · Task 27 review M-5) ·
 * คอลัมน์ `lineIdFinance` ไม่ใช่เกณฑ์ (ค่าค้างที่ไม่มีแถวหนุน = verified false — กติกาข้อ 9 ของ security.md)
 */
export function withFinanceLineStatus<
  T extends { lineLinks?: { lineUserId: string; linkedAt: Date }[] },
>(customer: T): Omit<T, 'lineLinks'> & { financeLine: FinanceLineStatus } {
  const { lineLinks, ...rest } = customer;
  const verified = financeLineRecipient({ lineLinks }) !== null;
  return {
    ...rest,
    financeLine: {
      verified,
      linkedAt: verified ? lineLinks![0].linkedAt.toISOString() : null,
    },
  };
}

/** แบบค้นเอง — สำหรับผู้ส่งที่มีแค่ `customerId` และแก้ select ของแหล่งข้อมูลไม่ได้ (เช่น source ที่ผูก revision เอกสาร) */
export async function findFinanceLineRecipient(
  prisma: Pick<PrismaService, 'customerLineLink'>,
  customerId: string,
): Promise<string | null> {
  const link = await prisma.customerLineLink.findFirst({
    where: { customerId, ...ACTIVE_FINANCE_LINK_WHERE },
    select: { lineUserId: true },
  });
  return link?.lineUserId ?? null;
}

export async function findOtpVerifiedCustomerId(
  prisma: Pick<PrismaService, 'customerLineLink'>,
  lineUserId: string,
): Promise<string | null> {
  const link = await prisma.customerLineLink.findFirst({
    where: { lineUserId, ...VERIFIED_FINANCE_LINK_WHERE },
    select: { customerId: true },
  });
  return link?.customerId ?? null;
}

/** LINE + ลูกค้าของห้องแชท — สิ่งที่ใช้ตัดสินว่าห้องยืนยัน OTP แล้วหรือไม่ */
export interface FinanceLineRoomRef {
  lineUserId: string | null;
  customerId: string | null;
}

/** กติกาเดียว: LINE ของห้องยืนยัน OTP (แถว `VERIFIED_FINANCE_LINK_WHERE`) กับ**ลูกค้าของห้อง** — ยืนยันกับคนอื่น = ไม่ใช่ */
function verifiedRoomCustomer(
  room: FinanceLineRoomRef,
  verifiedCustomerIdOfLine: string | null | undefined,
): string | undefined {
  if (!room.lineUserId || !room.customerId) return undefined;
  return verifiedCustomerIdOfLine === room.customerId ? room.customerId : undefined;
}

/**
 * Task 24 round 3 (m-R2-1 ข) — ลูกค้าของห้องเมื่อ LINE ของห้องยืนยัน OTP กับลูกค้าคนนั้นแล้ว · ไม่ใช่ห้อง LINE / ยังไม่ยืนยัน / ยืนยันกับคนอื่น
 * = undefined. ห้องของ LINE ที่ลูกค้ายกเลิกผูกแล้วยังถือ `customer_id` เดิม (ยกเลิกผูกล้างแค่ `verified_at`) ⇒ ข้อความสำเร็จรูปของห้อง
 * การเงินใช้ตัวนี้ตัดสินว่าเติมตัวแปรลูกค้าได้ไหม (`CannedResponseSenderService`) · Task 33 ย้ายมาไว้ที่นี่ให้สถานะห้องในอินบ็อกซ์
 * (`findFinanceLineRoomStatuses`) ใช้กติกาเดียวกัน
 */
export async function findOtpVerifiedRoomCustomerId(
  prisma: Pick<PrismaService, 'customerLineLink'>,
  room: FinanceLineRoomRef,
): Promise<string | undefined> {
  if (!room.lineUserId || !room.customerId) return undefined;
  return verifiedRoomCustomer(room, await findOtpVerifiedCustomerId(prisma, room.lineUserId));
}

/**
 * Task 33 (mockup A2/A3) — สถานะ LINE การเงินของห้องในอินบ็อกซ์ · **ไม่มี U-id**:
 * - `verified` — กติกาเดียวกับ `findOtpVerifiedRoomCustomerId` (ข้อความสำเร็จรูปเติมตัวแปรลูกค้าได้)
 * - ไม่ verified + `unlinkedAt` — LINE นี้เคยยืนยันกับลูกค้าของห้องแล้วหลุด (ยกเลิกผูก / ลูกค้าเปลี่ยน LINE) = ป้าย "ยกเลิกผูกแล้ว"
 * - ไม่ verified + `unlinkedAt: null` — ไม่เคยผูก LINE นี้กับลูกค้านี้ / ไม่ทราบ (ไม่อยู่ใน mockup — หน้าเว็บไม่แสดงอะไร)
 */
export interface FinanceLineRoomStatus {
  verified: boolean;
  /** วันที่ยกเลิก (ISO) · verified หรือไม่ทราบ = null */
  unlinkedAt: string | null;
}

/**
 * สถานะของหลายห้องในสอง query (รายชื่อแชท 50 ห้องต่อหน้า) — เฉพาะห้อง `LINE_FINANCE` ที่มีทั้ง LINE และลูกค้า (ห้องอื่นไม่อยู่ใน Map)
 * วันที่ยกเลิก: `chat_rooms.finance_line_unlinked_at` (ตั้งโดย `clearFinanceRoomVerification` — ครอบกรณีลูกค้าเปลี่ยน LINE ซึ่งแถว link
 * ถูกชี้ไป LINE ใหม่) ก่อน · ห้องที่หลุดก่อนมีคอลัมน์นี้ ใช้แถว link ที่ปิดแล้วของคู่ (LINE, ลูกค้าของห้อง) เดียวกัน
 */
export async function findFinanceLineRoomStatuses(
  prisma: Pick<PrismaService, 'customerLineLink'>,
  rooms: readonly (FinanceLineRoomRef & {
    id: string;
    channel: ChatChannel | string;
    financeLineUnlinkedAt?: Date | null;
  })[],
): Promise<Map<string, FinanceLineRoomStatus>> {
  const result = new Map<string, FinanceLineRoomStatus>();
  const targets = rooms.filter(
    (room) => room.channel === ChatChannel.LINE_FINANCE && !!room.lineUserId && !!room.customerId,
  );
  if (targets.length === 0) return result;

  const verifiedLinks = await prisma.customerLineLink.findMany({
    where: {
      lineUserId: { in: [...new Set(targets.map((room) => room.lineUserId!))] },
      ...VERIFIED_FINANCE_LINK_WHERE,
    },
    select: { lineUserId: true, customerId: true },
  });
  const verifiedCustomerOf = new Map(verifiedLinks.map((l) => [l.lineUserId, l.customerId]));
  const unverified = targets.filter(
    (room) => !verifiedRoomCustomer(room, verifiedCustomerOf.get(room.lineUserId!)),
  );
  const needLegacyDate = unverified.filter((room) => !room.financeLineUnlinkedAt);
  const closedLinks = needLegacyDate.length
    ? await prisma.customerLineLink.findMany({
        where: {
          lineUserId: { in: [...new Set(needLegacyDate.map((room) => room.lineUserId!))] },
          channel: LineChannelType.FINANCE,
          unlinkedAt: { not: null },
          deletedAt: null,
        },
        select: { lineUserId: true, customerId: true, unlinkedAt: true },
      })
    : [];
  const closedAt = new Map(
    closedLinks.map((l) => [`${l.lineUserId}\u0000${l.customerId}`, l.unlinkedAt]),
  );

  for (const room of targets) {
    if (verifiedRoomCustomer(room, verifiedCustomerOf.get(room.lineUserId!))) {
      result.set(room.id, { verified: true, unlinkedAt: null });
      continue;
    }
    const unlinkedAt =
      room.financeLineUnlinkedAt ??
      closedAt.get(`${room.lineUserId}\u0000${room.customerId}`) ??
      null;
    result.set(room.id, { verified: false, unlinkedAt: unlinkedAt?.toISOString() ?? null });
  }
  return result;
}

/**
 * จุดตัดของค่า `customers.line_id_shop` ที่ยังเชื่อเป็นทางสำรอง — ก่อน Task 20 (2026-10-31 00:00 เวลาไทย).
 * แถวที่แก้หลังจากนั้น (`updated_at` ใหม่กว่า — Prisma ตั้งให้ทุกครั้งที่ update) อาจถือค่าที่พนักงาน/บอทขายเขียนใหม่โดยไม่มี OTP
 * ⇒ ไม่นับ (fail closed: แถวเก่าที่ถูกแก้ช่องอื่นภายหลังก็หลุด — ลูกค้ายืนยัน OTP แทน)
 */
export const LEGACY_SHOP_LINE_ID_CUTOFF = new Date('2026-10-31T00:00:00+07:00');

/**
 * Task 22 (task-20-report ข้อกังวล 1 — ทางเลือก ก) — ตัวตนลูกค้าของหน้า LIFF ฝั่งร้าน ("ประกันของฉัน" / เคสหลังการขาย):
 * 1. แถว OTP ของ LINE เดียวกัน (`findOtpVerifiedCustomerId`) — หลักฐานตัวตนเดียวของระบบ (ลูกค้าเงินสดก็ยืนยันได้: OTP ค้นลูกค้าจากเบอร์
 *    ไม่ดูว่ามีสัญญา)
 * 2. สำรองเฉพาะค่า `line_id_shop` ที่เขียนก่อน Task 20 (`updatedAt < LEGACY_SHOP_LINE_ID_CUTOFF`) — ค่าที่เขียนหลังจากนั้นไม่ผ่าน OTP
 *    (พนักงาน/บอทขายยังเขียนคอลัมน์นี้ได้) จึงไม่นับ · ชุดแถวสำรองนี้จำกัดแล้ว (ไม่โตขึ้น) — ตรวจ/ล้างก่อนเชื่อม OA ร้านกับ prod
 *
 * ไม่ใช้ทางเลือก ข (ให้ OTP เขียน line_id_shop ด้วย) เพราะคอลัมน์นั้นยังมีผู้เขียนที่ไม่ผ่าน OTP — เขียนเพิ่มอีกทางไม่ทำให้มันเป็นหลักฐานได้
 */
export async function findShopLiffCustomerId(
  prisma: Pick<PrismaService, 'customerLineLink' | 'customer'>,
  lineUserId: string,
): Promise<string | null> {
  const verified = await findOtpVerifiedCustomerId(prisma, lineUserId);
  if (verified) return verified;
  const legacy = await prisma.customer.findFirst({
    where: {
      lineIdShop: lineUserId,
      deletedAt: null,
      updatedAt: { lt: LEGACY_SHOP_LINE_ID_CUTOFF },
    },
    select: { id: true },
  });
  return legacy?.id ?? null;
}

/**
 * ข้อความเดียวที่บอท OA ร้านตอบ LINE ที่ยังไม่ยืนยัน OTP เมื่อขอข้อมูลสัญญา/ยอด หรือพิมพ์เบอร์มา —
 * ไม่บอกว่าเบอร์มีในระบบไหม ไม่มีชื่อ · ลิงก์เดียวกับที่บอท OA การเงินส่ง (LINE Login → /liff/finance-verify)
 */
export function buildShopVerifyPrompt(): string {
  return (
    'เพื่อความปลอดภัยของข้อมูล ต้องยืนยันตัวตนด้วยเบอร์โทร + รหัส OTP ทาง SMS ก่อนนะคะ\n\n' +
    `👉 ยืนยันตัวตน:\n${buildBrowserUrl('/liff/finance-verify')}\n\n` +
    'ยืนยันเสร็จแล้วกลับมาพิมพ์ "เช็คยอด" ได้เลยค่ะ'
  );
}
