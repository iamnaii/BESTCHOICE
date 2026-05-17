import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWebhookDto, SUPPORTED_EVENTS, WebhookEventType } from './dto/webhook.dto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * D1.3.3.3 — read the OWNER-editable `webhooks_enabled` SystemConfig flag.
   * **DEFAULT-OFF** per accountant package — outbound webhook dispatch is
   * paused unless OWNER explicitly opts in. (Inbound webhooks like
   * paysolutions / sms / line / facebook are NOT gated by this flag; they
   * are critical for payment processing and run on dedicated controllers.)
   *
   * Read directly via PrismaService (mirrors PR #884's lean readBoolFlag
   * pattern). DB failure falls through to the spec-defined default false.
   */
  private async isWebhooksEnabled(): Promise<boolean> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'webhooks_enabled', deletedAt: null },
        select: { value: true },
      });
      if (!row?.value) return false; // DEFAULT-OFF
      const v = row.value.trim().toLowerCase();
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
      return false; // unparseable → default off
    } catch {
      return false; // DB error → default off (fail-closed for outbound)
    }
  }

  async registerWebhook(dto: CreateWebhookDto, userId: string) {
    const invalidEvents = dto.events.filter(
      (e) => !(SUPPORTED_EVENTS as readonly string[]).includes(e),
    );
    if (invalidEvents.length > 0) {
      throw new BadRequestException(
        `events ไม่รองรับ: ${invalidEvents.join(', ')}. รองรับเฉพาะ: ${SUPPORTED_EVENTS.join(', ')}`,
      );
    }

    return this.prisma.webhookSubscription.create({
      data: {
        name: dto.name,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        createdById: userId,
      },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async listWebhooks() {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { id: true, name: true } },
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { success: true, createdAt: true, statusCode: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return subscriptions.map((s) => ({
      ...s,
      // Mask secret — never expose it
      lastDelivery: s.deliveries[0] || null,
      deliveries: undefined,
    }));
  }

  async getWebhook(id: string) {
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, deletedAt: null },
      include: {
        createdBy: { select: { id: true, name: true } },
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            eventType: true,
            statusCode: true,
            success: true,
            errorMessage: true,
            attemptCount: true,
            deliveredAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!sub) throw new NotFoundException('ไม่พบ webhook subscription');
    return sub;
  }

  async deleteWebhook(id: string) {
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, deletedAt: null },
    });
    if (!sub) throw new NotFoundException('ไม่พบ webhook subscription');
    return this.prisma.webhookSubscription.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async sendTestEvent(id: string) {
    // D1.3.3.3 — short-circuit test sends when webhooks are globally off
    // so OWNER's "Test" click in the UI doesn't silently surprise them.
    if (!(await this.isWebhooksEnabled())) {
      throw new BadRequestException(
        'Webhook outbound dispatch ถูกปิดอยู่ — เปิด SystemConfig key `webhooks_enabled` ก่อนทดสอบ',
      );
    }
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, deletedAt: null },
    });
    if (!sub) throw new NotFoundException('ไม่พบ webhook subscription');

    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test event from BESTCHOICE', subscriptionId: id },
    };

    const result = await this.deliverWebhook(sub, 'test', testPayload.data);
    return {
      success: result.success,
      statusCode: result.statusCode,
      errorMessage: result.errorMessage,
    };
  }

  /**
   * Dispatch an event to all active matching webhook subscriptions.
   * Called from payment/contract services.
   *
   * D1.3.3.3 — gated by `webhooks_enabled` SystemConfig flag (DEFAULT-OFF).
   * Returns silently when disabled so business flows (payment / contract
   * creation) don't error out on the webhook-related side-effect call.
   */
  async dispatchEvent(eventType: WebhookEventType | 'test', payload: Record<string, unknown>) {
    if (!(await this.isWebhooksEnabled())) {
      this.logger.debug(
        `Skipping outbound webhook dispatch for '${eventType}' — webhooks_enabled flag is off`,
      );
      return;
    }
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        events: { has: eventType },
      },
    });

    if (subscriptions.length === 0) return;

    this.logger.log(`Dispatching event '${eventType}' to ${subscriptions.length} subscriber(s)`);

    await Promise.allSettled(
      subscriptions.map((sub) => this.deliverWebhook(sub, eventType, payload)),
    );
  }

  private async deliverWebhook(
    sub: { id: string; url: string; secret: string },
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<{ success: boolean; statusCode: number | null; errorMessage: string | null }> {
    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data,
    });

    const signature = createHmac('sha256', sub.secret).update(body).digest('hex');

    let statusCode: number | null = null;
    let success = false;
    let errorMessage: string | null = null;
    let attemptCount = 1;

    const attempt = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': `sha256=${signature}`,
            'X-Webhook-Event': eventType,
            'User-Agent': 'BESTCHOICE-Webhook/1.0',
          },
          body,
          signal: controller.signal,
        });
        statusCode = response.status;
        success = response.ok;
        if (!success) {
          errorMessage = `HTTP ${response.status}`;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errorMessage = message;
        success = false;
      } finally {
        clearTimeout(timeout);
      }
    };

    await attempt();

    // Retry once on failure
    if (!success) {
      attemptCount = 2;
      await attempt();
    }

    // Log delivery (non-blocking)
    this.prisma.webhookDelivery
      .create({
        data: {
          subscriptionId: sub.id,
          eventType,
          payload: JSON.parse(body) as object,
          statusCode,
          success,
          errorMessage,
          attemptCount,
          deliveredAt: success ? new Date() : null,
        },
      })
      .catch((err: unknown) => {
        this.logger.error('Failed to log webhook delivery', err);
      });

    if (!success) {
      this.logger.warn(
        `Webhook delivery failed for subscription ${sub.id}: ${errorMessage}`,
      );
    }

    return { success, statusCode, errorMessage };
  }
}
