import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerPiiService } from './customer-pii.service';
import { customerPhoneLockKey, lockCustomerPhone } from './customer-phone-lock';
import { hashPII } from '../../utils/pii.util';
import { decryptPII } from '../../utils/crypto.util';

const PII_KEY = 'c'.repeat(64);
const PII_SALT = 'skip-tracing-db-spec-salt-0123456789';

/**
 * Skip-tracing บน Postgres จริง (คำตัดสินเจ้าของ 2026-09-17 ข้อ 3):
 *  - เบอร์ใหม่ที่ไม่มีใครถือ → เบอร์หลัก + phoneHash/phoneEncrypted ใหม่ (hash เก่าไม่ค้าง)
 *  - เบอร์ของลูกค้าคนอื่น → เบอร์สำรอง ไม่แตะเบอร์หลัก + บอกชื่อเจ้าของ
 *  - ล็อกเบอร์เดียวกับฝั่งพนักงาน: ผู้เขียนอีกคอนเนกชันถือล็อกแล้วสร้างเจ้าของเบอร์ก่อน →
 *    skip-tracing ที่รอล็อกอยู่เห็นแถวนั้นหลัง commit แล้วเก็บเป็นเบอร์สำรอง (ไม่มีสองคนถือเบอร์หลักเดียวกัน)
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest <ไฟล์นี้> --runInBand
 */
describe('SkipTracingService.updateContact (real DB)', () => {
  const prisma = new PrismaClient();
  const holderDb = new PrismaClient();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const pii = new CustomerPiiService(prisma as never);
  const service = new SkipTracingService(prisma as never, audit as never, pii);
  const savedEnv = { key: process.env.PII_ENCRYPTION_KEY, salt: process.env.PII_HASH_SALT };
  const ids = new Set<string>();

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = PII_KEY;
    process.env.PII_HASH_SALT = PII_SALT;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await Promise.all([prisma.$connect(), holderDb.$connect()]);
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { id: { in: [...ids] } } });
    await Promise.all([prisma.$disconnect(), holderDb.$disconnect()]);
    if (savedEnv.key === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = savedEnv.key;
    if (savedEnv.salt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = savedEnv.salt;
  });

  beforeEach(() => audit.log.mockClear());

  async function freshPhone(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const phone = `0977${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
      const taken = await prisma.customer.count({
        where: {
          OR: [{ phone }, { phoneHash: hashPII(phone, PII_SALT) }, { phoneSecondary: phone }],
        },
      });
      if (taken === 0) return phone;
    }
    throw new Error('หาเบอร์ทดสอบที่ว่างไม่ได้');
  }

  function primaryPhone(phone: string) {
    const enc = pii.encryptCustomerFields({ phone });
    return { phone, phoneHash: enc.phoneHash, phoneEncrypted: enc.phoneEncrypted };
  }

  async function customerWithPhone(label: string, phone: string) {
    const row = await prisma.customer.create({
      data: {
        name: `skip-tracing spec ${label}`,
        ...primaryPhone(phone),
      },
    });
    ids.add(row.id);
    return row;
  }

  it('เบอร์ว่าง → เบอร์หลัก + hash/encrypted ใหม่ · hash เก่าหายจากแถว', async () => {
    const oldPhone = await freshPhone();
    const debtor = await customerWithPhone('primary', oldPhone);
    const newPhone = await freshPhone();

    const result = await service.updateContact(
      debtor.id,
      { newPhone, reason: 'ญาติให้เบอร์ใหม่' },
      { userId: undefined },
    );

    expect(result).toMatchObject({ phone: newPhone, phoneStoredAs: 'PRIMARY', phoneOwner: null });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: debtor.id } });
    expect(row.phone).toBe(newPhone);
    expect(row.phoneHash).toBe(hashPII(newPhone, PII_SALT));
    expect(decryptPII(row.phoneEncrypted!, PII_KEY)).toBe(newPhone);
    // hash เก่าไม่ค้าง ⇒ ลูกค้าใหม่ที่ใช้เบอร์เก่าจะไม่ถูกบล็อกผิดตัว
    expect(
      await prisma.customer.count({
        where: { id: debtor.id, phoneHash: hashPII(oldPhone, PII_SALT) },
      }),
    ).toBe(0);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('เบอร์ของลูกค้าคนอื่น → เบอร์สำรอง ไม่แตะเบอร์หลัก และบอกชื่อเจ้าของ', async () => {
    const debtorPhone = await freshPhone();
    const debtor = await customerWithPhone('debtor', debtorPhone);
    const ownerPhone = await freshPhone();
    const owner = await customerWithPhone('owner', ownerPhone);

    const result = await service.updateContact(
      debtor.id,
      { newPhone: ownerPhone, reason: 'เบอร์ภรรยา' },
      { userId: undefined },
    );

    expect(result).toMatchObject({
      phone: debtorPhone,
      phoneSecondary: ownerPhone,
      phoneStoredAs: 'SECONDARY',
      phoneOwner: { id: owner.id, name: owner.name },
    });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: debtor.id } });
    expect(row.phone).toBe(debtorPhone);
    expect(row.phoneHash).toBe(hashPII(debtorPhone, PII_SALT));
    expect(row.phoneSecondary).toBe(ownerPhone);
    expect(decryptPII(row.phoneSecondaryEncrypted!, PII_KEY)).toBe(ownerPhone);
    const live = await prisma.customer.count({
      where: { deletedAt: null, phoneHash: hashPII(ownerPhone, PII_SALT) },
    });
    expect(live).toBe(1);
  });

  it('รอล็อกเบอร์ของอีกคอนเนกชันที่กำลังสร้างเจ้าของเบอร์ → เห็นแถวนั้นหลัง commit แล้วเก็บเป็นเบอร์สำรอง', async () => {
    const debtor = await customerWithPhone('race', await freshPhone());
    const contested = await freshPhone();
    const key = customerPhoneLockKey(pii, contested)!;

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    let ownerId = '';

    const holder = holderDb.$transaction(
      async (tx) => {
        await lockCustomerPhone(tx, pii, contested);
        locked();
        await gate;
        const created = await tx.customer.create({
          data: {
            name: 'skip-tracing spec race-owner',
            ...primaryPhone(contested),
          },
        });
        ownerId = created.id;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    await lockTaken;

    const run = service.updateContact(
      debtor.id,
      { newPhone: contested, reason: 'เบอร์ที่ชนกัน' },
      { userId: undefined },
    );
    // รอจนผู้เขียน skip-tracing เข้าคิวล็อกจริง (ถ้าไม่ล็อก มันจะจบก่อนและเขียนเป็นเบอร์หลัก)
    let queued = false;
    let settled = false;
    void run.then(
      () => (settled = true),
      () => (settled = true),
    );
    const deadline = Date.now() + 10_000;
    while (!settled && Date.now() < deadline) {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
          AND objid = ((hashtext(${key})::bigint) & 4294967295)::oid`;
      if (Number(rows[0]?.n ?? 0) >= 1) {
        queued = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await holder;
    ids.add(ownerId);
    const result = await run;

    expect(queued).toBe(true);
    expect(result.phoneStoredAs).toBe('SECONDARY');
    expect(result.phoneOwner?.id).toBe(ownerId);
    const primaries = await prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ phone: contested }, { phoneHash: hashPII(contested, PII_SALT) }],
      },
      select: { id: true },
    });
    expect(primaries.map((r) => r.id)).toEqual([ownerId]);
  });
  it('เบอร์เดิมบนแถวที่เสียจากบั๊กเดิม (hash ค้าง + ไม่มี ciphertext) → ซ่อมในแถวเดียวกัน phoneStoredAs = null', async () => {
    const phone = await freshPhone();
    const staleFor = await freshPhone();
    const debtor = await prisma.customer.create({
      data: {
        name: 'skip-tracing spec same-primary',
        phone,
        phoneHash: hashPII(staleFor, PII_SALT),
        phoneEncrypted: null,
      },
    });
    ids.add(debtor.id);

    const result = await service.updateContact(
      debtor.id,
      { newPhone: phone, reason: 'ยืนยันเบอร์เดิม' },
      { userId: undefined },
    );

    expect(result).toMatchObject({ phone, phoneStoredAs: null, phoneOwner: null });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: debtor.id } });
    expect(row.phoneHash).toBe(hashPII(phone, PII_SALT));
    expect(decryptPII(row.phoneEncrypted!, PII_KEY)).toBe(phone);
    // hash ค้างไม่บล็อกเบอร์ staleFor อีกต่อไป
    expect(await prisma.customer.count({ where: { phoneHash: hashPII(staleFor, PII_SALT) } })).toBe(0);
  });

  it('เบอร์เดิมบนแถวที่ถูกต้องอยู่แล้ว → ไม่เขียนคอลัมน์เบอร์', async () => {
    const phone = await freshPhone();
    const debtor = await customerWithPhone('same-primary-clean', phone);

    const result = await service.updateContact(
      debtor.id,
      { newPhone: phone, reason: 'ยืนยันเบอร์เดิม' },
      { userId: undefined },
    );

    expect(result.phoneStoredAs).toBeNull();
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: debtor.id } });
    expect(row.phoneEncrypted).toBe(debtor.phoneEncrypted);
    expect(row.phoneHash).toBe(debtor.phoneHash);
  });
});
