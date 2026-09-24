/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> PII_ENCRYPTION_KEY=<hex64> PII_HASH_SALT=<salt ≥32 ตัว>
 *   npx jest src/modules/external-finance-application/__tests__/finance-application-flow.db.spec.ts --runInBand
 * (PII_HASH_SALT ต้อง ≥32 ตัว — pii.encryptCustomerFields() ปฏิเสธ salt สั้นกว่านั้น)
 * สร้างห้อง/ผู้ใช้/ลูกค้า/สินค้าของตัวเองแล้วลบทิ้งใน afterAll (ลูกก่อนแม่)
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient, ChatChannel } from '@prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { FinanceApplicationService } from '../services/finance-application.service';
import { FinanceApplicationNumberService } from '../services/finance-application-number.service';
import { FinanceApplicationFilesService } from '../services/finance-application-files.service';
import { FinanceShareService } from '../services/finance-share.service';
import { FinanceApplicationNotifyService } from '../services/finance-application-notify.service';
import { StorageService } from '../../storage/storage.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';

const prisma = new PrismaClient();
const tag = `gfin-flow-${Date.now()}`;
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
let roomId = '';
let userId = '';
let service: FinanceApplicationService;
let pii: CustomerPiiService;
let localDir = '';
let storage: StorageService;
let files: FinanceApplicationFilesService;
const config = { get: (key: string) => process.env[key] } as any;

// Task 6 (share link / staff result / cancel) ต่อเทสต์บนใบเดียวกันนี้ — hoisted แทน const ในตัว it
let sendRoomId = '';
let sendCustomerId = '';
let sendProductId = '';
let sendAppId = '';
let sent: Awaited<ReturnType<FinanceApplicationService['send']>>;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) throw new Error(`สเปคนี้ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  const user = await prisma.user.findFirst({ where: { role: 'OWNER', deletedAt: null }, select: { id: true } });
  if (!user) throw new Error('ต้องมีผู้ใช้ OWNER ในฐานทดสอบ (seed ก่อน)');
  userId = user.id;
  const room = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: tag, displayName: tag } });
  roomId = room.id;
  pii = new CustomerPiiService(prisma as any);
  service = new FinanceApplicationService(prisma as any, new FinanceApplicationNumberService(), pii, config);
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
  if (sendAppId) {
    await prisma.externalFinanceApplicationEvent.deleteMany({ where: { applicationId: sendAppId } });
    await prisma.externalFinanceApplicationFile.deleteMany({ where: { applicationId: sendAppId } });
    await prisma.externalFinanceApplication.delete({ where: { id: sendAppId } });
  }
  if (sendRoomId) await prisma.chatRoom.delete({ where: { id: sendRoomId } });
  if (sendProductId) await prisma.product.delete({ where: { id: sendProductId } });
  if (sendCustomerId) await prisma.customer.delete({ where: { id: sendCustomerId } });
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

  it('does not create two rows when two fromMessage calls race on the same chat message (review fix round 1)', async () => {
    const actor = { id: userId, role: 'OWNER' };
    const raceTag = `gfin-files-race-${Date.now()}`;
    const room = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: raceTag, displayName: raceTag },
    });
    try {
      const message = await prisma.chatMessage.create({
        data: { roomId: room.id, role: 'STAFF', type: 'IMAGE', text: null, mediaUrl: `staff-chat/${room.id}/race.jpg`, mediaType: 'image/jpeg' },
      });
      await fs.mkdir(path.dirname(path.join(localDir, `staff-chat/${room.id}/race.jpg`)), { recursive: true });
      await fs.writeFile(path.join(localDir, `staff-chat/${room.id}/race.jpg`), JPEG_BYTES);
      const app = await service.createDraft(room.id, actor);
      const [a, b] = await Promise.all([
        files.fromMessage(app.id, { messageId: message.id, slot: 'INCOME' }, actor),
        files.fromMessage(app.id, { messageId: message.id, slot: 'INCOME' }, actor),
      ]);
      expect(a.id).toBe(b.id);
      const rows = await prisma.externalFinanceApplicationFile.findMany({
        where: { applicationId: app.id, sourceMessageId: message.id, deletedAt: null },
      });
      expect(rows).toHaveLength(1);
      // ไม่มีไฟล์กำพร้าในที่เก็บ local — เหลือแค่ไฟล์ของแถวที่รอด (อีกอัปโหลดถูกลบใน finally ของ attach())
      const appDir = path.join(localDir, 'external-finance', app.id);
      const filesOnDisk = await fs.readdir(appDir).catch(() => [] as string[]);
      expect(filesOnDisk).toHaveLength(1);
      expect(path.join('external-finance', app.id, filesOnDisk[0])).toBe(rows[0].storageKey);
    } finally {
      await prisma.externalFinanceApplicationFile.deleteMany({ where: { application: { roomId: room.id } } });
      await prisma.externalFinanceApplicationEvent.deleteMany({ where: { application: { roomId: room.id } } });
      await prisma.externalFinanceApplication.deleteMany({ where: { roomId: room.id } });
      await prisma.chatMessage.deleteMany({ where: { roomId: room.id } });
      await prisma.chatRoom.delete({ where: { id: room.id } });
    }
  });

  it('send(COPY) persists a hash + encrypted token, and getShareLink returns the same url', async () => {
    const actor = { id: userId, role: 'OWNER' };
    const branch = await prisma.branch.findFirst({ where: { deletedAt: null }, select: { id: true } });
    if (!branch) throw new Error('ต้องมีสาขาในฐานทดสอบ (seed ก่อน)');
    // เขียนเบอร์ผ่าน encryptCustomerFields ให้เหมือน CustomerWriteService.create จริง (dual-write
    // plaintext + phoneEncrypted/phoneHash) — พิสูจน์ว่า buildValues() ถอดรหัส phoneEncrypted จริง
    // ไม่ใช่แค่อ่าน legacy plaintext column เฉยๆ (fix round 1 Important 1)
    const rawPhone = '0937581095';
    const { phoneEncrypted, phoneHash } = pii.encryptCustomerFields({ phone: rawPhone });
    const customer = await prisma.customer.create({
      data: {
        name: `ทดสอบระบบ ${tag}`, phone: rawPhone, occupation: 'พนักงานบริษัท', birthDate: new Date('1997-12-27'),
        phoneEncrypted, phoneHash,
      },
    });
    sendCustomerId = customer.id;
    const product = await prisma.product.create({
      data: {
        name: 'iPhone 13 Pro Max', brand: 'Apple', model: '13 Pro Max', storage: '256GB', category: 'PHONE_USED',
        imeiSerial: `${tag}-imei`, costPrice: 10000, branchId: branch.id, status: 'IN_STOCK',
      },
    });
    sendProductId = product.id;
    const room = await prisma.chatRoom.create({ data: { channel: ChatChannel.FACEBOOK, externalUserId: `${tag}-send`, displayName: `${tag}-send` } });
    sendRoomId = room.id;
    const app = await service.createDraft(room.id, actor);
    sendAppId = app.id;
    await service.update(app.id, { customerId: customer.id, productId: product.id }, actor);
    for (const slot of ['ID_SELFIE', 'ID_CARD', 'INCOME'] as const) {
      await files.upload(app.id, slot, { buffer: JPEG_BYTES, mimetype: 'image/jpeg', originalname: 'a.jpg' } as any, actor);
    }
    sent = await service.send(app.id, { via: 'COPY' }, actor);
    const link = await service.getShareLink(app.id, actor);
    expect(link.url).toBe(sent.shareUrl);
    const row = await prisma.externalFinanceApplication.findUnique({ where: { id: app.id } });
    expect(row?.shareTokenHash).toHaveLength(64);
    expect(row?.shareTokenEnc).not.toContain(sent.shareUrl.split('/').pop());
    expect(row?.status).toBe('SENT');
    // ยืนยันว่าเบอร์ที่ถูก encryptCustomerFields ไว้ถูกถอดรหัสจริงตอน buildValues() —
    // ไม่ใช่แค่อ่าน legacy plaintext column (fix round 1 Important 1)
    expect(sent.messageText).toContain('093 758 1095');
  });

  it('resolves the live link, counts one view per ipHash, and a partner APPROVED reply closes the application', async () => {
    const share = new FinanceShareService(prisma as any, storage, new FinanceApplicationNotifyService());
    const token = sent.shareUrl.split('/').pop()!;
    const r = await share.resolve(token);
    expect(r.state).toBe('OK');
    await share.recordView(sendAppId, 'ip-a', 'jest');
    await share.recordView(sendAppId, 'ip-a', 'jest');
    const row1 = await prisma.externalFinanceApplication.findUnique({ where: { id: sendAppId } });
    expect(row1?.shareViewCount).toBe(1);
    const reply = await share.reply(token, { action: 'APPROVED', name: 'คุณเอ', note: 'ผ่านครับ' }, 'ip-a');
    expect(reply.status).toBe('APPROVED');
    const row2 = await prisma.externalFinanceApplication.findUnique({ where: { id: sendAppId }, include: { events: true } });
    expect(row2?.resultSource).toBe('PARTNER_LINK');
    expect(row2?.closedAt).not.toBeNull();
    expect(row2?.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['SENT', 'LINK_VIEWED', 'PARTNER_APPROVED']));
    await expect(share.reply(token, { action: 'REJECTED', name: 'คุณเอ' }, 'ip-a')).rejects.toThrow(ConflictException);
  });

  it('an expired link is GONE and records no view', async () => {
    await prisma.externalFinanceApplication.update({ where: { id: sendAppId }, data: { shareExpiresAt: new Date(Date.now() - 1000) } });
    const share = new FinanceShareService(prisma as any, storage, new FinanceApplicationNotifyService());
    const token = sent.shareUrl.split('/').pop()!;
    expect(await share.resolve(token)).toEqual({ state: 'GONE', reason: 'EXPIRED' });
    await expect(share.fileStream(token, 'any')).rejects.toThrow(NotFoundException);
  });
});
