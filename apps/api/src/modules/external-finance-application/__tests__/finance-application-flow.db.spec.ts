/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand
 * สร้างห้อง/ผู้ใช้/ลูกค้า/สินค้าของตัวเองแล้วลบทิ้งใน afterAll (ลูกก่อนแม่)
 */
import { PrismaClient, ChatChannel } from '@prisma/client';
import { FinanceApplicationService } from '../services/finance-application.service';
import { FinanceApplicationNumberService } from '../services/finance-application-number.service';

const prisma = new PrismaClient();
const tag = `gfin-flow-${Date.now()}`;
let roomId = '';
let userId = '';
let service: FinanceApplicationService;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const user = await prisma.user.findFirst({ where: { role: 'OWNER', deletedAt: null }, select: { id: true } });
  if (!user) throw new Error('ต้องมีผู้ใช้ OWNER ในฐานทดสอบ (seed ก่อน)');
  userId = user.id;
  const room = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: tag, displayName: tag } });
  roomId = room.id;
  service = new FinanceApplicationService(prisma as any, new FinanceApplicationNumberService());
});

afterAll(async () => {
  await prisma.externalFinanceApplicationEvent.deleteMany({ where: { application: { roomId } } });
  await prisma.externalFinanceApplicationFile.deleteMany({ where: { application: { roomId } } });
  await prisma.externalFinanceApplication.deleteMany({ where: { roomId } });
  await prisma.chatMessage.deleteMany({ where: { roomId } });
  await prisma.chatRoom.delete({ where: { id: roomId } });
  await prisma.$disconnect();
});

describe('ใบยื่น GFIN บน DB จริง', () => {
  it('creates one draft per room with a BC-YYMMDD-NNN number and returns it again on the second call', async () => {
    const actor = { id: userId, role: 'OWNER' };
    const first = await service.createDraft(roomId, actor);
    expect(first.number).toMatch(/^BC-\d{6}-\d{3}$/);
    const second = await service.createDraft(roomId, actor);
    expect(second.id).toBe(first.id);
    const listed = await service.listForRoom(roomId, actor);
    expect(listed.current?.id).toBe(first.id);
    expect(listed.history).toHaveLength(0);
  });
});
