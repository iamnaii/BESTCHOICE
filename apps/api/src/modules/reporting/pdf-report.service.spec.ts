import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfReportService } from './pdf-report.service';
import { PdfReportWeeklyCron } from './pdf-report-weekly.cron';
import { EmailService } from '../email/email.service';
import { OverdueAnalyticsService } from '../overdue/analytics.service';
import { AnalyticsAgingService } from '../overdue/analytics-aging.service';
import { AnalyticsLeaderboardService } from '../overdue/analytics-leaderboard.service';
import { AnalyticsRecoveryService } from '../overdue/analytics-recovery.service';
import { StuckContractsService } from '../overdue/stuck-contracts.service';

const sampleAnalytics = {
  range: '30d' as const,
  weeklyCollectionRate: [
    { weekStart: '2026-04-14', paidCount: 4, dueCount: 5, rate: 0.8 },
  ],
  promiseKeptTrend: [{ weekStart: '2026-04-14', kept: 7, broken: 2 }],
  dunningActionVolume: [{ date: '2026-04-20', sent: 11, failed: 1 }],
  letterDispatchByType: [{ type: 'RETURN_DEVICE_45D', month: '2026-04-01', count: 3 }],
  mdmLockVolume: [{ date: '2026-04-20', proposed: 2, approved: 1 }],
};

const mockAnalytics = { getAnalytics: jest.fn().mockResolvedValue(sampleAnalytics) };
const mockAging = {
  getAgingBuckets: jest
    .fn()
    .mockResolvedValue([{ bucket: '8-30', count: 5, outstanding: 12000 }]),
};
const mockLeaderboard = {
  getLeaderboard: jest
    .fn()
    .mockResolvedValue([{ name: 'Alice', contractsHandled: 12, amountCollected: '34000' }]),
};
const mockRecovery = {
  getRecoveryByChannel: jest
    .fn()
    .mockResolvedValue([{ channel: 'LINE', sent: 10, recovered: 7, rate: 0.7 }]),
};
const mockStuck = {
  getStuckContracts: jest
    .fn()
    .mockResolvedValue([
      { contractNumber: 'CT-001', daysStuck: 21, customerName: 'Bob', status: 'OVERDUE' },
    ]),
};

const mockPrisma = {
  systemConfig: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('PdfReportService', () => {
  let service: PdfReportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PdfReportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OverdueAnalyticsService, useValue: mockAnalytics },
        { provide: AnalyticsAgingService, useValue: mockAging },
        { provide: AnalyticsLeaderboardService, useValue: mockLeaderboard },
        { provide: AnalyticsRecoveryService, useValue: mockRecovery },
        { provide: StuckContractsService, useValue: mockStuck },
      ],
    }).compile();
    service = mod.get(PdfReportService);
  });

  describe('generate (on-demand)', () => {
    it('produces a non-empty PDF buffer with %PDF header', async () => {
      const buf = await service.generate({
        from: new Date('2026-04-18'),
        to: new Date('2026-04-25'),
      });
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(1000);
      expect(buf.subarray(0, 4).toString('ascii')).toBe('%PDF');
      expect(mockAnalytics.getAnalytics).toHaveBeenCalledWith({ range: '30d' });
    });
  });

  describe('recipients (role-gate is on controller; service exercises persistence)', () => {
    it('returns empty when no SystemConfig row exists', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
      const out = await service.getRecipients();
      expect(out).toEqual([]);
    });

    it('persists recipients comma-joined via upsert', async () => {
      mockPrisma.systemConfig.upsert.mockResolvedValueOnce({} as never);
      const out = await service.setRecipients(['  a@x.com ', 'b@y.com']);
      expect(out.recipients).toEqual(['a@x.com', 'b@y.com']);
      const args = mockPrisma.systemConfig.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ key: 'pdf_report_recipients' });
      expect(args.update.value).toBe('a@x.com,b@y.com');
      expect(args.create.value).toBe('a@x.com,b@y.com');
    });
  });
});

describe('PdfReportWeeklyCron', () => {
  let cron: PdfReportWeeklyCron;
  let pdfReport: { generate: jest.Mock; getRecipients: jest.Mock };
  let email: { sendMail: jest.Mock };

  beforeEach(() => {
    pdfReport = {
      generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
      getRecipients: jest.fn(),
    };
    email = { sendMail: jest.fn().mockResolvedValue(true) };
    cron = new PdfReportWeeklyCron(
      pdfReport as unknown as PdfReportService,
      email as unknown as EmailService,
    );
  });

  it('skips sending when no recipients are configured', async () => {
    pdfReport.getRecipients.mockResolvedValueOnce([]);
    const out = await cron.run();
    expect(out).toEqual({ sent: 0, recipients: 0 });
    expect(pdfReport.generate).not.toHaveBeenCalled();
    expect(email.sendMail).not.toHaveBeenCalled();
  });

  it('generates PDF and emails to all configured recipients', async () => {
    pdfReport.getRecipients.mockResolvedValueOnce(['owner@bestchoice.com', 'finance@bestchoice.com']);
    const out = await cron.run();
    expect(out.recipients).toBe(2);
    expect(out.sent).toBe(2);
    expect(pdfReport.generate).toHaveBeenCalledTimes(1);
    const mailArgs = email.sendMail.mock.calls[0][0];
    expect(mailArgs.to).toEqual(['owner@bestchoice.com', 'finance@bestchoice.com']);
    expect(mailArgs.attachments).toHaveLength(1);
    expect(mailArgs.attachments[0].contentType).toBe('application/pdf');
  });
});
