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
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      botDetectionLog: { create: jest.fn().mockResolvedValue({}) },
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
    it('upserts rate limit row', async () => {
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/products');
      expect(prisma.ipRateLimit.upsert).toHaveBeenCalled();
    });
  });

  describe('classifyUserAgent — social preview crawlers (B4)', () => {
    it('detects facebookexternalhit as KNOWN_GOOD', () => {
      expect(
        service.classifyUserAgent('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'),
      ).toBe('KNOWN_GOOD');
    });
    it('detects Facebot as KNOWN_GOOD', () => {
      expect(service.classifyUserAgent('Facebot')).toBe('KNOWN_GOOD');
    });
    it('detects Twitterbot as KNOWN_GOOD', () => {
      expect(service.classifyUserAgent('Twitterbot/1.0')).toBe('KNOWN_GOOD');
    });
    it('detects the LINE link preview crawler as KNOWN_GOOD', () => {
      expect(service.classifyUserAgent('Mozilla/5.0 (compatible; Line-Poker/1.0)')).toBe('KNOWN_GOOD');
    });
    it('never rate-limits a social crawler even at a huge request rate', () => {
      expect(
        service.decideAction({ userAgent: 'facebookexternalhit/1.1', requestRate: 9999, pagePath: '/shop/share/abc' }),
      ).toBe('LOGGED');
    });
  });

  describe('recordRateLimit — sliding window actually resets (B4 429 bug)', () => {
    it('resets requestCount to 1 when the stored window is older than 60s', async () => {
      prisma.ipRateLimit.findUnique.mockResolvedValue({
        ipHash: 'h',
        windowStart: new Date(Date.now() - 61_000),
        requestCount: 500,
      });
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/shop/products');
      expect(prisma.ipRateLimit.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ requestCount: 1, pagesVisited: 1 }),
        }),
      );
      expect(prisma.ipRateLimit.update).not.toHaveBeenCalled();
    });

    it('increments (does not reset) inside the same 60s window', async () => {
      prisma.ipRateLimit.findUnique.mockResolvedValue({
        ipHash: 'h',
        windowStart: new Date(Date.now() - 5_000),
        requestCount: 7,
      });
      await service.recordRateLimit('1.2.3.4', 'Mozilla/5.0', '/shop/products');
      expect(prisma.ipRateLimit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requestCount: { increment: 1 } }),
        }),
      );
      expect(prisma.ipRateLimit.upsert).not.toHaveBeenCalled();
    });

    it('creates a fresh row when the IP has never been seen', async () => {
      prisma.ipRateLimit.findUnique.mockResolvedValue(null);
      await service.recordRateLimit('9.9.9.9', 'Mozilla/5.0', '/shop/products');
      expect(prisma.ipRateLimit.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ requestCount: 1 }) }),
      );
    });
  });

  describe('getRequestRate — expired window reads as 0', () => {
    it('returns 0 when the stored window is older than 60s', async () => {
      prisma.ipRateLimit.findUnique.mockResolvedValue({
        ipHash: 'h',
        windowStart: new Date(Date.now() - 60_001),
        requestCount: 900,
      });
      expect(await service.getRequestRate('1.2.3.4')).toBe(0);
    });
    it('returns the stored count inside the window', async () => {
      prisma.ipRateLimit.findUnique.mockResolvedValue({
        ipHash: 'h',
        windowStart: new Date(Date.now() - 1_000),
        requestCount: 12,
      });
      expect(await service.getRequestRate('1.2.3.4')).toBe(12);
    });
  });
});
