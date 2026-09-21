import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';
import { TradeInValuationService } from '../trade-in/services/trade-in-valuation.service';

const D = (n: number) => new Prisma.Decimal(n);

/** DB fixture: 1 คำถาม SINGLE + 1 คำถาม MULTI + valuation iPhone 15 128GB = 14,500 */
const QUESTIONS = [
  {
    id: 'q1',
    key: 'warranty',
    title: 'ประกัน Apple',
    helpText: null,
    selectType: 'SINGLE',
    sortOrder: 0,
    isActive: true,
    deletedAt: null,
    choices: [
      {
        id: 'c10',
        label: 'เหลือ >4 เดือน',
        deductType: 'FIXED',
        deductValue: D(0),
        sortOrder: 0,
        isActive: true,
        deletedAt: null,
      },
      {
        id: 'c11',
        label: 'หมดประกัน',
        deductType: 'FIXED',
        deductValue: D(500),
        sortOrder: 1,
        isActive: true,
        deletedAt: null,
      },
    ],
  },
  {
    id: 'q2',
    key: 'functional-issues',
    title: 'ปัญหาการใช้งาน',
    helpText: null,
    selectType: 'MULTI',
    sortOrder: 1,
    isActive: true,
    deletedAt: null,
    choices: [
      {
        id: 'c20',
        label: 'ลำโพง',
        deductType: 'PERCENT',
        deductValue: D(35),
        sortOrder: 0,
        isActive: true,
        deletedAt: null,
      },
    ],
  },
];

describe('ShopBuybackService (instant quote)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let line: any;
  let service: ShopBuybackService;

  beforeEach(() => {
    prisma = {
      tradeInValuation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'v1',
          brand: 'Apple',
          model: 'iPhone 15',
          storage: '128GB',
          condition: 'A',
          basePrice: D(14500),
          deletedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      buybackQuestion: { findMany: jest.fn().mockResolvedValue(QUESTIONS) },
      tradeIn: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: 'ti-1', status: 'PENDING_APPRAISAL', ...data }),
          ),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      systemConfig: { findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.key === 'sell_exchange_bonus_pct' ? { value: '10' } : null)) },
    };
    line = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    service = new ShopBuybackService(prisma, line, new BuybackPricingService());
  });

  const answers = [
    { questionKey: 'warranty', choiceIds: ['c11'] },
    { questionKey: 'functional-issues', choiceIds: [] },
  ];

  it('discloses the imported AppleHouse benchmark without changing shop deductions', async () => {
    prisma.tradeInValuation.findFirst.mockResolvedValue({ model: 'iPhone 15', storage: '128GB', basePrice: D(14000),
      note: 'อ้างอิง applehouseth.com 2026-09-21 · เครื่องไทย' });
    const questionnaire = await service.getQuestions('iPhone 15', '128GB');
    expect(questionnaire).toMatchObject({ source: 'https://applehouseth.com/', capturedAt: '2026-09-21T00:00:00+07:00', pricingMode: 'SUM_PERCENT_FLOOR10' });
    const quote = await service.quoteForAnswers('iPhone 15', '128GB', answers);
    expect(quote.cashPrice).toBe('13500.00');
    expect(quote.breakdown).toMatchObject({ source: questionnaire.source, capturedAt: questionnaire.capturedAt, pricingMode: questionnaire.pricingMode });
  });

  it('does not attribute manual or unspecified prices to AppleHouse', async () => {
    expect((await service.getQuestions('iPhone 15', '128GB')).source).toBeUndefined();
    expect((await service.quoteForAnswers('iPhone 15', '128GB', answers)).source).toBeUndefined();
  });

  it('stops attributing a staff override to AppleHouse while preserving recorded quotes', async () => {
    const row = { id: 'v1', model: 'iPhone 15', storage: '128GB', basePrice: D(14000),
      note: 'อ้างอิง applehouseth.com 2026-09-21 · เครื่องไทย' };
    prisma.tradeInValuation.findFirst.mockImplementation(async () => ({ ...row }));
    prisma.tradeInValuation.update = jest.fn().mockImplementation(async ({ data }) => Object.assign(row, data));
    const recorded = await service.quoteForAnswers('iPhone 15', '128GB', answers);
    const valuations = new TradeInValuationService(prisma);
    const dto = { brand: 'Apple', model: row.model, storage: row.storage, condition: 'A', basePrice: 14000 };
    await valuations.upsertValuation(dto);
    expect((await service.getQuestions(row.model, row.storage)).source).toBe('https://applehouseth.com/');
    await valuations.upsertValuation({ ...dto, basePrice: 15000 });
    expect(row.note).toContain('ข้อมูลอ้างอิงเดิม');
    expect((await service.getQuestions(row.model, row.storage)).source).toBeUndefined();
    expect((await service.quoteForAnswers(row.model, row.storage, answers)).source).toBeUndefined();
    expect(recorded.breakdown?.source).toBe('https://applehouseth.com/');
  });

  describe('model/storage reference pricing', () => {
    const referenceQuestions = [
      { id: 'rq1', key: 'warranty', title: 'ประกัน', selectType: 'SINGLE', choices: [{ id: 'expired', label: 'หมดประกัน', deductType: 'FIXED', deductValue: '500' }] },
      { id: 'rq2', key: 'body', title: 'ตัวเครื่อง', selectType: 'SINGLE', choices: [{ id: 'scratched', label: 'มีรอย', deductType: 'PERCENT', deductValue: '15' }] },
    ];
    const catalog = { version: 1, source: 'https://www.yellobe.com/buy/detail', capturedAt: '2026-09-08T14:00:00Z',
      profiles: { small: { pricingMode: 'MAX_PERCENT_EXACT', eligibilityRequired: true, eligibilityText: 'เครื่องเปิดใช้งานได้และไม่มีบัญชีล็อก', questions: referenceQuestions },
        large: { pricingMode: 'MAX_PERCENT_EXACT', eligibilityRequired: true, eligibilityText: 'เครื่องเปิดใช้งานได้และไม่มีบัญชีล็อก',
          questions: [{ ...referenceQuestions[1], choices: [{ id: 'large-scratch', label: 'มีรอย', deductType: 'PERCENT', deductValue: '20' }] }] } },
      assignments: [{ model: 'iPhone 12', storage: '128GB', profileId: 'small' }, { model: 'iPhone 12', storage: '256GB', profileId: 'large' }] };
    const referenceAnswers = [{ questionKey: 'warranty', choiceIds: ['expired'] }, { questionKey: 'body', choiceIds: ['scratched'] }];
    beforeEach(() => {
      prisma.systemConfig.findFirst.mockImplementation(({ where }) => Promise.resolve({ value: where.key === 'sell_reference_pricing_v1' ? JSON.stringify(catalog) : '10' }));
      prisma.tradeInValuation.findFirst.mockResolvedValue({ model: 'iPhone 12', storage: '128GB', basePrice: D(5000) });
    });

    it('selects the exact capacity profile and uses it for both questions and quote snapshots', async () => {
      const questions = await service.getQuestions('iphone 12', '128 GB');
      expect(questions).toMatchObject({ profileId: 'small', eligibilityRequired: true, pricingMode: 'MAX_PERCENT_EXACT', questions: referenceQuestions });
      expect((await service.getQuestions('iPhone 12', '256GB')).questions[0].choices[0].id).toBe('large-scratch');
      const result = await service.quoteForAnswers('iPhone 12', '128GB', referenceAnswers, 'BUYBACK', { deviceEligibilityConfirmed: true });
      expect(result.price).toBe('3825.00');
      expect(result.grade).toBe('C');
      expect(result.breakdown).toMatchObject({ profileId: 'small', source: catalog.source, pricingMode: 'MAX_PERCENT_EXACT', pctTotal: '15' });
      expect(result.conditionAnswers).toContainEqual(expect.objectContaining({ questionKey: '__device_eligibility', confirmed: true, profileId: 'small' }));
      expect(prisma.buybackQuestion.findMany).not.toHaveBeenCalled();
    });

    it('fails closed for unconfirmed eligibility, unsupported capacities and malformed runtime catalogs', async () => {
      await expect(service.quoteForAnswers('iPhone 12', '128GB', referenceAnswers)).rejects.toThrow(BadRequestException);
      await expect(service.getQuestions('iPhone 12', '512GB')).rejects.toThrow(BadRequestException);
      prisma.systemConfig.findFirst.mockResolvedValue({ value: '{broken' });
      await expect(service.getQuestions('iPhone 12', '128GB')).rejects.toThrow(ServiceUnavailableException);
    });

    it('hides unsupported capacities of reference models while keeping legacy models and the no-argument questionnaire', async () => {
      prisma.tradeInValuation.findMany.mockResolvedValue([
        { model: 'iPhone 12', storage: '128GB', basePrice: D(5000) },
        { model: 'iPhone 12', storage: '512GB', basePrice: D(6000) },
        { model: 'iPhone 8', storage: '64GB', basePrice: D(1000) },
      ]);
      const result = await service.getCatalog();
      expect(result.models).toEqual([{ model: 'iPhone 12', storages: [{ storage: '128GB', maxPrice: '5000.00' }] },
        { model: 'iPhone 8', storages: [{ storage: '64GB', maxPrice: '1000.00' }] }]);
      expect((await service.getQuestions()).eligibilityRequired).toBe(false);
      expect(prisma.buybackQuestion.findMany).toHaveBeenCalled();
    });
  });

  const dto = {
    model: 'iPhone 15',
    storage: '128GB',
    answers,
    sellerName: 'สมชาย',
    sellerPhone: '0812345678',
    imei: '111',
    lineUserId: 'L1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  describe('quoteForAnswers', () => {
    it('staff assessment requires explicit answers for MULTI questions and a configured questionnaire', async () => {
      await expect(service.quoteForAnswers('iPhone 15', '128GB', [
        { questionKey: 'warranty', choiceIds: ['c11'] },
      ], 'BUYBACK', { requireCompleteQuestionnaire: true })).rejects.toThrow(BadRequestException);
      const quote = await service.quoteForAnswers('iPhone 15', '128GB', answers, 'BUYBACK', { requireCompleteQuestionnaire: true });
      expect(quote.price).toBe('14000.00');
      prisma.buybackQuestion.findMany.mockResolvedValue([]);
      await expect(service.quoteForAnswers('iPhone 15', '128GB', [], 'BUYBACK', { requireCompleteQuestionnaire: true }))
        .rejects.toThrow(BadRequestException);
    });

    it('คำนวณราคาเดียว + breakdown: (14500-500)*1 → 14000', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers);
      expect(r.available).toBe(true);
      expect(r.price).toBe('14000.00');
      expect(r.maxPrice).toBe('14500.00');
      expect(r.grade).toBe('A');
      expect(r.breakdown!.lines).toHaveLength(1);
    });

    it('MULTI เลือกได้ → หัก % และเกรดขยับ', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', [
        { questionKey: 'warranty', choiceIds: ['c11'] },
        { questionKey: 'functional-issues', choiceIds: ['c20'] },
      ]);
      // (14500-500)*(1-0.35) = 9100 → floor10 = 9100
      expect(r.price).toBe('9100.00');
      expect(r.grade).toBe('C');
    });

    it('รุ่นไม่มีในตาราง → available:false ไม่ throw', async () => {
      prisma.tradeInValuation.findFirst.mockResolvedValue(null);
      const r = await service.quoteForAnswers('iPhone 99', '1TB', answers);
      expect(r.available).toBe(false);
    });

    it('SINGLE ไม่ตอบ → BadRequestException', async () => {
      await expect(
        service.quoteForAnswers('iPhone 15', '128GB', [
          { questionKey: 'functional-issues', choiceIds: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('choiceId ไม่อยู่ใต้คำถาม → BadRequestException', async () => {
      await expect(
        service.quoteForAnswers('iPhone 15', '128GB', [
          { questionKey: 'warranty', choiceIds: ['c20'] },
          { questionKey: 'functional-issues', choiceIds: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('questionnaire ว่าง → ราคา = maxPrice', async () => {
      prisma.buybackQuestion.findMany.mockResolvedValue([]);
      const r = await service.quoteForAnswers('iPhone 15', '128GB', []);
      expect(r.price).toBe('14500.00');
    });

    it('choiceIds ซ้ำกันใน MULTI → หักครั้งเดียว (ไม่ใช่ 2 เท่า)', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', [
        { questionKey: 'warranty', choiceIds: ['c11'] },
        { questionKey: 'functional-issues', choiceIds: ['c20', 'c20'] },
      ]);
      // (14500-500)*(1-0.35) = 9100 — ต้องเท่ากับหัก c20 ครั้งเดียว ไม่ใช่ 70%
      expect(r.price).toBe('9100.00');
    });

    it('questionKey ซ้ำกันใน answers → BadRequestException', async () => {
      await expect(
        service.quoteForAnswers('iPhone 15', '128GB', [
          { questionKey: 'warranty', choiceIds: ['c10'] },
          { questionKey: 'warranty', choiceIds: ['c11'] },
          { questionKey: 'functional-issues', choiceIds: [] },
        ]),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submit', () => {
    it('สร้าง TradeIn snapshot ครบ + คืนราคา', async () => {
      const r = await service.submit(dto, undefined);
      expect(r).toEqual({ id: 'ti-1', status: 'PENDING_APPRAISAL', price: '14000.00' });
      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      expect(data.flow).toBe('BUYBACK');
      expect(data.submissionSource).toBe('ONLINE');
      expect(data.deviceBrand).toBe('Apple');
      expect(data.deviceCondition).toBe('A');
      expect(data.estimatedValue.toString()).toBe('14000');
      expect(data.basePriceAtAppraisal).toBeUndefined(); // spec §5.2 — ห้าม snapshot maxPrice ที่นี่
      expect(data.quoteBreakdown.maxPrice).toBe('14500.00');
      expect(Array.isArray(data.conditionAnswers)).toBe(true);
    });

    it('IMEI ซ้ำใน 24 ชม. → BadRequestException', async () => {
      prisma.tradeIn.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.submit(dto, undefined)).rejects.toThrow(BadRequestException);
    });

    it('LINE flex พังต้องไม่ล้ม submit + flex มีราคา', async () => {
      line.sendFlexMessage.mockRejectedValue(new Error('down'));
      const r = await service.submit(dto, undefined);
      expect(r.id).toBe('ti-1');
      expect(JSON.stringify(line.sendFlexMessage.mock.calls[0][1])).toContain('14,000');
    });

    it('รุ่นไม่มีราคา → NotFoundException', async () => {
      prisma.tradeInValuation.findFirst.mockResolvedValue(null);
      await expect(service.submit(dto, undefined)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCatalog', () => {
    it('group รุ่น + เรียงใหม่→เก่า, unparseable ไปท้าย, ความจุน้อย→มาก', async () => {
      prisma.tradeInValuation.findMany.mockResolvedValue([
        { model: 'iPhone 15', storage: '128GB', basePrice: D(14500) },
        { model: 'iPhone 15', storage: '256GB', basePrice: D(15000) },
        { model: 'iPhone 16 Pro Max', storage: '256GB', basePrice: D(30000) },
        { model: 'iPhone SE 2022', storage: '64GB', basePrice: D(5000) },
        { model: 'iPhone 16 Pro', storage: '256GB', basePrice: D(27000) },
      ]);
      const r = await service.getCatalog();
      expect(r.models.map((m) => m.model)).toEqual([
        'iPhone 16 Pro Max',
        'iPhone 16 Pro',
        'iPhone 15',
        'iPhone SE 2022',
      ]);
      expect(r.models[2].storages.map((s) => s.storage)).toEqual(['128GB', '256GB']);
      expect(r.models[2].storages[0].maxPrice).toBe('14500.00');
    });
  });

  describe('getStatus', () => {
    it('ไม่พบ → NotFoundException; พบ → รวม field ใหม่', async () => {
      await expect(service.getStatus('x')).rejects.toThrow(NotFoundException);
      prisma.tradeIn.findFirst.mockResolvedValue({ id: 'ti-1', estimatedValue: D(14000) });
      const r = await service.getStatus('ti-1');
      expect(r.id).toBe('ti-1');
      const call = prisma.tradeIn.findFirst.mock.calls[1][0];
      expect(call.where.deletedAt).toBe(null);
      expect(call.select.estimatedValue).toBe(true);
      expect(call.select.quoteBreakdown).toBe(true);
      expect(call.select.preferredVisitDate).toBe(true);
    });
  });

  describe('dual price (flow)', () => {
    it('quote default (BUYBACK): price=cash, มี exchangePrice/bonusPct ครบ', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers);
      expect(r.price).toBe('14000.00'); // cash เดิม
      expect(r.cashPrice).toBe('14000.00');
      expect(r.exchangePrice).toBe('15400.00'); // 14000×1.1
      expect(r.bonusPct).toBe('10');
      expect(r.breakdown!.price).toBe('14000.00');
      expect(r.breakdown!.chosenFlow).toBe('BUYBACK');
      expect(r.breakdown!.cashPrice).toBe('14000.00');
      expect(r.breakdown!.exchangePrice).toBe('15400.00');
    });

    it('quote flow=EXCHANGE: price=exchange + invariant breakdown.price', async () => {
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers, 'EXCHANGE');
      expect(r.price).toBe('15400.00');
      expect(r.breakdown!.price).toBe('15400.00');
      expect(r.breakdown!.chosenFlow).toBe('EXCHANGE');
      expect(r.cashPrice).toBe('14000.00');
    });

    it('bonus config นอกช่วง → default 10', async () => {
      prisma.systemConfig.findFirst.mockImplementation(({ where }) => Promise.resolve(where.key === 'sell_exchange_bonus_pct' ? { value: '250' } : null));
      const r = await service.quoteForAnswers('iPhone 15', '128GB', answers, 'EXCHANGE');
      expect(r.bonusPct).toBe('10');
    });

    it('getQuestions ตอบ bonusPct', async () => {
      const r = await service.getQuestions();
      expect(r.bonusPct).toBe('10');
    });

    it('submit flow=EXCHANGE: estimatedValue=exchange, TradeIn.flow=EXCHANGE, flex มีราคาเทิร์น+คำว่าเทิร์น', async () => {
      const r = await service.submit({ ...dto, flow: 'EXCHANGE' }, undefined);
      expect(r.price).toBe('15400.00');
      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      expect(data.flow).toBe('EXCHANGE');
      expect(data.estimatedValue.toString()).toBe('15400');
      expect(data.quoteBreakdown.price).toBe('15400.00');
      expect(data.quoteBreakdown.chosenFlow).toBe('EXCHANGE');
      const flex = JSON.stringify(line.sendFlexMessage.mock.calls[0][1]);
      expect(flex).toContain('15,400');
      expect(flex).toContain('เทิร์น');
    });

    it('submit ไม่ส่ง flow → BUYBACK เดิมเป๊ะ (back-compat bundle เก่า)', async () => {
      await service.submit(dto, undefined);
      const data = prisma.tradeIn.create.mock.calls[0][0].data;
      expect(data.flow).toBe('BUYBACK');
      expect(data.estimatedValue.toString()).toBe('14000');
      expect(data.quoteBreakdown.chosenFlow).toBe('BUYBACK');
    });
  });
});
