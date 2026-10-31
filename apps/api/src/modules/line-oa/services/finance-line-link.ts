import { BadRequestException } from '@nestjs/common';
import { ChatChannel, LineChannelType, Prisma } from '@prisma/client';

/**
 * Task 22 I3 — พนักงาน/API ตั้ง `customers.line_id_finance` เป็นค่าใหม่ไม่ได้ (การผูก LINE การเงินต้องผ่าน OTP ทาง SMS
 * ไปเบอร์ของลูกค้าเท่านั้น — `VerificationService.linkVerifiedLine`). ทางที่ลูกค้าทำได้จริงวันนี้: ส่งข้อความใดก็ได้ใน
 * แชท LINE การเงิน → บอทตอบการ์ดยืนยันตัวตนให้ LINE ที่ยังไม่ผูกทุกข้อความ (`ChatbotFinanceService.handleMessage` →
 * `replyVerifyFlexAndSave`) ปุ่ม "เริ่มยืนยันตัวตน" → `/liff/finance-verify` (เบอร์ + OTP). ระบบไม่มีปุ่มฝั่งพนักงานที่ส่ง
 * ลิงก์ยืนยันตัวตนให้ลูกค้า ⇒ ข้อความชี้ทางของลูกค้าเอง
 */
export const LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE =
  'การผูก LINE การเงินต้องให้ลูกค้ายืนยันเบอร์ด้วย OTP เอง — ให้ลูกค้าส่งข้อความใดก็ได้ในแชท LINE การเงิน แล้วกดปุ่ม "เริ่มยืนยันตัวตน" (กรอกเบอร์ + รหัส OTP ทาง SMS)';

/**
 * Task 24 RR-M2 — ส่งข้อความ LINE การเงินให้ลูกค้าที่ไม่มีแถว OTP ที่ยังผูกไม่ได้ (ปลายทาง = แถว OTP เท่านั้น — กติกาข้อ 9 ของ security.md)
 * ⇒ บอกพนักงานตรง ๆ ว่าลูกค้ายังไม่ยืนยัน (ค่า LINE ID ที่หน้าลูกค้าแสดงอาจเป็นค่าที่พนักงาน/นำเข้าเขียนไว้ — ใช้ส่งไม่ได้) และชี้ทางที่มีจริง
 * ทางเดียวกับ `LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE` (ตรวจ 2026-10-31: `ChatbotFinanceService.handleMessage` ตอบการ์ดยืนยันให้ LINE ที่ยังไม่ผูก
 * ทุกข้อความ ปุ่ม "เริ่มยืนยันตัวตน" · ไม่มีปุ่มฝั่งพนักงานส่งลิงก์ยืนยัน)
 */
export const LINE_FINANCE_NOT_VERIFIED_MESSAGE =
  'ส่ง LINE ไม่ได้ — ลูกค้ารายนี้ยังไม่ได้ยืนยัน LINE การเงินด้วย OTP (LINE ID ที่บันทึกไว้ในระบบใช้ส่งข้อความไม่ได้จนกว่าลูกค้าจะยืนยัน) · ให้ลูกค้าส่งข้อความใดก็ได้ในแชท LINE การเงิน แล้วกดปุ่ม "เริ่มยืนยันตัวตน" (กรอกเบอร์ + รหัส OTP ทาง SMS) — ระบบไม่มีปุ่มให้พนักงานส่งลิงก์ยืนยันแทน';

/**
 * Task 24 fix round 1 I-1 — แผง 360 ("แชท LINE") ส่งได้เฉพาะห้อง LINE การเงินของแถว OTP ที่ยังผูก · ห้อง LINE ร้านยังไม่มีการยืนยันตัวตน
 * ด้วย OTP (OA ร้านยังไม่เชื่อม prod · `line_id_shop` พนักงาน/บอทขายเขียนได้) ⇒ ไม่ส่งทาง LINE ร้านจากแผงนี้ · ทางของลูกค้าเหมือน
 * `LINE_FINANCE_NOT_VERIFIED_MESSAGE` (ไม่ชี้หน้ากล่องข้อความรวม — ACCOUNTANT เปิดแผงนี้ได้แต่เข้า `/inbox` ไม่ได้)
 */
export const LINE_SHOP_STAFF_SEND_DISABLED_MESSAGE =
  'ส่งไม่ได้ — แผงนี้ส่งได้เฉพาะ LINE การเงินของลูกค้าที่ยืนยัน OTP แล้ว (แชทที่เห็นเป็นของ LINE ร้าน ซึ่งยังไม่มีการยืนยันตัวตน จึงไม่ส่งทาง LINE ร้านจากที่นี่) · ลูกค้ารายนี้ยังไม่ได้ยืนยัน LINE การเงิน — ให้ลูกค้าส่งข้อความใดก็ได้ในแชท LINE การเงิน แล้วกดปุ่ม "เริ่มยืนยันตัวตน" (กรอกเบอร์ + รหัส OTP ทาง SMS)';

/**
 * ตัดสินค่า LINE การเงินที่พนักงาน/API ส่งมา (ฟอร์มลูกค้า · skip-tracing) เทียบกับค่าปัจจุบันของลูกค้า:
 * - ไม่ส่ง / ส่งค่าเดิม (ฟอร์มแก้ไขส่งทุกช่องกลับมาทุกครั้ง) / ว่างทั้งคู่ → `'none'` ไม่แตะ
 * - ส่งค่าว่างหรือ null ขณะที่ลูกค้ามีค่าอยู่ → `'clear'` ยกเลิกผูก (`unlinkFinanceLine` แบบ `customerId`)
 * - ค่าอื่น → 400 `LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE` (ห้ามตั้ง U-id ที่ไม่ได้ผ่าน OTP)
 *
 * เทียบหลัง trim — `' U1 '` ที่ส่งกลับมาคือค่าเดิม
 */
export function staffLineFinanceChange(
  requested: string | null | undefined,
  current: string | null | undefined,
): 'none' | 'clear' {
  if (requested === undefined) return 'none';
  const next = requested?.trim() ?? '';
  const cur = current?.trim() ?? '';
  if (next === cur) return 'none';
  if (next === '') return 'clear';
  throw new BadRequestException({
    message: LINE_FINANCE_LINK_REQUIRES_OTP_MESSAGE,
    field: 'lineIdFinance',
  });
}

/**
 * Task 24 (Task 22 review M-8) — `chat_rooms.verified_at` ของห้อง LINE การเงิน = "ห้องของลูกค้าที่ยืนยัน OTP แล้ว" (ด่าน `verifiedOnly` ของแม่แบบ
 * ข้อความ — `CannedResponseSenderService.send`). ผู้ตั้งค่า (ทั้งหมดต้องมีแถว OTP ที่ยังผูก): `VerificationService.bind` (ห้องของ LINE ที่เพิ่งผูก) ·
 * `ChatRoomService.linkRoomToCustomer` (บอทการเงินหลัง `isLinked`) · สร้างห้องการเงินใหม่ของ LINE ที่มีแถวยังผูก (`ChatRoomService.getOrCreate` ·
 * cron `overdue-chat` ส่งลูกค้าจากแถวที่ยังผูกเข้า `RoomManagerService.getOrCreateRoom`). ฝั่งกลับ = helper นี้ตัวเดียว เรียกในทรานแซกชันเดียวกับการปิด/ย้ายแถว:
 * ล้างห้อง LINE การเงินของ LINE ที่หลุด (`lineUserIds`) และของลูกค้าที่ไม่เหลือ LINE ที่ยืนยันแล้ว (`customerIds` — ลูกค้ามีแถว FINANCE ได้แถวเดียว
 * ⇒ ห้องการเงินของเขาที่ยัง verified ทุกห้องเป็นค่าค้าง รวมห้องของ LINE เก่าที่ยกเลิกไปก่อนแก้ข้อนี้) · ไม่แตะ `customerId` ของห้อง (ประวัติแชทคงเดิม)
 */
export async function clearFinanceRoomVerification(
  tx: Prisma.TransactionClient,
  lost: { lineUserIds?: readonly string[]; customerIds?: readonly string[] },
): Promise<void> {
  const lineUserIds = [...new Set((lost.lineUserIds ?? []).filter(Boolean))];
  const customerIds = [...new Set((lost.customerIds ?? []).filter(Boolean))];
  const scope: Prisma.ChatRoomWhereInput[] = [];
  if (lineUserIds.length > 0) scope.push({ lineUserId: { in: lineUserIds } });
  if (customerIds.length > 0) scope.push({ customerId: { in: customerIds } });
  if (scope.length === 0) return;
  // ไม่กรอง deletedAt โดยตั้งใจ — เป็นการล้างค่า ไม่ใช่การอ่าน
  await tx.chatRoom.updateMany({
    where: { channel: ChatChannel.LINE_FINANCE, verifiedAt: { not: null }, OR: scope },
    data: { verifiedAt: null },
  });
}

/**
 * Task 29 (เจ้าของตัดสิน 31 ต.ค. 2026 — Task 27 review M-2) — **ลำดับล็อกเดียว**ของทุกทางที่ผูก/ยกเลิกผูก LINE การเงิน:
 * **แถวลูกค้า (`customers`, เรียงตาม id ใน SQL) → แถว `customer_line_links` → `chat_rooms`**. ผู้เรียก: `VerificationService.bind`
 * (ผ่าน `lockCustomersForFinanceLineBind`) · `unlinkFinanceLine` ทั้งสองแบบ (LIFF / พนักงาน) · ปุ่ม/PATCH ยกเลิกผูกของพนักงาน
 * (`CustomerWriteService.unlinkFinanceLineByStaff`). เดิม `bind` ล็อกแถว link/ห้องก่อนแล้วค่อยแถวลูกค้า ⇒ ยืนยัน OTP พร้อมพนักงานกดยกเลิกผูก
 * ลูกค้าคนเดียวกัน = deadlock 40P01 (ปักที่ `finance-line-lock-order.db.spec.ts`).
 *
 * ล็อกหลายแถวต้องผ่าน helper นี้เท่านั้น — `ORDER BY id` ใน SQL ตัดสินลำดับ (LockRows ทำงานหลัง Sort) ทุกผู้เรียกจึงเรียงเหมือนกันเสมอ ·
 * `FOR NO KEY UPDATE` = ระดับเดียวกับ UPDATE ที่ไม่แตะคอลัมน์ key (ทุกทางแก้แค่ `line_id_finance`) ไม่บล็อก insert แถวลูกที่อ้าง FK ·
 * ล็อกซ้ำแถวที่ถืออยู่แล้วไม่มีผล
 */
export async function lockFinanceLineCustomers(
  tx: Prisma.TransactionClient,
  customerIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(customerIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM customers WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR NO KEY UPDATE`;
}

/**
 * Task 29 — ชุดลูกค้าที่ `bind` (OTP) จะแตะ ล็อกก่อนแตะแถว link/ห้อง: ลูกค้าที่กำลังผูก + ลูกค้าที่ถือแถว link ของ LINE นี้อยู่
 * (LINE ย้ายออกจากเขา — ห้องของเขาถูกล้าง `verified_at`) + ทุกลูกค้าที่คอลัมน์ `line_id_finance` = LINE นี้ (bind ล้างค่าให้ — รวมแถวที่ถูกลบ).
 * อ่านชุด → ล็อก (เรียง id) → อ่านซ้ำใต้ล็อก จนชุดไม่โตอีก (ปกติสองรอบ · ชุดเปลี่ยนได้เฉพาะเมื่อมี bind ของ LINE เดียวกันอีกตัว commit ระหว่างนั้น —
 * แถวที่เพิ่มเข้ามารอบหลังล็อกช้ากว่าลำดับ แต่ทรานแซกชันที่ทำให้ชุดเปลี่ยน commit ไปแล้วจึงไม่เป็นวงจร) ·
 * คืนเจ้าของแถว link ของ LINE นี้ตามที่อ่านใต้ล็อก (ไม่มีแถว = null)
 */
export async function lockCustomersForFinanceLineBind(
  tx: Prisma.TransactionClient,
  lineUserId: string,
  customerId: string,
): Promise<{ lineHolderId: string | null }> {
  const locked = new Set<string>();
  let lineHolderId: string | null = null;
  for (let round = 0; round < 5; round++) {
    const lineRow = await tx.customerLineLink.findUnique({
      where: { lineUserId_channel: { lineUserId, channel: LineChannelType.FINANCE } },
      select: { customerId: true },
    });
    // ไม่กรอง deletedAt โดยตั้งใจ — bind ล้างคอลัมน์นี้บนทุกแถว (รวมลูกค้าที่ถูกลบ)
    const columnHolders = await tx.customer.findMany({
      where: { lineIdFinance: lineUserId },
      select: { id: true },
    });
    lineHolderId = lineRow?.customerId ?? null;
    const ids = [customerId, lineHolderId, ...columnHolders.map((c) => c.id)].filter(
      (id): id is string => !!id,
    );
    if (ids.every((id) => locked.has(id))) break;
    await lockFinanceLineCustomers(tx, ids);
    ids.forEach((id) => locked.add(id));
  }
  return { lineHolderId };
}

/** ยกเลิกผูกของ LINE หนึ่งบัญชี (ลูกค้าเป็นคนกดในหน้า LIFF) หรือของลูกค้าหนึ่งคน (พนักงานล้างช่อง LINE การเงิน) */
export type FinanceLineUnlinkTarget = { lineUserId: string } | { customerId: string };

/**
 * ยกเลิกผูก LINE การเงิน — ทางเดียวของการล้าง `customers.line_id_finance` + ปิดแถว `customer_line_links` ช่อง FINANCE
 * (ต้องเรียกใน tx เดียวกับงานที่เหลือของผู้เรียก). แถวที่ปิด (`unlinkedAt`) คือสิ่งที่ `/liff/finance-verify` และบอทการเงิน
 * (`VerificationService.isLinked`) ถือเป็น "ผูกแล้ว" — ล้างแต่คอลัมน์โดยไม่ปิดแถว = ลูกค้ายืนยัน LINE ใหม่ไม่ได้ (409
 * `CUSTOMER_LINKED_TO_OTHER_LINE_MESSAGE`) ส่วนบอทยังถือว่าผูกอยู่. ผูกใหม่ด้วย OTP เปิด/ชี้แถวเดิมกลับ (`VerificationService.bind`)
 *
 * - `{ lineUserId }` (LIFF "ยกเลิกผูก LINE" — `LiffTokenGuard` พิสูจน์ว่าเป็นเจ้าของ LINE นี้): ล้างคอลัมน์บน**ทุก**ลูกค้าที่ถือ
 *   LINE นี้ **รวมแถวที่ถูกลบ** (กู้จากถังขยะ/ชุบ ghost แล้วค่าไม่กลับมา — Task 22 fix round 1) (เดิมล้างคนเดียว — Task 19 review M1)
 *   + ปิดแถวของ LINE นี้
 * - `{ customerId }` (พนักงานล้างช่องในฟอร์มลูกค้า / skip-tracing): ล้างคอลัมน์ของลูกค้าคนนี้ + ปิดแถวของ**ลูกค้าคนนี้**เท่านั้น —
 *   ห้ามปิดตาม LINE: ค่าในคอลัมน์อาจเป็น U-id ที่พนักงานพิมพ์ (I3) ซึ่งเป็น LINE ที่ยืนยัน OTP ไว้กับลูกค้าอีกคน
 *
 * ไม่สลับ rich menu กลับเป็นเมนูก่อนยืนยัน (เหมือน LIFF เดิม) · ไม่เขียน journey
 */
export async function unlinkFinanceLine(
  tx: Prisma.TransactionClient,
  target: FinanceLineUnlinkTarget,
  unlinkedAt: Date = new Date(),
): Promise<void> {
  if ('lineUserId' in target) {
    // ลูกค้าที่ถือแถวของ LINE นี้อยู่ (unique ต่อ LINE — ไม่เกินหนึ่งคน) — ปิดแถวแล้วเขาไม่เหลือ LINE ที่ยืนยัน (M-8)
    const holders = await tx.customerLineLink.findMany({
      where: { lineUserId: target.lineUserId, channel: LineChannelType.FINANCE, unlinkedAt: null },
      select: { customerId: true },
    });
    // Task 29 — ล็อกลูกค้าทุกคนที่ทางนี้จะแตะก่อน (เรียง id) แล้วค่อยแถว link → ห้อง (ลำดับเดียวกับ bind/ปุ่มพนักงาน) ·
    // updateMany ข้างล่างล็อกตามลำดับที่สแกนเจอ ถ้าไม่ล็อกก่อนจะสวนกับ bind ที่ล็อกเรียง id ได้เมื่อมีหลายคนถือคอลัมน์นี้
    const columnHolders = await tx.customer.findMany({
      where: { lineIdFinance: target.lineUserId },
      select: { id: true },
    });
    await lockFinanceLineCustomers(tx, [
      ...holders.map((h) => h.customerId),
      ...columnHolders.map((c) => c.id),
    ]);
    // ไม่กรอง deletedAt โดยตั้งใจ — เป็นการล้างค่า ไม่ใช่การอ่าน
    await tx.customer.updateMany({
      where: { lineIdFinance: target.lineUserId },
      data: { lineIdFinance: null },
    });
    await tx.customerLineLink.updateMany({
      where: { lineUserId: target.lineUserId, channel: LineChannelType.FINANCE, unlinkedAt: null },
      data: { unlinkedAt },
    });
    await clearFinanceRoomVerification(tx, {
      lineUserIds: [target.lineUserId],
      customerIds: holders.map((h) => h.customerId),
    });
    return;
  }
  // Task 29 — แถวลูกค้าก่อนแถว link/ห้อง (ผู้เรียกที่ล็อกไว้แล้ว — ปุ่ม/PATCH ของพนักงาน — ล็อกซ้ำไม่มีผล)
  await lockFinanceLineCustomers(tx, [target.customerId]);
  // LINE ของแถวที่กำลังปิด (M-8) — ห้องของ LINE นั้นอาจผูกลูกค้าอื่นไว้ (พนักงานผูกห้องเอง) ก็ถือว่าไม่ยืนยันแล้ว
  const closing = await tx.customerLineLink.findMany({
    where: { customerId: target.customerId, channel: LineChannelType.FINANCE, unlinkedAt: null },
    select: { lineUserId: true },
  });
  await tx.customer.update({
    where: { id: target.customerId },
    data: { lineIdFinance: null },
  });
  await tx.customerLineLink.updateMany({
    where: { customerId: target.customerId, channel: LineChannelType.FINANCE, unlinkedAt: null },
    data: { unlinkedAt },
  });
  await clearFinanceRoomVerification(tx, {
    lineUserIds: closing.map((r) => r.lineUserId),
    customerIds: [target.customerId],
  });
}
