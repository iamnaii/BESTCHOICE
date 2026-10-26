import { Test } from '@nestjs/testing';
import { CollectionsSummaryService } from './collections-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StaffNotifyService } from '../staff-notify/staff-notify.service';

describe('CollectionsSummaryService', () => {
  let service: CollectionsSummaryService;
  let prisma: any;
  let staffNotify: any;

  beforeEach(async () => {
    const prismaMock: any = {
      user: { findMany: jest.fn() },
      dailyAssignment: { groupBy: jest.fn() },
    };
    const hubMock = { notify: jest.fn().mockResolvedValue({ recipients: 2, sent: 2, deduped: 0, failed: 0, quotaSkipped: 0 }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CollectionsSummaryService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StaffNotifyService, useValue: hubMock },
      ],
    }).compile();
    service = moduleRef.get(CollectionsSummaryService);
    prisma = moduleRef.get(PrismaService);
    staffNotify = moduleRef.get(StaffNotifyService);
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

  it('sendDailySummary notifies the staff LINE hub once', async () => {
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
    // ก้อน 7 A16 — ผ่านท่อกลาง (เจ้าของ+ผจก.การเงิน ตามสวิตช์) · วันละครั้ง
    expect(staffNotify.notify).toHaveBeenCalledTimes(1);
    expect(staffNotify.notify).toHaveBeenCalledWith('collections.daily_summary', expect.objectContaining({
      title: expect.stringMatching(/^สรุปงานเก็บเงิน/),
      lines: expect.arrayContaining([expect.stringMatching(/แนน/)]),
      link: '/collections',
      dedupeKey: '2026-04-26',
    }));
  });

  it('sendDailySummary tolerates per-recipient failure', async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'o1', lineId: 'U_LINE_1' },
        { id: 'o2', lineId: 'U_LINE_2' },
      ]);
    prisma.dailyAssignment.groupBy.mockResolvedValue([]);
    staffNotify.notify.mockResolvedValueOnce({ recipients: 2, sent: 1, deduped: 0, failed: 1, quotaSkipped: 0 });

    const result = await service.sendDailySummary(new Date('2026-04-26'));

    expect(result.recipients).toBe(2);
    expect(result.sent).toBe(1);
  });
});
