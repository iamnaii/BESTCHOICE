import { Test } from '@nestjs/testing';
import { MigrationService } from './migration.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportContractDto, ImportCustomerDto } from './dto/import.dto';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { IMPORT_NATIONAL_ID_CONFLICT_MSG, IMPORT_PHONE_TAKEN_MSG } from './migration.service';

/**
 * #17 — importContracts must write Product + Contract + Payments atomically
 * per row, so a mid-row failure leaves no orphan Product / Contract / partial
 * schedule. These tests assert the writes go through a single $transaction
 * (the tx client), not this.prisma directly.
 */
describe('MigrationService.importContracts — per-row atomicity (#17)', () => {
  let service: MigrationService;
  let prisma: any;
  let txClient: any;

  const dto: ImportContractDto = {
    customerNationalId: '1234567890123',
    productName: 'iPhone 13',
    branchName: 'สาขาหลัก',
    salespersonEmail: 'sales@bestchoice.com',
    sellingPrice: 10000,
    downPayment: 1000,
    interestRate: 0.1,
    totalMonths: 12,
    status: 'ACTIVE',
  } as ImportContractDto;

  beforeEach(async () => {
    txClient = {
      product: { create: jest.fn().mockResolvedValue({ id: 'prod-1' }) },
      contract: {
        create: jest.fn().mockResolvedValue({ id: 'ct-1' }),
        findFirst: jest.fn().mockResolvedValue(null), // generateContractNumber lookup
      },
      payment: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 12 }),
      },
    };

    prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust-1' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'br-1' }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sales-1' }) },
      $transaction: jest.fn(async (cb: any) => cb(txClient)),
      // Direct (non-tx) write methods — these MUST NOT be used (would orphan).
      product: { create: jest.fn() },
      contract: { create: jest.fn(), findFirst: jest.fn() },
      payment: { create: jest.fn(), createMany: jest.fn() },
    };

    const mod = await Test.createTestingModule({
      providers: [
        MigrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerPiiService, useValue: {} },
      ],
    }).compile();
    service = mod.get(MigrationService);
  });

  it('commits a row through a single $transaction (writes use the tx client, not this.prisma)', async () => {
    const res = await service.importContracts([dto]);

    expect(res.success).toBe(1);
    expect(res.failed).toBe(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // All writes went through the tx client...
    expect(txClient.product.create).toHaveBeenCalledTimes(1);
    expect(txClient.contract.create).toHaveBeenCalledTimes(1);
    expect(txClient.payment.createMany).toHaveBeenCalledTimes(1); // no payments[] → auto-gen
    // ...never via the bare prisma client (which would not roll back).
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('rolls the whole row back (failed++, error captured) when a write inside the tx throws', async () => {
    txClient.contract.create.mockRejectedValueOnce(new Error('FK violation'));

    const res = await service.importContracts([dto]);

    expect(res.success).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0].message).toMatch(/FK violation/);
    // The product.create that preceded the failure was on the tx client, so a
    // real DB rolls it back — no orphan leaks via the bare prisma client.
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('uses one $transaction PER ROW (not a single tx around the whole import)', async () => {
    const res = await service.importContracts([dto, { ...dto }, { ...dto }]);
    expect(res.success).toBe(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });
});

/**
 * คำตัดสินเจ้าของ 2026-09-17 — นำเข้าลูกค้า: normalize เบอร์ · dual-write hash/เข้ารหัส ·
 * ต่อแถว ทรานแซกชันเดียว: ล็อกเบอร์ → เบอร์เป็นของคนอื่น = แถวนั้นล้ม (field phone) → ไม่งั้นแก้แถวเลขบัตรเดิม (plaintext หรือ hash) หรือสร้างใหม่
 */
describe('MigrationService.importCustomers — เบอร์หลัก', () => {
  let service: MigrationService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pii: any;
  let events: string[];

  // เลขบัตรที่ checksum ถูก
  const NID = '1101700230708';
  const base: ImportCustomerDto = {
    name: 'สมชาย นำเข้า',
    nationalId: NID,
    phone: '081-234 5678',
  } as ImportCustomerDto;

  beforeEach(async () => {
    events = [];
    tx = {
      $executeRaw: jest.fn(async () => {
        events.push('lock');
        return 0;
      }),
      customer: {
        findFirst: jest.fn(async () => {
          events.push('target');
          return null;
        }),
        findMany: jest.fn(async () => {
          events.push('owner-check');
          return [];
        }),
        create: jest.fn(async () => {
          events.push('create');
          return { id: 'new' };
        }),
        update: jest.fn(async () => {
          events.push('update');
          return { id: 'same-person' };
        }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (c: unknown) => unknown) => cb(tx)),
      customer: { upsert: jest.fn() },
    };
    pii = {
      hash: jest.fn((v: string | null | undefined) => (v ? `h:${v}` : null)),
      encryptCustomerFields: jest.fn((input: Record<string, string | undefined>) => {
        const out: Record<string, string | undefined> = {};
        if (input.nationalId !== undefined) {
          out.nationalIdEncrypted = `enc:${input.nationalId}`;
          out.nationalIdHash = `h:${input.nationalId}`;
        }
        if (input.phone !== undefined) {
          out.phoneEncrypted = `enc:${input.phone}`;
          out.phoneHash = `h:${input.phone}`;
        }
        if (input.phoneSecondary !== undefined) {
          out.phoneSecondaryEncrypted = input.phoneSecondary ? `enc:${input.phoneSecondary}` : '';
        }
        if (input.addressIdCard !== undefined) out.addressIdCardEncrypted = `enc:${input.addressIdCard}`;
        if (input.addressCurrent !== undefined) {
          out.addressCurrentEncrypted = `enc:${input.addressCurrent}`;
        }
        return out;
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        MigrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerPiiService, useValue: pii },
      ],
    }).compile();
    service = mod.get(MigrationService);
  });

  it('normalize เบอร์ + dual-write เฉพาะคอลัมน์ที่มี · ล็อกก่อนอ่าน · สร้างผ่าน tx', async () => {
    const res = await service.importCustomers([
      { ...base, phoneSecondary: '+66 82 000 0000', addressCurrent: 'บ้าน' },
    ]);

    expect(res).toEqual({ success: 1, failed: 0, errors: [] });
    expect(events).toEqual(['lock', 'target', 'owner-check', 'create']);
    expect(pii.encryptCustomerFields).toHaveBeenCalledWith({
      nationalId: NID,
      phone: '0812345678',
      phoneSecondary: '0820000000',
      addressIdCard: undefined,
      addressCurrent: 'บ้าน',
    });
    const data = tx.customer.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      nationalId: NID,
      phone: '0812345678',
      phoneHash: 'h:0812345678',
      phoneEncrypted: 'enc:0812345678',
      phoneSecondary: '0820000000',
      phoneSecondaryEncrypted: 'enc:0820000000',
      nationalIdHash: `h:${NID}`,
      nationalIdEncrypted: `enc:${NID}`,
      addressCurrent: 'บ้าน',
      addressCurrentEncrypted: 'enc:บ้าน',
    });
    expect(data.addressIdCardEncrypted).toBeUndefined();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(prisma.customer.upsert).not.toHaveBeenCalled();
  });

  it('หาแถวเป้าหมายด้วยเลขบัตร plaintext หรือ hash (ไม่กรอง deletedAt)', async () => {
    await service.importCustomers([base]);
    expect(tx.customer.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ nationalId: NID }, { nationalIdHash: `h:${NID}` }],
    });
  });

  it('คนเดิม (เจอด้วย hash) → update ตาม id ไม่แตะ plaintext เลขบัตร · ไม่แตะเบอร์สำรองเมื่อไม่ส่ง', async () => {
    tx.customer.findFirst.mockResolvedValueOnce({ id: 'same-person' });
    const res = await service.importCustomers([base]);
    expect(res.success).toBe(1);
    const args = tx.customer.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'same-person' });
    expect(args.data).toMatchObject({ phone: '0812345678', phoneHash: 'h:0812345678' });
    expect(args.data.nationalId).toBeUndefined();
    expect(args.data.phoneSecondary).toBeUndefined();
    expect(args.data.phoneSecondaryEncrypted).toBeUndefined();
    expect(tx.customer.create).not.toHaveBeenCalled();
  });

  it('ค้นเจ้าของเบอร์ด้วย phone/phoneHash ยกเว้นแถวเลขบัตรเดียวกัน', async () => {
    tx.customer.findFirst.mockResolvedValueOnce({ id: 'same-person' });
    await service.importCustomers([base]);
    expect(tx.customer.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      id: { notIn: ['same-person'] },
      OR: [{ phone: '0812345678' }, { phoneHash: 'h:0812345678' }],
    });
    expect(tx.customer.update).toHaveBeenCalledTimes(1);
  });

  it('เบอร์เป็นของลูกค้าคนอื่น → แถวนั้นล้ม (field phone) ไม่เขียน · แถวถัดไปยังทำต่อ', async () => {
    tx.customer.findMany.mockResolvedValueOnce([
      { id: 'someone-else', name: 'x', phone: '0812345678', phoneHash: 'h:0812345678' },
    ]);
    const res = await service.importCustomers([base, { ...base, phone: '0899999999' }]);

    expect(res.success).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors).toEqual([{ row: 1, field: 'phone', message: IMPORT_PHONE_TAKEN_MSG }]);
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
    expect(tx.customer.create.mock.calls[0][0].data.phone).toBe('0899999999');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('hash ค้าง (plaintext ของอีกแถวเป็นเบอร์อื่น) ไม่นับเป็นเจ้าของ → นำเข้าได้', async () => {
    tx.customer.findMany.mockResolvedValueOnce([
      { id: 'stale', name: 'x', phone: '0899999999', phoneHash: 'h:0812345678' },
    ]);
    const res = await service.importCustomers([base]);
    expect(res).toEqual({ success: 1, failed: 0, errors: [] });
    expect(tx.customer.create).toHaveBeenCalledTimes(1);
  });

  it('P2002 (เลขบัตรชนแถวที่ข้อมูลไม่ตรงกัน) → ข้อความไทย field nationalId', async () => {
    tx.customer.create.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    const res = await service.importCustomers([base]);
    expect(res.errors).toEqual([
      { row: 1, field: 'nationalId', message: IMPORT_NATIONAL_ID_CONFLICT_MSG },
    ]);
  });

  it('เบอร์ที่ normalize แล้วว่าง → เบอร์โทรห้ามว่าง ไม่เปิดทรานแซกชัน', async () => {
    const res = await service.importCustomers([{ ...base, phone: ' - ' }]);
    expect(res.errors).toEqual([{ row: 1, field: 'phone', message: 'เบอร์โทรห้ามว่าง' }]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('เข้ารหัสไม่ได้ (ไม่มีกุญแจ) → แถวนั้นล้มพร้อมข้อความ ไม่เขียน plaintext', async () => {
    pii.encryptCustomerFields.mockImplementationOnce(() => {
      throw new Error('PII_ENCRYPTION_KEY missing or too short');
    });
    const res = await service.importCustomers([base]);
    expect(res.failed).toBe(1);
    expect(res.errors[0].message).toMatch(/PII_ENCRYPTION_KEY/);
    expect(tx.customer.create).not.toHaveBeenCalled();
  });
});
