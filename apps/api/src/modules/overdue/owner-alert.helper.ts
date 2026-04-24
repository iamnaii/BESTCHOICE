import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Sends an internal LINE alert to all OWNER users who have lineId set.
 * Used by collections crons to surface pending-approval counts so OWNER
 * doesn't have to poll the approval tab.
 *
 * Silent no-op if no OWNER has lineId — logged but not an error. Individual
 * send failures are swallowed at the caller level (Sentry capture there).
 */
@Injectable()
export class OwnerAlertHelper {
  private readonly logger = new Logger(OwnerAlertHelper.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async sendToAllOwners(
    message: string,
    relatedId?: string,
  ): Promise<{ sent: number; failed: number }> {
    const owners = await this.prisma.user.findMany({
      where: {
        role: 'OWNER',
        isActive: true,
        isSystemUser: false,
        lineId: { not: null },
        deletedAt: null,
      },
      select: { id: true, lineId: true, phone: true },
    });

    if (owners.length === 0) {
      this.logger.log('No OWNER with lineId — skipping alert');
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    for (const owner of owners) {
      try {
        const result = await this.notifications.send({
          channel: 'LINE',
          recipient: owner.lineId!,
          message,
          relatedId: relatedId ?? 'collections-alert',
          fallbackPhone: owner.phone ?? undefined,
        });
        if (result.status === 'SENT') sent++;
        else failed++;
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  }
}
