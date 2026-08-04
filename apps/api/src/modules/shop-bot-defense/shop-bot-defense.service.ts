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

  /**
   * Start of the fixed one-minute bucket that `now` falls into.
   * Both the writer and the reader derive the current window from this, so a
   * stored `window_start` that is strictly older than the current bucket means
   * its counter belongs to a window that has already closed.
   */
  private windowStartFor(now: Date = new Date()): Date {
    return new Date(now.getTime() - (now.getTime() % 60_000));
  }

  async recordRateLimit(ip: string, userAgent: string, pagePath: string): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return;
    const ipHash = hashPII(ip, salt);
    // Bind as an ISO string cast to `timestamp`, NOT as a Date. A Date parameter is
    // sent as timestamptz and Postgres then converts it into this column
    // (`timestamp without time zone`) using the session TimeZone — on a non-UTC
    // session that stores a shifted value, which the ORM reads back verbatim and
    // compares against an unshifted clock. Keeping it naive-UTC here matches what
    // every other (ORM) writer in the codebase stores.
    const windowStart = this.windowStartFor().toISOString();

    // Raw upsert because the counter must RESET (not increment) when the stored
    // window has rolled over, and Prisma's `upsert.update` cannot express a
    // conditional. Doing it in one statement also keeps concurrent requests from
    // the same IP from racing a read-then-write.
    try {
      await this.prisma.$executeRaw`
        INSERT INTO ip_rate_limits (ip_hash, window_start, request_count, pages_visited, unique_pages_visited, last_user_agent)
        VALUES (${ipHash}, ${windowStart}::timestamp, 1, 1, 1, ${userAgent})
        ON CONFLICT (ip_hash) DO UPDATE SET
          request_count = CASE WHEN ip_rate_limits.window_start < ${windowStart}::timestamp THEN 1 ELSE ip_rate_limits.request_count + 1 END,
          pages_visited = CASE WHEN ip_rate_limits.window_start < ${windowStart}::timestamp THEN 1 ELSE ip_rate_limits.pages_visited + 1 END,
          window_start = CASE WHEN ip_rate_limits.window_start < ${windowStart}::timestamp THEN ${windowStart}::timestamp ELSE ip_rate_limits.window_start END,
          last_user_agent = ${userAgent}
      `;
    } catch (err) {
      // Caller is fire-and-forget (`void recordRateLimit(...)` in the guard) — an
      // unhandled rejection here would take down the process, and failing to count
      // a hit must never block a shopper.
      this.logger.error(`Rate-limit record failed (${pagePath}): ${(err as Error).message}`);
    }
  }

  async getRequestRate(ip: string): Promise<number> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return 0;
    const ipHash = hashPII(ip, salt);
    const row = await this.prisma.ipRateLimit.findUnique({ where: { ipHash } });
    if (!row) return 0;
    // Counter from a closed window — do not carry it into this minute.
    if (row.windowStart.getTime() < this.windowStartFor().getTime()) return 0;
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
