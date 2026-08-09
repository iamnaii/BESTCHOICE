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

/** ความยาวหน้าต่างนับ rate — ใช้ร่วมกันทั้ง record และ read เพื่อกันค่าคลาดกัน */
export const RATE_LIMIT_WINDOW_MS = 60_000;

const RATE_LIMIT_PER_MIN = 100;
/**
 * หน้ารายการ/รายละเอียดสินค้ายิงหลาย request ต่อการเปิด 1 หน้า (list + models +
 * detail + related + installment-preview) และลูกค้าหลายคนอาจอยู่หลัง NAT เดียวกัน
 * → เพดานต้อง "หลวมกว่า" ปกติ ไม่ใช่แน่นกว่า (บั๊กเดิมตั้งใจให้แน่นกว่าแต่ dead code อยู่)
 */
const CATALOG_RATE_LIMIT_PER_MIN = 240;

/** path (หลังตัด prefix /api แล้ว) ที่ถือเป็นการเดินดูสินค้าปกติ */
function isCatalogPath(pagePath?: string): boolean {
  if (!pagePath) return false;
  return pagePath.startsWith('/shop/products') || pagePath.startsWith('/products');
}

@Injectable()
export class ShopBotDefenseService {
  private readonly logger = new Logger(ShopBotDefenseService.name);

  constructor(private prisma: PrismaService) {}

  classifyUserAgent(ua: string): BotType | null {
    // Social/link-preview crawlers ต้องเช็คก่อนทุกกฎ — ตัวมันคือคนดึงการ์ด OG
    // ของ /api/shop/share/:id ถ้าโดนจัดเป็น SCRAPER/RATE_ABUSE การ์ดจะไม่ขึ้นเลย
    if (/facebookexternalhit|Facebot|Twitterbot|Line-?Poker|LineBot|Slackbot|Discordbot|WhatsApp|TelegramBot|LinkedInBot/i.test(ua))
      return 'KNOWN_GOOD';
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
    const limit = isCatalogPath(input.pagePath) ? CATALOG_RATE_LIMIT_PER_MIN : RATE_LIMIT_PER_MIN;
    if (input.requestRate > limit) {
      return 'RATE_LIMITED';
    }
    return 'LOGGED';
  }

  /**
   * นับ request ต่อ IP ในหน้าต่าง 60 วินาทีแบบ "รีเซ็ตได้จริง"
   *
   * บั๊กเดิม: windowStart ถูกคำนวณเป็นต้นนาทีปัจจุบันแล้วเขียนทับทุกครั้ง ส่วน
   * requestCount ใช้ increment อย่างเดียว → counter ไม่เคยกลับเป็น 1 และ
   * getRequestRate ก็เห็น window ใหม่เสมอ ⇒ IP ที่เคยยิงครบเพดานโดน 429 ถาวร
   *
   * อ่านก่อนเขียน (2 query) แทน raw upsert แบบมีเงื่อนไข เพื่อให้ตรรกะรีเซ็ต
   * ทดสอบได้ด้วย unit test; ช่อง race ที่เหลือทำให้นับพลาดได้ไม่กี่ครั้งต่อ
   * หน้าต่าง ซึ่งรับได้สำหรับ bot-defense (ไม่ใช่เส้นทางเงิน)
   */
  async recordRateLimit(ip: string, userAgent: string, _pagePath: string): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) return;
    const ipHash = hashPII(ip, salt);
    const now = new Date();

    const existing = await this.prisma.ipRateLimit.findUnique({ where: { ipHash } });
    const expired =
      !existing || now.getTime() - existing.windowStart.getTime() >= RATE_LIMIT_WINDOW_MS;

    if (expired) {
      await this.prisma.ipRateLimit.upsert({
        where: { ipHash },
        create: {
          ipHash,
          windowStart: now,
          requestCount: 1,
          pagesVisited: 1,
          uniquePagesVisited: 1,
          lastUserAgent: userAgent,
        },
        update: {
          windowStart: now,
          requestCount: 1,
          pagesVisited: 1,
          lastUserAgent: userAgent,
        },
      });
      return;
    }

    await this.prisma.ipRateLimit.update({
      where: { ipHash },
      data: {
        requestCount: { increment: 1 },
        pagesVisited: { increment: 1 },
        lastUserAgent: userAgent,
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
    if (elapsedMs >= RATE_LIMIT_WINDOW_MS) return 0; // window expired
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
