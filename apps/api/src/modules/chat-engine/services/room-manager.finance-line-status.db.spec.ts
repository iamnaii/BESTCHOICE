/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/room-manager.finance-line-status.db.spec.ts --runInBand
 *
 * Task 33 (mockup A2/A3 "อินบ็อกซ์ — สถานะ LINE การเงิน") — ห้อง `LINE_FINANCE` ในรายชื่อแชท (`GET /staff-chat/rooms`) และหัวห้อง
 * (`GET /staff-chat/rooms/:id`) ได้ `financeLineStatus` ที่**คำนวณฝั่ง server** และ**ไม่มี LINE user id**:
 * - `verified` = เกณฑ์เดียวกับข้อความสำเร็จรูปของห้องการเงิน (Task 24 round 3 — แถว OTP ที่ยังผูกของ LINE ห้องนี้เป็นของลูกค้าของห้อง)
 * - ไม่ verified + รู้วันที่ยกเลิก (`unlinkedAt`) = ป้าย "ยกเลิกผูกแล้ว" — ครอบทั้งยกเลิกเฉย ๆ และ **ลูกค้าเปลี่ยน LINE** (แถว link ของลูกค้าถูกชี้ไป
 *   LINE ใหม่ — ประวัติของ LINE เก่าในแถว link หายไป ⇒ ห้องจำเวลาที่หลุดจากการยืนยันเอง `chat_rooms.finance_line_unlinked_at`)
 * - ไม่เคยผูก LINE นี้กับลูกค้านี้ (พนักงานผูกห้องเอง) = `{ verified: false, unlinkedAt: null }` (ไม่อยู่ใน mockup — หน้าเว็บไม่แสดงอะไร)
 * - ห้องช่องอื่น / ห้องไม่มีลูกค้า = null
 */
import { ChatChannel, LineChannelType, PrismaClient } from '@prisma/client';
import { VerificationService } from '../../chatbot-finance/services/verification.service';
import { LiffApiService } from '../../line-oa/liff-api.service';
import { RoomManagerService } from './room-manager.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t33r-${Date.now()}`;
const digits = String(Date.now()).slice(-7);
const customerIds: string[] = [];
const line = (name: string) => `U${tag}-${name}`;
const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
const GRANTED_CONSENT = { granted: true } as const;
let verification: VerificationService;
let liff: LiffApiService;
let rooms: RoomManagerService;

async function customer(name: string, phoneSuffix: string) {
  const row = await prisma.customer.create({
    data: { name: `ทดสอบ ${name} ${tag}`, phone: `08${phoneSuffix}${digits}` },
  });
  customerIds.push(row.id);
  return row;
}

async function room(channel: ChatChannel, lineUserId: string | null, customerId: string | null) {
  return (await prisma.chatRoom.create({ data: { channel, lineUserId, customerId } })).id;
}

async function verifyWithOtp(lineUserId: string, phone: string) {
  sms.sendSmsFromQueue.mockClear();
  await verification.requestOtp({ lineUserId, phone });
  const otp = (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
  return verification.verifyOtp({ lineUserId, otp, consent: GRANTED_CONSENT });
}

/** แถวของห้องตามที่ GET /staff-chat/rooms คืน (กรองลูกค้าของเทสนี้) */
async function listed(customerId: string) {
  const { data } = await rooms.listRooms({ customerId, limit: 100 });
  return data as unknown as Array<Record<string, unknown> & { id: string }>;
}

async function statusOf(customerId: string, roomId: string) {
  const row = (await listed(customerId)).find((r) => r.id === roomId);
  if (!row) throw new Error('ไม่พบห้องในรายการ');
  return row.financeLineStatus;
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
  );
  verification._setResponseFloorForTests(0);
  liff = new LiffApiService(prisma as never);
  rooms = new RoomManagerService(prisma as never, {} as never);
});

afterAll(async () => {
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { startsWith: `U${tag}` } } });
  await prisma.chatRoom.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.customerLineLink.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.pDPAConsent.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.chatbotOtpRequest.deleteMany({
    where: { OR: [{ lineUserId: { contains: tag } }, { customerId: { in: customerIds } }] },
  });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.$disconnect();
});

describe('Task 33 — financeLineStatus ของห้องในอินบ็อกซ์ (Postgres จริง)', () => {
  it('1. ห้องของ LINE ที่ยืนยัน OTP กับลูกค้าของห้อง → verified (A3) · ไม่มี U-id ในสถานะ', async () => {
    const a = await customer('A', '1');
    const roomId = await room(ChatChannel.LINE_FINANCE, line('a1'), a.id);
    await verifyWithOtp(line('a1'), a.phone!);

    const row = (await listed(a.id)).find((r) => r.id === roomId)!;
    expect(row.financeLineStatus).toEqual({ verified: true, unlinkedAt: null });
    expect(JSON.stringify(row.financeLineStatus)).not.toContain('U');
    // คอลัมน์ภายในของการคำนวณไม่ออกไปถึงหน้าเว็บ
    expect(row).not.toHaveProperty('financeLineUnlinkedAt');
  });

  it('2. ลูกค้ายกเลิกผูกเองใน LIFF → ห้องของ LINE นั้น "ยกเลิกผูกแล้ว" + วันที่ยกเลิก (A2)', async () => {
    const b = await customer('B', '2');
    const roomId = await room(ChatChannel.LINE_FINANCE, line('b1'), b.id);
    await verifyWithOtp(line('b1'), b.phone!);
    await liff.unlinkLineAccount(line('b1'));
    const link = await prisma.customerLineLink.findUniqueOrThrow({
      where: { lineUserId_channel: { lineUserId: line('b1'), channel: LineChannelType.FINANCE } },
    });

    expect(await statusOf(b.id, roomId)).toEqual({
      verified: false,
      unlinkedAt: link.unlinkedAt!.toISOString(),
    });
  });

  it('3. ลูกค้าเปลี่ยน LINE (ยกเลิก L1 แล้วยืนยัน L2 — แถว link ถูกชี้ไป L2) → ห้อง L1 ยัง "ยกเลิกผูกแล้ว" + วันที่ยกเลิก L1 · ห้อง L2 verified', async () => {
    const c = await customer('C', '3');
    const oldRoom = await room(ChatChannel.LINE_FINANCE, line('c1'), c.id);
    await verifyWithOtp(line('c1'), c.phone!);
    await liff.unlinkLineAccount(line('c1'));
    const unlinkedAt = (
      await prisma.customerLineLink.findFirstOrThrow({ where: { customerId: c.id } })
    ).unlinkedAt!;
    const newRoom = await room(ChatChannel.LINE_FINANCE, line('c2'), null);
    await verifyWithOtp(line('c2'), c.phone!);
    // แถว link ของลูกค้าถูกชี้ไป L2 แล้ว — ประวัติของ L1 ไม่อยู่ในแถว link อีก
    expect(
      await prisma.customerLineLink.findMany({ where: { lineUserId: line('c1') } }),
    ).toEqual([]);

    expect(await statusOf(c.id, oldRoom)).toEqual({
      verified: false,
      unlinkedAt: unlinkedAt.toISOString(),
    });
    expect(await statusOf(c.id, newRoom)).toEqual({ verified: true, unlinkedAt: null });
  });

  it('4. ยืนยันกลับด้วย LINE เดิม → ห้องกลับเป็น verified (วันที่ยกเลิกเดิมไม่ค้าง)', async () => {
    const d = await customer('D', '4');
    const roomId = await room(ChatChannel.LINE_FINANCE, line('d1'), d.id);
    await verifyWithOtp(line('d1'), d.phone!);
    await liff.unlinkLineAccount(line('d1'));
    await prisma.chatbotOtpRequest.updateMany({
      where: { lineUserId: line('d1') },
      data: { lastRequestAt: new Date(Date.now() - 2 * 60_000) },
    });
    await verifyWithOtp(line('d1'), d.phone!);

    expect(await statusOf(d.id, roomId)).toEqual({ verified: true, unlinkedAt: null });
    const raw = await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } });
    expect(raw.financeLineUnlinkedAt).toBeNull();
  });

  it('5. แถว link ที่ยกเลิกไว้ก่อนมีคอลัมน์ของห้อง (ข้อมูลก่อน deploy) → ใช้วันที่ยกเลิกจากแถว link', async () => {
    const e = await customer('E', '5');
    const unlinkedAt = new Date('2026-10-20T04:00:00.000Z');
    await prisma.customerLineLink.create({
      data: { customerId: e.id, lineUserId: line('e1'), channel: LineChannelType.FINANCE, unlinkedAt },
    });
    const roomId = await room(ChatChannel.LINE_FINANCE, line('e1'), e.id);

    expect(await statusOf(e.id, roomId)).toEqual({
      verified: false,
      unlinkedAt: unlinkedAt.toISOString(),
    });
  });

  it('6. ห้องที่ลูกค้าไม่เคยผูก LINE นี้ (พนักงานผูกห้องเอง) → ไม่ verified · ไม่มีวันที่ยกเลิก (ไม่อยู่ใน mockup)', async () => {
    const f = await customer('F', '6');
    const roomId = await room(ChatChannel.LINE_FINANCE, line('f1'), f.id);

    expect(await statusOf(f.id, roomId)).toEqual({ verified: false, unlinkedAt: null });
  });

  it('7. ห้องช่องอื่น (LINE ร้าน · Facebook) และห้อง LINE การเงินที่ไม่มีลูกค้า → null', async () => {
    const g = await customer('G', '7');
    const shop = await room(ChatChannel.LINE_SHOP, line('g1'), g.id);
    const fb = await room(ChatChannel.FACEBOOK, null, g.id);

    expect(await statusOf(g.id, shop)).toBeNull();
    expect(await statusOf(g.id, fb)).toBeNull();
    const orphan = await room(ChatChannel.LINE_FINANCE, line('g2'), null);
    const [withStatus] = await rooms.attachFinanceLineStatus([
      await prisma.chatRoom.findUniqueOrThrow({ where: { id: orphan } }),
    ]);
    expect(withStatus.financeLineStatus).toBeNull();
  });

  it('8. หัวห้อง (GET /staff-chat/rooms/:id ผ่าน attachFinanceLineStatus) ได้สถานะเดียวกับรายชื่อ', async () => {
    const b = customerIds[1];
    const roomRow = (await listed(b)).find((r) => r.channel === ChatChannel.LINE_FINANCE)!;
    const found = await rooms.findById(roomRow.id);
    const [withStatus] = await rooms.attachFinanceLineStatus([found!]);
    expect(withStatus.financeLineStatus).toEqual(roomRow.financeLineStatus);
    expect(withStatus).not.toHaveProperty('financeLineUnlinkedAt');
  });
});
