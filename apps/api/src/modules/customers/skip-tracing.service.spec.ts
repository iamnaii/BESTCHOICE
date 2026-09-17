import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SkipTracingService } from './skip-tracing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerPiiService } from './customer-pii.service';
import { sanitizeAuditValue } from '../audit/audit-sanitize.util';

describe('SkipTracingService', () => {
  let service: SkipTracingService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let audit: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pii: any;
  /** ลำดับเหตุการณ์ข้ามทรานแซกชัน — ใช้พิสูจน์ว่าล็อกมาก่อน และ audit มาหลัง commit */
  let events: string[];

  const existingCustomer = {
    id: 'cust-1',
    phone: '0810000000',
    phoneHash: 'h:0810000000',
    phoneEncrypted: 'enc:0810000000',
    phoneSecondary: 'old-secondary',
    lineIdFinance: 'old-line',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    events = [];
    tx = {
      $executeRaw: jest.fn().mockImplementation(async () => {
        events.push('lock');
        return 0;
      }),
      customer: {
        findFirst: jest.fn().mockImplementation(async () => {
          events.push('read');
          return existingCustomer;
        }),
        findMany: jest.fn().mockImplementation(async () => {
          events.push('owner-check');
          return [];
        }),
        update: jest.fn().mockImplementation(async ({ data }) => {
          events.push('update');
          const plain = { ...data };
          delete plain.phoneHash;
          delete plain.phoneEncrypted;
          delete plain.phoneSecondaryEncrypted;
          return { ...existingCustomer, ...plain };
        }),
      },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation(async (fn: (c: unknown) => unknown) => {
        events.push('tx-begin');
        const r = await fn(tx);
        events.push('tx-commit');
        return r;
      }),
    };
    audit = {
      log: jest.fn().mockImplementation(async () => {
        events.push('audit');
      }),
    };
    pii = {
      hash: jest.fn((v: string | null | undefined) => (v ? `h:${v}` : null)),
      encryptCustomerFields: jest.fn((input: { phone?: string; phoneSecondary?: string }) => ({
        ...(input.phone !== undefined
          ? { phoneEncrypted: `enc:${input.phone}`, phoneHash: `h:${input.phone}` }
          : {}),
        ...(input.phoneSecondary !== undefined
          ? { phoneSecondaryEncrypted: `enc:${input.phoneSecondary}` }
          : {}),
      })),
    };

    const mod = await Test.createTestingModule({
      providers: [
        SkipTracingService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: CustomerPiiService, useValue: pii },
      ],
    }).compile();
    service = mod.get(SkipTracingService);
  });

  describe('เบอร์ใหม่ที่ไม่มีเจ้าของอื่น → เบอร์หลัก', () => {
    it('เขียน phone + phoneHash + phoneEncrypted (แก้ hash ค้าง) และ audit หลัง commit', async () => {
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '0820000000', reason: 'ญาติให้เบอร์ใหม่' },
        { userId: 'user-1', ipAddress: '127.0.0.1' },
      );

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: {
          phone: '0820000000',
          phoneHash: 'h:0820000000',
          phoneEncrypted: 'enc:0820000000',
        },
        select: expect.any(Object),
      });
      expect(result.phone).toBe('0820000000');
      expect(result.phoneStoredAs).toBe('PRIMARY');
      expect(result.phoneOwner).toBeNull();

      // ล็อกเป็นคำสั่งแรกของทรานแซกชัน · audit หลัง commit
      expect(events).toEqual(['tx-begin', 'lock', 'read', 'owner-check', 'update', 'tx-commit', 'audit']);

      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = audit.log.mock.calls[0][0];
      expect(entry.action).toBe('SKIP_TRACING_UPDATE');
      expect(entry.entity).toBe('customer');
      expect(entry.entityId).toBe('cust-1');
      expect(entry.oldValue.phone).toBe('0810000000');
      expect(entry.oldValue.phoneSecondary).toBe('old-secondary');
      expect(entry.newValue.phone).toBe('0820000000');
      expect(entry.newValue.phoneSecondary).toBe('old-secondary');
      expect(entry.newValue.phoneStoredAs).toBe('PRIMARY');
      expect(entry.newValue.phoneOwnerId).toBeNull();
      expect(entry.newValue.reason).toBe('ญาติให้เบอร์ใหม่');
    });

    it('ค้นเจ้าของอื่นด้วย phone หรือ phoneHash และไม่นับตัวเอง', async () => {
      await service.updateContact(
        'cust-1',
        { newPhone: '0820000000', reason: 'x-x-x' },
        { userId: 'u' },
      );
      const where = tx.customer.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
      expect(where.id).toEqual({ notIn: ['cust-1'] });
      expect(where.OR).toEqual([{ phone: '0820000000' }, { phoneHash: 'h:0820000000' }]);
    });

    it('normalize เบอร์รูปแบบอื่นก่อนล็อก/ค้น/เขียน', async () => {
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '+66 82-000-0000', reason: 'x-x-x' },
        { userId: 'u' },
      );
      expect(result.phone).toBe('0820000000');
      expect(tx.customer.update.mock.calls[0][0].data.phone).toBe('0820000000');
    });

    it('แถวที่ hash ค้างชี้เบอร์นี้แต่ plaintext เป็นเบอร์อื่น ไม่นับเป็นเจ้าของ', async () => {
      tx.customer.findMany.mockResolvedValueOnce([
        { id: 'stale', name: 'คนเก่า', phone: '0899999999', phoneHash: 'h:0820000000' },
      ]);
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '0820000000', reason: 'x-x-x' },
        { userId: 'u' },
      );
      expect(result.phoneStoredAs).toBe('PRIMARY');
      expect(result.phoneOwner).toBeNull();
    });
  });

  describe('เบอร์ใหม่เป็นของลูกค้าคนอื่น → เบอร์สำรอง', () => {
    it('ไม่แตะเบอร์หลัก เขียน phoneSecondary + encrypted และบอกชื่อเจ้าของ', async () => {
      tx.customer.findMany.mockResolvedValueOnce([
        { id: 'cust-2', name: 'สมชาย ใจดี', phone: '0820000000', phoneHash: 'h:0820000000' },
      ]);
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '0820000000', reason: 'เบอร์ภรรยา' },
        { userId: 'user-1' },
      );

      expect(tx.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: {
          phoneSecondary: '0820000000',
          phoneSecondaryEncrypted: 'enc:0820000000',
        },
        select: expect.any(Object),
      });
      expect(result.phone).toBe('0810000000');
      expect(result.phoneSecondary).toBe('0820000000');
      expect(result.phoneStoredAs).toBe('SECONDARY');
      expect(result.phoneOwner).toEqual({ id: 'cust-2', name: 'สมชาย ใจดี' });

      const entry = audit.log.mock.calls[0][0];
      expect(entry.oldValue.phoneSecondary).toBe('old-secondary');
      expect(entry.newValue.phoneSecondary).toBe('0820000000');
      expect(entry.newValue.phone).toBe('0810000000');
      expect(entry.newValue.phoneStoredAs).toBe('SECONDARY');
      expect(entry.newValue.phoneOwnerId).toBe('cust-2');
      // ชื่อเจ้าของไม่ลง audit (id อย่างเดียว)
      expect(JSON.stringify(entry.newValue)).not.toContain('สมชาย');
      expect(events.indexOf('audit')).toBeGreaterThan(events.indexOf('tx-commit'));
    });

    it('แถวสตริกต์โหมด (plaintext ว่าง) ที่ hash ตรง นับเป็นเจ้าของ', async () => {
      tx.customer.findMany.mockResolvedValueOnce([
        { id: 'cust-3', name: 'ลูกค้าเข้ารหัส', phone: '', phoneHash: 'h:0820000000' },
      ]);
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '0820000000', reason: 'x-x-x' },
        { userId: 'u' },
      );
      expect(result.phoneStoredAs).toBe('SECONDARY');
      expect(result.phoneOwner).toEqual({ id: 'cust-3', name: 'ลูกค้าเข้ารหัส' });
    });
  });

  describe('เบอร์ใหม่ตรงกับเบอร์หลักเดิม', () => {
    it('ไม่เปลี่ยนเบอร์ และไม่ค้นเจ้าของ', async () => {
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '081-000-0000', reason: 'ยืนยันเบอร์เดิม' },
        { userId: 'u' },
      );
      expect(tx.customer.findMany).not.toHaveBeenCalled();
      expect(tx.customer.update.mock.calls[0][0].data).toEqual({});
      expect(result.phone).toBe('0810000000');
      expect(result.phoneStoredAs).toBeNull();
      expect(result.phoneOwner).toBeNull();
      const entry = audit.log.mock.calls[0][0];
      expect(entry.newValue.phoneStoredAs).toBeNull();
    });

    it('แถวเสียจากบั๊กเดิม (hash ค้าง) → ซ่อม phone/phoneHash/phoneEncrypted แต่ phoneStoredAs ยัง null', async () => {
      tx.customer.findFirst.mockResolvedValueOnce({
        ...existingCustomer,
        phoneHash: 'h:0899999999',
      });
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '0810000000', reason: 'ยืนยันเบอร์เดิม' },
        { userId: 'u' },
      );
      expect(tx.customer.findMany).not.toHaveBeenCalled();
      expect(tx.customer.update.mock.calls[0][0].data).toEqual({
        phone: '0810000000',
        phoneHash: 'h:0810000000',
        phoneEncrypted: 'enc:0810000000',
      });
      expect(result.phoneStoredAs).toBeNull();
    });

    it('ไม่มี ciphertext หรือ plaintext ยังไม่ normalize → ซ่อมด้วย', async () => {
      tx.customer.findFirst.mockResolvedValueOnce({
        ...existingCustomer,
        phone: '081-000-0000',
        phoneEncrypted: null,
      });
      await service.updateContact('cust-1', { newPhone: '0810000000', reason: 'x-x-x' }, { userId: 'u' });
      expect(tx.customer.update.mock.calls[0][0].data).toEqual({
        phone: '0810000000',
        phoneHash: 'h:0810000000',
        phoneEncrypted: 'enc:0810000000',
      });
    });

    it('สตริกต์โหมด (plaintext ว่าง) hash ตรง → ไม่เขียนเบอร์ ไม่ค้นเจ้าของ', async () => {
      tx.customer.findFirst.mockResolvedValueOnce({ ...existingCustomer, phone: '' });
      const result = await service.updateContact(
        'cust-1',
        { newPhone: '0810000000', reason: 'x-x-x' },
        { userId: 'u' },
      );
      expect(tx.customer.findMany).not.toHaveBeenCalled();
      expect(tx.customer.update.mock.calls[0][0].data).toEqual({});
      expect(result.phoneStoredAs).toBeNull();
    });
  });

  it('เบอร์ของคนอื่น + LINE ID ใหม่ในครั้งเดียว → เบอร์สำรอง และ LINE ID ถูกบันทึกด้วย', async () => {
    tx.customer.findMany.mockResolvedValueOnce([
      { id: 'cust-2', name: 'สมชาย', phone: '0820000000', phoneHash: 'h:0820000000' },
    ]);
    const result = await service.updateContact(
      'cust-1',
      { newPhone: '0820000000', newLineId: 'new-line', reason: 'x-x-x' },
      { userId: 'u' },
    );
    expect(tx.customer.update.mock.calls[0][0].data).toEqual({
      phoneSecondary: '0820000000',
      phoneSecondaryEncrypted: 'enc:0820000000',
      lineIdFinance: 'new-line',
    });
    expect(result.phoneStoredAs).toBe('SECONDARY');
    expect(result.lineIdFinance).toBe('new-line');
  });

  it('payload audit ผ่าน sanitizer จริง → เบอร์หลัก/เบอร์สำรองถูกปิด แต่ phoneStoredAs/phoneOwnerId ยังอ่านได้', async () => {
    tx.customer.findMany.mockResolvedValueOnce([
      { id: 'cust-2', name: 'สมชาย', phone: '0820000000', phoneHash: 'h:0820000000' },
    ]);
    await service.updateContact('cust-1', { newPhone: '0820000000', reason: 'x-x-x' }, { userId: 'u' });
    const entry = audit.log.mock.calls[0][0];
    const oldValue = sanitizeAuditValue(entry.oldValue) as Record<string, unknown>;
    const newValue = sanitizeAuditValue(entry.newValue) as Record<string, unknown>;
    expect(oldValue.phone).toBe('[REDACTED]');
    expect(oldValue.phoneSecondary).toBe('[REDACTED]');
    expect(newValue.phone).toBe('[REDACTED]');
    expect(newValue.phoneSecondary).toBe('[REDACTED]');
    expect(newValue.phoneStoredAs).toBe('SECONDARY');
    expect(newValue.phoneOwnerId).toBe('cust-2');
    const body = sanitizeAuditValue({ newPhone: '0820000000', newLineId: 'x' }) as Record<string, unknown>;
    expect(body).toEqual({ newPhone: '[REDACTED]', newLineId: '[REDACTED]' });
  });

  it('เบอร์ที่ normalize แล้วไม่ใช่ 10 หลักขึ้นต้น 0 → 400 ไม่เปิดทรานแซกชัน', async () => {
    await expect(
      service.updateContact('cust-1', { newPhone: '12345', reason: 'x-x-x' }, { userId: 'u' }),
    ).rejects.toThrow('เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('updates LINE ID without touching phone (ไม่ล็อกเบอร์)', async () => {
    const result = await service.updateContact(
      'cust-1',
      { newLineId: 'new-line-id', reason: 'เจอใน Facebook' },
      { userId: 'user-1' },
    );

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { lineIdFinance: 'new-line-id' },
      select: expect.any(Object),
    });
    expect(result.lineIdFinance).toBe('new-line-id');
    expect(result.phone).toBe('0810000000');
    expect(result.phoneStoredAs).toBeNull();

    const entry = audit.log.mock.calls[0][0];
    expect(entry.oldValue.lineIdFinance).toBe('old-line');
    expect(entry.newValue.lineIdFinance).toBe('new-line-id');
  });

  it('marks customer as LOST and writes audit', async () => {
    const result = await service.updateContact(
      'cust-1',
      { markAsLost: true, reason: 'หาทุกช่องทางแล้วไม่เจอ' },
      { userId: 'user-1' },
    );

    expect(tx.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: { status: 'LOST' },
      select: expect.any(Object),
    });
    expect(result.status).toBe('LOST');

    const entry = audit.log.mock.calls[0][0];
    expect(entry.oldValue.status).toBe('ACTIVE');
    expect(entry.newValue.status).toBe('LOST');
    expect(entry.newValue.reason).toBe('หาทุกช่องทางแล้วไม่เจอ');
  });

  it('throws BadRequest when no field is provided', async () => {
    await expect(
      service.updateContact('cust-1', { reason: 'ทดสอบ' }, { userId: 'u' }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('throws NotFound when customer is missing or soft-deleted (ไม่เขียน audit)', async () => {
    tx.customer.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.updateContact(
        'missing',
        { newPhone: '0820000000', reason: 'x' },
        { userId: 'u' },
      ),
    ).rejects.toThrow(NotFoundException);
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
