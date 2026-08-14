import { Test } from '@nestjs/testing';
import {
  KnowledgeExtractorService,
  containsForbiddenRateTalk,
} from './knowledge-extractor.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiUsageService } from '../ai-usage/ai-usage.service';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('@anthropic-ai/sdk');

type ClaudePayload = {
  faqs?: Record<string, unknown>[];
  objections?: Record<string, unknown>[];
};

function mockClaude(
  payload: ClaudePayload | string,
  opts: { tokenCounts?: number[]; stopReason?: string } = {},
) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const mockStream = jest.fn().mockReturnValue({
    finalMessage: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: opts.stopReason ?? 'end_turn',
    }),
  });
  // countTokens ถูกเรียกก่อน stream เสมอ — default ตอบค่าต่ำ (ไม่ trigger การตัด)
  const counts = opts.tokenCounts ?? [];
  const mockCountTokens = jest.fn().mockImplementation(() => {
    const next = counts.length > 0 ? counts.shift() : 1000;
    return Promise.resolve({ input_tokens: next });
  });
  (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
    messages: { stream: mockStream, countTokens: mockCountTokens },
  }));
  return { mockStream, mockCountTokens };
}

async function buildService(
  pairs = [{ customerMessage: 'ใช้เอกสารอะไรบ้าง', humanEdit: 'บัตรใบเดียวค่ะ' }],
  activeRowIds: string[] = [],
) {
  const prisma = {
    aiTrainingPair: { findMany: jest.fn().mockResolvedValue(pairs) },
    chatKnowledgeBase: {
      upsert: jest.fn().mockResolvedValue({ id: 'kb1' }),
      findMany: jest.fn().mockResolvedValue(activeRowIds.map((id) => ({ id }))),
    },
  };
  const aiUsage = { record: jest.fn() };

  const mod = await Test.createTestingModule({
    providers: [
      KnowledgeExtractorService,
      { provide: PrismaService, useValue: prisma },
      { provide: AiUsageService, useValue: aiUsage },
    ],
  }).compile();

  return { svc: mod.get(KnowledgeExtractorService), prisma, aiUsage };
}

const FAQ = {
  intent: 'documents_required',
  audience: 'SALES',
  triggerKeywords: ['เอกสาร'],
  exampleQuestions: ['ต้องใช้เอกสารอะไรบ้างคะ'],
  responseTemplate: 'ใช้บัตรประชาชนใบเดียวเลยค่ะ',
  responseType: 'auto',
  requiresAuth: false,
  frequency: 24,
  confidence: 0.95,
};

const OBJECTION = {
  intent: 'objection_price_too_high',
  keyword: 'แพง',
  audience: 'SALES',
  triggerKeywords: ['แพง', 'ลดได้ไหม'],
  exampleQuestions: ['แพงไปครับ ลดได้ไหม'],
  bestResponse: 'เข้าใจค่ะ มี 3 ทางช่วยได้นะคะ',
  frequency: 8,
  confidence: 0.9,
};

describe('KnowledgeExtractorService', () => {
  it('เก็บ FAQ ลง ChatKnowledgeBase แบบ inactive รอแอดมินรีวิว', async () => {
    mockClaude({ faqs: [FAQ], objections: [] });
    const { svc, prisma, aiUsage } = await buildService();

    const result = await svc.extractAndSeed();

    expect(result.faqsSeeded).toBe(1);
    expect(prisma.chatKnowledgeBase.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.chatKnowledgeBase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'extracted:documents_required' },
        create: expect.objectContaining({
          category: 'EXTRACTED',
          channel: 'LINE_SHOP',
          responseType: 'auto',
          requiresAuth: false,
          active: false,
          priority: 24,
        }),
      }),
    );
    expect(aiUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'knowledge-extractor',
        method: 'extractAndSeed',
        status: 'success',
      }),
    );
  });

  it('เก็บ objection ลงตารางจริง (ของเดิมนับแต่ไม่เคยเขียน)', async () => {
    mockClaude({ faqs: [], objections: [OBJECTION] });
    const { svc, prisma } = await buildService();

    const result = await svc.extractAndSeed();

    expect(result.objectionsSeeded).toBe(1);
    expect(prisma.chatKnowledgeBase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'extracted:objection_price_too_high' },
        create: expect.objectContaining({
          category: 'EXTRACTED_OBJECTION',
          intent: 'objection_price_too_high',
          triggerKeywords: ['แพง', 'ลดได้ไหม'],
          responseTemplate: 'เข้าใจค่ะ มี 3 ทางช่วยได้นะคะ',
          active: false,
        }),
      }),
    );
  });

  it('FINANCE → LINE_FINANCE, BOTH → null (ทุกช่องทาง)', async () => {
    mockClaude({
      faqs: [
        { ...FAQ, intent: 'due_date', audience: 'FINANCE', requiresAuth: true },
        { ...FAQ, intent: 'store_location_hours', audience: 'BOTH' },
      ],
      objections: [],
    });
    const { svc, prisma } = await buildService();

    await svc.extractAndSeed();

    const channels = prisma.chatKnowledgeBase.upsert.mock.calls.map(
      ([arg]: [{ create: { intent: string; channel: string | null } }]) => [
        arg.create.intent,
        arg.create.channel,
      ],
    );
    expect(channels).toEqual([
      ['due_date', 'LINE_FINANCE'],
      ['store_location_hours', null],
    ]);
  });

  describe('containsForbiddenRateTalk', () => {
    it.each([
      'ผ่อน 0% 12 งวดค่ะ',
      'ดอกเบี้ยถูกกว่าที่อื่นค่ะ',
      'คิด 3 เปอร์เซ็นต์ต่อเดือนค่ะ',
      'ดาวน์ 20% ที่เหลือผ่อนได้เลยค่ะ',
    ])('บล็อกเรท: %s', (text) => {
      expect(containsForbiddenRateTalk(text)).toBe(true);
    });

    // เคสจริงที่กฎเหมารวม "%" เคยกินทิ้ง — สำนวนขายปกติ ไม่เกี่ยวกับดอกเบี้ย
    it.each([
      'ของแท้ 100% ค่ะ ไม่ติด iCloud ตรวจสภาพทุกเครื่อง',
      'แบต 89% สภาพสวยมากค่ะ',
      'ใช้บัตรประชาชนใบเดียวเลยค่ะ ไม่เช็คบูโรนะคะ',
    ])('ปล่อยผ่าน: %s', (text) => {
      expect(containsForbiddenRateTalk(text)).toBe(false);
    });
  });

  it('ตัดคำตอบที่มีคำต้องห้าม (ดอกเบี้ย/%) ทิ้ง', async () => {
    mockClaude({
      faqs: [{ ...FAQ, responseTemplate: 'ผ่อน 0% 12 งวดค่ะ' }],
      objections: [{ ...OBJECTION, bestResponse: 'ดอกเบี้ยถูกกว่าที่อื่นค่ะ' }],
    });
    const { svc, prisma } = await buildService();

    const result = await svc.extractAndSeed();

    expect(result).toEqual({ faqsSeeded: 0, objectionsSeeded: 0 });
    expect(prisma.chatKnowledgeBase.upsert).not.toHaveBeenCalled();
  });

  it('ตัด intent นอก taxonomy และ confidence ต่ำกว่า 0.5 ทิ้ง', async () => {
    mockClaude({
      faqs: [
        { ...FAQ, intent: 'ราคามือถือ' },
        { ...FAQ, intent: 'promotion', confidence: 0.3 },
      ],
      objections: [{ ...OBJECTION, intent: 'objection_unknown' }],
    });
    const { svc, prisma } = await buildService();

    const result = await svc.extractAndSeed();

    expect(result).toEqual({ faqsSeeded: 0, objectionsSeeded: 0 });
    expect(prisma.chatKnowledgeBase.upsert).not.toHaveBeenCalled();
  });

  it('อ่าน JSON ที่ถูกหุ้มด้วย code fence ได้', async () => {
    mockClaude('```json\n' + JSON.stringify({ faqs: [FAQ], objections: [] }) + '\n```');
    const { svc } = await buildService();

    await expect(svc.extractAndSeed()).resolves.toEqual({ faqsSeeded: 1, objectionsSeeded: 0 });
  });

  it('ไม่มีคู่ข้อความ → ไม่เรียก Claude', async () => {
    const { mockStream } = mockClaude({ faqs: [], objections: [] });
    const { svc } = await buildService([]);

    await expect(svc.extractAndSeed()).resolves.toEqual({ faqsSeeded: 0, objectionsSeeded: 0 });
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('prompt เกินเพดาน token → ตัดคู่ข้อความจนพอดีก่อนเรียก Claude จริง', async () => {
    // countTokens ครั้งแรกเกินเพดาน (จำลองเคสจริง 212,906) ครั้งถัดมาพอดี
    const { mockStream, mockCountTokens } = mockClaude(
      { faqs: [FAQ], objections: [] },
      { tokenCounts: [212_906, 170_000] },
    );
    const manyPairs = Array.from({ length: 2000 }, (_, i) => ({
      customerMessage: `คำถามที่ ${i}`,
      humanEdit: `คำตอบที่ ${i}`,
    }));
    const { svc } = await buildService(manyPairs);

    await expect(svc.extractAndSeed()).resolves.toEqual({ faqsSeeded: 1, objectionsSeeded: 0 });
    expect(mockCountTokens).toHaveBeenCalledTimes(2);
    expect(mockStream).toHaveBeenCalledTimes(1);
    // 2000 × (180000×0.95/212906) = 1606 คู่ — ข้อความที่ส่งจริงต้องไม่มีคู่ท้าย ๆ แล้ว
    const sent = (mockStream.mock.calls[0][0] as { messages: { content: string }[] })
      .messages[0].content;
    expect(sent).toContain('คำถามที่ 0');
    expect(sent).not.toContain('คำถามที่ 1999');
  });

  it('คำตอบโดนตัดที่ max_tokens → โยน error ชัดเจน ไม่ปล่อยไป parse JSON ครึ่งเดียว', async () => {
    mockClaude({ faqs: [FAQ], objections: [] }, { stopReason: 'max_tokens' });
    const { svc } = await buildService();

    await expect(svc.extractAndSeed()).rejects.toThrow(/max_tokens/);
  });

  it('แถวที่เปิดใช้อยู่ (ผ่านรีวิว/แต่งมือแล้ว) → ไม่ทับด้วยข้อความสกัดใหม่', async () => {
    mockClaude({ faqs: [FAQ], objections: [OBJECTION] });
    // documents_required เปิดใช้อยู่ → ต้องถูกข้าม; objection ยังปิด → ลงตามปกติ
    const { svc, prisma } = await buildService(undefined, ['extracted:documents_required']);

    await expect(svc.extractAndSeed()).resolves.toEqual({ faqsSeeded: 0, objectionsSeeded: 1 });
    const upsertedIds = prisma.chatKnowledgeBase.upsert.mock.calls.map(
      (c: [{ where: { id: string } }]) => c[0].where.id,
    );
    expect(upsertedIds).toEqual(['extracted:objection_price_too_high']);
  });
});
