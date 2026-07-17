import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShopBuybackService } from './shop-buyback.service';
import { BuybackPricingService } from './buyback-pricing.service';

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
    };
    line = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    service = new ShopBuybackService(prisma, line, new BuybackPricingService());
  });

  const answers = [
    { questionKey: 'warranty', choiceIds: ['c11'] },
    { questionKey: 'functional-issues', choiceIds: [] },
  ];

  describe('quoteForAnswers', () => {
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
      prisma.tradeIn.findUnique.mockResolvedValue({ id: 'ti-1', estimatedValue: D(14000) });
      const r = await service.getStatus('ti-1');
      expect(r.id).toBe('ti-1');
      const select = prisma.tradeIn.findUnique.mock.calls[1][0].select;
      expect(select.estimatedValue).toBe(true);
      expect(select.quoteBreakdown).toBe(true);
      expect(select.preferredVisitDate).toBe(true);
    });
  });
});
