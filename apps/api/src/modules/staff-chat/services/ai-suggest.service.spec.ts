import { AiSuggestService } from './ai-suggest.service';

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
    { record: jest.fn() } as any,
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
