import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineMessagePayload } from '../dto/webhook-event.dto';
import { FlexMessagePayload } from '../flex-messages/base-template';
import { buildPromotionFlex } from '../flex-messages/campaign.flex';
import { buildThankYouFlex } from '../flex-messages/campaign.flex';
import { buildNewProductFlex } from '../flex-messages/campaign.flex';
import {
  CampaignSendDto,
  CampaignTargetGroup,
  CampaignMessageType,
  CampaignFlexTemplate,
} from '../dto/campaign-send.dto';
import { LineApiClientService } from './line-api-client.service';

@Injectable()
export class LineCampaignService {
  private readonly logger = new Logger(LineCampaignService.name);

  constructor(
    private prisma: PrismaService,
    private apiClient: LineApiClientService,
  ) {}

  // ─── Campaign Methods ─────────────────────────────────

  /**
   * Send a bulk LINE campaign to a target group of customers.
   * Fire-and-forget: validates input, then sends asynchronously.
   */
  async sendCampaign(dto: CampaignSendDto): Promise<{ queued: number; sent: number; failed: number }> {
    // Validate: text messages require message body, flex requires template
    if (dto.messageType === CampaignMessageType.TEXT && !dto.message) {
      throw new BadRequestException('กรุณาระบุข้อความสำหรับ text message');
    }
    if (dto.messageType === CampaignMessageType.FLEX && !dto.flexTemplate) {
      throw new BadRequestException('กรุณาเลือก Flex template');
    }

    // Query target customers with lineId
    const customers = await this.getCampaignTargetCustomers(dto.targetGroup);
    if (customers.length === 0) {
      return { queued: 0, sent: 0, failed: 0 };
    }

    // Build message payload
    const buildMessage = (customerName: string): LineMessagePayload[] | FlexMessagePayload => {
      if (dto.messageType === CampaignMessageType.TEXT) {
        return [{ type: 'text', text: dto.message! }] as LineMessagePayload[];
      }

      // Flex message
      switch (dto.flexTemplate) {
        case CampaignFlexTemplate.PROMOTION:
          return buildPromotionFlex({
            title: dto.customData?.title || 'โปรโมชั่นพิเศษ',
            subtitle: dto.customData?.subtitle || 'จาก BEST CHOICE',
            imageUrl: dto.customData?.imageUrl,
            ctaUrl: dto.customData?.ctaUrl,
          });
        case CampaignFlexTemplate.THANK_YOU:
          return buildThankYouFlex({
            customerName,
            message: dto.message,
          });
        case CampaignFlexTemplate.NEW_PRODUCT:
          return buildNewProductFlex({
            productName: dto.customData?.title || 'สินค้าใหม่',
            imageUrl: dto.customData?.imageUrl,
            price: dto.customData?.price,
            ctaUrl: dto.customData?.ctaUrl,
          });
        default:
          throw new BadRequestException(`ไม่รู้จัก flex template: ${dto.flexTemplate}`);
      }
    };

    // Send in batches of 50 with 1s delay — fire-and-forget
    const result = { sent: 0, failed: 0 };
    const batchSize = 50;

    // Execute sending asynchronously (don't block the request)
    this.executeCampaignSend(customers, buildMessage, dto, batchSize, result).catch((err) => {
      this.logger.error(`[Campaign] Async send failed: ${err}`);
    });

    // Return immediately — sending happens asynchronously
    return { queued: customers.length, sent: 0, failed: 0 };
  }

  /**
   * Execute campaign sending in batches (runs asynchronously)
   */
  private async executeCampaignSend(
    customers: Array<{ lineId: string; name: string }>,
    buildMessage: (customerName: string) => LineMessagePayload[] | FlexMessagePayload,
    dto: CampaignSendDto,
    batchSize: number,
    _result: { sent: number; failed: number },
  ): Promise<void> {
    let totalSent = 0;
    let totalFailed = 0;
    const campaignId = `campaign-${Date.now()}`;

    for (let i = 0; i < customers.length; i += batchSize) {
      const batch = customers.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (customer) => {
          try {
            const msg = buildMessage(customer.name);

            if (dto.messageType === CampaignMessageType.TEXT) {
              await this.apiClient.pushMessage(customer.lineId, msg as LineMessagePayload[], 'line-shop');
            } else {
              await this.apiClient.sendFlexMessage(customer.lineId, msg as FlexMessagePayload, 'line-shop');
            }

            // Log success
            await this.prisma.notificationLog.create({
              data: {
                channel: 'LINE',
                recipient: customer.lineId,
                subject: `campaign:${dto.targetGroup}:${dto.flexTemplate || 'text'}`,
                message: dto.message || `campaign flex: ${dto.flexTemplate}`,
                status: 'SENT',
                sentAt: new Date(),
                relatedId: campaignId,
              },
            });

            return 'sent';
          } catch (err) {
            // Log failure
            await this.prisma.notificationLog.create({
              data: {
                channel: 'LINE',
                recipient: customer.lineId,
                subject: `campaign:${dto.targetGroup}:${dto.flexTemplate || 'text'}`,
                message: dto.message || `campaign flex: ${dto.flexTemplate}`,
                status: 'FAILED',
                errorMsg: err instanceof Error ? err.message : String(err),
                sentAt: new Date(),
                relatedId: campaignId,
              },
            });

            return 'failed';
          }
        }),
      );

      let rateLimitedSeconds = 0;
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value === 'sent') totalSent++;
        else totalFailed++;
        // (Audit finding W6) Detect 429 Retry-After surfaced by callLineApi.
        // If any item in the batch was rate-limited, sleep at least the
        // requested interval before the next batch instead of barrelling
        // through with the fixed 1s gap.
        if (r.status === 'rejected' && r.reason instanceof Error) {
          const m = r.reason.message?.match(/429.*retry after (\d+)s/i);
          if (m) {
            const sec = Number.parseInt(m[1], 10);
            if (sec > rateLimitedSeconds) rateLimitedSeconds = sec;
          }
        }
      }

      // Wait between batches — honour LINE Retry-After if seen, else 1s default.
      if (i + batchSize < customers.length) {
        const waitMs = Math.max(rateLimitedSeconds * 1000, 1000);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    this.logger.log(
      `[Campaign] Completed: sent=${totalSent}, failed=${totalFailed}, target=${dto.targetGroup}`,
    );
  }

  /**
   * Query customers matching the campaign target group who have lineId
   */
  private async getCampaignTargetCustomers(
    targetGroup: CampaignTargetGroup,
  ): Promise<Array<{ lineId: string; name: string }>> {
    switch (targetGroup) {
      case CampaignTargetGroup.ALL: {
        const customers = await this.prisma.customer.findMany({
          where: { lineIdShop: { not: null }, deletedAt: null, pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } } },
          select: { lineIdShop: true, name: true },
        });
        return customers
          .filter((c): c is { lineIdShop: string; name: string } => c.lineIdShop !== null)
          .map((c) => ({ lineId: c.lineIdShop, name: c.name }));
      }

      case CampaignTargetGroup.ACTIVE: {
        const customers = await this.prisma.customer.findMany({
          where: {
            lineIdShop: { not: null },
            deletedAt: null,
            pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } },
            contracts: {
              some: { status: 'ACTIVE', deletedAt: null },
            },
          },
          select: { lineIdShop: true, name: true },
        });
        return customers
          .filter((c): c is { lineIdShop: string; name: string } => c.lineIdShop !== null)
          .map((c) => ({ lineId: c.lineIdShop, name: c.name }));
      }

      case CampaignTargetGroup.OVERDUE: {
        const customers = await this.prisma.customer.findMany({
          where: {
            lineIdShop: { not: null },
            deletedAt: null,
            pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } },
            contracts: {
              some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null },
            },
          },
          select: { lineIdShop: true, name: true },
        });
        return customers
          .filter((c): c is { lineIdShop: string; name: string } => c.lineIdShop !== null)
          .map((c) => ({ lineId: c.lineIdShop, name: c.name }));
      }

      case CampaignTargetGroup.COMPLETED: {
        // Customers who have all contracts completed (loyalty group)
        const customers = await this.prisma.customer.findMany({
          where: {
            lineIdShop: { not: null },
            deletedAt: null,
            pdpaConsents: { some: { status: 'GRANTED', deletedAt: null } },
            contracts: {
              some: { deletedAt: null },
            },
          },
          select: {
            lineIdShop: true,
            name: true,
            contracts: {
              where: { deletedAt: null },
              select: { status: true },
            },
          },
        });

        return customers
          .filter((c) => {
            // All contracts must be COMPLETED or EARLY_PAYOFF
            return (
              c.lineIdShop !== null &&
              c.contracts.length > 0 &&
              c.contracts.every((con) =>
                ['COMPLETED', 'EARLY_PAYOFF'].includes(con.status),
              )
            );
          })
          .map((c) => ({ lineId: c.lineIdShop!, name: c.name }));
      }

      default:
        return [];
    }
  }

  /**
   * Get campaign history from NotificationLog
   */
  async getCampaignHistory(): Promise<
    Array<{
      date: string;
      targetGroup: string;
      messageType: string;
      sent: number;
      failed: number;
    }>
  > {
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        channel: 'LINE',
        subject: { startsWith: 'campaign:' },
        deletedAt: null,
      },
      orderBy: { sentAt: 'desc' },
      take: 1000,
    });

    // Group by relatedId (campaign batch)
    const campaignMap = new Map<
      string,
      {
        date: string;
        targetGroup: string;
        messageType: string;
        sent: number;
        failed: number;
      }
    >();

    for (const log of logs) {
      const key = log.relatedId || log.id;
      const existing = campaignMap.get(key);

      // Parse subject: "campaign:ALL:promotion"
      const parts = (log.subject || '').split(':');
      const targetGroup = parts[1] || 'UNKNOWN';
      const messageType = parts[2] || 'text';
      const date = log.sentAt
        ? log.sentAt.toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      if (existing) {
        if (log.status === 'SENT') existing.sent++;
        else existing.failed++;
      } else {
        campaignMap.set(key, {
          date,
          targetGroup,
          messageType,
          sent: log.status === 'SENT' ? 1 : 0,
          failed: log.status === 'FAILED' ? 1 : 0,
        });
      }
    }

    return Array.from(campaignMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  }
}
