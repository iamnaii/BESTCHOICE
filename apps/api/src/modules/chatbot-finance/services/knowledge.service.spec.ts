import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const kbEntries = [
    {
      id: 'kb-1',
      intent: 'payment_info',
      category: 'billing',
      triggerKeywords: ['ค่างวด', 'ยอดชำระ', 'จ่ายเท่าไหร่'],
      exampleQuestions: ['ยอดที่ต้องจ่ายเท่าไหร่'],
      responseTemplate: 'ยอดชำระงวดนี้คือ...',
      responseType: 'auto',
      priority: 10,
      active: true,
    },
    {
      id: 'kb-2',
      intent: 'late_fee',
      category: 'billing',
      triggerKeywords: ['ค่าปรับ', 'ปรับล่าช้า'],
      exampleQuestions: ['ค่าปรับวันละเท่าไหร่'],
      responseTemplate: 'ค่าปรับ 50 บาท/วัน',
      responseType: 'auto',
      priority: 5,
      active: true,
    },
    {
      id: 'kb-3',
      intent: 'store_location',
      category: 'general',
      triggerKeywords: ['สาขา', 'ที่อยู่ร้าน'],
      exampleQuestions: ['ร้านอยู่ที่ไหน'],
      responseTemplate: 'สาขาลาดพร้าว...',
      responseType: 'info',
      priority: 3,
      active: true,
    },
  ];

  beforeEach(async () => {
    prisma = {
      chatKnowledgeBase: {
        findMany: jest.fn().mockResolvedValue(kbEntries),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'new-1', ...data })),
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'kb-1', ...data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(KnowledgeService);
  });

  describe('search', () => {
    it('returns matching entries scored by keyword overlap', async () => {
      const results = await service.search('ค่าปรับล่าช้า');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].intent).toBe('late_fee');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('returns priority-only entries with low scores when no keyword matches', async () => {
      // entries with priority > 0 still get score from priority*0.1
      const results = await service.search('สภาพอากาศวันนี้');
      // All results should have low scores (only from priority weight, no keyword match)
      for (const r of results) {
        expect(r.score).toBeLessThanOrEqual(1.5);
      }
    });

    it('returns empty array for empty query', async () => {
      const results = await service.search('');
      expect(results).toEqual([]);
    });

    it('returns max 3 results', async () => {
      // All entries match "ค่างวด ค่าปรับ สาขา"
      const results = await service.search('ค่างวด ค่าปรับ สาขา');
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('scores keyword matches higher (2 pts each)', async () => {
      const results = await service.search('ยอดชำระ');

      const paymentEntry = results.find((r) => r.intent === 'payment_info');
      expect(paymentEntry).toBeDefined();
      // 'ยอดชำระ' matches keyword → score includes 2 pts
      expect(paymentEntry!.score).toBeGreaterThanOrEqual(2);
    });

    it('includes priority weight in scoring (0.1 * priority)', async () => {
      const results = await service.search('ค่างวด');

      // payment_info has priority=10 → +1.0 bonus
      const entry = results.find((r) => r.intent === 'payment_info');
      expect(entry).toBeDefined();
      // base score from keyword match + priority bonus
      expect(entry!.score).toBeGreaterThanOrEqual(2 + 10 * 0.1);
    });
  });

  describe('CRUD', () => {
    it('creates new KB entry', async () => {
      const input = {
        intent: 'new_faq',
        category: 'general',
        triggerKeywords: ['ใหม่'],
        exampleQuestions: ['คำถามใหม่'],
        responseTemplate: 'คำตอบ',
        responseType: 'auto',
      };

      const result = await service.create(input);

      expect(prisma.chatKnowledgeBase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: 'LINE_FINANCE',
            intent: 'new_faq',
            active: true,
          }),
        }),
      );
      expect(result.intent).toBe('new_faq');
    });

    it('soft deletes KB entry', async () => {
      prisma.chatKnowledgeBase.findFirst.mockResolvedValue({ id: 'kb-1' });

      await service.remove('kb-1');

      expect(prisma.chatKnowledgeBase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'kb-1' },
          data: expect.objectContaining({ active: false }),
        }),
      );
    });

    it('throws NotFoundException for soft-deleting non-existent entry', async () => {
      prisma.chatKnowledgeBase.findFirst.mockResolvedValue(null);

      await expect(service.remove('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
