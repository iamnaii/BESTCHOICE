/* eslint-disable @typescript-eslint/no-explicit-any -- mock clients ที่บันทึกลำดับคำสั่ง */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerWriteService, uniqueClashToConflict } from './customer-write.service';
import { hashPII } from '../../../utils/pii.util';

/**
 * ล็อกเบอร์หลัก (คำตัดสินเจ้าของ 2026-09-17) — ลำดับ: ล็อก → ตรวจซ้ำบน tx → เขียน ในทรานแซกชันเดียว
 * การแข่งจริงบน Postgres ปักไว้ที่ customer-phone-lock.race.db.spec.ts — ไฟล์นี้ปักลำดับคำสั่งกับทางแยก
 */
describe('CustomerWriteService — ล็อกเบอร์หลัก', () => {
  const SALT = 'phone-lock-write-spec-salt-0123456789';
  const PHONE = '0812345678';
  const LOCK_KEY = `customer-phone:${hashPII(PHONE, SALT)}`;
  let prevSalt: string | undefined;
  let prevKey: string | undefined;

  const calls: string[] = [];
  let root: Record<string, any>;
  let tx: Record<string, any>;
  let service: CustomerWriteService;
  let contactResolver: { findOrCreateByNaturalKey: jest.Mock };
  let query: { findOne: jest.Mock };

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    prevKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_HASH_SALT = SALT;
    delete process.env.PII_ENCRYPTION_KEY;
  });
  afterAll(() => {
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = prevSalt;
    if (prevKey !== undefined) process.env.PII_ENCRYPTION_KEY = prevKey;
  });

  function client(label: string) {
    const log = (name: string, value: unknown = null) =>
      jest.fn(async (...args: unknown[]) => {
        calls.push(`${label}.${name}`);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown)(...args)
          : value;
      });
    return {
      $executeRaw: log('lock', 1),
      customer: {
        findFirst: log('findFirst'),
        findUnique: log('findUnique'),
        count: log('count', 0),
        create: log('create', (a: any) => ({ id: 'new', ...a.data })),
        update: log('update', (a: any) => ({
          id: a.where.id,
          name: 'x',
          phone: a.data.phone ?? null,
        })),
      },
    };
  }

  beforeEach(() => {
    calls.length = 0;
    tx = client('tx');
    root = {
      ...client('root'),
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => {
        calls.push('root.$transaction');
        return cb(tx);
      }),
    };
    contactResolver = {
      findOrCreateByNaturalKey: jest.fn(async () => {
        calls.push('tx.contact:code');
        return { id: 'contact-1' };
      }),
    };
    query = { findOne: jest.fn().mockResolvedValue({ id: 'c1', phone: '0899999999' }) };
    service = new CustomerWriteService(root as never, contactResolver as never, query as never);
  });

  const lockKeyOf = (c: Record<string, any>) => c.$executeRaw.mock.calls[0][1];

  it('create: ล็อกเบอร์ (คีย์ = hash ของเบอร์ที่จัดรูปแล้ว) → ตรวจซ้ำบน tx → contact:code → เขียน', async () => {
    await service.create({ name: 'คนใหม่', phone: '081-234 5678' } as never);
    expect(lockKeyOf(tx)).toBe(LOCK_KEY);
    expect(calls).toEqual([
      'root.$transaction',
      'tx.lock',
      'tx.findFirst', // ตรวจเบอร์ซ้ำ
      'tx.contact:code',
      'tx.findFirst', // หา stub ของ contact
      'tx.create',
    ]);
    expect(root.customer.findFirst).not.toHaveBeenCalled();
  });

  it('create: เบอร์ซ้ำ → 409 เดิม (message/field/existingCustomer) และไม่ไปถึง contact:code/เขียน', async () => {
    tx.customer.findFirst.mockImplementationOnce(async () => ({
      id: 'c-old',
      name: 'คนเดิม',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      _count: { contracts: 0 },
    }));
    const err = await service.create({ name: 'คนใหม่', phone: PHONE } as never).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({
      message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
      field: 'phone',
      existingCustomer: expect.objectContaining({ id: 'c-old', name: 'คนเดิม' }),
    });
    expect(contactResolver.findOrCreateByNaturalKey).not.toHaveBeenCalled();
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('create: ไม่มีเบอร์ → ไม่ล็อก แต่ยังตรวจอีเมลซ้ำบน tx', async () => {
    await service.create({ name: 'walk-in', email: 'A@x.com' } as never);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.customer.findFirst.mock.calls[0][0].where.email).toEqual({
      equals: 'a@x.com',
      mode: 'insensitive',
    });
  });

  it('update: ตั้งเบอร์ → ทรานแซกชันเดียว ล็อก → ตรวจซ้ำ (กันชนตัวเอง) → update', async () => {
    await service.update('c1', { phone: PHONE });
    expect(calls).toEqual(['root.$transaction', 'tx.lock', 'tx.findFirst', 'tx.update']);
    expect(lockKeyOf(tx)).toBe(LOCK_KEY);
    expect(tx.customer.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        phoneHash: hashPII(PHONE, SALT),
        deletedAt: null,
        id: { not: 'c1' },
      }),
    );
  });

  it('update: ไม่แตะเบอร์ → ทางเดิม ไม่มีทรานแซกชัน ไม่ล็อก', async () => {
    await service.update('c1', { name: 'ชื่อใหม่', email: 'b@x.com' } as never);
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(calls).toEqual(['root.findFirst', 'root.update']);
  });

  it('update: เบอร์ซ้ำ → 409 และไม่ update', async () => {
    tx.customer.findFirst.mockImplementationOnce(async () => ({
      id: 'c-old',
      name: 'คนเดิม',
      createdAt: new Date(),
      _count: { contracts: 1 },
    }));
    await expect(service.update('c1', { phone: PHONE })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  describe('fillPlaceholderContact', () => {
    const NID = '1103700012345';
    const actor = { id: 'staff-1', role: 'SALES' };

    beforeEach(() => {
      root.customer.findUnique.mockImplementation(async () => ({
        id: 'p1',
        name: 'placeholder',
        phone: null,
        nationalId: null,
        phoneHash: null,
        deletedAt: null,
        acquisitionSource: 'CHAT_FACEBOOK',
      }));
    });

    it('ล็อก → ตรวจเบอร์ → ตรวจเลขบัตร → update ในทรานแซกชันเดียว', async () => {
      await service.fillPlaceholderContact('p1', { phone: PHONE, nationalId: NID }, actor);
      // findUnique (อ่าน placeholder) ถูก mockImplementation ทับตัวบันทึก — อยู่นอกทรานแซกชัน
      expect(calls).toEqual([
        'root.$transaction',
        'tx.lock',
        'tx.findFirst',
        'tx.findFirst',
        'tx.update',
      ]);
      expect(tx.customer.findFirst.mock.calls[1][0].where).toEqual({
        nationalIdHash: hashPII(NID, SALT),
        id: { not: 'p1' },
      });
    });

    function p2002(target: unknown) {
      return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target },
      });
    }

    it('P2002 ที่คอลัมน์เลขบัตร → 409 เลขบัตรเดิม', async () => {
      root.$transaction.mockRejectedValueOnce(p2002(['national_id_hash']));
      const err = await service
        .fillPlaceholderContact('p1', { phone: PHONE, nationalId: NID }, actor)
        .catch((e) => e);
      expect(err.getResponse()).toEqual({
        message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
        field: 'nationalId',
      });
    });

    it('P2002 ที่คอลัมน์เบอร์ → 409 เบอร์ ไม่ใช่ "เลขบัตรซ้ำ"', async () => {
      root.$transaction.mockRejectedValueOnce(p2002(['phone_hash']));
      const err = await service
        .fillPlaceholderContact('p1', { phone: PHONE }, actor)
        .catch((e) => e);
      expect(err.getResponse()).toEqual({
        message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
        field: 'phone',
      });
    });
  });

  describe('uniqueClashToConflict', () => {
    const make = (meta: Record<string, unknown> | undefined) =>
      new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 't', meta });

    it.each([
      [['nationalIdHash'], 'nationalId'],
      ['customers_national_id_key', 'nationalId'],
      [['phoneHash'], 'phone'],
      ['customers_phone_hash_active_key', 'phone'],
    ])('target %p → field %p', (target, field) => {
      expect(
        (uniqueClashToConflict(make({ target })).getResponse() as { field: string }).field,
      ).toBe(field);
    });

    it('ไม่รู้ช่อง → ข้อความกลาง ไม่เดาว่าเป็นเลขบัตร', () => {
      const body = uniqueClashToConflict(make(undefined)).getResponse() as {
        message: string;
        field?: string;
      };
      expect(body.field).toBeUndefined();
      expect(body.message).not.toContain('เลขบัตร');
    });
  });
});
