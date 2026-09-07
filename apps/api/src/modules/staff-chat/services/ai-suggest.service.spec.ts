import { AiSuggestService } from './ai-suggest.service';
import { Logger } from '@nestjs/common';

function makeService(env: { apiKey?: string; nodeEnv?: string }) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'ANTHROPIC_API_KEY' ? env.apiKey : key === 'NODE_ENV' ? env.nodeEnv : undefined,
    ),
  };
  const prisma = {
    chatMessage: {
      findMany: jest.fn().mockResolvedValue([{ role: 'CUSTOMER', text: 'ราคาเท่าไหร่ครับ' }]),
    },
  };
  return new AiSuggestService(
    config as any,
    prisma as any,
    { detectProducts: jest.fn().mockResolvedValue([]) } as any,
    { getFewShotExamples: jest.fn().mockResolvedValue([]) } as any,
    { getBase: jest.fn().mockResolvedValue('persona') } as any,
    { isAvailable: !!env.apiKey, generate: jest.fn() } as any,
  );
}

describe('AiSuggestService.suggest — mock gate', () => {
  it('production + ไม่มี API key → ไม่คืนข้อความ mock เลย (กันราคาปลอมถึงลูกค้า)', async () => {
    const svc = makeService({ nodeEnv: 'production' });
    const res = await svc.suggest('r1');
    expect(res.suggestions).toEqual([]);
    expect(res.detectedProducts).toEqual([]);
  });

  it('dev + ไม่มี API key → คืน mock ที่ติดป้าย [MOCK] ทุกข้อความ', async () => {
    const svc = makeService({ nodeEnv: 'development' });
    const res = await svc.suggest('r1');
    expect(res.suggestions.length).toBeGreaterThan(0);
    expect(res.suggestions.every((s) => s.text.startsWith('[MOCK] '))).toBe(true);
  });
});

describe('AiSuggestService.suggest — text assistance', () => {
  const product = {
    name: 'โทรศัพท์ตัวอย่าง',
    price: 12000,
    stock: 2,
    pricingOptions: [{ installments: 12, monthlyPayment: 1000, downPaymentMin: 3000 }],
    activePromotions: [{ name: 'โปรตัวอย่าง' }],
  };
  function setup() {
    const prisma = {
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([
          { role: 'STAFF', text: 'ยินดีให้บริการ', staff: { name: 'เอ' } },
          { role: 'CUSTOMER', text: 'ราคาเท่าไหร่ครับ' },
        ]),
      },
      chatRoom: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ customer: { name: 'ลูกค้าตัวอย่าง', contracts: [] } }),
      },
      promotion: {
        findMany: jest.fn().mockResolvedValue([{ name: 'โปรตัวอย่าง', description: 'แถมเคส' }]),
      },
    };
    const suggestions = Array.from({ length: 4 }, (_, index) => ({
      text: `คำตอบ ${index + 1}`,
      intent: 'answer_price',
      confidence: 0.9,
    }));
    const aiText = {
      isAvailable: true,
      generate: jest.fn().mockResolvedValue(JSON.stringify(suggestions)),
    };
    const aiTraining = {
      getFewShotExamples: jest
        .fn()
        .mockResolvedValue([{ customerMessage: 'มีสินค้าไหม', staffResponse: 'มีครับ' }]),
    };
    const service = new AiSuggestService(
      { get: jest.fn().mockReturnValue('production') } as any,
      prisma as any,
      { detectProducts: jest.fn().mockResolvedValue([product]) } as any,
      aiTraining as any,
      { getBase: jest.fn().mockResolvedValue('บุคลิกร้านเดิม') } as any,
      aiText as any,
    );
    return { service, prisma, aiText, aiTraining, suggestions };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('attributes suggestions to the server actor without adding that identity to the prompt', async () => {
    const { service, aiText } = setup();
    await service.suggest('room-1', 'ร่างเดิม', 'server-actor');
    expect(aiText.generate.mock.calls[0][1]).toEqual({
      service: 'ai-suggest',
      method: 'suggest',
      userId: 'server-actor',
    });
    expect(JSON.stringify(aiText.generate.mock.calls[0][0])).not.toContain('server-actor');
  });

  it('keeps grounded context, model/token budget and at most three suggestions', async () => {
    const { service, aiText, aiTraining, suggestions } = setup();
    const result = await service.suggest('room-1', 'ร่างเดิม');
    expect(result.suggestions).toEqual(suggestions.slice(0, 3));
    expect(result.detectedProducts).toEqual([product.name]);
    expect(aiTraining.getFewShotExamples).toHaveBeenCalledWith(null, 5, 'ราคาเท่าไหร่ครับ');
    expect(aiText.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: expect.stringContaining('บุคลิกร้านเดิม'),
      }),
      { service: 'ai-suggest', method: 'suggest' },
    );
    const prompt = aiText.generate.mock.calls[0][0].messages[0].content;
    for (const content of [
      'ลูกค้าตัวอย่าง',
      product.name,
      '12,000',
      'สต็อก 2',
      'โปรตัวอย่าง',
      'แถมเคส',
      'ร่างเดิม',
      'มีสินค้าไหม',
      'พนักงาน (เอ): ยินดีให้บริการ',
    ]) {
      expect(prompt).toContain(content);
    }
    expect(prompt.indexOf('ลูกค้า: ราคาเท่าไหร่ครับ')).toBeLessThan(
      prompt.indexOf('พนักงาน (เอ): ยินดีให้บริการ'),
    );
  });

  it('extracts a JSON array even when wrapped in explanatory text', async () => {
    const { service, aiText, suggestions } = setup();
    aiText.generate.mockResolvedValue(`คำแนะนำ:\n${JSON.stringify(suggestions)}\nจบ`);
    expect((await service.suggest('room-1')).suggestions).toEqual(suggestions.slice(0, 3));
  });

  it.each([null, 'ไม่ใช่ JSON', '[invalid json]'])(
    'preserves detected products when text cannot be parsed (%s)',
    async (text) => {
      const { service, aiText } = setup();
      aiText.generate.mockResolvedValue(text);
      const result = await service.suggest('room-1');
      expect(result.suggestions).toEqual([]);
      expect(result.detectedProducts).toEqual([product.name]);
    },
  );

  it('returns the existing empty suggestions fallback on provider failure', async () => {
    const { service, aiText } = setup();
    aiText.generate.mockRejectedValue(new Error('unavailable'));
    const result = await service.suggest('room-1');
    expect(result.suggestions).toEqual([]);
    expect(result.detectedProducts).toEqual([product.name]);
  });

  it('does not call the provider for an empty conversation', async () => {
    const { service, prisma, aiText } = setup();
    prisma.chatMessage.findMany.mockResolvedValue([]);
    const result = await service.suggest('room-1');
    expect(result.suggestions).toEqual([]);
    expect(aiText.generate).not.toHaveBeenCalled();
  });
});
