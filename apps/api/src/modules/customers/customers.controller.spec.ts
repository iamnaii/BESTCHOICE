import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import { SkipTracingService } from './skip-tracing.service';
import { CustomerInsightsService } from '../overdue/customer-insights.service';
import { PiiAuditService } from '../pii/pii-audit.service';
import { CustomerMergeService } from '../chat-prospects/customer-merge.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';

describe('CustomersController PII (Phase 5)', () => {
  let controller: CustomersController;
  let service: { findOne: jest.Mock; findDetail: jest.Mock; findAll: jest.Mock; search: jest.Mock; fillPlaceholderContact: jest.Mock; update: jest.Mock };
  let piiAudit: { logDecryption: jest.Mock };
  let tierService: CustomerTierService;
  let merge: { absorbPlaceholder: jest.Mock; assertActorMayAbsorb: jest.Mock };

  beforeEach(async () => {
    service = {
      findOne: jest.fn(),
      findDetail: jest.fn(),
      findAll: jest.fn(),
      search: jest.fn(),
      fillPlaceholderContact: jest.fn(),
      update: jest.fn(),
    };
    piiAudit = { logDecryption: jest.fn().mockResolvedValue(undefined) };
    merge = {
      absorbPlaceholder: jest
        .fn()
        .mockResolvedValue({ placeholderId: 'p1', targetId: 't1', movedRooms: 1, movedCreditChecks: 0 }),
      assertActorMayAbsorb: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        { provide: CustomersService, useValue: service },
        { provide: PiiAuditService, useValue: piiAudit },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        { provide: SkipTracingService, useValue: {} },
        { provide: CustomerInsightsService, useValue: {} },
        { provide: CustomerMergeService, useValue: merge },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CustomersController);
    tierService = module.get(CustomerTierService);
  });

  const reqOf = (role: string) =>
    ({
      user: { id: 'u1', role },
      ip: '1.2.3.4',
      headers: { 'user-agent': 'jest' },
    }) as any;

  it('masks nationalId for SALES role on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123', phone: '0812345678' });
    const result = await controller.findOne('c1', reqOf('SALES'));
    expect((result as any).nationalId).toBe('12345-XXXXX-XX-3');
    expect((result as any).phone).toBe('0812345678'); // not masked per Q1 matrix
  });

  // A8 — ช่องค้นหา "ผูกกับลูกค้าเดิม" โชว์ "จากแชท · ยังไม่มีเบอร์" จากธงนี้ · mask ของ SALES ต้องไม่ตัดธงทิ้ง
  it('search: SALES เห็นเลขบัตรแบบ mask แต่ chatPlaceholder ยังอยู่ครบทุกแถว', async () => {
    service.search.mockResolvedValue([
      { id: 'p1', name: 'Facebook #1234', phone: null, nationalId: null, chatPlaceholder: true },
      { id: 'c1', name: 'สมชาย', phone: '0812345678', nationalId: '1234567890123', chatPlaceholder: false },
    ]);
    const result = await controller.search('ส', reqOf('SALES'));
    expect(result).toEqual([
      { id: 'p1', name: 'Facebook #1234', phone: null, nationalId: null, chatPlaceholder: true },
      { id: 'c1', name: 'สมชาย', phone: '0812345678', nationalId: '12345-XXXXX-XX-3', chatPlaceholder: false },
    ]);
  });

  it('returns full nationalId for OWNER on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    const result = await controller.findOne('c1', reqOf('OWNER'));
    expect((result as any).nationalId).toBe('1234567890123');
  });

  it('logs PII_DECRYPT_MASKED for SALES on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    await controller.findOne('c1', reqOf('SALES'));
    // Wait microtask for void this.piiAudit.logDecryption to fire
    await new Promise((r) => setImmediate(r));
    expect(piiAudit.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ masked: true, role: 'SALES', userId: 'u1' }),
    );
  });

  it('logs PII_DECRYPT_FULL for OWNER on findOne', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    await controller.findOne('c1', reqOf('OWNER'));
    await new Promise((r) => setImmediate(r));
    expect(piiAudit.logDecryption).toHaveBeenCalledWith(
      expect.objectContaining({ masked: false, role: 'OWNER' }),
    );
  });

  it('masks list response for SALES on findAll', async () => {
    service.findAll.mockResolvedValue({
      data: [
        { id: 'c1', nationalId: '1234567890123', phone: '0812345678' },
        { id: 'c2', nationalId: '1234567890124', phone: '0823456789' },
      ],
      total: 2,
      page: 1,
      limit: 50,
    });
    // ตัวกรองเป็น DTO ก้อนเดียว → req เป็นพารามิเตอร์ที่ 2 เสมอ
    // (เวอร์ชันเดิมมี undefined 10 ตัวคั่น ถ้า @Query เปลี่ยนจำนวน req จะเลื่อนตำแหน่ง
    //  role กลายเป็น 'UNKNOWN' แล้วการปิดเลขบัตรหยุดทำงานแบบเทสยังเขียว)
    const result = await controller.findAll({ page: 1, limit: 50 } as any, reqOf('SALES'));
    expect((result.data[0] as any).nationalId).toBe('12345-XXXXX-XX-3');
    expect((result.data[1] as any).nationalId).toBe('12345-XXXXX-XX-4');
    expect((result.data[0] as any).phone).toBe('0812345678');
  });


  it('ส่ง filters ทั้งก้อนต่อให้ service — ตัวกรองใหม่ต้องไม่หายระหว่างทาง', async () => {
    service.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    const filters = {
      page: 1, limit: 50, view: 'prospects', search: 'ก', source: 'FACEBOOK',
      contacted: '7d', tag: 'VIP,LOYAL', owner: 'unassigned', precheck: 'FULL_CHECK_PASSED',
    } as any;
    await controller.findAll(filters, reqOf('OWNER'));
    expect(service.findAll).toHaveBeenCalledWith(filters);
  });

  it('export ใช้ตัวกรองชุดเดียวกับตาราง (ตาราง/Excel ต้องไม่หลุดจากกัน)', async () => {
    (service as any).exportRows = jest.fn().mockResolvedValue({ data: [], total: 0 });
    const filters = { page: 1, limit: 50, view: 'customers', purchase: 'CASH', branchId: 'br1' } as any;
    await controller.exportRows(filters, reqOf('OWNER'));
    expect((service as any).exportRows).toHaveBeenCalledWith(filters);
    expect(service.findAll).not.toHaveBeenCalled();
  });

  it('returns null gracefully on findOne when customer not found', async () => {
    service.findOne.mockResolvedValue(null);
    const result = await controller.findOne('nope', reqOf('SALES'));
    expect(result).toBeNull();
  });

  it('GET /customers/:id ยังอ่านผ่าน findOne เบา ๆ (อินบ็อกซ์/สร้างสัญญา/OCR เรียกบ่อย) ไม่ใช่ findDetail', async () => {
    service.findOne.mockResolvedValue({ id: 'c1', nationalId: '1234567890123' });
    await controller.findOne('c1', reqOf('OWNER'));
    expect(service.findOne).toHaveBeenCalledWith('c1');
    expect(service.findDetail).not.toHaveBeenCalled();
  });

  describe('GET /customers/:id/detail (หน้ารายละเอียดลูกค้า)', () => {
    const detailRow = { id: 'c1', nationalId: '1234567890123', phone: '0812345678', openContracts: [] };
    type DetailResult = typeof detailRow | null;

    it('อ่านผ่าน findDetail ไม่ใช่ findOne', async () => {
      service.findDetail.mockResolvedValue(detailRow);
      await controller.findDetail('c1', reqOf('OWNER'));
      expect(service.findDetail).toHaveBeenCalledWith('c1');
      expect(service.findOne).not.toHaveBeenCalled();
    });

    it('SALES เห็นเลขบัตรแบบปิดบัง และบันทึก PII_DECRYPT_MASKED', async () => {
      service.findDetail.mockResolvedValue(detailRow);
      const result = (await controller.findDetail('c1', reqOf('SALES'))) as DetailResult;
      expect(result?.nationalId).toBe('12345-XXXXX-XX-3');
      expect(result?.phone).toBe('0812345678');
      expect(result?.openContracts).toEqual([]);
      await new Promise((r) => setImmediate(r));
      expect(piiAudit.logDecryption).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', customerId: 'c1', role: 'SALES', masked: true }),
      );
    });

    it('OWNER เห็นเลขบัตรเต็ม และบันทึก PII_DECRYPT_FULL', async () => {
      service.findDetail.mockResolvedValue(detailRow);
      const result = (await controller.findDetail('c1', reqOf('OWNER'))) as DetailResult;
      expect(result?.nationalId).toBe('1234567890123');
      await new Promise((r) => setImmediate(r));
      expect(piiAudit.logDecryption).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', customerId: 'c1', role: 'OWNER', masked: false }),
      );
    });
  });

  describe('GET /customers/:id/tier', () => {
    it('returns tier response from service', async () => {
      const mockResp = {
        customerId: 'cust-1',
        tier: 'GOLD' as const,
        reasons: [{ code: 'GOLD', message: 'x' }],
        history: {
          totalContracts: 3, closedContracts: 3, activeContracts: 0,
          onTimePaymentPct: 100, onTimePayments: 36, latePayments: 0,
          maxOverdueDays: 0, currentOutstanding: 0,
          hasBadDebt: false, hasRepossession: false,
        },
      };
      const tierSpy = jest.spyOn(tierService, 'getCustomerTier').mockResolvedValue(mockResp);
      const result = await controller.getTier('cust-1');
      expect(tierSpy).toHaveBeenCalledWith('cust-1');
      expect(result.tier).toBe('GOLD');
    });
  });

  it('absorbInto ส่งต่อไป CustomerMergeService พร้อม actor', async () => {
    const req = { user: { id: 'staff-1', role: 'SALES' } } as any;
    await expect(controller.absorbInto('p1', 't1', req)).resolves.toEqual({
      placeholderId: 'p1',
      targetId: 't1',
      movedRooms: 1,
      movedCreditChecks: 0,
    });
    expect(merge.absorbPlaceholder).toHaveBeenCalledWith(
      'p1',
      't1',
      { id: 'staff-1', role: 'SALES' },
      { allowPlaceholderTarget: true },
    );
  });

  // Ruling R22 — คำใบ้ "อาจเป็นคนเดียวกัน" ชี้ทิศทางรวมผู้สนใจอัตโนมัติสองคนไว้ (สเปค §3.6)
  // ปลายทางเป็น placeholder จึงต้องรวมได้ผ่านปุ่มนี้ ไม่ใช่ 409 "ให้ใช้รวมห้องแชท"
  it('absorbInto ส่ง allowPlaceholderTarget: true — ปลายทางเป็นผู้สนใจอัตโนมัติอีกคนก็รวมได้ (R22)', async () => {
    const req = { user: { id: 'owner-1', role: 'OWNER' } } as any;
    await controller.absorbInto('p1', 'p2', req);
    expect(merge.absorbPlaceholder.mock.calls[0][3]).toEqual({ allowPlaceholderTarget: true });
  });

  // Ruling R26 — การรวมย้ายห้องทุกห้องของผู้สนใจ ⇒ SALES ต้องผ่านด่านขอบเขตห้องก่อนเสมอ
  it('absorbInto ตรวจขอบเขตห้องของ SALES ก่อนรวม แล้วค่อยเรียก absorbPlaceholder', async () => {
    const req = { user: { id: 'sales-1', role: 'SALES' } } as any;
    await controller.absorbInto('p1', 't1', req);
    expect(merge.assertActorMayAbsorb).toHaveBeenCalledWith('p1', { id: 'sales-1', role: 'SALES' });
    expect(merge.assertActorMayAbsorb.mock.invocationCallOrder[0]).toBeLessThan(
      merge.absorbPlaceholder.mock.invocationCallOrder[0],
    );
  });

  it('absorbInto: ด่านขอบเขตห้องปฏิเสธ → 403 และไม่รวมเลย', async () => {
    const req = { user: { id: 'sales-1', role: 'SALES' } } as any;
    merge.assertActorMayAbsorb.mockRejectedValueOnce(new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้'));
    await expect(controller.absorbInto('p1', 't1', req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(merge.absorbPlaceholder).not.toHaveBeenCalled();
  });

  it('absorbInto ไม่ครอบ exception จาก CustomerMergeService — 409/404/400 ส่งต่อให้ client ตรง ๆ', async () => {
    const req = { user: { id: 'staff-1', role: 'OWNER' } } as any;
    const err = new ConflictException('รวมไม่ได้: ผู้สนใจคนนี้มีสัญญา 1 รายการ — ให้แก้ที่รายการนั้นก่อน');
    merge.absorbPlaceholder.mockRejectedValueOnce(err);
    await expect(controller.absorbInto('p1', 't1', req)).rejects.toBe(err);
  });

  describe('POST /customers/:id/fill-contact', () => {
    it('SALES: ผ่านด่านขอบเขตห้องก่อน แล้วส่ง dto + actor เข้า service', async () => {
      service.fillPlaceholderContact.mockResolvedValue({ id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' });
      const dto = { phone: '0812345678', name: 'สมชาย ใจดี' };
      const result = await controller.fillContact('p1', dto as any, reqOf('SALES'));
      expect(merge.assertActorMayAbsorb).toHaveBeenCalledWith('p1', { id: 'u1', role: 'SALES' });
      expect(service.fillPlaceholderContact).toHaveBeenCalledWith('p1', dto, { id: 'u1', role: 'SALES' });
      expect(result).toEqual({ id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' });
    });

    it('SALES นอกขอบเขตห้อง → 403 จากด่าน และไม่แตะ service', async () => {
      merge.assertActorMayAbsorb.mockRejectedValueOnce(new ForbiddenException('ไม่มีสิทธิ์เข้าถึงห้องแชทนี้'));
      await expect(controller.fillContact('p1', { phone: '0812345678' } as any, reqOf('SALES'))).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.fillPlaceholderContact).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /customers/:id', () => {
    it('ส่ง actor ต่อเข้า service — ใช้ระบุผู้เติมเบอร์ในแถว CONTACT_ADDED', async () => {
      service.update.mockResolvedValue({ id: 'c1' });
      const dto = { phone: '0812345678' };
      await controller.update('c1', dto as any, reqOf('OWNER'));
      expect(service.update).toHaveBeenCalledWith('c1', dto, { id: 'u1', role: 'OWNER' });
    });
  });
});
