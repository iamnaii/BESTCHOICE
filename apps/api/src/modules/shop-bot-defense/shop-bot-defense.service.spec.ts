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
});
