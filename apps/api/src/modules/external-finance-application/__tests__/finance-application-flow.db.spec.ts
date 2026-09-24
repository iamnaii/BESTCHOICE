/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand
 * สร้างห้อง/ผู้ใช้/ลูกค้า/สินค้าของตัวเองแล้วลบทิ้งใน afterAll (ลูกก่อนแม่)
 */
import { PrismaClient, ChatChannel } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { FinanceApplicationService } from '../services/finance-application.service';
import { FinanceApplicationNumberService } from '../services/finance-application-number.service';
import { FinanceApplicationFilesService } from '../services/finance-application-files.service';
import { StorageService } from '../../storage/storage.service';

const prisma = new PrismaClient();
const tag = `gfin-flow-${Date.now()}`;
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
let roomId = '';
let userId = '';
let service: FinanceApplicationService;
let localDir = '';
let storage: StorageService;
let files: FinanceApplicationFilesService;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const user = await prisma.user.findFirst({ where: { role: 'OWNER', deletedAt: null }, select: { id: true } });
  if (!user) throw new Error('ต้องมีผู้ใช้ OWNER ในฐานทดสอบ (seed ก่อน)');
  userId = user.id;
  const room = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: tag, displayName: tag } });
  roomId = room.id;
  service = new FinanceApplicationService(prisma as any, new FinanceApplicationNumberService());
  localDir = await fs.mkdtemp(path.join(tmpdir(), 'gfin-files-'));
  const env: Record<string, string> = { STORAGE_LOCAL_DIR: localDir, NODE_ENV: 'test' };
  storage = new StorageService({ get: (key: string) => env[key] } as any);
  files = new FinanceApplicationFilesService(prisma as any, storage, service, {} as any, {} as any);
});

afterAll(async () => {
  await prisma.externalFinanceApplicationEvent.deleteMany({ where: { application: { roomId } } });
  await prisma.externalFinanceApplicationFile.deleteMany({ where: { application: { roomId } } });
  await prisma.externalFinanceApplication.deleteMany({ where: { roomId } });
  await prisma.chatMessage.deleteMany({ where: { roomId } });
  await prisma.chatRoom.delete({ where: { id: roomId } });
  await prisma.$disconnect();
  await fs.rm(localDir, { recursive: true, force: true });
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

  it('does not create two open applications when two requests race for the same room (fix round 1)', async () => {
    const actor = { id: userId, role: 'OWNER' };
    const raceTag = `gfin-race-${Date.now()}`;
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: raceTag, displayName: raceTag },
    });
    try {
      const [a, b] = await Promise.all([
        service.createDraft(room.id, actor),
        service.createDraft(room.id, actor),
      ]);
      expect(a.id).toBe(b.id);
      const count = await prisma.externalFinanceApplication.count({
        where: { roomId: room.id, deletedAt: null },
      });
      expect(count).toBe(1);
    } finally {
      await prisma.externalFinanceApplicationEvent.deleteMany({ where: { application: { roomId: room.id } } });
      await prisma.externalFinanceApplication.deleteMany({ where: { roomId: room.id } });
      await prisma.chatRoom.delete({ where: { id: room.id } });
    }
  });

  it('attaches a staff-chat image from the room into INCOME once (duplicate pick returns the same row)', async () => {
    const message = await prisma.chatMessage.create({ data: { roomId, role: 'STAFF', type: 'IMAGE', text: null, mediaUrl: `staff-chat/${roomId}/x.jpg`, mediaType: 'image/jpeg' } });
    await fs.mkdir(path.dirname(path.join(localDir, `staff-chat/${roomId}/x.jpg`)), { recursive: true });
    await fs.writeFile(path.join(localDir, `staff-chat/${roomId}/x.jpg`), JPEG_BYTES); // เขียนไฟล์ลงที่เก็บ local ที่ StorageService ชี้ไว้
    const actor = { id: userId, role: 'OWNER' };
    const app = await service.createDraft(roomId, actor);
    const a = await files.fromMessage(app.id, { messageId: message.id, slot: 'INCOME' }, actor);
    const b = await files.fromMessage(app.id, { messageId: message.id, slot: 'INCOME' }, actor);
    expect(b.id).toBe(a.id);
    const rows = await prisma.externalFinanceApplicationFile.findMany({ where: { applicationId: app.id, deletedAt: null } });
    expect(rows).toHaveLength(1);
  });
});
