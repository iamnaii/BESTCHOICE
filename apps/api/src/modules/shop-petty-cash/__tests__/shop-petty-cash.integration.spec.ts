/**
 * เงินสดย่อยหน้าร้าน S11-1106 — เมนูเติม/คืน + วงเงิน (ข้อ 20.2 · 2026-10-18) — พิสูจน์บน DB จริง
 *
 * ทุกยอดอ่านจากสมุดบัญชี SHOP ผ่าน service จริง (`ShopPettyCashService`) — ไม่เขียน JE ด้วย prisma ตรง ๆ
 * ฐานทดสอบใช้ร่วมกับ spec อื่น (S11-1106 อาจมียอดจากจ่ายผู้จัดจำหน่าย) ⇒ ทุก assertion เทียบจากยอดก่อนทำ (base) ไม่ใช่ศูนย์
 *
 * สิ่งที่พิสูจน์:
 *   1. summary: บัญชี · วงเงิน (DEFAULT/SET) · เติมได้อีก · ธนาคารที่เลือกได้
 *   2. เติม → Dr S11-1106 / Cr ธนาคาร · ยอดคงเหลือขยับ · ตารางเคลื่อนไหวมีแถว + ยอดสะสม · audit
 *   3. requestId เดิม = รายการเดิม · ค่าต่าง = 409
 *   4. เติมเกินวงเงิน / คืนเกินคงเหลือ = 400 ไม่มีแถว/JE
 *   5. คืน → Dr ธนาคาร / Cr S11-1106
 *   6. หลักฐาน: อัปโหลด key ใต้ shop-petty-cash/ · tx ล้ม → ลบ key
 *   7. งวดของวันที่ที่เลือกปิดแล้ว → ลงวันที่บันทึก + Todo แจ้งฝ่ายบัญชี
 *   8. กดเติมพร้อมกันสองคน → advisory lock: ผ่านคนเดียวเมื่อรวมกันเกินวงเงิน
 *   9. ตั้งวงเงิน: ด่านค่า · audit
 *
 * Runner: vitest (jest ignore `*.integration.spec.ts`). ต้องมี DB จริง:
 *   cd apps/api && DATABASE_URL=... npx vitest run --no-file-parallelism \
 *     src/modules/shop-petty-cash/__tests__/shop-petty-cash.integration.spec.ts
 * CI: glob `PETTY_FILES` ใน `.github/workflows/deploy-gcp.yml`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { Readable } from 'stream';
import { seedFinanceCoa } from '../../../../prisma/seed-coa-finance';
import { seedShopCoa } from '../../../../prisma/seed-coa-shop';
import { JournalAutoService } from '../../journal/journal-auto.service';
import { CompanyResolverService } from '../../journal/company-resolver.service';
import { ShopPettyCashTemplate } from '../../journal/cpa-templates/shop-petty-cash.template';
import { ShopPettyCashService } from '../shop-petty-cash.service';
import { SHOP_PETTY_CASH_AUDIT, SHOP_PETTY_CASH_LIMIT_KEY, SHOP_PETTY_CASH_PERIOD_TODO_TAG } from '../shop-petty-cash.constants';
import { bangkokCalendarParts, bangkokDateString } from '../../../utils/date.util';

const prisma = new PrismaClient();
const journal = new JournalAutoService(prisma as never);
const companyResolver = new CompanyResolverService(prisma as never);
const template = new ShopPettyCashTemplate(journal, prisma as never, companyResolver);

function fakeStorage() {
  const uploaded: string[] = [];
  const deleted: string[] = [];
  return {
    uploaded,
    deleted,
    upload: vi.fn(async (key: string) => { uploaded.push(key); return key; }),
    delete: vi.fn(async (key: string) => { deleted.push(key); }),
    getStream: vi.fn(async () => Readable.from(['img'])),
  };
}
const storage = fakeStorage();
const audit = { log: vi.fn(async () => undefined) };
const service = new ShopPettyCashService(prisma as never, template, companyResolver, storage as never, audit as never);

// คอนเนกชันที่สอง — เทสต์กดพร้อมกัน (PrismaClient เดียวซ้อน interactive tx สองตัวไม่ได้)
const prisma2 = new PrismaClient({ transactionOptions: { timeout: 20_000 } });
const companyResolver2 = new CompanyResolverService(prisma2 as never);
const service2 = new ShopPettyCashService(
  prisma2 as never,
  new ShopPettyCashTemplate(new JournalAutoService(prisma2 as never), prisma2 as never, companyResolver2),
  companyResolver2,
  fakeStorage() as never,
  { log: vi.fn(async () => undefined) } as never,
);

const RUN = Date.now().toString(36).toUpperCase();
const today = () => bangkokDateString(new Date());
const dec = (v: string | number) => new Decimal(v);
// PNG จริงขั้นต่ำที่ด่าน magic bytes (`isEvidenceImage`) รับ: ลายเซ็น 8 ไบต์ + เนื้อถึง 12 ไบต์
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const file = (name = 'slip.png'): Express.Multer.File =>
  ({ fieldname: 'evidence', originalname: name, mimetype: 'image/png', size: PNG_BYTES.length, buffer: PNG_BYTES }) as never;

let adminId: string;
let adminName: string;
let shopCompanyId: string;
let originalLimit: string | null = null;
const actor = () => ({ id: adminId, role: 'OWNER' });
const movementIds: string[] = [];

async function balance(): Promise<Decimal> {
  const agg = await prisma.journalLine.aggregate({
    where: { accountCode: 'S11-1106', deletedAt: null, journalEntry: { status: 'POSTED', deletedAt: null, companyId: shopCompanyId } },
    _sum: { debit: true, credit: true },
  });
  return dec((agg._sum.debit ?? 0).toString()).sub((agg._sum.credit ?? 0).toString());
}

async function linesOf(journalEntryId: string) {
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  return lines.map((l) => `${l.accountCode}:${l.debit.toFixed(2)}:${l.credit.toFixed(2)}`);
}

describe('เงินสดย่อยหน้าร้าน S11-1106 (integration)', () => {
  beforeAll(async () => {
    await seedFinanceCoa(prisma);
    await seedShopCoa(prisma);
    const shop = await prisma.companyInfo.findFirstOrThrow({ where: { companyCode: 'SHOP', deletedAt: null } });
    shopCompanyId = shop.id;
    let admin = await prisma.user.findFirst({ where: { email: 'admin@bestchoice.com' } });
    if (!admin) admin = await prisma.user.create({ data: { email: 'admin@bestchoice.com', password: 'x', name: 'admin', role: 'OWNER' } });
    adminId = admin.id;
    adminName = admin.name;
    const row = await prisma.systemConfig.findFirst({ where: { key: SHOP_PETTY_CASH_LIMIT_KEY, deletedAt: null } });
    originalLimit = row?.value ?? null;
  }, 60_000);

  afterAll(async () => {
    await prisma.todo.deleteMany({ where: { tags: { has: SHOP_PETTY_CASH_PERIOD_TODO_TAG } } });
    const rows = await prisma.shopPettyCashMovement.findMany({ where: { id: { in: movementIds } }, select: { journalEntryId: true } });
    const jeIds = rows.map((r) => r.journalEntryId).filter((id): id is string => !!id);
    await prisma.journalPostAuditLog.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.journalLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.shopPettyCashMovement.deleteMany({ where: { id: { in: movementIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    if (originalLimit == null) await prisma.systemConfig.deleteMany({ where: { key: SHOP_PETTY_CASH_LIMIT_KEY } });
    else await prisma.systemConfig.updateMany({ where: { key: SHOP_PETTY_CASH_LIMIT_KEY }, data: { value: originalLimit } });
    await prisma.$disconnect();
    await prisma2.$disconnect();
  });

  it('1. summary: บัญชี S11-1106 · ธนาคาร 2 บัญชี · วงเงินตั้งได้ (SET) · เติมได้อีก = วงเงิน − คงเหลือ', async () => {
    const base = await balance();
    const limit = base.add(10000);
    await service.setLimit(Number(limit.toFixed(2)), actor());
    const summary = await service.getSummary();
    expect(summary.accountCode).toBe('S11-1106');
    expect(summary.balance).toBe(base.toFixed(2));
    expect(summary.limit).toMatchObject({ value: limit.toFixed(2), source: 'SET' });
    expect(summary.headroom).toBe('10000.00');
    expect(summary.overLimit).toBe('0.00');
    expect(summary.banks.map((b) => b.code)).toEqual(['S11-1202', 'S11-1201']);
    expect(summary.defaultBank).toEqual({ TOP_UP: 'S11-1202', RETURN: 'S11-1201' });
    expect(summary.month.key).toBe(today().slice(0, 7));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: SHOP_PETTY_CASH_AUDIT.LIMIT, userId: adminId }));
  });

  it('2. เติม 1,000 จาก S11-1202 → Dr S11-1106 / Cr S11-1202 · ยอดขยับ · แถวในตาราง · audit', async () => {
    const base = await balance();
    const result = await service.record('TOP_UP', { amount: 1000, movedAt: today(), note: 'เติมรอบแรก', requestId: `req-${RUN}-1` }, actor());
    movementIds.push(result.movement.id);
    expect(result.duplicate).toBe(false);
    expect(result.periodClosed).toBe(false);
    expect(result.movement).toMatchObject({ kind: 'TOP_UP', amount: '1000.00', bankAccountCode: 'S11-1202', bankLabel: 'ธนาคารหน้าร้าน (จ่ายออก)', note: 'เติมรอบแรก', hasEvidence: false });
    expect(result.movement.journalEntryNo).toBeTruthy();
    const row = await prisma.shopPettyCashMovement.findUniqueOrThrow({ where: { id: result.movement.id } });
    expect(await linesOf(row.journalEntryId!)).toEqual(['S11-1106:1000.00:0.00', 'S11-1202:0.00:1000.00']);
    expect((await balance()).toFixed(2)).toBe(base.add(1000).toFixed(2));
    expect(result.summary.balance).toBe(base.add(1000).toFixed(2));

    const page = await service.listMovements();
    const mine = page.rows.find((r) => r.movementId === result.movement.id);
    expect(mine).toMatchObject({ kind: 'TOP_UP', label: 'เติมจาก ธนาคารหน้าร้าน (จ่ายออก)', inAmount: '1000.00', outAmount: '0.00', note: 'เติมรอบแรก', hasEvidence: false, journalEntryNo: result.movement.journalEntryNo });
    expect(mine!.createdByName).toBe(adminName);
    // แถวใหม่สุดอยู่บน และยอดสะสมของแถวบนสุด = ยอดปิดของช่วง
    expect(page.rows[0].balanceAfter).toBe(page.closing);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: SHOP_PETTY_CASH_AUDIT.TOP_UP, entityId: result.movement.id }));
  });

  it('3. requestId เดิม → รายการเดิม ไม่ลงซ้ำ · ค่าต่าง → 409', async () => {
    const before = await balance();
    const again = await service.record('TOP_UP', { amount: 1000, movedAt: today(), requestId: `req-${RUN}-1` }, actor());
    expect(again.duplicate).toBe(true);
    expect(again.movement.id).toBe(movementIds[0]);
    expect((await balance()).toFixed(2)).toBe(before.toFixed(2));
    await expect(service.record('TOP_UP', { amount: 999, movedAt: today(), requestId: `req-${RUN}-1` }, actor())).rejects.toBeInstanceOf(ConflictException);
  });

  it('4. เติมเกินวงเงิน / คืนเกินคงเหลือ → 400 ไม่มีแถว/JE', async () => {
    const summary = await service.getSummary();
    const headroom = dec(summary.headroom);
    expect(headroom.toFixed(2)).toBe('9000.00');
    const countBefore = await prisma.shopPettyCashMovement.count();
    await expect(service.record('TOP_UP', { amount: 9500, movedAt: today() }, actor())).rejects.toThrow('เติมได้อีกไม่เกิน 9,000.00 บาท');
    const over = dec(summary.balance).add(1);
    await expect(service.record('RETURN', { amount: Number(over.toFixed(2)), movedAt: today() }, actor())).rejects.toThrow('คืนได้ไม่เกินยอดคงเหลือ');
    await expect(service.record('TOP_UP', { amount: 0, movedAt: today() }, actor())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record('TOP_UP', { amount: 100, movedAt: today(), bankAccountCode: 'S11-1106' }, actor())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.record('TOP_UP', { amount: 100, movedAt: '2099-01-01' }, actor())).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.shopPettyCashMovement.count()).toBe(countBefore);
  });

  it('5. คืน 300 เข้า S11-1201 → Dr S11-1201 / Cr S11-1106', async () => {
    const base = await balance();
    const result = await service.record('RETURN', { amount: 300, movedAt: today(), requestId: `req-${RUN}-2` }, actor());
    movementIds.push(result.movement.id);
    expect(result.movement).toMatchObject({ kind: 'RETURN', amount: '300.00', bankAccountCode: 'S11-1201', bankLabel: 'ธนาคารหน้าร้าน (รับเข้า)' });
    const row = await prisma.shopPettyCashMovement.findUniqueOrThrow({ where: { id: result.movement.id } });
    expect(await linesOf(row.journalEntryId!)).toEqual(['S11-1201:300.00:0.00', 'S11-1106:0.00:300.00']);
    expect((await balance()).toFixed(2)).toBe(base.sub(300).toFixed(2));
    const page = await service.listMovements();
    expect(page.rows.find((r) => r.movementId === result.movement.id)).toMatchObject({ kind: 'RETURN', label: 'คืนเข้า ธนาคารหน้าร้าน (รับเข้า)', inAmount: '0.00', outAmount: '300.00' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: SHOP_PETTY_CASH_AUDIT.RETURN }));
  });

  it('6. หลักฐาน: อัปโหลด key ใต้ shop-petty-cash/ · ดึงรูปได้ · tx ล้ม → ลบ key ทิ้ง', async () => {
    const result = await service.record('TOP_UP', { amount: 100, movedAt: today(), requestId: `req-${RUN}-3` }, actor(), file());
    movementIds.push(result.movement.id);
    expect(result.movement.hasEvidence).toBe(true);
    expect(storage.uploaded.at(-1)).toMatch(/^shop-petty-cash\/\d{8}\/[0-9a-f-]{36}\.png$/);
    const evidence = await service.getEvidence(result.movement.id);
    expect(evidence.key).toBe(storage.uploaded.at(-1));
    const page = await service.listMovements();
    expect(page.rows.find((r) => r.movementId === result.movement.id)?.hasEvidence).toBe(true);

    const uploadedBefore = storage.uploaded.length;
    await expect(service.record('TOP_UP', { amount: 50_000, movedAt: today() }, actor(), file('x.png'))).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploaded.length).toBe(uploadedBefore + 1);
    expect(storage.deleted.at(-1)).toBe(storage.uploaded.at(-1));
    await expect(service.record('TOP_UP', { amount: 10, movedAt: today() }, actor(), { ...file(), mimetype: 'application/pdf' } as never)).rejects.toThrow('รองรับเฉพาะรูป');
  });

  it('7. งวดของวันที่ที่เลือกปิดแล้ว → ลงวันที่บันทึกแทน + Todo แจ้งฝ่ายบัญชี', async () => {
    const now = new Date();
    const parts = bangkokCalendarParts(now);
    // เดือนก่อน (ปฏิทินไทย) — ปิดงวดนั้นของ SHOP ชั่วคราว
    const prevYear = parts.month === 0 ? parts.year - 1 : parts.year;
    const prevMonth0 = parts.month === 0 ? 11 : parts.month - 1;
    const movedAt = `${prevYear}-${String(prevMonth0 + 1).padStart(2, '0')}-01`;
    const where = { companyId_year_month: { companyId: shopCompanyId, year: prevYear, month: prevMonth0 + 1 } };
    const before = await prisma.accountingPeriod.findUnique({ where });
    await prisma.accountingPeriod.upsert({ where, create: { companyId: shopCompanyId, year: prevYear, month: prevMonth0 + 1, status: 'CLOSED' }, update: { status: 'CLOSED' } });
    try {
      const result = await service.record('TOP_UP', { amount: 50, movedAt, requestId: `req-${RUN}-4` }, actor());
      movementIds.push(result.movement.id);
      expect(result.periodClosed).toBe(true);
      expect(result.accountingNotified).toBe(true);
      expect(bangkokDateString(new Date(result.movement.postedAt))).toBe(today());
      // movedAt = เที่ยงคืนเวลาไทย (ISO เป็นวันก่อนหน้า 17:00Z) — เทียบด้วยปฏิทินไทย
      expect(bangkokDateString(new Date(result.movement.movedAt))).toBe(movedAt);
      const todo = await prisma.todo.findFirst({ where: { tags: { has: SHOP_PETTY_CASH_PERIOD_TODO_TAG }, title: { contains: 'เติมเงินสดย่อย' } }, orderBy: { createdAt: 'desc' } });
      expect(todo?.description).toContain('50.00');
    } finally {
      if (before) await prisma.accountingPeriod.update({ where, data: { status: before.status } });
      else await prisma.accountingPeriod.delete({ where });
    }
  });

  it('8. กดเติมพร้อมกันสองคน รวมเกินวงเงิน → ผ่านคนเดียว (advisory lock)', async () => {
    const summary = await service.getSummary();
    const headroom = dec(summary.headroom);
    expect(headroom.gt(100)).toBe(true);
    const each = headroom.mul(0.6).toDecimalPlaces(2);
    const results = await Promise.allSettled([
      service.record('TOP_UP', { amount: Number(each.toFixed(2)), movedAt: today(), requestId: `req-${RUN}-5a` }, actor()),
      service2.record('TOP_UP', { amount: Number(each.toFixed(2)), movedAt: today(), requestId: `req-${RUN}-5b` }, actor()),
    ]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof service.record>>> => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(BadRequestException);
    movementIds.push(ok[0].value.movement.id);
    expect((await service.getSummary()).balance).toBe(dec(summary.balance).add(each).toFixed(2));
  });

  it('9. ตั้งวงเงิน: ติดลบ / เกินเพดาน / ทศนิยมเกิน 2 → 400 · ค่าใหม่สะท้อนใน summary', async () => {
    await expect(service.setLimit(-1, actor())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setLimit(2_000_000, actor())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setLimit(12.345, actor())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setLimit(Number.NaN, actor())).rejects.toBeInstanceOf(BadRequestException);
    const limit = await service.setLimit(0, actor());
    expect(limit).toMatchObject({ value: '0.00', source: 'SET' });
    const summary = await service.getSummary();
    expect(summary.headroom).toBe('0.00');
    expect(summary.overLimit).toBe(summary.balance);
    await expect(service.record('TOP_UP', { amount: 1, movedAt: today() }, actor())).rejects.toThrow('เติมได้อีกไม่เกิน 0.00 บาท');
    // เกินวงเงินแล้วยัง "คืน" ได้ (Review Focus 2) — คืนไม่อ่านวงเงิน
    const back = await service.record('RETURN', { amount: 1, movedAt: today(), requestId: `req-${RUN}-9` }, actor());
    movementIds.push(back.movement.id);
    expect(back.movement.kind).toBe('RETURN');
  });

  it('10. ตารางเดือนอื่น: เดือนผิดรูป → 400 · เดือนที่ไม่มีรายการ → ว่าง ยอดเปิด = ยอดปิด', async () => {
    await expect(service.listMovements('2026-13')).rejects.toBeInstanceOf(BadRequestException);
    const page = await service.listMovements('2000-01');
    expect(page.rows).toEqual([]);
    expect(page.opening).toBe(page.closing);
    expect(page.month).toEqual({ key: '2000-01', label: 'มกราคม 2543' });
  });
});
