import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SendNotificationDto, CreateNotificationTemplateDto, UpdateNotificationTemplateDto } from './dto/create-notification.dto';
import { NotificationChannel } from '@prisma/client';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  // ============================================================
  // NOTIFICATION SENDING
  // ============================================================

  /**
   * Send a notification via LINE, SMS, or IN_APP
   */
  async send(dto: SendNotificationDto): Promise<{ id: string; status: string }> {
    let status = 'PENDING';
    let errorMsg: string | null = null;
    let sentAt: Date | null = null;

    try {
      if (dto.channel === 'LINE') {
        await this.sendLine(dto.recipient, dto.message);
        status = 'SENT';
        sentAt = new Date();
      } else if (dto.channel === 'SMS') {
        await this.sendSms(dto.recipient, dto.message);
        status = 'SENT';
        sentAt = new Date();
      } else {
        // IN_APP - just log it
        status = 'SENT';
        sentAt = new Date();
      }
    } catch (err) {
      status = 'FAILED';
      errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Notification failed: ${errorMsg}`);
    }

    const log = await this.prisma.notificationLog.create({
      data: {
        channel: dto.channel as NotificationChannel,
        recipient: dto.recipient,
        subject: dto.subject,
        message: dto.message,
        status,
        relatedId: dto.relatedId,
        errorMsg,
        sentAt,
      },
    });

    return { id: log.id, status };
  }

  /**
   * Send LINE message (placeholder - requires LINE Messaging API setup)
   */
  private async sendLine(recipient: string, message: string): Promise<void> {
    // TODO: Implement LINE Messaging API integration
    // For now, log the message
    this.logger.log(`[LINE] To: ${recipient}, Message: ${message.substring(0, 50)}...`);

    // In production, this would use:
    // const client = new messagingApi.MessagingApiClient({ channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN });
    // await client.pushMessage({ to: recipient, messages: [{ type: 'text', text: message }] });
  }

  /**
   * Send SMS (placeholder - requires SMS provider setup)
   */
  private async sendSms(recipient: string, message: string): Promise<void> {
    // TODO: Implement SMS provider (ThaiBulkSMS/Twilio) integration
    this.logger.log(`[SMS] To: ${recipient}, Message: ${message.substring(0, 50)}...`);

    // In production, this would use:
    // await twilioClient.messages.create({ body: message, to: recipient, from: process.env.SMS_FROM_NUMBER });
  }

  /**
   * Send notification using a template with data substitution
   */
  async sendFromTemplate(
    templateId: string,
    data: Record<string, string>,
    recipient: string,
    relatedId?: string,
  ) {
    const template = await this.prisma.systemConfig.findUnique({
      where: { key: `notification_template_${templateId}` },
    });

    if (!template) throw new NotFoundException('ไม่พบ template');

    const templateData = JSON.parse(template.value);
    let message = templateData.messageTemplate as string;

    // Replace placeholders
    for (const [key, value] of Object.entries(data)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    return this.send({
      channel: templateData.channel,
      recipient,
      subject: templateData.subject,
      message,
      relatedId,
    });
  }

  // ============================================================
  // NOTIFICATION LOGS
  // ============================================================

  async findLogs(filters: { channel?: string; status?: string; relatedId?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.channel) where.channel = filters.channel;
    if (filters.status) where.status = filters.status;
    if (filters.relatedId) where.relatedId = filters.relatedId;

    return this.prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 50,
    });
  }

  async getLogStats() {
    const [total, sent, failed, pending] = await Promise.all([
      this.prisma.notificationLog.count(),
      this.prisma.notificationLog.count({ where: { status: 'SENT' } }),
      this.prisma.notificationLog.count({ where: { status: 'FAILED' } }),
      this.prisma.notificationLog.count({ where: { status: 'PENDING' } }),
    ]);

    return { total, sent, failed, pending };
  }

  // ============================================================
  // NOTIFICATION TEMPLATES (stored in system_config)
  // ============================================================

  async findTemplates() {
    const configs = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: 'notification_template_' } },
      orderBy: { key: 'asc' },
    });

    return configs.map((c) => ({
      id: c.key.replace('notification_template_', ''),
      ...JSON.parse(c.value),
      updatedAt: c.updatedAt,
    }));
  }

  async findTemplate(id: string) {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: `notification_template_${id}` },
    });
    if (!config) throw new NotFoundException('ไม่พบ template');

    return {
      id,
      ...JSON.parse(config.value),
      updatedAt: config.updatedAt,
    };
  }

  async createTemplate(dto: CreateNotificationTemplateDto) {
    const id = dto.eventType.toLowerCase() + '_' + dto.channel.toLowerCase();

    const exists = await this.prisma.systemConfig.findUnique({
      where: { key: `notification_template_${id}` },
    });
    if (exists) {
      // Update existing
      return this.updateTemplate(id, {
        name: dto.name,
        subject: dto.subject,
        messageTemplate: dto.messageTemplate,
        description: dto.description,
      });
    }

    const config = await this.prisma.systemConfig.create({
      data: {
        key: `notification_template_${id}`,
        value: JSON.stringify({
          name: dto.name,
          eventType: dto.eventType,
          channel: dto.channel,
          subject: dto.subject,
          messageTemplate: dto.messageTemplate,
          description: dto.description,
          isActive: true,
        }),
        label: `Template: ${dto.name}`,
      },
    });

    return { id, ...JSON.parse(config.value) };
  }

  async updateTemplate(id: string, dto: UpdateNotificationTemplateDto) {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: `notification_template_${id}` },
    });
    if (!config) throw new NotFoundException('ไม่พบ template');

    const existing = JSON.parse(config.value);
    const updated = { ...existing };
    if (dto.name !== undefined) updated.name = dto.name;
    if (dto.subject !== undefined) updated.subject = dto.subject;
    if (dto.messageTemplate !== undefined) updated.messageTemplate = dto.messageTemplate;
    if (dto.description !== undefined) updated.description = dto.description;
    if (dto.isActive !== undefined) updated.isActive = dto.isActive;

    await this.prisma.systemConfig.update({
      where: { key: `notification_template_${id}` },
      data: { value: JSON.stringify(updated) },
    });

    return { id, ...updated };
  }

  async deleteTemplate(id: string) {
    const config = await this.prisma.systemConfig.findUnique({
      where: { key: `notification_template_${id}` },
    });
    if (!config) throw new NotFoundException('ไม่พบ template');

    await this.prisma.systemConfig.delete({
      where: { key: `notification_template_${id}` },
    });

    return { deleted: true };
  }

  // ============================================================
  // SCHEDULING (CRON-BASED)
  // ============================================================

  /**
   * Send payment reminders for upcoming due dates (run daily)
   * Sends reminders 3 days and 1 day before due date
   */
  async sendPaymentReminders() {
    const now = new Date();
    const in1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const upcomingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        dueDate: {
          gte: new Date(now.toISOString().split('T')[0]),
          lte: in3Days,
        },
        contract: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, phone: true, lineId: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of upcomingPayments) {
      const customer = payment.contract.customer;
      const daysUntil = Math.ceil(
        (new Date(payment.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const message = `สวัสดีค่ะ คุณ${customer.name}\nแจ้งเตือน: ค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nจำนวน ${Number(payment.amountDue).toLocaleString()} บาท\nครบกำหนดชำระอีก ${daysUntil} วัน (${new Date(payment.dueDate).toLocaleDateString('th-TH')})\nกรุณาชำระตามกำหนด ขอบคุณค่ะ`;

      // Try LINE first, fallback to SMS
      if (customer.lineId) {
        await this.send({
          channel: 'LINE',
          recipient: customer.lineId,
          message,
          relatedId: payment.contractId,
        });
        sent++;
      } else if (customer.phone) {
        await this.send({
          channel: 'SMS',
          recipient: customer.phone,
          message,
          relatedId: payment.contractId,
        });
        sent++;
      }
    }

    return { sent, total: upcomingPayments.length, timestamp: now };
  }

  /**
   * Send overdue notices (run daily)
   * Sends notices 1, 3, and 7 days after due date
   */
  async sendOverdueNotices() {
    const now = new Date();
    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        dueDate: { lt: now },
        contract: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, phone: true, lineId: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const payment of overduePayments) {
      const customer = payment.contract.customer;
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(payment.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );

      // Only send on day 1, 3, 7
      if (![1, 3, 7].includes(daysOverdue)) continue;

      const outstanding = Number(payment.amountDue) - Number(payment.amountPaid) + Number(payment.lateFee);
      const message = `แจ้งเตือน: คุณ${customer.name}\nค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nเลยกำหนดชำระ ${daysOverdue} วัน\nยอมค้างชำระ ${outstanding.toLocaleString()} บาท (รวมค่าปรับ)\nกรุณาชำระโดยเร็ว`;

      if (customer.lineId) {
        await this.send({
          channel: 'LINE',
          recipient: customer.lineId,
          message,
          relatedId: payment.contractId,
        });
      }
      if (customer.phone) {
        await this.send({
          channel: 'SMS',
          recipient: customer.phone,
          message,
          relatedId: payment.contractId,
        });
      }
      sent++;
    }

    return { sent, total: overduePayments.length, timestamp: now };
  }

  /**
   * Notify managers about overdue contracts (run daily)
   */
  async notifyManagersOverdue() {
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        status: 'OVERDUE',
        deletedAt: null,
      },
      include: {
        customer: { select: { name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            users: {
              where: { role: 'BRANCH_MANAGER', isActive: true },
              select: { name: true, email: true },
            },
          },
        },
      },
    });

    let sent = 0;
    for (const contract of overdueContracts) {
      for (const manager of contract.branch.users) {
        await this.send({
          channel: 'IN_APP',
          recipient: manager.email,
          subject: 'สัญญาค้างชำระ',
          message: `สัญญา ${contract.contractNumber} (${contract.customer.name}) ที่สาขา ${contract.branch.name} มีสถานะค้างชำระ กรุณาติดตาม`,
          relatedId: contract.id,
        });
        sent++;
      }
    }

    return { sent, contracts: overdueContracts.length };
  }

  /**
   * Notify owner about defaulted contracts (run daily)
   */
  async notifyOwnerDefault() {
    const defaultContracts = await this.prisma.contract.findMany({
      where: { status: 'DEFAULT', deletedAt: null },
      include: {
        customer: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });

    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true },
      select: { email: true, name: true },
    });

    let sent = 0;
    for (const owner of owners) {
      if (defaultContracts.length > 0) {
        const contractList = defaultContracts
          .map((c) => `- ${c.contractNumber}: ${c.customer.name} (${c.branch.name})`)
          .join('\n');

        await this.send({
          channel: 'IN_APP',
          recipient: owner.email,
          subject: `สัญญา DEFAULT ${defaultContracts.length} รายการ`,
          message: `สัญญาที่อยู่ในสถานะ DEFAULT:\n${contractList}`,
        });
        sent++;
      }
    }

    return { sent, contracts: defaultContracts.length };
  }
}
