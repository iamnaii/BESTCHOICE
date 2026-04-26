import { Test } from '@nestjs/testing';
import { CollectionsSummaryService } from './collections-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';

describe('CollectionsSummaryService', () => {
  let service: CollectionsSummaryService;
  let prisma: any;
  let line: any;

  beforeEach(async () => {
    const prismaMock: any = {
      user: { findMany: jest.fn() },
      dailyAssignment: { groupBy: jest.fn() },
    };
    const lineMock = { pushMessage: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsSummaryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LineOaService, useValue: lineMock },
      ],
    }).compile();
    service = moduleRef.get(CollectionsSummaryService);
    prisma = moduleRef.get(PrismaService);
    line = moduleRef.get(LineOaService);
  });

  it('formatMessage with no rows says no work', () => {
    const out = service.formatMessage(new Date('2026-04-26'), []);
    expect(out).toContain('— ไม่มีงานวันนี้ —');
  });

  it('formatMessage with one collector includes name + ratio + percent', () => {
    const out = service.formatMessage(new Date('2026-04-26'), [
      { name: 'แนน', pending: 2, done: 16, skipped: 0, total: 18 },
    ]);
    expect(out).toContain('แนน');
    expect(out).toContain('16/18');
    expect(out).toContain('89%');
    expect(out).toContain('ค้าง 2');
  });

  it('formatMessage with multiple collectors adds an overall total', () => {
    const out = service.formatMessage(new Date('2026-04-26'), [
      { name: 'แนน', pending: 0, done: 18, skipped: 0, total: 18 },
      { name: 'กวาง', pending: 0, done: 12, skipped: 2, total: 14 },
    ]);
    expect(out).toContain('รวม: 30/32');
  });

  it('sendDailySummary pushes to OWNERs with lineId', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([{ id: 'u1', name: 'แนน' }]) // SALES collectors
      .mockResolvedValueOnce([
        { id: 'o1', name: 'เจ้าของ', lineId: 'U_LINE_1' },
        { id: 'o2', name: 'เจ้าของ 2', lineId: 'U_LINE_2' },
      ]); // OWNERs
    prisma.dailyAssignment.groupBy.mockResolvedValue([
      { collectorId: 'u1', status: 'DONE', _count: { _all: 18 } },
      { collectorId: 'u1', status: 'PENDING', _count: { _all: 2 } },
    ]);

    const result = await service.sendDailySummary(new Date('2026-04-26'));

    expect(result.recipients).toBe(2);
    expect(result.sent).toBe(2);
    expect(line.pushMessage).toHaveBeenCalledTimes(2);
    expect(line.pushMessage).toHaveBeenCalledWith(
      'U_LINE_1',
      expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
    );
  });

  it('sendDailySummary tolerates per-recipient failure', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'o1', lineId: 'U_LINE_1' },
        { id: 'o2', lineId: 'U_LINE_2' },
      ]);
    prisma.dailyAssignment.groupBy.mockResolvedValue([]);
    line.pushMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('LINE API down'));

    const result = await service.sendDailySummary(new Date('2026-04-26'));

    expect(result.recipients).toBe(2);
    expect(result.sent).toBe(1);
  });
});
