import { Test } from '@nestjs/testing';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { NotificationCategory } from './notification-category.enum';

describe('ComplianceService', () => {
  let service: ComplianceService;
  let prisma: { notificationLog: { count: jest.Mock } };
  let pdpa: { hasActiveConsent: jest.Mock };
  let holiday: { isHoliday: jest.Mock };

  beforeEach(async () => {
    prisma = { notificationLog: { count: jest.fn().mockResolvedValue(0) } };
    pdpa = { hasActiveConsent: jest.fn().mockResolvedValue(true) };
    holiday = { isHoliday: jest.fn().mockReturnValue(false) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: PrismaService, useValue: prisma },
        { provide: PDPAService, useValue: pdpa },
        { provide: HolidayService, useValue: holiday },
      ],
    }).compile();

    service = moduleRef.get(ComplianceService);
  });

  afterEach(() => jest.useRealTimers());

  it('time-window: blocks weekday 23:00 ICT with OUTSIDE_HOURS', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T16:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('OUTSIDE_HOURS');
    expect(result.retryAfter).toBeDefined();
  });

  it('time-window: allows weekday 14:00 ICT', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.allowed).toBe(true);
  });

  it('time-window: blocks weekend 19:00 ICT (after 18:00 weekend cutoff)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-09T12:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.allowed).toBe(false);
  });

  it('time-window: blocks holiday at 19:00 ICT (treated as weekend window)', async () => {
    holiday.isHoliday.mockReturnValueOnce(true);
    jest.useFakeTimers().setSystemTime(new Date('2026-04-13T12:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.allowed).toBe(false);
  });

  it('frequency-cap: blocks 2nd dunning to same (customer + contract) same day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
    prisma.notificationLog.count.mockResolvedValueOnce(1);
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('FREQUENCY_CAP');
  });

  it('frequency-cap: does not apply to REMINDER', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
    prisma.notificationLog.count.mockResolvedValueOnce(5);
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.REMINDER,
    });
    expect(result.allowed).toBe(true);
  });

  it('PDPA: blocks DUNNING when no consent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T07:00:00Z'));
    pdpa.hasActiveConsent.mockResolvedValueOnce(false);
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      contractId: 'k1',
      category: NotificationCategory.DUNNING,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_CONSENT');
  });

  it('bypass: TRANSACTIONAL category always allowed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      category: NotificationCategory.TRANSACTIONAL,
    });
    expect(result.allowed).toBe(true);
  });

  it('bypass: STAFF category always allowed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      category: NotificationCategory.STAFF,
    });
    expect(result.allowed).toBe(true);
  });

  it('bypass: bypassCompliance flag overrides everything', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T20:00:00Z'));
    const result = await service.canSend({
      channel: 'LINE',
      customerId: 'c1',
      category: NotificationCategory.DUNNING,
      bypassCompliance: true,
    });
    expect(result.allowed).toBe(true);
  });

  describe('ensureIdentificationPrefix', () => {
    it('prepends [BESTCHOICE FINANCE] to DUNNING message missing it', () => {
      const result = service.ensureIdentificationPrefix(
        'hello',
        NotificationCategory.DUNNING,
      );
      expect(result).toBe('[BESTCHOICE FINANCE] hello');
    });

    it('leaves DUNNING message that already has prefix unchanged', () => {
      const result = service.ensureIdentificationPrefix(
        '[BESTCHOICE FINANCE] hello',
        NotificationCategory.DUNNING,
      );
      expect(result).toBe('[BESTCHOICE FINANCE] hello');
    });

    it('does not modify REMINDER messages', () => {
      const result = service.ensureIdentificationPrefix(
        'hello',
        NotificationCategory.REMINDER,
      );
      expect(result).toBe('hello');
    });

    it('does not modify TRANSACTIONAL messages', () => {
      const result = service.ensureIdentificationPrefix(
        'hello',
        NotificationCategory.TRANSACTIONAL,
      );
      expect(result).toBe('hello');
    });
  });

  describe('scanForbiddenContent', () => {
    it('detects threatening language', () => {
      const matches = service.scanForbiddenContent('เราจะข่มขู่คุณถ้าไม่จ่าย');
      expect(matches).toContain('threatening language');
    });

    it('allows ดำเนินคดี in LEGAL_ACTION stage', () => {
      const matches = service.scanForbiddenContent(
        'จะดำเนินคดีตามกฎหมาย',
        'LEGAL_ACTION',
      );
      expect(matches).toEqual([]);
    });

    it('blocks ดำเนินคดี in non-LEGAL_ACTION stages', () => {
      const matches = service.scanForbiddenContent('จะดำเนินคดี');
      expect(matches).toContain('legal threat');
    });

    it('returns empty for clean message', () => {
      const matches = service.scanForbiddenContent(
        'แจ้งเตือน: ครบกำหนดชำระงวดที่ 3',
      );
      expect(matches).toEqual([]);
    });
  });
});
