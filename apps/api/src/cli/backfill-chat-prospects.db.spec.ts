import { Logger } from '@nestjs/common';
import { PrismaClient, ChatChannel } from '@prisma/client';
import { ChatProspectService } from '../modules/chat-prospects/chat-prospect.service';
import { runBackfill } from './backfill-chat-prospects.cli';

/**
 * พิสูจน์ Ruling R20 บน Postgres จริง (ไม่ใช่ mock — เดิม R7 mock ทุกเทสต์ ไม่มีอะไรเคยเจอ Postgres จริง):
 * Prisma `cursor:{id:lastId},skip:1` มีบั๊ก — ห้อง cursor ที่ ensureForRoom ผูกสำเร็จหลุดจาก
 * BACKFILL_WHERE (customerId:null) ก่อนคำขอถัดไป ⇒ skip:1 (OFFSET หลังกรอง) ไปกินห้องถัดไปแทน
 * ห้อง cursor ที่หายไปแล้ว — ห้องกลางหายอย่างเงียบๆ ที่ batchSize=1. Explicit keyset ไม่มีปัญหานี้
 * เพราะเงื่อนไข (createdAt,id) > last ไม่สนว่าห้อง last ยังอยู่ใน BACKFILL_WHERE หรือไม่.
 * ต้องรันกับ Postgres จริง: DATABASE_URL=<ฐานทดสอบที่ apply migration แล้ว> npx jest <ไฟล์นี้> --runInBand
 */
describe('runBackfill keyset pagination (real DB, Ruling R20)', () => {
  const prisma = new PrismaClient();
  const service = new ChatProspectService(prisma as never);
  const suffix = Date.now();
  const roomIds: string[] = [];
  const extraCustomerIds: string[] = [];

  beforeAll(() => {
    // ChatProspectService.ensureForRoom logs one INFO line per created placeholder (production
    // behavior, not test noise) — silence it here to keep this spec's output pristine, same
    // convention as chat-prospect.service.db.spec.ts.
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    if (roomIds.length) {
      const linked = await prisma.chatRoom.findMany({ where: { id: { in: roomIds } }, select: { customerId: true } });
      for (const r of linked) if (r.customerId) extraCustomerIds.push(r.customerId);
      await prisma.chatRoom.deleteMany({ where: { id: { in: roomIds } } });
      roomIds.length = 0;
    }
    if (extraCustomerIds.length) {
      await prisma.customer.deleteMany({ where: { id: { in: extraCustomerIds } } });
      extraCustomerIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('batchSize=1, 3 ห้องของ 3 คนต่างกัน ทั้งหมด linkable → ทั้งสามห้องได้ customerId และ processed=3 (เดิม R7 ทำห้องกลางหายที่ batchSize นี้พอดี)', async () => {
    const r1 = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `r20-a-${suffix}`, displayName: 'A', createdAt: new Date('2026-05-12T00:00:00.000Z') },
    });
    const r2 = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `r20-b-${suffix}`, displayName: 'B', createdAt: new Date('2026-05-12T00:00:01.000Z') },
    });
    const r3 = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `r20-c-${suffix}`, displayName: 'C', createdAt: new Date('2026-05-12T00:00:02.000Z') },
    });
    roomIds.push(r1.id, r2.id, r3.id);

    const log = jest.fn();
    const result = await runBackfill(prisma, service, { batchSize: 1, log });

    expect(result.processed).toBe(3);
    expect(result.created).toBe(3); // 3 คนต่างกัน (externalUserId ต่างกัน) = สร้างใหม่ทั้งหมด
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);

    const after = await prisma.chatRoom.findMany({
      where: { id: { in: [r1.id, r2.id, r3.id] } },
      select: { id: true, customerId: true },
    });
    expect(after).toHaveLength(3);
    for (const room of after) {
      expect(room.customerId).not.toBeNull(); // ทุกห้องต้องมีเจ้าของ — ถ้า R7 เดิมยังอยู่ ห้อง r2 จะยังเป็น null
    }
  });

  it('ห้องกลางแก้ไม่ได้ (ไม่มี lineUserId/externalUserId — ensureForRoom คืน null) — loop ไม่ค้าง ห้องก่อน/หลังยังเสร็จครบ (Ruling R20)', async () => {
    const r1 = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `r20-d-${suffix}`, displayName: 'D', createdAt: new Date('2026-05-13T00:00:00.000Z') },
    });
    const r2 = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, displayName: 'unresolvable', createdAt: new Date('2026-05-13T00:00:01.000Z') }, // ไม่มี lineUserId/externalUserId
    });
    const r3 = await prisma.chatRoom.create({
      data: { channel: ChatChannel.FACEBOOK, externalUserId: `r20-e-${suffix}`, displayName: 'E', createdAt: new Date('2026-05-13T00:00:02.000Z') },
    });
    roomIds.push(r1.id, r2.id, r3.id);

    const log = jest.fn();
    const result = await runBackfill(prisma, service, { batchSize: 1, log });

    expect(result.processed).toBe(3); // ทุกห้องถูกเข้าถึง — loop ไม่หยุดที่ r2
    expect(result.skipped).toBe(1); // r2: ensureForRoom คืน null (ไม่มี externalKey ให้ผูก)
    expect(result.created).toBe(2); // r1, r3
    expect(result.failed).toBe(0);

    const after = await prisma.chatRoom.findMany({
      where: { id: { in: [r1.id, r2.id, r3.id] } },
      select: { id: true, customerId: true },
    });
    const byId = new Map(after.map((r) => [r.id, r.customerId]));
    expect(byId.get(r1.id)).not.toBeNull();
    expect(byId.get(r2.id)).toBeNull(); // ห้องที่แก้ไม่ได้ ยังไม่มีเจ้าของ — ถูกต้องแล้ว ไม่ใช่บั๊ก
    expect(byId.get(r3.id)).not.toBeNull(); // ห้องหลัง r2 ยังถูกประมวลผล — พิสูจน์ loop ไม่ค้าง
  });
});
