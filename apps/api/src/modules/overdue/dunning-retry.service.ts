import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/notification-category.enum';

@Injectable()
export class DunningRetryService {
  private readonly logger = new Logger(DunningRetryService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * List DunningActions with status=FAILED, newest first.
   * Includes contract.customer (for display) and dunningRule (for channel info).
   */
  async listFailed(limit = 100) {
    return this.prisma.dunningAction.findMany({
      where: { status: 'FAILED', deletedAt: null },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
          },
        },
        dunningRule: {
          select: { id: true, name: true, channel: true, messageTemplate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Retry a single failed DunningAction.
   * Re-sends via NotificationsService using stored messageContent + recipient from contract.customer.
   * - On success: updates status=SENT
   * - On failure: keeps status=FAILED and updates result text
   */
  async retry(actionId: string, userId: string) {
    const action = await this.prisma.dunningAction.findUnique({
      where: { id: actionId },
      include: {
        contract: {
          select: {
            id: true,
            contractNumber: true,
            customer: { select: { id: true, name: true, phone: true, lineIdFinance: true } },
          },
        },
        dunningRule: {
          select: { id: true, name: true, channel: true },
        },
      },
    });

    if (!action || action.deletedAt) {
      throw new NotFoundException('ไม่พบ DunningAction');
    }

    if (action.status !== 'FAILED') {
      throw new BadRequestException('สามารถ retry ได้เฉพาะ DunningAction ที่มีสถานะ FAILED เท่านั้น');
    }

    const customer = action.contract.customer;
    const channel = action.dunningRule.channel;

    // Resolve recipient based on channel
    const recipient =
      channel === 'LINE' ? customer.lineIdFinance : customer.phone;

    if (!recipient) {
      throw new BadRequestException(
        `ไม่พบผู้รับสำหรับช่องทาง ${channel} (ลูกค้า: ${customer.name})`,
      );
    }

    const message = action.messageContent ?? action.dunningRule.channel;

    try {
      const sendResult = await this.notificationsService.send({
        channel: channel as 'LINE' | 'SMS',
        channelKey: channel === 'LINE' ? 'line-finance' : undefined,
        recipient,
        message,
        relatedId: action.contractId,
        subject: `Dunning retry: ${action.dunningRule.name}`,
        noRetry: true, // manual retry — don't re-enqueue on failure
        customerId: customer.id,
        category: NotificationCategory.DUNNING,
      });

      if (sendResult.status === 'SENT') {
        const updated = await this.prisma.dunningAction.update({
          where: { id: actionId },
          data: {
            status: 'SENT',
            executedAt: new Date(),
            executedById: userId,
            result: `manual retry OK — notif ${sendResult.id}`,
          },
        });
        this.logger.log(`[DunningRetry] action ${actionId} retry succeeded by user ${userId}`);
        return updated;
      } else {
        // send returned FAILED without throwing
        await this.prisma.dunningAction.update({
          where: { id: actionId },
          data: {
            result: `manual retry failed: ${sendResult.errorMsg ?? 'unknown'}`,
            updatedAt: new Date(),
          },
        });
        throw new BadRequestException(
          `ส่ง ${channel} ไม่สำเร็จ: ${sendResult.errorMsg ?? 'unknown'}`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;

      const errMsg = err instanceof Error ? err.message : String(err);
      await this.prisma.dunningAction.update({
        where: { id: actionId },
        data: {
          result: `manual retry exception: ${errMsg}`,
          updatedAt: new Date(),
        },
      });
      throw new BadRequestException(`ส่ง ${channel} ไม่สำเร็จ: ${errMsg}`);
    }
  }
}
