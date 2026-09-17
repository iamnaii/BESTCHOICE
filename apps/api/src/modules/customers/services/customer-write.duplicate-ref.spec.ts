import { ConflictException } from '@nestjs/common';
import { CustomerWriteService } from './customer-write.service';
import { BOUGHT_WHERE } from './customer-query.service';

/**
 * A7 (mockup บอร์ด 4) — 409 ข้อมูลซ้ำต้องบอก "คนเดิม" พอให้พนักงานตัดสินใจ: ชื่อ · เป็นลูกค้าตั้งแต่เมื่อไร ·
 * ผ่อนอยู่กี่สัญญา (สถานะชุดเดียวกับ assertCustomerContractPolicy / search) — **ห้ามมีเบอร์หรือเลขบัตรของคนเดิม**
 * (คนที่พิมพ์ข้อมูลซ้ำอาจไม่ใช่เจ้าของข้อมูลนั้น) · ตัวเลขจริงจาก Postgres ปักไว้ที่
 * customer-write.fill-contact.db.spec.ts — ไฟล์นี้ปักรูป select + รูป payload ของทั้งสามช่องทาง
 */
describe('CustomerWriteService — existingCustomer ใน 409 ข้อมูลซ้ำ (A7)', () => {
  const PHONE = '0812345678';
  const NID = '1103700012345';
  const OPEN_CONTRACTS_COUNT_SELECT = {
    select: { contracts: { where: { deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } } } },
  };
  const REF_SELECT = { id: true, name: true, createdAt: true, _count: OPEN_CONTRACTS_COUNT_SELECT };
  const existingRow = {
    id: 'c-old',
    name: 'สมชาย ใจดี',
    createdAt: new Date('2026-09-03T02:15:00.000Z'),
    _count: { contracts: 1 },
  };
  // M-A3: purchased = ตรง BOUGHT_WHERE (นิยามเดียวกับแท็บลูกค้า view=customers) — beforeEach ให้ count = 1 (ซื้อแล้ว)
  const expectedRef = {
    id: 'c-old',
    name: 'สมชาย ใจดี',
    createdAt: '2026-09-03T02:15:00.000Z',
    activeContracts: 1,
    purchased: true,
  };

  let prevSalt: string | undefined;
  let prevKey: string | undefined;
  let prisma: {
    customer: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock; create: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let service: CustomerWriteService;

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    prevKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_HASH_SALT = 'duplicate-ref-spec-salt-0123456789';
    delete process.env.PII_ENCRYPTION_KEY;
  });

  afterAll(() => {
    if (prevSalt === undefined) delete process.env.PII_HASH_SALT;
    else process.env.PII_HASH_SALT = prevSalt;
    if (prevKey !== undefined) process.env.PII_ENCRYPTION_KEY = prevKey;
  });

  beforeEach(() => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      // ตรวจซ้ำเบอร์/อีเมลวิ่งในทรานแซกชันที่ถือล็อกเบอร์ — tx = mock ตัวเดียวกัน
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    service = new CustomerWriteService(prisma as never, {} as never, {} as never);
  });

  async function conflictOf(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
    let error: unknown;
    try {
      await run();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse() as Record<string, unknown>;
  }

  it('เบอร์ซ้ำตอนสร้าง → existingCustomer = {id, name, createdAt ISO, activeContracts} ไม่มีเบอร์/เลขบัตรของคนเดิม', async () => {
    prisma.customer.findFirst.mockResolvedValue({ ...existingRow });
    const body = await conflictOf(() => service.create({ name: 'คนใหม่', phone: PHONE } as never));
    expect(body).toEqual({ message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', existingCustomer: expectedRef, field: 'phone' });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ phoneHash: expect.any(String) }), select: REF_SELECT }),
    );
    const json = JSON.stringify(body);
    expect(json).not.toContain(PHONE);
  });

  it('purchased ใช้ BOUGHT_WHERE ตัวเดียวกับแท็บลูกค้า (ไม่มีสูตรที่สอง) · นับเฉพาะคนเดิมคนนั้น', async () => {
    prisma.customer.findFirst.mockResolvedValue({ ...existingRow });
    await conflictOf(() => service.create({ name: 'คนใหม่', phone: PHONE } as never));
    expect(prisma.customer.count).toHaveBeenCalledTimes(1);
    const where = prisma.customer.count.mock.calls[0][0].where;
    expect(where).toEqual({ AND: [{ id: 'c-old' }, BOUGHT_WHERE] });
    expect(where.AND[1]).toBe(BOUGHT_WHERE);
  });

  it('คนเดิมมีเบอร์แต่ยังไม่เคยซื้อ (ผู้สนใจ) → purchased: false', async () => {
    prisma.customer.findFirst.mockResolvedValue({ ...existingRow, _count: { contracts: 0 } });
    prisma.customer.count.mockResolvedValue(0);
    const body = await conflictOf(() => service.create({ name: 'คนใหม่', phone: PHONE } as never));
    expect(body.existingCustomer).toEqual({ ...expectedRef, activeContracts: 0, purchased: false });
  });

  it('ไม่ชนข้อมูลซ้ำ → ไม่ยิงคำถาม purchased เลย', async () => {
    prisma.customer.create.mockResolvedValue({ id: 'c-new' });
    const withTx = { ...prisma, $transaction: jest.fn(async (cb: (t: typeof prisma) => unknown) => cb(prisma)) };
    const contactResolver = { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-1' }) };
    const creating = new CustomerWriteService(withTx as never, contactResolver as never, {} as never);
    await creating.create({ name: 'คนใหม่', phone: PHONE } as never);
    expect(prisma.customer.count).not.toHaveBeenCalled();
  });

  it('อีเมลซ้ำ → existingCustomer รูปเดียวกัน', async () => {
    prisma.customer.findFirst.mockImplementation(async (args: { where: { email?: unknown } }) =>
      args.where.email ? { ...existingRow, _count: { contracts: 0 } } : null,
    );
    const body = await conflictOf(() => service.create({ name: 'คนใหม่', phone: PHONE, email: 'Old@Example.com' } as never));
    expect(body).toEqual({
      message: 'ลูกค้าที่มีอีเมลนี้มีอยู่แล้ว',
      existingCustomer: { ...expectedRef, activeContracts: 0 },
      field: 'email',
    });
    expect(prisma.customer.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ select: REF_SELECT }));
  });

  it('เลขบัตรซ้ำตอนสร้าง (findUnique ด้วย nationalIdHash) → existingCustomer รูปเดียวกัน ไม่มีเลขบัตร', async () => {
    prisma.customer.findUnique.mockResolvedValue({ ...existingRow, deletedAt: null });
    const body = await conflictOf(() =>
      service.create({ name: 'คนใหม่', nationalId: NID, isForeigner: true, phone: PHONE } as never),
    );
    expect(body).toEqual({ message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว', existingCustomer: expectedRef, field: 'nationalId' });
    // create() ยังเป็น findUnique บน nationalIdHash (คง call shape) — เพิ่มแค่ select ที่ต้องใช้ (deletedAt ไว้ตัดสิน revive)
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { nationalIdHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      select: { ...REF_SELECT, deletedAt: true },
    });
    expect(JSON.stringify(body)).not.toContain(NID);
  });

  it('เลขบัตรซ้ำตอนเติมเบอร์ผู้สนใจ (findFirst กันชนตัวเอง) → existingCustomer รูปเดียวกัน', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'p1', name: 'Facebook #1234', acquisitionSource: 'CHAT_FACEBOOK', phone: null, nationalId: null, deletedAt: null,
    });
    prisma.customer.findFirst.mockImplementation(async (args: { where: { nationalIdHash?: string } }) =>
      args.where.nationalIdHash ? { ...existingRow, deletedAt: null } : null,
    );
    const body = await conflictOf(() =>
      service.fillPlaceholderContact('p1', { phone: PHONE, nationalId: NID }, { id: 'staff-1', role: 'SALES' }),
    );
    expect(body).toEqual({ message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว', existingCustomer: expectedRef, field: 'nationalId' });
    expect(prisma.customer.findFirst).toHaveBeenLastCalledWith({
      where: { nationalIdHash: expect.any(String), id: { not: 'p1' } },
      select: { ...REF_SELECT, deletedAt: true },
    });
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('แถวที่เจอถูก soft-delete (ghost) → create() ไม่ 409 แต่ revive ตามเดิม', async () => {
    prisma.customer.findUnique.mockResolvedValue({ ...existingRow, deletedAt: new Date('2026-09-01') });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      customer: {
        update: jest.fn().mockResolvedValue({ id: 'c-old' }),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const withTx = {
      ...prisma,
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const contactResolver = { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-1' }) };
    const reviving = new CustomerWriteService(withTx as never, contactResolver as never, {} as never);
    await reviving.create({ name: 'คนเดิมกลับมา', nationalId: NID, isForeigner: true, phone: PHONE } as never);
    expect(tx.customer.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c-old' } }));
    expect(tx.customer.create).not.toHaveBeenCalled();
  });
});
