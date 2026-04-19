import { Test, TestingModule } from '@nestjs/testing';
import { AiMetricsService } from './ai-metrics.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AiMetricsService.getMetrics', () => {
  let service: AiMetricsService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      aiAutoReplyLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiTrainingPair: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [AiMetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AiMetricsService);
  });

  it('returns all-zero metrics when no data', async () => {
    const result = await service.getMetrics();
    expect(result).toEqual({
      autoReplyRate: 0,
      handoffRate: 0,
      acceptRate: 0,
      editRate: 0,
      rejectRate: 0,
      avgConfidence: 0,
      totalTrainingPairs: 0,
      usableTrainingPairs: 0,
    });
  });

  it('computes autoReplyRate + handoffRate from aiAutoReplyLog', async () => {
    prisma.aiAutoReplyLog.findMany.mockResolvedValue([
      { autoSent: true, confidence: 0.9 },
      { autoSent: true, confidence: 0.85 },
      { autoSent: false, confidence: 0.5 }, // handoff
      { autoSent: false, confidence: 0.3 }, // handoff
    ]);
    const result = await service.getMetrics();
    expect(result.autoReplyRate).toBe(50);
    expect(result.handoffRate).toBe(50);
  });

  it('avgConfidence is percent (0-100), not 0-1', async () => {
    prisma.aiAutoReplyLog.findMany.mockResolvedValue([
      { autoSent: true, confidence: 0.9 },
      { autoSent: true, confidence: 0.5 },
    ]);
    const result = await service.getMetrics();
    expect(result.avgConfidence).toBe(70); // (0.9+0.5)/2 * 100
  });

  it('acceptRate / editRate / rejectRate computed from SUGGEST_FEEDBACK pairs', async () => {
    prisma.aiTrainingPair.findMany.mockResolvedValue([
      { type: 'ACCEPT' },
      { type: 'ACCEPT' },
      { type: 'EDIT' },
      { type: 'REJECT' },
    ]);
    const result = await service.getMetrics();
    expect(result.acceptRate).toBe(50);
    expect(result.editRate).toBe(25);
    expect(result.rejectRate).toBe(25);
  });

  it('totalTrainingPairs + usableTrainingPairs from count queries', async () => {
    prisma.aiTrainingPair.count
      .mockResolvedValueOnce(120) // total
      .mockResolvedValueOnce(85); // usable (quality >= 0.7)
    const result = await service.getMetrics();
    expect(result.totalTrainingPairs).toBe(120);
    expect(result.usableTrainingPairs).toBe(85);
    // Verify quality filter on 2nd call
    expect(prisma.aiTrainingPair.count.mock.calls[1][0].where.quality.gte).toBe(0.7);
  });

  it('applies date filter when from/to provided', async () => {
    const from = new Date('2026-04-01');
    const to = new Date('2026-04-30');
    await service.getMetrics(from, to);
    const autoArgs = prisma.aiAutoReplyLog.findMany.mock.calls[0][0];
    expect(autoArgs.where.createdAt.gte).toBe(from);
    expect(autoArgs.where.createdAt.lte).toBe(to);
  });

  it('no date filter when neither from nor to provided (empty where)', async () => {
    await service.getMetrics();
    expect(prisma.aiAutoReplyLog.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('filters feedback by source=SUGGEST_FEEDBACK', async () => {
    await service.getMetrics();
    const where = prisma.aiTrainingPair.findMany.mock.calls[0][0].where;
    expect(where.source).toBe('SUGGEST_FEEDBACK');
  });
});
