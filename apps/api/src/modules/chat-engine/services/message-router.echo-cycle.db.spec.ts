/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chat-engine/services/message-router.echo-cycle.db.spec.ts --runInBand
 *
 * ทางจริงของ echo จาก Meta: MessageRouterService.mirrorOutbound → RoomManagerService.isHumanStaffEcho
 * → confirmExternalEcho → ResponseCycleService (สเปก 2026-11-26-fb-echo-closes-response-cycle-design.md)
 * เวลา echo = now() ของฐาน จึงถอยเวลาข้อความลูกค้า/รอบ/waitingSince แทนการรอจริง
 */
import { ChatChannel, MessageRole, PrismaClient } from '@prisma/client';
import { MessageRouterService } from './message-router.service';
import { ResponseCycleService } from './response-cycle.service';
import { RoomManagerService } from './room-manager.service';

const prisma = new PrismaClient();
const cycles = new ResponseCycleService(prisma as never);
const rooms = new RoomManagerService(
  prisma as never,
  {} as never,
  undefined,
  undefined,
  undefined,
  undefined,
  cycles,
);
const router = new MessageRouterService(
  rooms,
  { initiateHandoff: jest.fn() } as never,
  { get: jest.fn().mockReturnValue(undefined) } as never,
);
const tag = `echoe2e-${Date.now().toString(36)}`;
const FLAG = 'chat_work_queue_enabled';
let originalFlag: { value: string; deletedAt: Date | null } | null = null;
let seq = 0;

async function setFlag(on: boolean) {
  await prisma.systemConfig.upsert({
    where: { key: FLAG },
    create: { key: FLAG, value: on ? 'true' : 'false' },
    update: { value: on ? 'true' : 'false', deletedAt: null },
  });
}

/** ห้อง FB + ลูกค้าทัก (ทาง saveMessage จริง) แล้วถอยเวลาลูกค้า/รอบ/waitingSince ไป `agoSec` วินาที */
async function roomWithCustomer(agoSec: number, opts: { priorBot?: boolean } = {}) {
  const psid = `${tag}-${++seq}`;
  const r = await rooms.getOrCreateRoom({ externalUserId: psid, channel: ChatChannel.FACEBOOK });
  const ago = new Date(Date.now() - agoSec * 1000);
  if (opts.priorBot) {
    await rooms.saveMessage({ roomId: r.id, role: MessageRole.BOT, text: 'สวัสดีค่ะ' });
    await prisma.chatMessage.updateMany({
      where: { roomId: r.id, role: MessageRole.BOT },
      data: { createdAt: new Date(ago.getTime() - 60_000) },
    });
  }
  const c = await rooms.saveMessage({ roomId: r.id, role: MessageRole.CUSTOMER, text: 'สนใจ' });
  await prisma.chatMessage.update({ where: { id: c.id }, data: { createdAt: ago } });
  await prisma.chatResponseCycle.updateMany({
    where: { roomId: r.id, endedAt: null },
    data: { startedAt: ago },
  });
  await prisma.chatRoom.update({ where: { id: r.id }, data: { waitingSince: ago } });
  return { roomId: r.id, psid };
}

const echo = (psid: string, mid: string) =>
  router.mirrorOutbound({
    externalUserId: psid,
    channel: ChatChannel.FACEBOOK,
    role: MessageRole.STAFF,
    text: 'มีค่ะ สีดำ',
    externalMessageId: `${tag}-${mid}`,
  });

const state = async (roomId: string) => ({
  waitingSince: (await prisma.chatRoom.findUniqueOrThrow({ where: { id: roomId } })).waitingSince,
  open: await prisma.chatResponseCycle.count({ where: { roomId, endedAt: null } }),
  human: await prisma.chatResponseCycle.count({
    where: { roomId, endReason: 'HUMAN_REPLY', firstHumanStaffId: null },
  }),
});

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  originalFlag = await prisma.systemConfig.findUnique({
    where: { key: FLAG },
    select: { value: true, deletedAt: true },
  });
});

afterAll(async () => {
  const ids = (
    await prisma.chatRoom.findMany({
      where: { externalUserId: { startsWith: tag } },
      select: { id: true },
    })
  ).map((r) => r.id);
  await prisma.chatMessage.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatResponseCycle.deleteMany({ where: { roomId: { in: ids } } });
  await prisma.chatRoom.deleteMany({ where: { id: { in: ids } } });
  if (originalFlag)
    await prisma.systemConfig.update({ where: { key: FLAG }, data: originalFlag });
  else await prisma.systemConfig.deleteMany({ where: { key: FLAG } });
  await prisma.$disconnect();
});

describe('mirrorOutbound → รอบรอตอบ (สวิตช์คิวงานแชทเปิด)', () => {
  beforeEach(() => setFlag(true));

  it('คนตอบ 30 วิหลังลูกค้าทัก → รอบปิด HUMAN_REPLY ไม่ทราบผู้ตอบ · ห้องหลุดจากรอตอบ', async () => {
    const { roomId, psid } = await roomWithCustomer(30, { priorBot: true });
    await echo(psid, 'h1');
    expect(await state(roomId)).toEqual({ waitingSince: null, open: 0, human: 1 });
  });

  it('echo ทันทีหลังลูกค้าทัก (เพจตอบเอง) → รอบยังเปิด ห้องยังรอตอบ', async () => {
    const { roomId, psid } = await roomWithCustomer(1, { priorBot: true });
    await echo(psid, 'a1');
    const s = await state(roomId);
    expect(s.open).toBe(1);
    expect(s.human).toBe(0);
    expect(s.waitingSince).not.toBeNull();
  });

  it('ขาออกใบแรกของห้อง 30 วิหลังลูกค้าทัก (ข้อความทักทาย) → รอบยังเปิด', async () => {
    const { roomId, psid } = await roomWithCustomer(30);
    await echo(psid, 'g1');
    expect((await state(roomId)).open).toBe(1);
  });
});

describe('mirrorOutbound → waitingSince (สวิตช์คิวงานแชทปิด — กติกาเดียวกัน)', () => {
  beforeEach(() => setFlag(false));

  it('คนตอบ → ล้าง waitingSince', async () => {
    const { roomId, psid } = await roomWithCustomer(30, { priorBot: true });
    await echo(psid, 'h2');
    expect((await state(roomId)).waitingSince).toBeNull();
  });

  it('เพจตอบเอง → ไม่ล้าง', async () => {
    const { roomId, psid } = await roomWithCustomer(1, { priorBot: true });
    await echo(psid, 'a2');
    expect((await state(roomId)).waitingSince).not.toBeNull();
  });
});
