import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPII } from '../../utils/pii.util';

export type BotType =
  | 'AI_CRAWLER'
  | 'GENERIC_BOT'
  | 'SCRAPER'
  | 'HEADLESS_BROWSER'
  | 'RATE_ABUSE'
  | 'PRICE_MONITOR'
  | 'KNOWN_GOOD';

export type BotAction = 'LOGGED' | 'RATE_LIMITED' | 'CAPTCHA_REQUIRED' | 'BLOCKED' | 'CLOAKED';

const RATE_LIMIT_PER_MIN = 100;
const CATALOG_RATE_LIMIT_PER_MIN = 30;

@Injectable()
export class ShopBotDefenseService {
  private readonly logger = new Logger(ShopBotDefenseService.name);

  constructor(private prisma: PrismaService) {}

  classifyUserAgent(ua: string): BotType | null {
    if (/GPTBot|ClaudeBot|Anthropic-AI|PerplexityBot|Google-Extended/i.test(ua)) return 'AI_CRAWLER';
    if (/Bytespider|CCBot/i.test(ua)) return 'SCRAPER';
    if (/HeadlessChrome|PhantomJS|Selenium|Puppeteer/i.test(ua)) return 'HEADLESS_BROWSER';
    if (/wget|curl|python-requests|axios|node-fetch|scrapy/i.test(ua)) return 'SCRAPER';
    if (/Googlebot|Bingbot|DuckDuckBot|Slurp|Baiduspider/i.test(ua)) return 'KNOWN_GOOD';
    return null;
  }

  decideAction(input: { userAgent: string; requestRate: number; pagePath?: string }): BotAction {
    const type = this.classifyUserAgent(input.userAgent);

    // Aggressive scrapers — block
    if (type === 'SCRAPER' && /Bytespider|CCBot/i.test(input.userAgent)) {
      return 'BLOCKED';
    }
    // Other scraper tools (curl/wget) — captcha required
    if (type === 'SCRAPER') {
      return 'CAPTCHA_REQUIRED';
    }
    // Headless — captcha
    if (type === 'HEADLESS_BROWSER') {
      return 'CAPTCHA_REQUIRED';
    }
    // AI crawlers — allow + log (friendly to AI discovery for SEO)
    if (type === 'AI_CRAWLER') {
      return 'LOGGED';
    }
    // Known good search bots — allow
    if (type === 'KNOWN_GOOD') {
      return 'LOGGED';
    }
    // Rate limit check for normal browsers
    const limit = input.pagePath?.startsWith('/products') ? CATALOG_RATE_LIMIT_PER_MIN * 2 : RATE_LIMIT_PER_MIN;
    if (input.requestRate > limit) {
      return 'RATE_LIMITED';
    }
    return 'LOGGED';
  }

  async recordRateLimit(ip: string, userAgent: string, pagePath: string): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return;
    const ipHash = hashPII(ip, salt);
    const now = new Date();
    const windowStart = new Date(now.getTime() - (now.getTime() % 60_000));

    await this.prisma.ipRateLimit.upsert({
      where: { ipHash },
      create: {
        ipHash,
        windowStart,
        requestCount: 1,
        pagesVisited: 1,
        uniquePagesVisited: 1,
        lastUserAgent: userAgent,
      },
      update: {
        requestCount: { increment: 1 },
        pagesVisited: { increment: 1 },
        lastUserAgent: userAgent,
        windowStart: now.getTime() - windowStart.getTime() > 60_000 ? now : windowStart,
      },
    });
  }

  async getRequestRate(ip: string): Promise<number> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return 0;
    const ipHash = hashPII(ip, salt);
    const row = await this.prisma.ipRateLimit.findUnique({ where: { ipHash } });
    if (!row) return 0;
    const elapsedMs = Date.now() - row.windowStart.getTime();
    if (elapsedMs > 60_000) return 0; // window expired
    return row.requestCount;
  }

  async logDetection(input: {
    ip: string;
    userAgent: string;
    pagePath: string;
    detectedType: BotType;
    action: BotAction;
    signals: Record<string, unknown>;
  }): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return;
    try {
      await this.prisma.botDetectionLog.create({
        data: {
          ipHash: hashPII(input.ip, salt),
          userAgent: input.userAgent,
          detectedType: input.detectedType,
          signals: input.signals as object,
          pagePath: input.pagePath,
          action: input.action,
        },
      });
    } catch (err) {
      this.logger.error(`Bot detection log failed: ${(err as Error).message}`);
    }
  }
}
