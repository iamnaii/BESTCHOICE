import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { FINANCE_STATUS_LABEL } from '../finance-application-status.util';

const TODO_TAG = 'gfin';

@Injectable()
export class FinanceApplicationNotifyService {
  private readonly logger = new Logger(FinanceApplicationNotifyService.name);
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** GFIN ตอบผ่านลิงก์ → Todo HIGH ให้ผู้ส่ง + แจ้งเตือนในแอป (spec §9) — ห้าม throw ออก */
  async partnerReplied(applicationId: string): Promise<void> {
    const app = await this.prisma.externalFinanceApplication.findFirst({
      where: { id: applicationId, deletedAt: null },
      include: {
        events: {
          where: { actorType: 'PARTNER', kind: { in: ['PARTNER_APPROVED', 'PARTNER_REJECTED', 'PARTNER_MORE_INFO', 'PARTNER_ACK'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!app) return;
    const assigneeId = app.sentById ?? app.createdById;
    const latest = app.events[0];
    const label = FINANCE_STATUS_LABEL[app.status];
    const title = `GFIN ตอบใบยื่น ${app.number}: ${label}`;
    const description = [
      latest?.note ? `หมายเหตุจาก GFIN: ${latest.note}` : null,
      `เปิดห้องแชท → แท็บ GFIN เพื่อดูรายละเอียด`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const open = await this.prisma.todo.findFirst({
        where: { assigneeId, tags: { has: TODO_TAG }, title, status: { not: 'DONE' }, deletedAt: null },
        select: { id: true },
      });
      if (!open) {
        const system = await this.prisma.user.findFirst({ where: { isSystemUser: true, deletedAt: null }, select: { id: true } });
        await this.prisma.todo.create({
          data: {
            title,
            description,
            priority: 'HIGH',
            createdById: system?.id ?? assigneeId,
            assigneeId,
            roomId: app.roomId,
            tags: [TODO_TAG],
          },
        });
      }
    } catch (err) {
      this.logger.warn(`todo create failed app=${app.id}: ${(err as Error).message}`);
    }

    try {
      await this.notifications.send({ channel: 'IN_APP', recipient: assigneeId, subject: title, message: description, relatedId: app.id });
    } catch (err) {
      this.logger.warn(`IN_APP notify failed app=${app.id}: ${(err as Error).message}`);
    }
  }
}
