/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/room-manager.customer-send.db.spec.ts --runInBand
 *
 * Task 24 fix round 1 I-1 — แท็บ "แชท LINE" ในแผง 360 (`POST /staff-chat/customer/:customerId/messages` → `sendCustomerMessage`) เคยเลือก
 * "ห้อง LINE ล่าสุดที่ customerId = ลูกค้าคนนี้" ⇒ หลังลูกค้า B ยกเลิก L1 แล้วยืนยัน L2 ห้องของ L1 ยังเป็นของ B (M-8 คง customerId ไว้) ·
 * ผู้ถือ L1 ทักมาทีหลัง = ห้องล่าสุด ⇒ พนักงานพิมพ์ยอดหนี้ของ B แล้วข้อความไปถึงผู้ถือ L1. ตอนนี้ปลายทาง = ห้อง LINE การเงินของแถว OTP ที่ยังผูกเท่านั้น
 * (`findFinanceLineRecipient` — เกณฑ์เดียวกับผู้ส่งข้อความการเงินทุกตัว) · ไม่มีแถว = 400 · ห้อง LINE ร้าน = 400 (ฝั่งร้านยังไม่มี OTP)
 */
import { BadRequestException } from '@nestjs/common';
import { ChatChannel, PrismaClient } from '@prisma/client';
import { VerificationService } from '../../chatbot-finance/services/verification.service';
import { LiffApiService } from '../../line-oa/liff-api.service';
import {
  LINE_FINANCE_NOT_VERIFIED_MESSAGE,
  LINE_SHOP_STAFF_SEND_DISABLED_MESSAGE,
} from '../../line-oa/services/finance-line-link';
import { RoomManagerService } from './room-manager.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t24i1-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const customerIds: string[] = [];
const line = (name: string) => `U${tag}-${name}`;
const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
const router = { sendStaffMessage: jest.fn().mockResolvedValue({ success: true }) };
let verification: VerificationService;
let liff: LiffApiService;
let rooms: RoomManagerService;

async function customer(name: string, phoneSuffix: string) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `09${phoneSuffix}${digits}` },
  });
  customerIds.push(row.id);
  return row;
}

async function room(
  channel: ChatChannel,
  lineUserId: string,
  customerId: string | null,
  lastMessageAt?: Date,
) {
  return (
    await prisma.chatRoom.create({ data: { channel, lineUserId, customerId, lastMessageAt } })
  ).id;
}

async function verifyWithOtp(lineUserId: string, phone: string) {
  await verification.requestOtp({ lineUserId, phone });
  const otp = (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
  return verification.verifyOtp({ lineUserId, otp });
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
    { get: jest.fn(() => ({ switchRichMenu: jest.fn() })) } as never,
  );
  liff = new LiffApiService(prisma as never);
  rooms = new RoomManagerService(prisma as never, {} as never, undefined, router as never);
});

beforeEach(() => router.sendStaffMessage.mockClear());

afterAll(async () => {
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { startsWith: `U${tag}` } } });
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.chatbotOtpRequest.deleteMany({ where: { lineUserId: { contains: tag } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.$disconnect();
});

describe('แผง 360 ส่ง LINE ถึงห้องของแถว OTP ที่ยังผูกเท่านั้น (Task 24 fix round 1 I-1)', () => {
  it('B ยกเลิก L1 แล้วยืนยัน L2 · ผู้ถือ L1 ทักมาล่าสุด → ข้อความไปห้อง L2 ไม่ใช่ L1 · ประวัติแชทแสดงห้อง L2', async () => {
    const b = await customer('B', '1');
    const l1Room = await room(ChatChannel.LINE_FINANCE, line('L1'), null);
    await verifyWithOtp(line('L1'), b.phone!);
    await expect(liff.unlinkLineAccount(line('L1'))).resolves.toEqual({ success: true });
    const l2Room = await room(ChatChannel.LINE_FINANCE, line('L2'), null);
    await expect(verifyWithOtp(line('L2'), b.phone!)).resolves.toMatchObject({ customerId: b.id });
    // ผู้ถือ L1 ทักมาทีหลัง — ห้อง L1 ยังเป็นของ B (customerId) และใหม่กว่า
    await prisma.chatRoom.update({
      where: { id: l1Room },
      data: { lastMessageAt: new Date(Date.now() + 3_600_000) },
    });
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: l1Room } })).customerId).toBe(
      b.id,
    );

    const sent = await rooms.sendCustomerMessage(b.id, 'staff-1', 'ยอดค้างชำระ');

    expect(sent.room).toEqual({ id: l2Room });
    expect(router.sendStaffMessage).toHaveBeenCalledTimes(1);
    expect(router.sendStaffMessage).toHaveBeenCalledWith({
      roomId: l2Room,
      staffId: 'staff-1',
      text: 'ยอดค้างชำระ',
    });
    expect((await rooms.getCustomerMessages(b.id, 10)).roomId).toBe(l2Room);
  });

  it('ไม่มีแถว OTP ที่ยังผูก (มีแต่ห้องการเงินที่ผูกลูกค้าไว้) → 400 ข้อความยังไม่ยืนยัน OTP ไม่ส่ง', async () => {
    const d = await customer('D', '2');
    await room(ChatChannel.LINE_FINANCE, line('D'), d.id, new Date());

    const err = await rooms.sendCustomerMessage(d.id, 'staff-1', 'x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(LINE_FINANCE_NOT_VERIFIED_MESSAGE);
    expect(router.sendStaffMessage).not.toHaveBeenCalled();
  });

  it('มีแต่ห้อง LINE ร้าน → 400 (ฝั่งร้านยังไม่มี OTP) ไม่ส่งทาง LINE ร้าน', async () => {
    const e = await customer('E', '3');
    await room(ChatChannel.LINE_SHOP, line('E-shop'), e.id, new Date());

    const err = await rooms.sendCustomerMessage(e.id, 'staff-1', 'x').catch((x: unknown) => x);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(LINE_SHOP_STAFF_SEND_DISABLED_MESSAGE);
    expect(router.sendStaffMessage).not.toHaveBeenCalled();
  });

  it('ยืนยัน OTP แล้วแต่ยังไม่เคยทักแชท (ไม่มีห้องของ LINE นั้น) → room null ไม่ส่ง (ไม่ถอยไปห้องอื่นของลูกค้า)', async () => {
    const c = await customer('C', '4');
    await room(ChatChannel.LINE_FINANCE, line('C-old'), c.id, new Date());
    await verifyWithOtp(line('C'), c.phone!);

    await expect(rooms.sendCustomerMessage(c.id, 'staff-1', 'x')).resolves.toEqual({ room: null });
    expect(router.sendStaffMessage).not.toHaveBeenCalled();
    // fix round 2 m-1 — ประวัติต้องไม่ถอยไปห้องของ LINE อื่น (ช่องพิมพ์จะชี้ห้องเก่า) — มุมมองของแถว OTP: ยังไม่มีแชท
    await expect(rooms.getCustomerMessages(c.id, 10)).resolves.toEqual({
      roomId: null,
      channel: null,
      messages: [],
      hasMore: false,
    });
  });
});
