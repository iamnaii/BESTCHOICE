import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnlineAppraisalService } from './online-appraisal.service';

const D = (n: number | string) => new Prisma.Decimal(n);

const ONLINE_TRADEIN = {
  id: 'ti-1',
  status: 'PENDING_APPRAISAL',
  appraisalLocked: false,
  firstAppraisedAt: null,
  flow: 'BUYBACK',
  deviceModel: 'iPhone 15',
  deviceBrand: 'Apple',
  deviceStorage: '128GB',
  submissionSource: 'ONLINE',
  branchId: null,
  updatedAt: new Date('2026-09-08T00:00:00Z'),
  estimatedValue: D(12420),
  quoteBreakdown: { maxPrice: '14500.00', price: '12420.00', lines: [] },
  deletedAt: null,
  notes: null,
};

const EXCHANGE_TRADEIN = {
  ...ONLINE_TRADEIN,
  flow: 'EXCHANGE',
  estimatedValue: D(13660),
  quoteBreakdown: {
    maxPrice: '14500.00', price: '13660.00', cashPrice: '12420.00',
    exchangePrice: '13660.00', bonusPct: '10', chosenFlow: 'EXCHANGE', lines: [],
  },
};

describe('OnlineAppraisalService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let shopBuyback: any;
  let service: OnlineAppraisalService;

  beforeEach(() => {
    prisma = {
      tradeIn: {
        findFirst: jest.fn().mockResolvedValue({ ...ONLINE_TRADEIN }),
        // CAS write: updateMany with a conditional WHERE (count===0 → race loser),
        // followed by a findUnique re-read to return the fresh record.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ ...ONLINE_TRADEIN }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    shopBuyback = { quoteForAnswers: jest.fn() };
    service = new OnlineAppraisalService(prisma, shopBuyback);
  });

  it.each(['AS_ANSWERED', 'MANUAL'] as const)('requires and records staff eligibility confirmation in %s on a reference quote', async (mode) => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN,
      quoteBreakdown: { ...ONLINE_TRADEIN.quoteBreakdown, eligibilityRequired: true, eligibilityText: 'เครื่องไม่มีบัญชีล็อก', source: 'reference-source', profileId: 'p' },
      conditionAnswers: [{ questionKey: 'body', title: 'สภาพเดิม', choices: [] }] });
    const dto = { mode, ...(mode === 'MANUAL' ? { offeredPrice: 5000, reason: 'ปรับราคาพิเศษ' } : {}) };
    await expect(service.appraiseOnline('ti-1', dto, 'u1', 'OWNER')).rejects.toThrow(BadRequestException);
    await service.appraiseOnline('ti-1', { ...dto, deviceEligibilityConfirmed: true }, 'u1', 'OWNER');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.conditionAnswers).toContainEqual(expect.objectContaining({ questionKey: '__device_eligibility',
      confirmed: true, verifiedById: 'u1', verifiedAt: expect.any(String), title: 'เครื่องไม่มีบัญชีล็อก' }));
    expect(data.conditionAnswers[0]).toEqual({ questionKey: 'body', title: 'สภาพเดิม', choices: [] });
  });

  it('loads scoped questions only from the persisted device and enforces item branch access', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, branchId: 'branch-1' });
    shopBuyback.getQuestions = jest.fn().mockResolvedValue({ questions: [{ key: 'body' }] });
    await expect(service.questions('ti-1', 'BRANCH_MANAGER', 'branch-2')).rejects.toThrow(ForbiddenException);
    expect(shopBuyback.getQuestions).not.toHaveBeenCalled();
    await service.questions('ti-1', 'BRANCH_MANAGER', 'branch-1');
    expect(shopBuyback.getQuestions).toHaveBeenCalledWith('iPhone 15', '128GB');
  });

  it('previews quick-buy before seller intake without creating or reading a trade-in, then validates its final price', async () => {
    shopBuyback.quoteForAnswers.mockResolvedValue({ available: true, model: 'iPhone 12', storage: '128GB', price: '3825.00',
      cashPrice: '3825.00', maxPrice: '5000.00', grade: 'C', breakdown: { price: '3825.00', maxPrice: '5000.00' }, conditionAnswers: [] });
    const input = { deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceStorage: '128GB', answers: [{ questionKey: 'body', choiceIds: ['scratch'] }] };
    const preview = await service.quickBuyPreview(input);
    expect(preview).toMatchObject({ price: '3825.00', previewToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(prisma.tradeIn.findFirst).not.toHaveBeenCalled();
    expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
    const prepared = await service.prepareQuickBuy({ ...input, previewToken: preview.previewToken, agreedPrice: 3825, deviceCondition: 'C' }, 'u1');
    expect(prepared.data.offeredPrice.toString()).toBe('3825');
    expect(prepared.data.deviceCondition).toBe('C');
    await expect(service.prepareQuickBuy({ ...input, previewToken: preview.previewToken, agreedPrice: 4000 }, 'u1')).rejects.toThrow(ConflictException);
    await expect(service.prepareQuickBuy({ ...input, previewToken: preview.previewToken, agreedPrice: 3825, deviceCondition: 'A' }, 'u1')).rejects.toThrow(ConflictException);
  });

  it('rejects changed quick-buy quotes and stamps the actor on the accepted reference eligibility', async () => {
    const quote = { available: true, model: 'iPhone 12', storage: '128GB', price: '3825.00', cashPrice: '3825.00',
      maxPrice: '5000.00', grade: 'C', breakdown: { eligibilityRequired: true, eligibilityText: 'ไม่มีบัญชีล็อก', source: 'reference', profileId: 'p' },
      conditionAnswers: [{ questionKey: 'body', title: 'สภาพตัวเครื่อง', choices: [] }, { questionKey: '__device_eligibility', confirmed: true }] };
    shopBuyback.quoteForAnswers.mockResolvedValue(quote);
    const dto = { deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceStorage: '128GB',
      answers: [{ questionKey: 'body', choiceIds: ['scratch'] }], deviceEligibilityConfirmed: true, agreedPrice: 3825 };
    const preview = await service.quickBuyPreview(dto);
    const prepared = await service.prepareQuickBuy({ ...dto, previewToken: preview.previewToken }, 'staff-1');
    expect(prepared.data.conditionAnswers).toEqual([quote.conditionAnswers[0], expect.objectContaining({
      questionKey: '__device_eligibility', confirmed: true, verifiedById: 'staff-1', verifiedAt: expect.any(String), source: 'reference', profileId: 'p' })]);
    expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 12', '128GB', dto.answers, 'BUYBACK',
      { requireCompleteQuestionnaire: true, deviceEligibilityConfirmed: true });
    shopBuyback.quoteForAnswers.mockResolvedValue({ ...quote, cashPrice: '3600.00' });
    await expect(service.prepareQuickBuy({ ...dto, previewToken: preview.previewToken }, 'staff-1'))
      .rejects.toMatchObject({ response: { code: 'QUICK_BUY_QUOTE_CHANGED' } });
    expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
  });

  it.each(['0.00', '-1.00'])('never purchases a quick-buy quote of %s', async (cashPrice) => {
    shopBuyback.quoteForAnswers.mockResolvedValue({ available: true, model: 'iPhone 12', storage: '128GB', cashPrice,
      price: cashPrice, maxPrice: '5000.00', grade: 'D', breakdown: {}, conditionAnswers: [] });
    const dto = { deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceStorage: '128GB',
      answers: [{ questionKey: 'body', choiceIds: ['damaged'] }], agreedPrice: Number(cashPrice) };
    const preview = await service.quickBuyPreview(dto);
    await expect(service.prepareQuickBuy({ ...dto, previewToken: preview.previewToken }, 'staff-1')).rejects.toThrow(BadRequestException);
    expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
  });

  it('walk-in preview derives its device and flow from the record, then saves server snapshots with the preview token', async () => {
    const walkIn = { ...ONLINE_TRADEIN, submissionSource: 'OFFLINE', branchId: 'branch-1', quoteBreakdown: null };
    prisma.tradeIn.findFirst.mockResolvedValue(walkIn);
    shopBuyback.quoteForAnswers.mockResolvedValue({ available: true, price: '9100.00', cashPrice: '9100.00',
      exchangePrice: '10010.00', maxPrice: '14500.00', grade: 'C',
      breakdown: { maxPrice: '14500.00', price: '9100.00', cashPrice: '9100.00', chosenFlow: 'BUYBACK', lines: [] },
      conditionAnswers: [{ questionKey: 'warranty', title: 'Server title', choices: [] }] });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    const preview = await service.preview('ti-1', { answers }, 'BRANCH_MANAGER', 'branch-1');
    expect(preview.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers, previewToken: preview.previewToken }, 'u1', 'BRANCH_MANAGER', 'branch-1');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('9100');
    expect(data.deviceCondition).toBe('C');
    expect(data.conditionAnswers[0].title).toBe('Server title');
    expect(data.quoteBreakdown.price).toBe('9100.00');
    expect(prisma.tradeIn.updateMany.mock.calls[0][0].where).toMatchObject({ appraisalLocked: false, status: 'PENDING_APPRAISAL' });
  });

  describe('protected questionnaire preview', () => {
    const answers = [{ questionKey: 'condition', choiceIds: ['intact'] }];
    const quote = { available: true, price: '10000.00', maxPrice: '10000.00', grade: 'A',
      breakdown: { maxPrice: '10000.00', price: '10000.00' }, conditionAnswers: [] };
    beforeEach(() => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, submissionSource: 'OFFLINE', branchId: 'branch-1', quoteBreakdown: null });
      shopBuyback.quoteForAnswers.mockResolvedValue(quote);
    });

    it('rejects missing preview and price/config or record changes before confirmation', async () => {
      await expect(service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'OWNER')).rejects.toThrow(ConflictException);
      const preview = await service.preview('ti-1', { answers }, 'OWNER', null);
      shopBuyback.quoteForAnswers.mockResolvedValue({ ...quote, price: '9000.00' });
      await expect(service.appraiseOnline('ti-1', { mode: 'REVISED', answers, previewToken: preview.previewToken }, 'u1', 'OWNER'))
        .rejects.toThrow(ConflictException);
      shopBuyback.quoteForAnswers.mockResolvedValue(quote);
      prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, submissionSource: 'OFFLINE', branchId: 'branch-1', quoteBreakdown: null,
        updatedAt: new Date('2026-09-08T01:00:00Z') });
      await expect(service.appraiseOnline('ti-1', { mode: 'REVISED', answers, previewToken: preview.previewToken }, 'u1', 'OWNER'))
        .rejects.toThrow(ConflictException);
      expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
    });

    it('rejects another branch, a branchless manager, and unassigned offline work', async () => {
      await expect(service.preview('ti-1', { answers }, 'BRANCH_MANAGER', 'branch-2')).rejects.toThrow(ForbiddenException);
      await expect(service.preview('ti-1', { answers }, 'BRANCH_MANAGER', null)).rejects.toThrow(ForbiddenException);
      prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, submissionSource: 'OFFLINE', branchId: null });
      await expect(service.preview('ti-1', { answers }, 'BRANCH_MANAGER', 'branch-1')).rejects.toThrow(ForbiddenException);
      prisma.tradeIn.findFirst.mockResolvedValue(ONLINE_TRADEIN);
      await expect(service.preview('ti-1', { answers }, 'BRANCH_MANAGER', 'branch-1')).resolves.toMatchObject({ price: '10000.00' });
    });

    it.each([{ deviceBrand: 'Samsung' }, { deviceModel: 'iPad Pro' }, { deviceStorage: null },
      { status: 'ACCEPTED' }, { status: 'REJECTED' }, { appraisalLocked: true }])('rejects unsupported device/state %j', async (patch) => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, ...patch });
      await expect(service.preview('ti-1', { answers }, 'OWNER', null)).rejects.toThrow(BadRequestException);
      expect(shopBuyback.quoteForAnswers).not.toHaveBeenCalled();
    });

    it('does not accept a client price for a questionnaire appraisal', async () => {
      const preview = await service.preview('ti-1', { answers }, 'OWNER', null);
      await expect(service.appraiseOnline('ti-1', { mode: 'REVISED', answers, previewToken: preview.previewToken, offeredPrice: 1 }, 'u1', 'OWNER'))
        .rejects.toThrow(BadRequestException);
      expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
    });

    it.each(['0.00', '-10.00'])('shows a computed price of %s in preview but never confirms it', async (price) => {
      shopBuyback.quoteForAnswers.mockResolvedValue({ ...quote, price });
      const preview = await service.preview('ti-1', { answers }, 'OWNER', null);
      expect(preview.price).toBe(price);
      await expect(service.appraiseOnline('ti-1', { mode: 'REVISED', answers, previewToken: preview.previewToken }, 'u1', 'OWNER'))
        .rejects.toThrow(BadRequestException);
      expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
    });
  });

  it('AS_ANSWERED: offeredPrice = estimatedValue เป๊ะ + snapshot maxPrice + lock', async () => {
    await service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER', 'branch-1');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('12420');
    expect(data.status).toBe('APPRAISED');
    expect(data.appraisalLocked).toBe(true);
    expect(data.basePriceAtAppraisal.toString()).toBe('14500');
    expect(data.appraisedById).toBe('u1');
  });

  it('REVISED: คิดราคาใหม่จาก engine + อัปเดต snapshot + เกรดใหม่', async () => {
    shopBuyback.quoteForAnswers.mockResolvedValue({
      available: true,
      price: '9100.00',
      maxPrice: '14500.00',
      grade: 'C',
      breakdown: { maxPrice: '14500.00', price: '9100.00', lines: [] },
      conditionAnswers: [{ questionKey: 'x' }],
    });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER', 'branch-1');
    expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers, 'BUYBACK', { requireCompleteQuestionnaire: true });
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('9100');
    expect(data.deviceCondition).toBe('C');
    expect(data.estimatedValue.toString()).toBe('9100');
    expect(data.quoteBreakdown.price).toBe('9100.00');
  });

  it('REVISED โดยไม่ส่ง answers → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'REVISED' }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('MANUAL: ต้องเป็น OWNER + reason — เขียน audit log', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'จอมีตำหนิเพิ่ม' }, 'u1', 'BRANCH_MANAGER', 'branch-1'),
    ).rejects.toThrow(ForbiddenException);

    await service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'จอมีตำหนิเพิ่ม' }, 'u1', 'OWNER');
    expect(prisma.auditLog.create).toHaveBeenCalled();
    const audit = prisma.auditLog.create.mock.calls[0][0].data;
    expect(audit.action).toBe('TRADE_IN_ONLINE_MANUAL_PRICE');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.offeredPrice.toString()).toBe('5000');
  });

  it('MANUAL ไม่มี reason → BadRequestException', async () => {
    await expect(
      service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000 }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('record ไม่มี quoteBreakdown → BadRequestException (ให้ใช้ appraise เดิม)', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, quoteBreakdown: null });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'OWNER'),
    ).rejects.toThrow(BadRequestException);
  });

  it('ล็อคแล้ว → เฉพาะ MANUAL+OWNER เท่านั้น', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, appraisalLocked: true, firstAppraisedAt: new Date('2026-07-01') });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER', 'branch-1'),
    ).rejects.toThrow(ForbiddenException);
    await service.appraiseOnline('ti-1', { mode: 'MANUAL', offeredPrice: 5000, reason: 'ตกลงราคาใหม่' }, 'u1', 'OWNER');
    expect(prisma.tradeIn.updateMany).toHaveBeenCalled();
  });

  it('AS_ANSWERED: updateMany count=0 (ถูกอีกคนประเมินไปแล้วระหว่างอ่าน) → BadRequestException (race loser)', async () => {
    prisma.tradeIn.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED' }, 'u1', 'BRANCH_MANAGER', 'branch-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('MANUAL บน record ที่จบ lifecycle แล้ว (status ACCEPTED, locked) → BadRequestException, ไม่แตะ updateMany', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({
      ...ONLINE_TRADEIN,
      status: 'ACCEPTED',
      appraisalLocked: true,
      firstAppraisedAt: new Date('2026-07-01'),
    });
    await expect(
      service.appraiseOnline(
        'ti-1',
        { mode: 'MANUAL', offeredPrice: 5000, reason: 'พยายามแก้ราคาย้อนหลัง' },
        'u1',
        'OWNER',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.tradeIn.updateMany).not.toHaveBeenCalled();
  });

  it('REVISED: basePriceAtAppraisal snapshot จาก breakdown "ใหม่" ที่เพิ่งคิด ไม่ใช่ breakdown เก่าของ record', async () => {
    // record เดิม quoteBreakdown.maxPrice = '14500.00' — engine คิดใหม่ได้ราคาฐานต่างออกไป
    shopBuyback.quoteForAnswers.mockResolvedValue({
      available: true,
      price: '9100.00',
      maxPrice: '15000.00',
      grade: 'C',
      breakdown: { maxPrice: '15000.00', price: '9100.00', lines: [] },
      conditionAnswers: [{ questionKey: 'x' }],
    });
    const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
    await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER', 'branch-1');
    const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
    expect(data.basePriceAtAppraisal.toString()).toBe('15000');
  });

  it('MANUAL race-loser: สอง OWNER เรียก MANUAL พร้อมกันบน record APPRAISED เดิม → updateMany count=0 → BadRequestException, WHERE ล็อคด้วย offeredPrice ที่อ่านมา', async () => {
    prisma.tradeIn.findFirst.mockResolvedValue({
      ...ONLINE_TRADEIN,
      status: 'APPRAISED',
      appraisalLocked: true,
      firstAppraisedAt: new Date('2026-07-01'),
      offeredPrice: D(5000),
    });
    prisma.tradeIn.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.appraiseOnline(
        'ti-1',
        { mode: 'MANUAL', offeredPrice: 6000, reason: 'แก้ราคาซ้ำ (ผู้ใช้อื่นแก้ไปแล้ว)' },
        'u1',
        'OWNER',
      ),
    ).rejects.toThrow(BadRequestException);
    const where = prisma.tradeIn.updateMany.mock.calls[0][0].where;
    expect(where.offeredPrice.toString()).toBe('5000');
  });

  describe('flow-aware (spec /sell §7.2)', () => {
    it('REVISED บน EXCHANGE: ส่ง flow เข้า engine + ราคา/chosenFlow ตาม flow', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
      shopBuyback.quoteForAnswers.mockResolvedValue({
        available: true, price: '9990.00', maxPrice: '14500.00', grade: 'C',
        breakdown: { maxPrice: '14500.00', price: '9990.00', cashPrice: '9080.00',
          exchangePrice: '9990.00', bonusPct: '10', chosenFlow: 'EXCHANGE', lines: [] },
        conditionAnswers: [],
      });
      const answers = [{ questionKey: 'warranty', choiceIds: ['c11'] }];
      await service.appraiseOnline('ti-1', { mode: 'REVISED', answers }, 'u1', 'BRANCH_MANAGER', 'branch-1');
      expect(shopBuyback.quoteForAnswers).toHaveBeenCalledWith('iPhone 15', '128GB', answers, 'EXCHANGE', { requireCompleteQuestionnaire: true });
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.offeredPrice.toString()).toBe('9990');
      expect(data.estimatedValue.toString()).toBe('9990');
      expect(data.quoteBreakdown.chosenFlow).toBe('EXCHANGE');
    });

    it('AS_ANSWERED useCashPrice บน EXCHANGE: ราคา cash + flip flow → BUYBACK + invariant breakdown', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
      await service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED', useCashPrice: true }, 'u1', 'BRANCH_MANAGER', 'branch-1');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.offeredPrice.toString()).toBe('12420');
      expect(data.flow).toBe('BUYBACK');
      expect(data.estimatedValue.toString()).toBe('12420');
      expect(data.quoteBreakdown.price).toBe('12420.00');
      expect(data.quoteBreakdown.chosenFlow).toBe('BUYBACK');
    });

    it('useCashPrice บน record BUYBACK → BadRequestException', async () => {
      await expect(
        service.appraiseOnline('ti-1', { mode: 'AS_ANSWERED', useCashPrice: true }, 'u1', 'OWNER'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('MANUAL re-stamp (launch-wave Track D)', () => {
    const manualDto = (price: number) => ({
      mode: 'MANUAL' as const,
      offeredPrice: price,
      reason: 'ปรับราคาตามสภาพจริง',
    });

    it('BUYBACK: estimatedValue + breakdown.price + cashPrice = ราคาใหม่ทั้งหมด', async () => {
      await service.appraiseOnline('ti-1', manualDto(11000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.estimatedValue.toString()).toBe('11000');
      expect(data.quoteBreakdown.price).toBe('11000.00');
      expect(data.quoteBreakdown.cashPrice).toBe('11000.00');
    });

    it('EXCHANGE: exchangePrice = manual, cashPrice inverse จาก snapshot bonusPct (floor to tens)', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...EXCHANGE_TRADEIN });
      await service.appraiseOnline('ti-1', manualDto(14000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.estimatedValue.toString()).toBe('14000');
      expect(data.quoteBreakdown.price).toBe('14000.00');
      expect(data.quoteBreakdown.exchangePrice).toBe('14000.00');
      // 14000 × 100 ÷ 110 = 12727.27… → floor to tens = 12720
      expect(data.quoteBreakdown.cashPrice).toBe('12720.00');
    });

    it('EXCHANGE record เก่าไม่มี bonusPct → cashPrice = manual ตรงๆ', async () => {
      const legacy = { ...EXCHANGE_TRADEIN, quoteBreakdown: { maxPrice: '14500.00', price: '13660.00', lines: [] } };
      prisma.tradeIn.findFirst.mockResolvedValue(legacy);
      await service.appraiseOnline('ti-1', manualDto(13000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.quoteBreakdown.cashPrice).toBe('13000.00');
      expect(data.quoteBreakdown.price).toBe('13000.00');
    });

    it('walk-in ไม่มี quoteBreakdown → stamp เฉพาะ estimatedValue', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ ...ONLINE_TRADEIN, quoteBreakdown: null });
      await service.appraiseOnline('ti-1', manualDto(9000), 'u1', 'OWNER');
      const data = prisma.tradeIn.updateMany.mock.calls[0][0].data;
      expect(data.estimatedValue.toString()).toBe('9000');
      expect(data.quoteBreakdown).toBeUndefined();
    });

    it('audit เขียนหลัง CAS สำเร็จ — race-loser (count=0) ต้องไม่มี audit', async () => {
      prisma.tradeIn.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.appraiseOnline('ti-1', manualDto(9000), 'u1', 'OWNER'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('CAS สำเร็จ → audit ถูกเขียน 1 ครั้งพร้อม oldValue/newValue', async () => {
      await service.appraiseOnline('ti-1', manualDto(11000), 'u1', 'OWNER');
      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const arg = prisma.auditLog.create.mock.calls[0][0].data;
      expect(arg.action).toBe('TRADE_IN_ONLINE_MANUAL_PRICE');
      expect(arg.newValue.offeredPrice).toBe(11000);
    });
  });
});
