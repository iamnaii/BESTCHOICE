import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiUsageService } from './ai-usage.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

describe('AiUsageService.record', () => {
  let service: AiUsageService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aiUsageLog: { create: jest.fn().mockResolvedValue({ id: 'au-1' }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AiUsageService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => '10' } },
      ],
    }).compile();
    service = mod.get(AiUsageService);
  });

  it('writes one row with computed cost for haiku call', async () => {
    await service.record({
      service: 'finance-ai',
      method: 'generateReply',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 10_000,
      outputTokens: 2_000,
      status: 'success',
    });
    const data = prisma.aiUsageLog.create.mock.calls[0][0].data;
    expect(data.service).toBe('finance-ai');
    expect(data.model).toBe('claude-haiku-4-5-20251001');
    expect(data.inputTokens).toBe(10_000);
    expect(Number(data.costUsd)).toBeCloseTo(0.016, 6);
    expect(data.status).toBe('success');
  });

  it('captures errorKind on error calls', async () => {
    await service.record({
      service: 'finance-ai',
      method: 'generateReply',
      model: 'claude-sonnet-4-5-20250514',
      inputTokens: 500,
      outputTokens: 0,
      status: 'error',
      errorKind: 'empty_response',
    });
    const data = prisma.aiUsageLog.create.mock.calls[0][0].data;
    expect(data.status).toBe('error');
    expect(data.errorKind).toBe('empty_response');
  });

  it('swallows DB failure (never block AI call)', async () => {
    prisma.aiUsageLog.create.mockRejectedValue(new Error('no table'));
    await expect(
      service.record({
        service: 'finance-ai',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 100,
        outputTokens: 50,
        status: 'success',
      }),
    ).resolves.toBeUndefined();
  });
});
