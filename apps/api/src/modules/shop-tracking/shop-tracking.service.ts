import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPII } from '../../utils/pii.util';

export interface RecordVisitInput {
  sessionId: string;
  ip: string;
  userAgent: string;
  pagePath: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  durationSec?: number;
  customerId?: string;
}

@Injectable()
export class ShopTrackingService {
  private readonly logger = new Logger(ShopTrackingService.name);

  constructor(private prisma: PrismaService) {}

  async recordVisit(input: RecordVisitInput): Promise<void> {
    const salt = process.env.PII_HASH_SALT;
    if (!salt) {
      this.logger.warn('PII_HASH_SALT missing — skipping visit tracking');
      return;
    }

    const ipHash = hashPII(input.ip, salt);
    const device = this.detectDevice(input.userAgent);
    const browser = this.detectBrowser(input.userAgent);
    const os = this.detectOS(input.userAgent);

    try {
      await this.prisma.websiteVisit.create({
        data: {
          sessionId: input.sessionId,
          customerId: input.customerId,
          ipHash,
          userAgent: input.userAgent,
          device,
          browser,
          os,
          pagePath: input.pagePath,
          referrer: input.referrer,
          utmSource: input.utmSource,
          utmMedium: input.utmMedium,
          utmCampaign: input.utmCampaign,
          durationSec: input.durationSec,
        },
      });

      await this.prisma.websiteSession.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          customerId: input.customerId,
          ipHash,
          device,
          browser,
          startedAt: new Date(),
          pageCount: 1,
          entryPage: input.pagePath,
          referrer: input.referrer,
          utmSource: input.utmSource,
          utmCampaign: input.utmCampaign,
          reachedCart: input.pagePath === '/cart',
          reachedCheckout: input.pagePath.startsWith('/checkout'),
        },
        update: {
          pageCount: { increment: 1 },
          exitPage: input.pagePath,
          endedAt: new Date(),
          reachedCart: input.pagePath === '/cart' ? true : undefined,
          reachedCheckout: input.pagePath.startsWith('/checkout') ? true : undefined,
        },
      });
    } catch (err) {
      this.logger.error(`Visit tracking failed: ${(err as Error).message}`);
    }
  }

  private detectDevice(ua: string): string {
    if (/Mobile|iPhone|Android.*Mobile/i.test(ua)) return 'mobile';
    if (/Tablet|iPad/i.test(ua)) return 'tablet';
    return 'desktop';
  }

  private detectBrowser(ua: string): string {
    if (/Line\//i.test(ua)) return 'LINE';
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    return 'Other';
  }

  private detectOS(ua: string): string {
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS|Macintosh/i.test(ua)) return 'macOS';
    if (/iPhone|iPad/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Other';
  }
}
