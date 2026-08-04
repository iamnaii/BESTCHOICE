import { Test } from '@nestjs/testing';
import { ShopBotDefenseService } from './shop-bot-defense.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ShopBotDefenseService', () => {
  let service: ShopBotDefenseService;
  let prisma: any;

  beforeEach(async () => {
    process.env.PII_HASH_SALT = 'test-salt-32-chars-minimum-needed-here';
    prisma = {
      ipRateLimit: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      botDetectionLog: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const module = await Test.createTestingModule({
      providers: [ShopBotDefenseService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ShopBotDefenseService);
  });

  afterEach(() => { delete process.env.PII_HASH_SALT; });

  describe('classifyUserAgent', () => {
    it('detects GPTBot as AI_CRAWLER', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 GPTBot/1.0')).toBe('AI_CRAWLER');
    });
    it('detects ClaudeBot as AI_CRAWLER', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 ClaudeBot/1.0')).toBe('AI_CRAWLER');
    });
    it('detects Anthropic-AI as AI_CRAWLER', () => {
      expect(service.classifyUserAgent('Anthropic-AI/1.0')).toBe('AI_CRAWLER');
    });
    it('detects Bytespider as SCRAPER', () => {
      expect(service.classifyUserAgent('Bytespider')).toBe('SCRAPER');
    });
    it('detects HeadlessChrome as HEADLESS_BROWSER', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 HeadlessChrome/100')).toBe('HEADLESS_BROWSER');
    });
    it('detects curl as SCRAPER', () => {
      expect(service.classifyUserAgent('curl/7.64.1')).toBe('SCRAPER');
    });
    it('detects Googlebot as KNOWN_GOOD', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 Googlebot/2.1')).toBe('KNOWN_GOOD');
    });
    it('returns null for normal browser', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 (iPhone) Safari/605')).toBeNull();
    });
  });

  describe('decideAction', () => {
    it('blocks aggressive scrapers (Bytespider)', () => {
      const action = service.decideAction({ userAgent: 'Bytespider', requestRate: 10 });
      expect(action).toBe('BLOCKED');
    });
    it('logs (allows) AI crawlers — friendly to AI discovery', () => {
      const action = service.decideAction({ userAgent: 'GPTBot', requestRate: 10 });
      expect(action).toBe('LOGGED');
    });
    it('rate-limits when request rate too high', () => {
      const action = service.decideAction({ userAgent: 'normal', requestRate: 200 });
      expect(action).toBe('RATE_LIMITED');
    });
    it('captcha for headless browsers', () => {
      const action = service.decideAction({ userAgent: 'HeadlessChrome', requestRate: 5 });
      expect(action).toBe('CAPTCHA_REQUIRED');
    });
    it('allows normal traffic', () => {
      const action = service.decideAction({ userAgent: 'Mozilla/5.0 Safari', requestRate: 5 });
      expect(action).toBe('LOGGED');
    });
  });

  describe('recordRateLimit', () => {
    /** ดึง SQL ที่ประกอบจาก tagged-template ของ $executeRaw ออกมาเป็นสตริงเดียว */
    const sqlOf = (call: any[]): string => (call[0] as string[]).join(' ? ');

    it('records the hit through an atomic upsert (ON CONFLICT) — not a read-then-write', async () => {
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
      expect(sql).toContain('INSERT INTO ip_rate_limits');
      expect(sql).toContain('ON CONFLICT');
    });

    it('resets request_count to 1 when the stored window is an older minute', async () => {
      // นี่คือหัวใจของบั๊ก 429 ถาวร: ของเดิม increment อย่างเดียว ไม่เคยรีเซ็ต
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
      expect(sql).toMatch(/request_count\s*=\s*CASE\s+WHEN\s+ip_rate_limits\.window_start\s*<\s*\?/i);
      expect(sql).toMatch(/window_start\s*=\s*CASE\s+WHEN\s+ip_rate_limits\.window_start\s*<\s*\?/i);
    });

    it('never pushes window_start forward inside the same minute (that is what disabled expiry)', async () => {
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      const sql = sqlOf(prisma.$executeRaw.mock.calls[0]);
      // ELSE ต้องคงค่าเดิมไว้ ไม่ใช่เขียนทับด้วยเวลาปัจจุบัน
      expect(sql).toMatch(/ELSE\s+ip_rate_limits\.window_start\s+END/i);
    });

    it('passes the start-of-minute bucket as a naive-UTC string, never a Date', async () => {
      // ห้าม bind เป็น Date: Postgres จะส่งเป็น timestamptz แล้วแปลงลงคอลัมน์
      // `timestamp without time zone` ตาม session TimeZone → บน session ที่ไม่ใช่ UTC
      // ค่าที่เก็บจะเลื่อน (เครื่องไทย +7 ชม.) แล้ว getRequestRate จะมองว่ายังไม่หมดอายุตลอด
      jest.useFakeTimers().setSystemTime(new Date('2026-08-04T10:15:37.512Z'));
      try {
        await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      } finally {
        jest.useRealTimers();
      }
      const values = prisma.$executeRaw.mock.calls[0].slice(1) as unknown[];
      expect(values.some((v) => v instanceof Date)).toBe(false);
      expect(values).toContain('2026-08-04T10:15:00.000Z');
      expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toContain('::timestamp');
    });

    it('is a no-op when PII_HASH_SALT is unset (fail-open)', async () => {
      delete process.env.PII_HASH_SALT;
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('swallows DB errors — the guard calls this fire-and-forget', async () => {
      prisma.$executeRaw.mockRejectedValueOnce(new Error('connection reset'));
      await expect(
        service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getRequestRate', () => {
    it('returns 0 when there is no row', async () => {
      prisma.ipRateLimit.findUnique.mockResolvedValue(null);
      await expect(service.getRequestRate('1.2.3.4')).resolves.toBe(0);
    });

    it('returns the count when the row is in the current minute', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-04T10:15:37.512Z'));
      try {
        prisma.ipRateLimit.findUnique.mockResolvedValue({
          windowStart: new Date('2026-08-04T10:15:00.000Z'),
          requestCount: 42,
        });
        await expect(service.getRequestRate('1.2.3.4')).resolves.toBe(42);
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns 0 for a count left over from a previous minute — even at the exact boundary', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-04T10:16:00.000Z'));
      try {
        prisma.ipRateLimit.findUnique.mockResolvedValue({
          windowStart: new Date('2026-08-04T10:15:00.000Z'),
          requestCount: 5000,
        });
        // ของเดิมใช้ elapsedMs > 60_000 → ตรงขอบพอดีจะคืน 5000 (ลูกค้าโดน 429 ต่อ)
        await expect(service.getRequestRate('1.2.3.4')).resolves.toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
