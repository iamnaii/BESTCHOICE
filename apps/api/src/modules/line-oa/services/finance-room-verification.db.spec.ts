/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/line-oa/services/finance-room-verification.db.spec.ts --runInBand
 *
 * Task 24 (Task 22 review M-8) — `chat_rooms.verified_at` ของห้อง LINE การเงิน = "ห้องนี้เป็นของลูกค้าที่ยืนยัน OTP แล้ว" (ด่าน `verifiedOnly`
 * ของแม่แบบ — `CannedResponseSenderService.send`). ยกเลิกผูกเคยไม่ล้างค่านี้ ⇒ แม่แบบ `verifiedOnly` ยังส่งเข้าห้องได้หลังยกเลิกผูก.
 * พิสูจน์บน Postgres ว่าทุกทางที่ LINE หลุดจากลูกค้าล้างค่านี้ในทรานแซกชันเดียวกัน (helper เดียว `clearFinanceRoomVerification`):
 *   1. พนักงานล้างช่อง LINE การเงิน (`PATCH /customers/:id` → `unlinkFinanceLine({ customerId })`) + ด่าน verifiedOnly หยุดส่ง
 *   2. ลูกค้ากดยกเลิกผูกใน LIFF (`unlinkLineAccount` → `unlinkFinanceLine({ lineUserId })`)
 *   3. ผูก LINE ใหม่หลังยกเลิก (bind ชี้แถวเดิมของลูกค้าไป LINE ใหม่) → ห้องของ LINE เดิมที่ยังค้าง verified (ข้อมูลก่อนแก้) ถูกล้าง
 *   4. LINE ย้ายจากลูกค้า A ไป B ด้วย OTP → ห้องอื่นของ A ที่ยังค้าง verified ถูกล้าง · ห้องของ LINE นั้นเป็นของ B และ verified
 *   ทุกข้อ: ห้องของลูกค้าอื่นที่ยืนยันอยู่ไม่ถูกแตะ
 */
import { BadRequestException } from '@nestjs/common';
import { ChatChannel, LineChannelType, PrismaClient } from '@prisma/client';
import { VerificationService } from '../../chatbot-finance/services/verification.service';
import { CustomerWriteService } from '../../customers/services/customer-write.service';
import { CannedResponseSenderService } from '../../staff-chat/services/canned-response-sender.service';
import { LiffApiService } from '../liff-api.service';
import { ChatRoomService } from '../../chatbot-finance/services/chat-room.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t24m8-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const customerIds: string[] = [];
const line = (name: string) => `U${tag}-${name}`;

const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
const richMenu = { switchRichMenu: jest.fn().mockResolvedValue(undefined) };
let verification: VerificationService;
let liff: LiffApiService;
let customerForm: CustomerWriteService;
let canned: CannedResponseSenderService;
let templateId = '';
let otherVerifiedRoom = '';

async function customer(name: string, phoneSuffix: string) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `09${phoneSuffix}${digits}` },
  });
  customerIds.push(row.id);
  return row;
}

async function room(lineUserId: string, customerId: string | null, verifiedAt: Date | null) {
  const row = await prisma.chatRoom.create({
    data: { lineUserId, channel: ChatChannel.LINE_FINANCE, customerId, verifiedAt },
  });
  return row.id;
}

const verifiedAt = async (id: string) =>
  (await prisma.chatRoom.findUniqueOrThrow({ where: { id } })).verifiedAt;

/** ขอ OTP ไปที่เบอร์ของลูกค้า แล้วยืนยันด้วยรหัสที่ส่งทาง SMS (เส้นจริง) */
async function verifyWithOtp(lineUserId: string, phone: string) {
  await verification.requestOtp({ lineUserId, phone });
  const otp = (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
  return verification.verifyOtp({ lineUserId, otp });
}

/** ด่าน verifiedOnly — ผ่านด่าน = ไปตายที่ "ไม่มี bubble" (translator ว่าง) · ไม่ผ่าน = ข้อความด่าน */
async function verifiedOnlyGate(roomId: string): Promise<'blocked' | 'passed'> {
  const err = await canned.send(roomId, templateId, 'staff-1').catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  return (err as BadRequestException).message === 'Template นี้ใช้ได้เฉพาะลูกค้าที่ยืนยันตัวตนแล้ว'
    ? 'blocked'
    : 'passed';
}

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  verification = new VerificationService(
    prisma as never,
    sms as never,
    { isEnabled: jest.fn().mockResolvedValue(false) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    undefined,
    undefined,
    { get: jest.fn(() => richMenu) } as never,
  );
  liff = new LiffApiService(prisma as never);
  const query = { findOne: (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } }) };
  customerForm = new CustomerWriteService(prisma as never, {} as never, query as never);
  canned = new CannedResponseSenderService(
    prisma as never,
    { filterByChannel: jest.fn(() => []) } as never,
    {} as never,
    {} as never,
  );
  const template = await prisma.cannedResponse.create({
    data: { shortcut: `/${tag}`, title: 'ทดสอบ', content: 'ทดสอบ', verifiedOnly: true },
  });
  templateId = template.id;
  // ลูกค้าอีกคนที่ยืนยัน OTP อยู่ — ห้องของเขาต้องไม่ถูกแตะในทุกข้อ
  const other = await customer('ยืนยันอยู่', '9');
  otherVerifiedRoom = await room(line('other'), other.id, null);
  await verifyWithOtp(line('other'), other.phone!);
});

afterAll(async () => {
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { startsWith: `U${tag}` } } });
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.chatbotOtpRequest.deleteMany({ where: { lineUserId: { contains: tag } } });
  await prisma.cannedResponse.deleteMany({ where: { id: templateId } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  expect(await verifiedAt(otherVerifiedRoom)).toBeInstanceOf(Date);
});

describe('ยกเลิกผูก LINE การเงิน → ล้าง chat_rooms.verified_at (Task 24 M-8)', () => {
  it('1. พนักงานล้างช่อง LINE การเงิน → ห้องของ LINE นั้น + ห้องเก่าของลูกค้าที่ค้าง verified ถูกล้าง · แม่แบบ verifiedOnly หยุดส่ง', async () => {
    const c = await customer('พนักงานล้าง', '1');
    const current = await room(line('1'), null, null);
    const legacy = await room(line('1-old'), c.id, new Date('2026-01-01')); // ข้อมูลก่อนแก้
    await verifyWithOtp(line('1'), c.phone!);
    expect(await verifiedAt(current)).toBeInstanceOf(Date);
    expect(await verifiedOnlyGate(current)).toBe('passed');

    await customerForm.update(c.id, { lineIdFinance: null } as never);

    expect(await verifiedAt(current)).toBeNull();
    expect(await verifiedAt(legacy)).toBeNull();
    expect(await verifiedOnlyGate(current)).toBe('blocked');
  });

  it('2. ลูกค้ากดยกเลิกผูกใน LIFF → ห้องของ LINE นั้นถูกล้าง · แม่แบบ verifiedOnly หยุดส่ง', async () => {
    const c = await customer('LIFF ยกเลิก', '2');
    const current = await room(line('2'), null, null);
    await verifyWithOtp(line('2'), c.phone!);
    expect(await verifiedOnlyGate(current)).toBe('passed');

    await expect(liff.unlinkLineAccount(line('2'))).resolves.toEqual({ success: true });

    expect(await verifiedAt(current)).toBeNull();
    expect(await verifiedOnlyGate(current)).toBe('blocked');
  });

  it('3. ยกเลิกแล้วผูก LINE ใหม่ (bind ชี้แถวเดิมไป LINE ใหม่) → ห้องของ LINE เดิมที่ค้าง verified ถูกล้าง · ห้อง LINE ใหม่ verified', async () => {
    const c = await customer('เปลี่ยน LINE', '3');
    const oldRoom = await room(line('3a'), null, null);
    await verifyWithOtp(line('3a'), c.phone!);
    await liff.unlinkLineAccount(line('3a'));
    // ข้อมูลก่อนแก้: ยกเลิกผูกไม่ได้ล้าง verified_at
    await prisma.chatRoom.update({ where: { id: oldRoom }, data: { verifiedAt: new Date() } });
    const newRoom = await room(line('3b'), null, null);

    await expect(verifyWithOtp(line('3b'), c.phone!)).resolves.toMatchObject({ customerId: c.id });

    expect(await verifiedAt(oldRoom)).toBeNull();
    expect(await verifiedAt(newRoom)).toBeInstanceOf(Date);
    expect(await verifiedOnlyGate(newRoom)).toBe('passed');
  });

  it('4. LINE ย้ายจากลูกค้า A ไป B ด้วย OTP → ห้องอื่นของ A ที่ค้าง verified ถูกล้าง · ห้องของ LINE นั้นเป็นของ B (verified)', async () => {
    const a = await customer('ลูกค้า A', '4');
    const b = await customer('ลูกค้า B', '5');
    const shared = await room(line('4'), null, null);
    await verifyWithOtp(line('4'), a.phone!);
    const aLegacy = await room(line('4-old'), a.id, new Date('2026-01-01'));

    await expect(verifyWithOtp(line('4'), b.phone!)).resolves.toMatchObject({ customerId: b.id });

    expect(await verifiedAt(aLegacy)).toBeNull();
    const moved = await prisma.chatRoom.findUniqueOrThrow({ where: { id: shared } });
    expect(moved.customerId).toBe(b.id);
    expect(moved.verifiedAt).toBeInstanceOf(Date);
    expect(
      await prisma.customerLineLink.count({
        where: { customerId: a.id, channel: LineChannelType.FINANCE, unlinkedAt: null },
      }),
    ).toBe(0);
  });

  /**
   * Task 24 fix round 1 M-1 — เกณฑ์เดียว "LINE นี้ยืนยัน OTP กับลูกค้าที่ยังอยู่" (แถวที่ยังผูก: unlinked/deleted ว่าง · ลูกค้าไม่ถูกลบ) ใช้ทั้ง
   * `isLinked` (บอทการเงิน → `linkRoomToCustomer` ตั้ง verified_at) และการสร้างห้องการเงินใหม่ — แถวที่ deleted_at ไม่ว่าง (แก้ DB มือ) ไม่นับ
   */
  it('5. แถว link ที่ถูกลบ (deleted_at ไม่ว่าง แม้ unlinked_at ว่าง) → isLinked = false และห้องใหม่ของ LINE นั้นไม่ verified', async () => {
    const c = await customer('แถวถูกลบ', '6');
    await verifyWithOtp(line('5'), c.phone!);
    expect(await verification.isLinked(line('5'))).toMatchObject({ linked: true });
    await prisma.customerLineLink.updateMany({
      where: { lineUserId: line('5') },
      data: { deletedAt: new Date() },
    });

    expect(await verification.isLinked(line('5'))).toEqual({ linked: false });
    const rooms = new ChatRoomService(
      prisma as never,
      {
        getUserProfile: jest.fn().mockResolvedValue(null),
      } as never,
    );
    const created = await rooms.getOrCreate(line('5'));
    expect(created).toMatchObject({ customerId: null, verifiedAt: null });
  });

  it('6. ลูกค้าของแถวถูกลบ (ถังขยะ) → isLinked = false · ห้องใหม่ไม่ verified', async () => {
    const c = await customer('ลูกค้าถูกลบ', '7');
    await verifyWithOtp(line('6'), c.phone!);
    await prisma.customer.update({ where: { id: c.id }, data: { deletedAt: new Date() } });

    expect(await verification.isLinked(line('6'))).toEqual({ linked: false });
    const rooms = new ChatRoomService(
      prisma as never,
      {
        getUserProfile: jest.fn().mockResolvedValue(null),
      } as never,
    );
    expect(await rooms.getOrCreate(line('6'))).toMatchObject({
      customerId: null,
      verifiedAt: null,
    });
  });

  /**
   * Task 24 round 3 (m-R2-1 ทางเลือก ข) — ห้องของ LINE ที่ลูกค้ายกเลิกแล้วยังถือ customerId เดิม (ข้อ 6 ไม่ปลด) ⇒ ใน inbox ห้องนั้นยังเป็นของลูกค้า.
   * พนักงานกดข้อความสำเร็จรูปในห้อง LINE การเงิน: ตัวแปรลูกค้าเติมค่าจริงเฉพาะห้องที่ OTP ตรงลูกค้าของห้อง (`otpVerifiedRoomCustomerId` — กติกาเดียวกับ I-C)
   * ไม่งั้นคำกลาง — ยอดหนี้ของ B ต้องไม่ไปถึงผู้ถือ L1
   */
  it('7. B ยกเลิก L1 แล้วยืนยัน L2 · พนักงานกดข้อความสำเร็จรูปที่มียอดหนี้: ห้อง L1 = คำกลาง · ห้อง L2 = ค่าจริงของ B', async () => {
    const b = await customer('สำเร็จรูป', '8');
    const l1Room = await room(line('7a'), null, null);
    await verifyWithOtp(line('7a'), b.phone!);
    await liff.unlinkLineAccount(line('7a'));
    const l2Room = await room(line('7b'), null, null);
    await verifyWithOtp(line('7b'), b.phone!);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: l1Room } })).customerId).toBe(
      b.id,
    );

    const template = await prisma.cannedResponse.create({
      data: {
        shortcut: `/${tag}-debt`,
        title: 'ยอดค้าง',
        content: 'ยอดค้าง',
        bubbles: {
          create: [
            { type: 'TEXT', text: 'คุณ{customerName} ยอดค้าง {amountDue} สัญญา {contractNumber}' },
          ],
        },
      },
    });
    const sentTexts: string[] = [];
    const expandVariables = jest.fn(async (probe: string, ctx: { customerId?: string }) =>
      probe.replace(/\{(\w+)\}/g, (_m, key: string) => (ctx.customerId ? `REAL-${key}` : '-')),
    );
    const sender = new CannedResponseSenderService(
      prisma as never,
      {
        filterByChannel: (bubbles: unknown[]) => bubbles,
        translateQuickReplies: () => [],
        toOutboundMessage: (bubble: { text: string }) => ({ text: bubble.text }),
      } as never,
      { expandVariables } as never,
      {
        sendStaffOutbound: jest.fn(async (_roomId: string, msg: { text: string }) => {
          sentTexts.push(msg.text);
          return { success: true };
        }),
      } as never,
    );

    await sender.send(l1Room, template.id, 'staff-1');
    await sender.send(l2Room, template.id, 'staff-1');

    expect(sentTexts[0]).toBe('คุณลูกค้า ยอดค้าง - สัญญา -');
    expect(sentTexts[1]).toBe(
      'คุณREAL-customerName ยอดค้าง REAL-amountDue สัญญา REAL-contractNumber',
    );
    await prisma.cannedResponseBubble.deleteMany({ where: { cannedResponseId: template.id } });
    await prisma.cannedResponse.delete({ where: { id: template.id } });
  });
});
