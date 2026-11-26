/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/response-cycle.echo.db.spec.ts --runInBand
 *
 * สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md — echo ของคนจาก Meta ปิดรอบ (HUMAN_REPLY, ไม่ทราบผู้ตอบ,
 * เวลาตอบ = เวลาบันทึก echo) · ข้อความลูกค้าหลังเส้นแบ่งเปิดรอบใหม่ · ไม่ใช่คน / ไม่มีรอบ / รอบเริ่มหลัง echo /
 * ไม่มีข้อความลูกค้าที่มีเลขลำดับ = ไม่ปิด
 */
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import { ResponseCycleService } from './response-cycle.service';

const prisma = new PrismaClient();
const service = new ResponseCycleService(prisma as never);
const tag = `echo-${Date.now().toString(36)}`;
const T0 = new Date(Date.now() - 3_600_000);
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
let seq = 0;

async function room(): Promise<string> {
  const r = await prisma.chatRoom.create({
    data: { channel: ChatChannel.FACEBOOK, externalUserId: `${tag}-${++seq}` },
  });
  return r.id;
}

/** ข้อความลูกค้า + เปิดรอบแบบเดียวกับ saveMessage ทาง tracking */
async function customer(roomId: string, createdAt: Date): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const m = await tx.chatMessage.create({
      data: { roomId, role: MessageRole.CUSTOMER, text: 'สนใจครับ', createdAt },
    });
    await service.openInTx(tx, { roomId, messageId: m.id, receivedAt: createdAt });
    return m.id;
  });
}

async function outbound(roomId: string, createdAt: Date, role: MessageRole = MessageRole.STAFF) {
  const m = await prisma.chatMessage.create({
    data: { roomId, role, text: 'ตอบจาก Meta', createdAt },
  });
  return m.id;
}

const openCycles = (roomId: string) =>
  prisma.chatResponseCycle.findMany({ where: { roomId, endedAt: null } });

beforeAll(() => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
});

afterAll(async () => {
  const rooms = await prisma.chatRoom.findMany({
    where: { externalUserId: { startsWith: tag } },
    select: { id: true },
  });
  const ids = rooms.map((r) => r.id);
  await prisma.chatMessage.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatResponseCycle.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatRoom.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('ResponseCycleService.confirmUnknownEcho — echo ของคนปิดรอบ', () => {
  it('คนตอบ → HUMAN_REPLY · ไม่ทราบผู้ตอบ · เวลาตอบ = เวลา echo · waitingSince ว่าง · echo ถือเส้นแบ่ง', async () => {
    const r = await room();
    const c1 = await customer(r, at(0));
    const [cycle] = await openCycles(r);
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    const closed = await prisma.chatResponseCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    expect(closed.endReason).toBe('HUMAN_REPLY');
    expect(closed.origin).toBe('LIVE');
    expect(closed.endedAt).toEqual(at(30));
    expect(closed.firstHumanSentAt).toEqual(at(30));
    expect(closed.firstHumanStaffId).toBeNull();
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: r } })).waitingSince).toBeNull();
    const echo = await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } });
    const cust = await prisma.chatMessage.findUniqueOrThrow({ where: { id: c1 } });
    expect(echo.cycleId).toBe(cycle.id);
    expect(echo.answeredThroughMessageId).toBe(c1);
    expect(echo.answeredThroughSequence).toBe(cust.inboundSequence);
    expect(echo.outboundSentAt).not.toBeNull();
    expect(await openCycles(r)).toHaveLength(0);
  });

  it('ลูกค้าทักต่อหลังเวลา echo → ปิดรอบเดิมแล้วเปิดรอบใหม่จากข้อความนั้น ห้องยังรอตอบ', async () => {
    const r = await room();
    await customer(r, at(0));
    const c2 = await customer(r, at(40));
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    const open = await openCycles(r);
    expect(open).toHaveLength(1);
    expect(open[0].startedAt).toEqual(at(40));
    expect(open[0].firstCustomerMessageId).toBe(c2);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: r } })).waitingSince).toEqual(
      at(40),
    );
    const ended = await prisma.chatResponseCycle.findMany({
      where: { roomId: r, endedAt: { not: null } },
    });
    expect(ended).toHaveLength(1);
    expect(ended[0].endReason).toBe('HUMAN_REPLY');
  });

  it('closeAsHuman = false (เพจตอบเอง) → ประทับส่งถึงอย่างเดียว รอบยังเปิด', async () => {
    const r = await room();
    await customer(r, at(0));
    const e1 = await outbound(r, at(2));

    await service.confirmUnknownEcho(e1, { closeAsHuman: false });

    expect(await openCycles(r)).toHaveLength(1);
    expect((await prisma.chatRoom.findUniqueOrThrow({ where: { id: r } })).waitingSince).toEqual(
      at(0),
    );
    const echo = await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } });
    expect(echo.outboundSentAt).not.toBeNull();
    expect(echo.cycleId).toBeNull();
  });

  it('ไม่ส่ง opts → พฤติกรรมเดิม ไม่ปิดรอบ', async () => {
    const r = await room();
    await customer(r, at(0));
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1);

    expect(await openCycles(r)).toHaveLength(1);
  });

  it('ไม่มีรอบเปิด → ไม่ทำอะไร ไม่ error', async () => {
    const r = await room();
    const e1 = await outbound(r, at(30));

    await expect(service.confirmUnknownEcho(e1, { closeAsHuman: true })).resolves.toBeUndefined();

    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } })).cycleId).toBeNull();
  });

  it('รอบเริ่มหลังเวลา echo (echo ตอบข้อความเก่า) → ไม่ปิด', async () => {
    const r = await room();
    const e1 = await outbound(r, at(10));
    await customer(r, at(20));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    expect(await openCycles(r)).toHaveLength(1);
  });

  it('ไม่มีข้อความลูกค้าที่มีเลขลำดับก่อน echo → ไม่ปิด', async () => {
    const r = await room();
    await customer(r, at(0));
    await prisma.chatMessage.updateMany({
      where: { roomId: r, role: MessageRole.CUSTOMER },
      data: { inboundSequence: null },
    });
    const e1 = await outbound(r, at(30));

    await service.confirmUnknownEcho(e1, { closeAsHuman: true });

    expect(await openCycles(r)).toHaveLength(1);
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: e1 } })).cycleId).toBeNull();
  });

  it('ข้อความ BOT แม้ส่ง closeAsHuman → ไม่ปิด', async () => {
    const r = await room();
    await customer(r, at(0));
    const b1 = await outbound(r, at(30), MessageRole.BOT);

    await service.confirmUnknownEcho(b1, { closeAsHuman: true });

    expect(await openCycles(r)).toHaveLength(1);
  });
});
