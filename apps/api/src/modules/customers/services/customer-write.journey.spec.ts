import { ConflictException } from '@nestjs/common';
import { CustomerWriteService } from './customer-write.service';

/** CONTACT_ADDED — เบอร์/เลขบัตรจากว่าง → มีค่า (writer mocked) · ห้ามมีเบอร์หรือเลขบัตรในแถวที่ส่งให้ writer */
describe('CustomerWriteService → CONTACT_ADDED', () => {
  const PHONE = '0812345678';
  const NID = '1103700012345';
  let prevSalt: string | undefined;
  let prevKey: string | undefined;
  let prisma: { customer: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock } };
  let query: { findOne: jest.Mock };
  let audit: { log: jest.Mock };
  let journey: { recordAfterCommit: jest.Mock };
  let service: CustomerWriteService;

  beforeAll(() => {
    prevSalt = process.env.PII_HASH_SALT;
    prevKey = process.env.PII_ENCRYPTION_KEY;
    process.env.PII_HASH_SALT = 'journey-contact-spec-salt-0123456789';
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
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest
          .fn()
          .mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id, name: 'สมชาย ใจดี', phone: PHONE })),
      },
    };
    query = { findOne: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    service = new CustomerWriteService(prisma as any, {} as any, query as any, undefined, audit as any, journey as any);
  });

  describe('update (PATCH /customers/:id)', () => {
    it('ยังไม่มีเบอร์ → ใส่เบอร์ → CONTACT_ADDED {fields:[phone], via: UPDATE} ผู้ทำ = actor · ไม่มีเบอร์ในแถว', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      await service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      const entry = journey.recordAfterCommit.mock.calls[0][0];
      expect(entry).toEqual({
        customerId: 'c1',
        kind: 'CONTACT_ADDED',
        occurredAt: expect.any(Date),
        actorType: 'STAFF',
        actorUserId: 'u-owner',
        roomId: null,
        refType: null,
        refId: null,
        data: { fields: ['phone'], via: 'UPDATE' },
        dedupeKey: 'CONTACT_ADDED:c1:phone',
      });
      expect(JSON.stringify(entry)).not.toContain(PHONE);
    });

    it('แถวเดิมเก็บเบอร์เป็น "" → นับว่ายังไม่มีเบอร์', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: '' });
      await service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    });

    it('มีเบอร์อยู่แล้ว → เปลี่ยนเบอร์ไม่นับเป็นได้เบอร์ใหม่', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: '0899999999' });
      await service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('แก้ช่องอื่นที่ไม่ใช่เบอร์ → ไม่บันทึก', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      await service.update('c1', { name: 'ชื่อใหม่' }, { id: 'u-owner', role: 'OWNER' });
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });

    it('ไม่มี actor → actorUserId null', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      await service.update('c1', { phone: PHONE });
      expect(journey.recordAfterCommit.mock.calls[0][0].actorUserId).toBeNull();
    });

    it('update ล้ม → ไม่บันทึก และโยนต่อ', async () => {
      query.findOne.mockResolvedValue({ id: 'c1', phone: null });
      prisma.customer.update.mockRejectedValue(new Error('db down'));
      await expect(service.update('c1', { phone: PHONE }, { id: 'u-owner', role: 'OWNER' })).rejects.toThrow('db down');
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });
  });

  describe('fillPlaceholderContact', () => {
    const placeholderRow = {
      id: 'p1',
      name: 'Facebook #1234',
      acquisitionSource: 'CHAT_FACEBOOK',
      phone: null,
      nationalId: null,
      deletedAt: null,
    };

    it('เติมเบอร์ → CONTACT_ADDED {fields:[phone], via: FILL_CONTACT} ผู้ทำ = พนักงาน', async () => {
      prisma.customer.findUnique.mockResolvedValue(placeholderRow);
      await service.fillPlaceholderContact('p1', { phone: PHONE }, { id: 'staff-1', role: 'SALES' });
      expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
      expect(journey.recordAfterCommit.mock.calls[0][0]).toMatchObject({
        customerId: 'p1',
        kind: 'CONTACT_ADDED',
        actorType: 'STAFF',
        actorUserId: 'staff-1',
        data: { fields: ['phone'], via: 'FILL_CONTACT' },
        dedupeKey: 'CONTACT_ADDED:p1:phone',
      });
    });

    it('เติมเบอร์ + เลขบัตร → fields [nationalId, phone] · ไม่มีเบอร์และเลขบัตรในแถว', async () => {
      prisma.customer.findUnique.mockResolvedValue(placeholderRow);
      await service.fillPlaceholderContact('p1', { phone: PHONE, nationalId: NID }, { id: 'staff-1', role: 'SALES' });
      const entry = journey.recordAfterCommit.mock.calls[0][0];
      expect(entry.data).toEqual({ fields: ['nationalId', 'phone'], via: 'FILL_CONTACT' });
      expect(entry.dedupeKey).toBe('CONTACT_ADDED:p1:nationalId+phone');
      const json = JSON.stringify(entry);
      expect(json).not.toContain(PHONE);
      expect(json).not.toContain(NID);
    });

    it('เบอร์ซ้ำ (409) → ไม่บันทึก', async () => {
      prisma.customer.findUnique.mockResolvedValue(placeholderRow);
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 'other', name: 'ลูกค้าเดิม' });
      await expect(
        service.fillPlaceholderContact('p1', { phone: PHONE }, { id: 'staff-1', role: 'SALES' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(journey.recordAfterCommit).not.toHaveBeenCalled();
    });
  });
});
