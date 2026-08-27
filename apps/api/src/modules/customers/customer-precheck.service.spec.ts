import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerPreCheckService } from './customer-precheck.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTierService } from './customer-tier.service';
import { CustomersService } from './customers.service';
import { TestModeService } from '../test-mode/test-mode.service';
import { AuditService } from '../audit/audit.service';
import { CreditCheckService } from '../credit-check/credit-check.service';

// Shared placeholder-customer helper mock. The lookup/create/revive logic now
// lives in CustomersService.findOrCreatePrecheckCustomer (so the pre-check path
// shares create()'s nationalIdHash + Contact dedup — see that helper's spec for
// the dedup behavior). Here we only assert pre-check DELEGATES to it.
function customersServiceMock(ret: { id: string; isNew: boolean } = { id: 'cust-default', isNew: false }) {
  return {
    findOrCreatePrecheckCustomer: jest.fn().mockResolvedValue(ret),
    update: jest.fn().mockResolvedValue({ id: ret.id }),
  };
}

describe('CustomerPreCheckService — decideOutcome (pure)', () => {
  let service: CustomerPreCheckService;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomerTierService, useValue: {} },
        { provide: CustomersService, useValue: customersServiceMock() },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        // pre-check เรียกตัวอ่าน statement ด้วย AI — สเปคชุดนี้ไม่ตรวจการเรียก AI
        // ให้คืน aiScore เป็น null (= ไม่มีคะแนน) เพื่อคงพฤติกรรมเดิมของเทสต์
        {
          provide: CreditCheckService,
          useValue: { ai: { analyzeForCustomer: jest.fn().mockResolvedValue({ aiScore: null }) } },
        },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('BLACKLIST always FAIL', () => {
    expect(service.decideOutcome('BLACKLIST', undefined).decision).toBe('FAIL');
  });
  it('RISKY always REVIEW', () => {
    expect(service.decideOutcome('RISKY', 80).decision).toBe('REVIEW');
  });
  it('GOLD always PASS — even without AI', () => {
    expect(service.decideOutcome('GOLD', undefined).decision).toBe('PASS');
  });
  it('GOOD with AI >= 50 PASS', () => {
    expect(service.decideOutcome('GOOD', 65).decision).toBe('PASS');
  });
  it('GOOD with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('GOOD', 45).decision).toBe('REVIEW');
  });
  it('GOOD with AI < 40 FAIL', () => {
    expect(service.decideOutcome('GOOD', 35).decision).toBe('FAIL');
  });
  it('GOOD without AI PASS', () => {
    expect(service.decideOutcome('GOOD', undefined).decision).toBe('PASS');
  });
  it('NEW with AI >= 50 PASS', () => {
    expect(service.decideOutcome('NEW', 60).decision).toBe('PASS');
  });
  it('NEW with AI 40-49 REVIEW', () => {
    expect(service.decideOutcome('NEW', 45).decision).toBe('REVIEW');
  });
  it('NEW with AI < 40 FAIL', () => {
    expect(service.decideOutcome('NEW', 30).decision).toBe('FAIL');
  });
  it('NEW without AI REVIEW', () => {
    expect(service.decideOutcome('NEW', undefined).decision).toBe('REVIEW');
  });
  it('NEW without AI + no statement → "ยังไม่มี statement" reason', () => {
    const result = service.decideOutcome('NEW', undefined, false);
    expect(result.decision).toBe('REVIEW');
    expect(result.reasons[0].code).toBe('NEW_NO_DATA');
    expect(result.reasons[0].message).toContain('ยังไม่มี statement');
  });
  it('NEW without AI + has statement → "แนบ statement แล้ว" reason (no contradiction)', () => {
    const result = service.decideOutcome('NEW', undefined, true);
    expect(result.decision).toBe('REVIEW');
    expect(result.reasons[0].code).toBe('NEW_PENDING_REVIEW');
    expect(result.reasons[0].message).toContain('แนบ statement แล้ว');
    expect(result.reasons[0].message).not.toContain('ยังไม่มี statement');
  });
});

describe('CustomerPreCheckService — runPreCheck placeholder + credit-check', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let customersService: ReturnType<typeof customersServiceMock>;

  async function build() {
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: { getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }) },
        },
        { provide: CustomersService, useValue: customersService },
        { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        // pre-check เรียกตัวอ่าน statement ด้วย AI — สเปคชุดนี้ไม่ตรวจการเรียก AI
        // ให้คืน aiScore เป็น null (= ไม่มีคะแนน) เพื่อคงพฤติกรรมเดิมของเทสต์
        {
          provide: CreditCheckService,
          useValue: { ai: { analyzeForCustomer: jest.fn().mockResolvedValue({ aiScore: null }) } },
        },
      ],
    }).compile();
    return mod.get(CustomerPreCheckService);
  }

  beforeEach(async () => {
    prisma = {
      customer: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      creditCheck: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // รองรับทั้งสองรูปแบบ: callback (runPreCheck) และ array (abandonPreCheck)
      $transaction: jest.fn((arg: unknown) =>
        Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma),
      ),
    };
    customersService = customersServiceMock({ id: 'cust-default', isNew: false });
    service = await build();
  });

  it('delegates placeholder creation to CustomersService.findOrCreatePrecheckCustomer (shared dedup pipeline)', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-new', isNew: true });

    const result = await service.runPreCheck({ nationalId: '2222222222222', phone: '0898765432' });

    expect(customersService.findOrCreatePrecheckCustomer).toHaveBeenCalledWith({
      nationalId: '2222222222222',
      phone: '0898765432',
    });
    // It must NOT do its own plaintext create/lookup anymore (that was the bug).
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(result.customerId).toBe('cust-new');
    expect(result.isNewCustomer).toBe(true);
  });

  it('returns an existing (non-new) customer from the helper', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-live', isNew: false });

    const result = await service.runPreCheck({ nationalId: '3333333333333', phone: '0811111111' });

    expect(result.customerId).toBe('cust-live');
    expect(result.isNewCustomer).toBe(false);
    // The only customer.update is the final creditCheckStatus write — never a
    // deletedAt clear here (revive lives inside the helper now).
    const updateCalls = prisma.customer.update.mock.calls;
    expect(
      updateCalls.every((call: [unknown]) => !('deletedAt' in (call[0] as { data: object }).data)),
    ).toBe(true);
  });

  it('reuses a recent PRE credit check instead of creating a duplicate', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-x', isNew: false });
    prisma.creditCheck.findFirst.mockResolvedValue({ id: 'cc-recent', aiScore: null });
    service = await build(); // fresh instance — empty in-memory cache

    const result = await service.runPreCheck({
      nationalId: '4444444444444',
      phone: '0820000000',
      bankName: 'KBANK',
      statementFiles: ['data:image/png;base64,xxx'],
    });

    expect(prisma.creditCheck.create).not.toHaveBeenCalled();
    expect(result.creditCheckId).toBe('cc-recent');
  });

  it('creates a new PRE credit check when no recent duplicate exists', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-y', isNew: false });
    prisma.creditCheck.findFirst.mockResolvedValue(null);
    prisma.creditCheck.create.mockResolvedValue({ id: 'cc-new' });
    service = await build();

    const result = await service.runPreCheck({
      nationalId: '5555555555555',
      phone: '0833333333',
      bankName: 'SCB',
      statementFiles: ['data:image/png;base64,yyy'],
    });

    expect(prisma.creditCheck.create).toHaveBeenCalledTimes(1);
    expect(result.creditCheckId).toBe('cc-new');
    const findFirstCall = prisma.creditCheck.findFirst.mock.calls[0][0];
    expect(findFirstCall.where.checkType).toBe('PRE');
    expect(findFirstCall.where.bankName).toBe('SCB');
    expect(findFirstCall.where.deletedAt).toBeNull();
  });

  // แถว CreditCheck ถูกสร้างนอก tx (สถานะ PENDING) เพื่อให้ตัววิเคราะห์ AI มี id อ้าง
  // แต่ **ผลสรุป** ของทั้งสองตารางยังต้องเขียนพร้อมกันใน tx เดียว
  it('เขียนผลสรุปของ CreditCheck + customer.creditCheckStatus ใน $transaction เดียว', async () => {
    customersService.findOrCreatePrecheckCustomer.mockResolvedValue({ id: 'cust-tx', isNew: false });
    prisma.creditCheck.create.mockResolvedValue({ id: 'cc-tx' });
    service = await build();

    await service.runPreCheck({
      nationalId: '6666666666666',
      phone: '0844444444',
      bankName: 'BBL',
      statementFiles: ['data:image/png;base64,zzz'],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // สร้างด้วย PENDING ก่อน แล้วค่อยอัปเดตเป็นผลจริง
    expect(prisma.creditCheck.create.mock.calls[0][0].data.status).toBe('PENDING');
    expect(prisma.creditCheck.update).toHaveBeenCalledTimes(1);
    const statusUpdateCall = prisma.customer.update.mock.calls.find(
      (call: [{ data: { creditCheckStatus?: string } }]) => call[0].data.creditCheckStatus !== undefined,
    );
    expect(statusUpdateCall).toBeDefined();
  });

  // ─── AI อ่าน statement (ต่อเข้า pre-check 2026-08-27) ─────────────────────
  // REGRESSION: เดิม `const aiScore = undefined` ตายตัว ⇒ decideOutcome เข้าสาขา
  // "ไม่มีข้อมูล AI" เสมอ ⇒ ลูกค้าใหม่ได้ REVIEW 100% ทั้งที่ wizard บังคับอัปโหลด statement
  describe('AI statement analysis', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ai: any;

    async function buildWithAi(score: number | null) {
      ai = { analyzeForCustomer: jest.fn().mockResolvedValue({ aiScore: score }) };
      const mod = await Test.createTestingModule({
        providers: [
          CustomerPreCheckService,
          { provide: PrismaService, useValue: prisma },
          {
            provide: CustomerTierService,
            useValue: { getCustomerTier: jest.fn().mockResolvedValue({ tier: 'NEW', reasons: [] }) },
          },
          { provide: CustomersService, useValue: customersService },
          { provide: TestModeService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
          { provide: AuditService, useValue: { log: jest.fn() } },
          { provide: CreditCheckService, useValue: { ai } },
        ],
      }).compile();
      return mod.get(CustomerPreCheckService);
    }

    const run = (svc: CustomerPreCheckService, nid: string) =>
      svc.runPreCheck({
        nationalId: nid,
        phone: '0891112222',
        bankName: 'KBANK',
        statementFiles: ['data:image/png;base64,aaa'],
      });

    beforeEach(() => {
      prisma.systemConfig = { findUnique: jest.fn().mockResolvedValue(null) };
      prisma.creditCheck.create.mockResolvedValue({ id: 'cc-ai' });
    });

    it('คะแนนสูง → ลูกค้าใหม่ PASS (เดิมได้ REVIEW เสมอ)', async () => {
      const svc = await buildWithAi(78);
      const res = await run(svc, '7000000000001');
      expect(ai.analyzeForCustomer).toHaveBeenCalledWith('cc-ai');
      expect(res.decision).toBe('PASS');
    });

    it('คะแนนต่ำ → FAIL', async () => {
      const svc = await buildWithAi(20);
      expect((await run(svc, '7000000000002')).decision).toBe('FAIL');
    });

    it('คะแนนก้ำกึ่ง → REVIEW', async () => {
      const svc = await buildWithAi(45);
      expect((await run(svc, '7000000000003')).decision).toBe('REVIEW');
    });

    it('AI พัง → ตัดสินโดยไม่ใช้คะแนน (REVIEW) และ **ไม่ throw**', async () => {
      const svc = await buildWithAi(0);
      ai.analyzeForCustomer.mockRejectedValue(new Error('Claude 500'));
      const res = await run(svc, '7000000000004');
      expect(res.decision).toBe('REVIEW');
    });

    it('สวิตช์ปิด (credit_precheck_ai_enabled=false) → ไม่เรียก AI เลย', async () => {
      const svc = await buildWithAi(90);
      prisma.systemConfig.findUnique.mockResolvedValue({ value: 'false' });
      const res = await run(svc, '7000000000005');
      expect(ai.analyzeForCustomer).not.toHaveBeenCalled();
      expect(res.decision).toBe('REVIEW');
    });

    it('ไม่มีแถวสวิตช์ = เปิดใช้งาน', async () => {
      const svc = await buildWithAi(80);
      prisma.systemConfig.findUnique.mockResolvedValue(null);
      await run(svc, '7000000000006');
      expect(ai.analyzeForCustomer).toHaveBeenCalled();
    });

    it('ใบเดิมที่วิเคราะห์แล้ว → ใช้คะแนนเดิม ไม่จ่ายค่า AI ซ้ำ', async () => {
      const svc = await buildWithAi(10);
      prisma.creditCheck.findFirst.mockResolvedValue({ id: 'cc-old', aiScore: 88 });
      const res = await run(svc, '7000000000007');
      expect(ai.analyzeForCustomer).not.toHaveBeenCalled();
      expect(res.decision).toBe('PASS');
    });

    it('ไม่แนบ statement → ไม่เรียก AI และไม่สร้างแถว CreditCheck', async () => {
      const svc = await buildWithAi(90);
      const res = await svc.runPreCheck({ nationalId: '7000000000008', phone: '0891112222' });
      expect(ai.analyzeForCustomer).not.toHaveBeenCalled();
      expect(prisma.creditCheck.create).not.toHaveBeenCalled();
      expect(res.decision).toBe('REVIEW');
    });
  });

  // ─── abandonPreCheck — refuse to delete real customer rows ──────────────
  it('abandons a placeholder customer with no contracts', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-placeholder',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: 'UNDER_REVIEW',
      _count: { contracts: 0 },
    });

    const result = await service.abandonPreCheck('cust-placeholder');

    expect(result.deleted).toBe(true);
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-placeholder' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('refuses to abandon if name was changed (full intake completed)', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-real',
      name: 'สมชาย ใจดี',
      creditCheckStatus: 'UNDER_REVIEW',
      _count: { contracts: 0 },
    });
    const result = await service.abandonPreCheck('cust-real');
    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('refuses to abandon if any contracts exist', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-with-contract',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: 'UNDER_REVIEW',
      _count: { contracts: 1 },
    });
    const result = await service.abandonPreCheck('cust-with-contract');
    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  // REGRESSION: abandon เคยรับเฉพาะ UNDER_REVIEW ทั้งที่ runPreCheck ตั้งได้ 3 ค่า
  // ⇒ decision PASS/FAIL ลบแถว placeholder ไม่ออกเลย. เส้น FAIL เป็นเคสที่เจ็บสุด เพราะ
  // ปุ่ม "กลับ"/"เริ่มใหม่" บนหน้าผลตรวจเรียก abandon ทั้งคู่ ⇒ เช็คไม่ผ่าน = ทิ้งแถวผี
  // ชื่อ "ลูกค้าใหม่ (Pre-check)" ค้างทะเบียนทุกครั้ง
  it.each([
    ['PRE_CHECK_PASSED', 'decision PASS'],
    ['REJECTED', 'decision FAIL'],
    ['UNDER_REVIEW', 'decision REVIEW'],
  ])('abandons a placeholder left in %s (%s)', async (status) => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-x',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: status,
      _count: { contracts: 0 },
    });
    const result = await service.abandonPreCheck('cust-x');
    expect(result.deleted).toBe(true);
  });

  // ใบตรวจของ session ที่ถูกทิ้งต้องหลุดจากคิว /credit-checks ด้วย — คิวนั้นกรอง
  // `deletedAt` ของตัว CreditCheck เอง ไม่ได้เช็ค customer.deletedAt
  it('soft-deletes the PRE credit checks of the abandoned session too', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-placeholder',
      name: 'ลูกค้าใหม่ (Pre-check)',
      creditCheckStatus: 'REJECTED',
      _count: { contracts: 0 },
    });
    prisma.creditCheck.updateMany.mockResolvedValue({ count: 1 });

    await service.abandonPreCheck('cust-placeholder');

    expect(prisma.creditCheck.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'cust-placeholder', checkType: 'PRE', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      }),
    );
    // ต้องอยู่ใน $transaction เดียวกับการลบลูกค้า — ไม่งั้นพังครึ่งทางได้
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  // NONE = แถวที่สร้างผ่าน POST /customers (pre-check ไม่เคยแตะ) — ลบทิ้งไม่ได้
  // FULL_CHECK_PASSED = ผ่านการตรวจเต็มแล้ว = ข้อมูลจริง
  it.each(['NONE', 'FULL_CHECK_PASSED'])(
    'refuses to abandon a row in %s (never written by runPreCheck)',
    async (status) => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-not-precheck',
        name: 'ลูกค้าใหม่ (Pre-check)',
        creditCheckStatus: status,
        _count: { contracts: 0 },
      });
      const result = await service.abandonPreCheck('cust-not-precheck');
      expect(result.deleted).toBe(false);
      expect(prisma.customer.update).not.toHaveBeenCalled();
    },
  );

  it('returns {deleted:false} silently if customer does not exist (already removed)', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    const result = await service.abandonPreCheck('cust-gone');
    expect(result.deleted).toBe(false);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  // ─── completePreCheck — ปิดงาน intake โดยไม่ต้องมีสิทธิ์ PATCH /customers/:id ───
  // เหตุที่ต้องมี: PATCH เป็น @Roles('OWNER','BRANCH_MANAGER') แต่ pre-check เปิดถึง SALES
  // ⇒ พนักงานขายเดินครบ wizard แล้วโดน 403 ที่ปุ่ม "บันทึก" เสมอ (และทิ้งแถว placeholder)
  const placeholderRow = {
    id: 'cust-placeholder',
    name: 'ลูกค้าใหม่ (Pre-check)',
    creditCheckStatus: 'PRE_CHECK_PASSED',
    _count: { contracts: 0 },
  };

  it('lets SALES finish the placeholder row it just created', async () => {
    prisma.customer.findFirst.mockResolvedValue(placeholderRow);
    await service.completePreCheck('cust-placeholder', { name: 'สมชาย ใจดี' }, 'SALES');
    expect(customersService.update).toHaveBeenCalledWith(
      'cust-placeholder',
      expect.objectContaining({ name: 'สมชาย ใจดี' }),
    );
  });

  it('refuses SALES on an EXISTING customer — not a backdoor around PATCH roles', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-real',
      name: 'สมหญิง รักดี',
      creditCheckStatus: 'FULL_CHECK_PASSED',
      _count: { contracts: 2 },
    });
    await expect(
      service.completePreCheck('cust-real', { name: 'ชื่อใหม่' }, 'SALES'),
    ).rejects.toThrow(ForbiddenException);
    expect(customersService.update).not.toHaveBeenCalled();
  });

  it('still lets OWNER/BRANCH_MANAGER edit an existing customer (no regression vs PATCH)', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-real',
      name: 'สมหญิง รักดี',
      creditCheckStatus: 'FULL_CHECK_PASSED',
      _count: { contracts: 2 },
    });
    await service.completePreCheck('cust-real', { name: 'ชื่อใหม่' }, 'BRANCH_MANAGER');
    expect(customersService.update).toHaveBeenCalled();
  });

  it('404s when the customer row is gone', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.completePreCheck('cust-gone', {}, 'SALES')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ─── Test-mode bypass (Task 3) ──────────────────────────────────────────────
describe('CustomerPreCheckService — test-mode bypass', () => {
  let service: CustomerPreCheckService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let testMode: { isEnabled: jest.Mock };
  let audit: { log: jest.Mock };
  let customersService: ReturnType<typeof customersServiceMock>;

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      creditCheck: { findFirst: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(),
    };
    testMode = { isEnabled: jest.fn() };
    audit = { log: jest.fn() };
    customersService = customersServiceMock({ id: 'cust-real', isNew: false });
    const mod = await Test.createTestingModule({
      providers: [
        CustomerPreCheckService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CustomerTierService,
          useValue: {
            getCustomerTier: jest.fn(() => {
              throw new Error('real precheck must NOT run when test-mode is ON');
            }),
          },
        },
        { provide: CustomersService, useValue: customersService },
        { provide: TestModeService, useValue: testMode },
        { provide: AuditService, useValue: audit },
        {
          provide: CreditCheckService,
          useValue: { ai: { analyzeForCustomer: jest.fn().mockResolvedValue({ aiScore: null }) } },
        },
      ],
    }).compile();
    service = mod.get(CustomerPreCheckService);
  });

  it('returns PASS + TEST_MODE_BYPASS reason WITHOUT running real checks when test-mode is ON', async () => {
    testMode.isEnabled.mockResolvedValue(true);

    const result = await service.runPreCheck({ nationalId: '1111111111111', phone: '0810000000' });

    expect(result.decision).toBe('PASS');
    expect(result.reasons.map((r) => r.code)).toContain('TEST_MODE_BYPASS');
    expect(customersService.findOrCreatePrecheckCustomer).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes a CREDIT_PRECHECK_BYPASSED_TEST_MODE audit marker when bypassing', async () => {
    testMode.isEnabled.mockResolvedValue(true);
    await service.runPreCheck(
      { nationalId: '2222222222222', phone: '0820000000' },
      { userId: 'user-1', ipAddress: '127.0.0.1' },
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREDIT_PRECHECK_BYPASSED_TEST_MODE',
        entity: 'customer',
        userId: 'user-1',
      }),
    );
  });

  it('falls through to real logic when test-mode is OFF', async () => {
    testMode.isEnabled.mockResolvedValue(false);
    // Reaches the placeholder helper, then the throwing tier mock proves the
    // bypass did NOT short-circuit.
    await expect(
      service.runPreCheck({ nationalId: '3333333333333', phone: '0830000000' }),
    ).rejects.toThrow('real precheck must NOT run when test-mode is ON');
    expect(customersService.findOrCreatePrecheckCustomer).toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
});
