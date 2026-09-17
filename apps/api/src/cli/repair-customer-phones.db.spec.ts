import { Prisma, PrismaClient } from '@prisma/client';
import { decryptPII, encryptPII } from '../utils/crypto.util';
import { hashPII } from '../utils/pii.util';
import { customerPhoneLockKey } from '../modules/customers/customer-phone-lock';
import { AuditService } from '../modules/audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTION, PhoneCrypto, RepairReport, runRepair } from './repair-customer-phones.cli';

const KEY = 'd'.repeat(64);
const WRONG_KEY = 'e'.repeat(64);
const SALT = 'repair-customer-phones-db-spec-salt-01';

/**
 * CLI ซ่อมเบอร์ลูกค้าบน Postgres จริง (คำตัดสินเจ้าของ 2026-09-17 ข้อ 2 + 4)
 *  - DRY-RUN ไม่เขียนอะไรเลย แต่รายงานตัวเลข/กลุ่มเบอร์ซ้ำครบ
 *  - APPLY ซ่อมรูปแบบ + hash + ciphertext · แถวที่ถอดรหัสไม่ได้ไม่ถูกแตะ · รันซ้ำไม่มีอะไรต้องทำ
 *  - ล็อกเบอร์เดียวกับฝั่งพนักงาน: คนอื่นถือล็อกแล้วแก้แถวระหว่างนั้น → ข้ามแถวนั้น (changedMeanwhile)
 *  - ด่านกุญแจ: ciphertext ถอดไม่ออกทั้งหมด → ไม่เขียนแถวไหนเลย
 * ทุกเคสจำกัดขอบเขตด้วย customerIds — ไม่แตะแถวของสเปคอื่นในฐานเทส
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('runRepair (real DB)', () => {
  const prisma = new PrismaClient();
  const holderDb = new PrismaClient();
  const crypto: PhoneCrypto = {
    hash: (v) => hashPII(v, SALT),
    encrypt: (v) => encryptPII(v, KEY),
    decrypt: (v) => decryptPII(v, KEY),
  };
  const log = () => undefined;
  const ids = new Set<string>();
  const savedSalt = process.env.PII_HASH_SALT;

  beforeAll(async () => {
    // customerPhoneLockKey (ไม่ได้ฉีด pii) อ่าน salt จาก env — ให้คีย์ในเทสตรงกับที่ CLI ใช้
    process.env.PII_HASH_SALT = SALT;
    await Promise.all([prisma.$connect(), holderDb.$connect()]);
    // ฐานเทสใหม่ไม่มีผู้ใช้ระบบ — seed แบบ capture-lead.tool.db.spec.ts (ทิ้งไว้โดยตั้งใจ)
    const sys = await prisma.user.findFirst({ where: { isSystemUser: true }, select: { id: true } });
    const sameEmail = await prisma.user.findUnique({
      where: { email: 'system@bestchoice.internal' },
      select: { id: true },
    });
    if (!sys && sameEmail) {
      throw new Error('ฐานเทสมี system@bestchoice.internal ที่ไม่ใช่ผู้ใช้ระบบ — ไม่แก้แถวของคนอื่น');
    }
    if (!sys) {
      await prisma.user.create({
        data: {
          email: 'system@bestchoice.internal',
          name: 'SYSTEM',
          role: 'OWNER',
          password: '__NO_LOGIN__',
          accessibleCompanies: ['SHOP', 'FINANCE'],
          primaryCompany: 'SHOP',
          isActive: false,
          isSystemUser: true,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: [...ids] } } });
    await Promise.all([prisma.$disconnect(), holderDb.$disconnect()]);
    if (savedSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = savedSalt;
  });

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0966${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: { OR: [{ phone }, { phoneHash: hashPII(phone, SALT) }, { phoneSecondary: phone }] },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  /** "0966123456" → "096-612 3456" */
  const dashed = (p: string) => `${p.slice(0, 3)}-${p.slice(3, 6)} ${p.slice(6)}`;
  /** "0966123456" → "+66966123456" */
  const intl = (p: string) => `+66${p.slice(1)}`;

  async function customer(label: string, data: Omit<Prisma.CustomerUncheckedCreateInput, 'name'>) {
    const row = await prisma.customer.create({
      data: { name: `repair-phones spec ${label}`, ...data },
    });
    ids.add(row.id);
    return row;
  }

  const clean = (p: string) => ({ phone: p, phoneHash: hashPII(p, SALT), phoneEncrypted: encryptPII(p, KEY) });

  const snapshot = (scope: string[]) =>
    prisma.customer.findMany({
      where: { id: { in: scope } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        phone: true,
        phoneHash: true,
        phoneEncrypted: true,
        phoneSecondary: true,
        phoneSecondaryEncrypted: true,
        updatedAt: true,
      },
    });

  async function fixture() {
    const pFormat = await freshPhone();
    const pStaleOld = await freshPhone();
    const pStaleNew = await freshPhone();
    const pClean = await freshPhone();
    const pSecondary = await freshPhone();
    const pDup = await freshPhone();
    const pWrongKey = await freshPhone();

    const format = await customer('format', { phone: dashed(pFormat) });
    const stale = await customer('stale', {
      phone: pStaleNew,
      phoneHash: hashPII(pStaleOld, SALT),
      phoneEncrypted: encryptPII(pStaleOld, KEY),
    });
    const good = await customer('clean', clean(pClean));
    const secondary = await customer('secondary', {
      ...clean(await freshPhone()),
      phoneSecondary: intl(pSecondary),
    });
    const invalid = await customer('invalid', { phone: '12345' });
    const wrongKey = await customer('wrong-key', {
      phone: pWrongKey,
      phoneHash: hashPII(pWrongKey, SALT),
      phoneEncrypted: encryptPII(pWrongKey, WRONG_KEY),
    });
    const dupBot = await customer('dup-bot', {
      phone: intl(pDup),
      acquisitionSource: 'AI_CHAT',
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
    });
    const dupStaff = await customer('dup-staff', {
      ...clean(pDup),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const dupHashOnly = await customer('dup-hash-only', {
      phone: null,
      phoneHash: hashPII(pDup, SALT),
      acquisitionSource: 'CHAT_FACEBOOK',
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
    });
    const dupDeleted = await customer('dup-deleted', { ...clean(pDup), deletedAt: new Date() });
    return {
      phones: { pFormat, pStaleNew, pSecondary, pDup },
      rows: { format, stale, good, secondary, invalid, wrongKey, dupBot, dupStaff, dupHashOnly, dupDeleted },
    };
  }

  function expectCommonReport(report: RepairReport, rows: Awaited<ReturnType<typeof fixture>>['rows']) {
    // scanned = แถวที่มีเบอร์ plaintext และยังไม่ถูกลบ (ไม่นับ hash-only / ถูกลบ)
    expect(report.counts.scanned).toBe(8);
    expect(report.counts.needsWrite).toBe(5); // format, stale, secondary, invalid, dupBot
    expect(report.counts.formatChanged).toBe(2); // format, dupBot
    expect(report.counts.hashFilled).toBe(3); // format, invalid, dupBot
    expect(report.counts.hashStale).toBe(1); // stale
    expect(report.counts.hashFixed).toBe(4);
    expect(report.counts.encryptedFilled).toBe(3);
    expect(report.counts.encryptedStale).toBe(1);
    expect(report.counts.secondaryFixed).toBe(1);
    expect(report.counts.invalid).toBe(1);
    expect(report.counts.decryptFailed).toBe(1);
    expect(report.counts.saltSuspect).toBe(0);
    expect(report.counts.hashPlaintextLeak).toBe(0);
    // แถว stale: หน้าจอแสดงเบอร์เก่าจาก ciphertext → หลัง APPLY จะแสดงเบอร์ใน phone
    expect(report.counts.displayChanged).toBe(1);
    expect(report.displayChangedIds).toEqual([rows.stale.id]);
    expect(report.invalidIds).toEqual([rows.invalid.id]);
    expect(report.decryptFailedIds).toEqual([rows.wrongKey.id]);
    expect(report.aborted).toEqual([]);
    expect(report.keyWarnings).toEqual([]);

    expect(report.duplicateGroupCount).toBe(1);
    const [group] = report.duplicateGroups;
    expect(group.hasBotOrChat).toBe(true);
    // บอท/แชทก่อน (เก่าก่อน) แล้วจึงแถวพนักงาน · แถวที่ถูกลบไม่อยู่ในกลุ่ม
    expect(group.customerIds).toEqual([rows.dupBot.id, rows.dupHashOnly.id, rows.dupStaff.id]);
    expect(group.members.map((m) => [m.origin, m.hashOnly, m.contracts, m.sales])).toEqual([
      ['BOT', false, 0, 0],
      ['CHAT', true, 0, 0],
      ['OTHER', false, 0, 0],
    ]);
    // รายงานไม่มีเบอร์/hash/ชื่อ
    const json = JSON.stringify(report);
    expect(json).not.toContain(rows.format.phone!);
    expect(json).not.toContain(hashPII(rows.dupStaff.phone!, SALT));
    expect(json).not.toContain('repair-phones spec');
  }

  it('DRY-RUN รายงานครบแต่ไม่เขียนอะไร · APPLY ซ่อมจริง · รันซ้ำไม่มีอะไรต้องทำ', async () => {
    const { phones, rows } = await fixture();
    const scope = Object.values(rows).map((r) => r.id);
    const before = await snapshot(scope);

    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const dry = await runRepair(prisma, crypto, { apply: false, customerIds: scope, batchSize: 3, log, audit });
    expect(dry.mode).toBe('DRY-RUN');
    expectCommonReport(dry, rows);
    expect(dry.counts.written).toBe(0);
    expect(await snapshot(scope)).toEqual(before);
    expect(audit.log).not.toHaveBeenCalled();

    const applied = await runRepair(prisma, crypto, { apply: true, customerIds: scope, batchSize: 3, log, audit });
    expect(applied.mode).toBe('APPLY');
    expectCommonReport(applied, rows);
    expect(applied.counts.written).toBe(5);
    expect(applied.counts.changedMeanwhile).toBe(0);
    expect(applied.counts.failed).toBe(0);

    const after = new Map((await snapshot(scope)).map((r) => [r.id, r]));
    const check = (id: string, phone: string) => {
      const r = after.get(id)!;
      expect(r.phone).toBe(phone);
      expect(r.phoneHash).toBe(hashPII(phone, SALT));
      expect(decryptPII(r.phoneEncrypted!, KEY)).toBe(phone);
    };
    check(rows.format.id, phones.pFormat);
    check(rows.stale.id, phones.pStaleNew);
    check(rows.dupBot.id, phones.pDup);
    check(rows.invalid.id, '12345');
    const sec = after.get(rows.secondary.id)!;
    expect(sec.phoneSecondary).toBe(phones.pSecondary);
    expect(decryptPII(sec.phoneSecondaryEncrypted!, KEY)).toBe(phones.pSecondary);

    // แถวที่ไม่ต้องซ่อม / ถอดรหัสไม่ได้ / ถูกลบ ไม่ถูกแตะ
    const untouched = new Map(before.map((r) => [r.id, r]));
    for (const id of [rows.good.id, rows.wrongKey.id, rows.dupStaff.id, rows.dupHashOnly.id, rows.dupDeleted.id]) {
      expect(after.get(id)).toEqual(untouched.get(id));
    }

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTION,
        entity: 'customer',
        userId: expect.any(String),
        newValue: expect.objectContaining({ written: 5, scanned: 8, duplicateGroupCount: 1 }),
      }),
    );

    const again = await runRepair(prisma, crypto, { apply: true, customerIds: scope, log, audit });
    expect(again.counts.needsWrite).toBe(0);
    expect(again.counts.written).toBe(0);
    expect(again.counts.decryptFailed).toBe(1);
    expect(again.duplicateGroupCount).toBe(1);
  });

  it('ใช้ล็อกเบอร์เดียวกับฝั่งพนักงาน: คนอื่นถือล็อกแล้วแก้แถวระหว่างรอ → ข้ามแถวนั้น ไม่ทับค่าใหม่', async () => {
    const p = await freshPhone();
    const newer = await freshPhone();
    const row = await customer('lock', { phone: dashed(p) });
    const key = customerPhoneLockKey(null, p)!;

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const holder = holderDb.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        locked();
        await released;
        // พนักงานเปลี่ยนเบอร์ระหว่างที่ CLI รอล็อก (commit ก่อน CLI ได้ล็อก)
        await tx.customer.update({ where: { id: row.id }, data: clean(newer) });
      },
      { timeout: 20_000 },
    );
    await holding;

    const repair = runRepair(prisma, crypto, { apply: true, customerIds: [row.id], log });
    // รอจนคอนเนกชันของ CLI ติดคิวล็อกจริง (advisory lock ที่ยังไม่ granted)
    for (let i = 0; ; i++) {
      const [{ waiting }] = await holderDb.$queryRaw<{ waiting: bigint }[]>`
        SELECT count(*) AS waiting FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
      if (Number(waiting) > 0) break;
      if (i > 200) throw new Error('CLI ไม่ได้รอล็อกเบอร์');
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    const report = await repair;

    expect(report.counts.needsWrite).toBe(1);
    expect(report.counts.written).toBe(0);
    expect(report.counts.changedMeanwhile).toBe(1);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.phone).toBe(newer);
    expect(after.phoneHash).toBe(hashPII(newer, SALT));
  });

  it('รายงานนับสัญญา/ใบขายจริง (ใบขายที่ยกเลิกไม่นับใน sales) + relation ที่บล็อกการลบทุกแถว', async () => {
    const p = await freshPhone();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const branch = await prisma.branch.create({ data: { name: `repair-phones spec ${stamp}` } });
    const user = await prisma.user.create({
      data: { email: `repair-phones-${stamp}@spec.local`, password: 'x', name: 'repair-phones spec' },
    });
    const product = await prisma.product.create({
      data: { name: 'repair-phones spec phone', brand: 'Apple', model: 'iPhone 15', category: 'PHONE_NEW', costPrice: 20000, branchId: branch.id },
    });
    const owner = await customer('counts-owner', clean(p));
    const other = await customer('counts-other', { ...clean(p), acquisitionSource: 'AI_CHAT' });
    const contract = await prisma.contract.create({
      data: {
        contractNumber: `RP-${stamp}`, customerId: owner.id, productId: product.id, branchId: branch.id,
        salespersonId: user.id, planType: 'STORE_WITH_INTEREST', sellingPrice: 25000, downPayment: 5000,
        interestRate: 0.02, totalMonths: 10, interestTotal: 4000, financedAmount: 20000, monthlyPayment: 2400,
      },
    });
    const voided = await prisma.sale.create({
      data: {
        saleNumber: `RP-${stamp}`, saleType: 'CASH', customerId: owner.id, productId: product.id, branchId: branch.id,
        salespersonId: user.id, sellingPrice: 25000, netAmount: 25000, deletedAt: new Date(),
      },
    });
    try {
      const report = await runRepair(prisma, crypto, { apply: false, customerIds: [owner.id, other.id], log });
      expect(report.duplicateGroupCount).toBe(1);
      const byId = new Map(report.duplicateGroups[0].members.map((m) => [m.id, m]));
      expect(byId.get(owner.id)).toMatchObject({
        contracts: 1,
        sales: 0,
        // ตัวบล็อกนับทุกแถวรวมที่ถูก soft-delete (ระวังไว้ก่อน) ⇒ ใบขายที่ยกเลิกยังบล็อกการลบ
        blocking: { contracts: 1, sales: 1 },
        blockingTotal: 2,
        chatRooms: 0,
      });
      expect(byId.get(other.id)).toMatchObject({ contracts: 0, sales: 0, blocking: {}, blockingTotal: 0 });
    } finally {
      await prisma.sale.delete({ where: { id: voided.id } });
      await prisma.contract.delete({ where: { id: contract.id } });
      await prisma.product.delete({ where: { id: product.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.branch.delete({ where: { id: branch.id } });
    }
  });

  it('แถวที่เขียนพลาด → ข้าม นับ failed + id ท้าย · แถวอื่นยังถูกเขียน', async () => {
    const a = await customer('fail-a', { phone: dashed(await freshPhone()) });
    const bad = await customer('fail-bad', { phone: dashed(await freshPhone()) });
    const c = await customer('fail-c', { phone: dashed(await freshPhone()) });
    const scope = [a.id, bad.id, c.id];
    const report = await runRepair(prisma, crypto, {
      apply: true,
      customerIds: scope,
      log,
      wrapWriteTx: (tx, rowId) => {
        if (rowId !== bad.id) return tx;
        return new Proxy(tx, {
          get(target, prop) {
            if (prop === 'customer') {
              return { updateMany: () => Promise.reject(new Error('simulated write failure')) };
            }
            const value = (target as unknown as Record<string | symbol, unknown>)[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    });
    expect(report.counts.needsWrite).toBe(3);
    expect(report.counts.written).toBe(2);
    expect(report.counts.failed).toBe(1);
    expect(report.failedIdTails).toEqual([`…${bad.id.slice(-6)}`]);
    const after = new Map((await snapshot(scope)).map((r) => [r.id, r]));
    expect(after.get(bad.id)!.phone).toBe(bad.phone);
    expect(after.get(bad.id)!.phoneHash).toBeNull();
    expect(after.get(a.id)!.phoneHash).not.toBeNull();
    expect(after.get(c.id)!.phoneHash).not.toBeNull();
  });

  it('APPLY กับ AuditService ตัวจริง → มีแถว audit_logs ที่อยู่ใน hash chain (ตัวเลขเท่านั้น)', async () => {
    const pAudit = await freshPhone();
    const row = await customer('audit', { phone: dashed(pAudit) });
    const started = new Date();
    const audit = new AuditService(prisma as unknown as PrismaService);
    const report = await runRepair(prisma, crypto, { apply: true, customerIds: [row.id], log, audit });
    expect(report.counts.written).toBe(1);

    // audit_logs ห้ามลบ (trigger audit_logs_no_delete) — แถวนี้ค้างในฐานเทสโดยตั้งใจ
    const rows = await prisma.auditLog.findMany({
      where: { action: AUDIT_ACTION, createdAt: { gte: started } },
      select: { entity: true, rowHash: true, sequenceNumber: true, newValue: true, oldValue: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entity).toBe('customer');
    expect(rows[0].rowHash).toEqual(expect.stringMatching(/^v2:/));
    expect(rows[0].sequenceNumber).not.toBeNull();
    expect(rows[0].newValue).toMatchObject({ written: 1, scanned: 1, duplicateGroupCount: 0 });
    expect(JSON.stringify([rows[0].newValue, rows[0].oldValue])).not.toContain(pAudit);
  });

  it('ด่านกุญแจ: ciphertext ถอดไม่ออกทุกแถว → APPLY หยุดก่อนเขียนแถวแรก', async () => {
    const pWrong = await freshPhone();
    const pFix = await freshPhone();
    const wrong = await customer('abort-wrong-key', {
      phone: pWrong,
      phoneHash: hashPII(pWrong, SALT),
      phoneEncrypted: encryptPII(pWrong, WRONG_KEY),
    });
    const fixable = await customer('abort-fixable', { phone: dashed(pFix) });
    const scope = [wrong.id, fixable.id];
    const before = await snapshot(scope);
    const audit = { log: jest.fn().mockResolvedValue(undefined) };

    const dry = await runRepair(prisma, crypto, { apply: false, customerIds: scope, log });
    expect(dry.aborted).toEqual([]);
    expect(dry.keyWarnings).toHaveLength(1);

    const report = await runRepair(prisma, crypto, { apply: true, customerIds: scope, log, audit });
    expect(report.aborted).toHaveLength(1);
    expect(report.keyWarnings).toEqual(report.aborted);
    expect(report.counts.needsWrite).toBe(1);
    expect(report.counts.written).toBe(0);
    expect(await snapshot(scope)).toEqual(before);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
