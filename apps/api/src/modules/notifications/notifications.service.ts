import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SendNotificationDto, CreateNotificationTemplateDto, UpdateNotificationTemplateDto } from './dto/create-notification.dto';
import { NotificationChannel } from '@prisma/client';
import { buildPaymentReminderFlex } from '../line-oa/flex-messages/payment-reminder.flex';
import { buildOverdueNoticeFlex } from '../line-oa/flex-messages/overdue-notice.flex';
import { FlexMessagePayload } from '../line-oa/flex-messages/base-template';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly lineChannelAccessToken: string | undefined;
  private readonly smsApiKey: string | undefined;
  private readonly smsApiSecret: string | undefined;
  private readonly smsSender: string | undefined;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.lineChannelAccessToken = this.configService.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
    this.smsApiKey = this.configService.get<string>('SMS_API_KEY');
    this.smsApiSecret = this.configService.get<string>('SMS_API_SECRET');
    this.smsSender = this.configService.get<string>('SMS_SENDER') || 'BESTCHOICE';
  }

  // ============================================================
  // NOTIFICATION SENDING
  // ============================================================

  /**
   * Send a notification via LINE, SMS, or IN_APP with retry support
   */
  async send(dto: SendNotificationDto): Promise<{ id: string; status: string }> {
    let status = 'PENDING';
    let errorMsg: string | null = null;
    let sentAt: Date | null = null;
    let retryCount = 0;
    const maxRetries = 2;

    const attemptSend = async (): Promise<void> => {
      if (dto.channel === 'LINE') {
        await this.sendLine(dto.recipient, dto.message);
      } else if (dto.channel === 'SMS') {
        await this.sendSms(dto.recipient, dto.message);
      }
      // IN_APP requires no external call
    };

    while (retryCount <= maxRetries) {
      try {
        await attemptSend();
        status = 'SENT';
        sentAt = new Date();
        break;
      } catch (err) {
        retryCount++;
        errorMsg = err instanceof Error ? err.message : 'Unknown error';

        if (retryCount <= maxRetries) {
          this.logger.warn(`Notification retry ${retryCount}/${maxRetries}: ${errorMsg}`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount));
        } else {
          status = 'FAILED';
          this.logger.error(`Notification failed after ${maxRetries} retries: ${errorMsg}`);

          // Fallback: if LINE failed, try SMS
          if (dto.channel === 'LINE' && dto.fallbackPhone) {
            this.logger.log(`Attempting SMS fallback for failed LINE notification`);
            try {
              await this.sendSms(dto.fallbackPhone, dto.message);
              status = 'SENT';
              sentAt = new Date();
              errorMsg = `LINE failed, sent via SMS fallback`;
            } catch (fallbackErr) {
              this.logger.error(`SMS fallback also failed: ${fallbackErr instanceof Error ? fallbackErr.message : 'Unknown'}`);
            }
          }
        }
      }
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
   * Send LINE message via LINE Messaging API (Push Message)
   */
  private async sendLine(recipient: string, message: string): Promise<void> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const url = 'https://api.line.me/v2/bot/message/push';
    const body = {
      to: recipient,
      messages: [{ type: 'text', text: message }],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE API error ${response.status}: ${errorBody}`);
    }

    this.logger.log(`[LINE] Message sent to ${recipient}`);
  }

  /**
   * Send a LINE Flex Message via LINE Messaging API (Push Message)
   */
  private async sendLineFlexMessage(recipient: string, flexMessage: FlexMessagePayload): Promise<void> {
    if (!this.lineChannelAccessToken) {
      throw new Error('LINE channel access token not configured');
    }

    const url = 'https://api.line.me/v2/bot/message/push';
    const body = {
      to: recipient,
      messages: [flexMessage],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.lineChannelAccessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE API error ${response.status}: ${errorBody}`);
    }

    this.logger.log(`[LINE] Flex message sent to ${recipient}`);
  }

  /**
   * Send SMS via ThaiBulkSMS API (or compatible provider)
   * Supports both ThaiBulkSMS and Twilio-compatible APIs
   */
  private async sendSms(recipient: string, message: string): Promise<void> {
    if (!this.smsApiKey) {
      throw new Error('SMS API key not configured');
    }

    // Clean phone number: ensure +66 format for Thai numbers
    const cleanPhone = this.formatThaiPhone(recipient);

    // ThaiBulkSMS API - use POST body to avoid credentials in URL/logs
    const url = 'https://bulk.thaibulksms.com/sms.php';
    const params = new URLSearchParams({
      username: this.smsApiKey,
      password: this.smsApiSecret || '',
      msisdn: cleanPhone,
      message,
      sender: this.smsSender || 'BESTCHOICE',
      force: 'standard',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const responseText = await response.text();

    if (!response.ok || responseText.includes('error')) {
      throw new Error(`SMS API error: ${responseText}`);
    }

    this.logger.log(`[SMS] Message sent to ${cleanPhone}`);
  }

  /**
   * Format Thai phone number to international format
   */
  private formatThaiPhone(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      return '66' + cleaned.substring(1);
    }
    if (cleaned.startsWith('66')) {
      return cleaned;
    }
    return cleaned;
  }

  /**
   * Replace {placeholders} in a string with data values
   */
  private replacePlaceholders(text: string, data: Record<string, string>): string {
    let result = text;
    for (const [key, value] of Object.entries(data)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Replace {placeholders} in a JSON object recursively
   */
  private replacePlaceholdersInJson(obj: unknown, data: Record<string, string>): unknown {
    if (typeof obj === 'string') {
      return this.replacePlaceholders(obj, data);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.replacePlaceholdersInJson(item, data));
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replacePlaceholdersInJson(value, data);
      }
      return result;
    }
    return obj;
  }

  /**
   * Send notification using a template with data substitution
   * Supports both text and Flex Message JSON templates
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

    // Check if template is active
    if (templateData.isActive === false) {
      this.logger.warn(`Template ${templateId} is inactive, skipping`);
      return { id: null, status: 'SKIPPED', reason: 'Template is inactive' };
    }

    // If format is 'flex' and channel is LINE, send as Flex Message
    if (templateData.format === 'flex' && templateData.channel === 'LINE' && templateData.flexTemplate) {
      try {
        const flexJson = JSON.parse(templateData.flexTemplate);
        const resolvedFlex = this.replacePlaceholdersInJson(flexJson, data) as FlexMessagePayload;
        await this.sendLineFlexMessage(recipient, resolvedFlex);

        const textSummary = this.replacePlaceholders(templateData.messageTemplate || templateData.name, data);
        const log = await this.prisma.notificationLog.create({
          data: {
            channel: 'LINE',
            recipient,
            subject: templateData.subject || templateData.name,
            message: `Flex: ${textSummary}`,
            status: 'SENT',
            relatedId,
            sentAt: new Date(),
          },
        });

        return { id: log.id, status: 'SENT' };
      } catch (err) {
        this.logger.warn(`Flex template send failed, falling back to text: ${err instanceof Error ? err.message : err}`);
        // Fall through to text message
      }
    }

    let message = templateData.messageTemplate as string;
    message = this.replacePlaceholders(message, data);

    return this.send({
      channel: templateData.channel,
      recipient,
      subject: templateData.subject,
      message,
      relatedId,
    });
  }

  /**
   * Bulk send notifications to multiple contracts
   */
  async sendBulk(templateId: string, contractIds: string[]) {
    const results: { contractId: string; status: string }[] = [];

    // Batch load all contracts to avoid N+1 queries
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds } },
      include: { customer: { select: { name: true, phone: true, lineId: true } } },
    });
    const contractMap = new Map(contracts.map((c) => [c.id, c]));

    for (const contractId of contractIds) {
      const contract = contractMap.get(contractId);
      if (!contract) continue;

      const customer = contract.customer;
      const data: Record<string, string> = {
        customer_name: customer.name,
        contract_number: contract.contractNumber,
      };

      const recipient = customer.lineId || customer.phone;
      if (!recipient) {
        results.push({ contractId, status: 'SKIPPED' });
        continue;
      }

      const result = await this.sendFromTemplate(templateId, data, recipient, contractId);
      results.push({ contractId, status: result.status });
    }

    return { total: contractIds.length, results };
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
      take: Math.min(filters.limit || 50, 100),
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
        format: dto.format,
        subject: dto.subject,
        messageTemplate: dto.messageTemplate,
        flexTemplate: dto.flexTemplate,
        description: dto.description,
      });
    }

    const templateValue: Record<string, unknown> = {
      name: dto.name,
      eventType: dto.eventType,
      channel: dto.channel,
      format: dto.format || 'text',
      subject: dto.subject,
      messageTemplate: dto.messageTemplate,
      description: dto.description,
      isActive: true,
    };
    if (dto.flexTemplate) {
      templateValue.flexTemplate = dto.flexTemplate;
    }

    const config = await this.prisma.systemConfig.create({
      data: {
        key: `notification_template_${id}`,
        value: JSON.stringify(templateValue),
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
    if (dto.format !== undefined) updated.format = dto.format;
    if (dto.subject !== undefined) updated.subject = dto.subject;
    if (dto.messageTemplate !== undefined) updated.messageTemplate = dto.messageTemplate;
    if (dto.flexTemplate !== undefined) updated.flexTemplate = dto.flexTemplate;
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
   * Sends reminders exactly 3 days and 1 day before due date
   */
  async sendPaymentReminders() {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    // Only fetch payments due in exactly 1 or 3 days (filter at DB level)
    const day1 = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    const day1End = new Date(day1.getTime() + 24 * 60 * 60 * 1000);
    const day3 = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    const day3End = new Date(day3.getTime() + 24 * 60 * 60 * 1000);

    const upcomingPayments = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { dueDate: { gte: day1, lt: day1End } },
          { dueDate: { gte: day3, lt: day3End } },
        ],
        contract: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, phone: true, lineId: true } },
            _count: { select: { payments: true } },
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

      // Try LINE Flex Message first, fallback to text, then SMS
      if (customer.lineId) {
        try {
          const flex = buildPaymentReminderFlex({
            customerName: customer.name,
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            totalInstallments: payment.contract._count.payments,
            amountDue: Number(payment.amountDue),
            dueDate: new Date(payment.dueDate).toLocaleDateString('th-TH'),
            daysUntilDue: daysUntil,
          });
          await this.sendLineFlexMessage(customer.lineId, flex);
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              recipient: customer.lineId,
              subject: 'แจ้งเตือนค่างวด',
              message: `Flex: งวด ${payment.installmentNo} จำนวน ${Number(payment.amountDue).toLocaleString()} บาท`,
              status: 'SENT',
              relatedId: payment.contractId,
              sentAt: new Date(),
            },
          });
          sent++;
        } catch (err) {
          this.logger.warn(`Flex message failed, falling back to text: ${err instanceof Error ? err.message : err}`);
          await this.send({
            channel: 'LINE',
            recipient: customer.lineId,
            message,
            relatedId: payment.contractId,
            fallbackPhone: customer.phone || undefined,
          });
          sent++;
        }
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

    this.logger.log(`Payment reminders sent: ${sent}/${upcomingPayments.length}`);
    return { sent, total: upcomingPayments.length, timestamp: now };
  }

  /**
   * Send overdue notices (run daily)
   * Sends notices exactly 1, 3, and 7 days after due date
   */
  async sendOverdueNotices() {
    const now = new Date();
    const today = new Date(now.toISOString().split('T')[0]);

    // Only fetch payments overdue by exactly 1, 3, or 7 days (filter at DB level)
    const dueDates = [1, 3, 7].map((days) => {
      const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      return { gte: start, lt: end };
    });

    const overduePayments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
        OR: dueDates.map((dueDate) => ({ dueDate })),
        contract: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
      },
      include: {
        contract: {
          include: {
            customer: { select: { name: true, phone: true, lineId: true } },
            _count: { select: { payments: true } },
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

      const outstanding = Number(payment.amountDue) - Number(payment.amountPaid) + Number(payment.lateFee);
      const message = `แจ้งเตือน: คุณ${customer.name}\nค่างวดที่ ${payment.installmentNo} สัญญา ${payment.contract.contractNumber}\nเลยกำหนดชำระ ${daysOverdue} วัน\nยอดค้างชำระ ${outstanding.toLocaleString()} บาท (รวมค่าปรับ)\nกรุณาชำระโดยเร็ว`;

      // Try LINE Flex Message first, fallback to text, then SMS
      if (customer.lineId) {
        try {
          const flex = buildOverdueNoticeFlex({
            customerName: customer.name,
            contractNumber: payment.contract.contractNumber,
            installmentNo: payment.installmentNo,
            totalInstallments: payment.contract._count.payments,
            amountDue: Number(payment.amountDue),
            lateFee: Number(payment.lateFee),
            totalOutstanding: outstanding,
            dueDate: new Date(payment.dueDate).toLocaleDateString('th-TH'),
            daysOverdue,
          });
          await this.sendLineFlexMessage(customer.lineId, flex);
          await this.prisma.notificationLog.create({
            data: {
              channel: 'LINE',
              recipient: customer.lineId,
              subject: 'แจ้งค้างชำระ',
              message: `Flex: งวด ${payment.installmentNo} ค้าง ${outstanding.toLocaleString()} บาท เลยกำหนด ${daysOverdue} วัน`,
              status: 'SENT',
              relatedId: payment.contractId,
              sentAt: new Date(),
            },
          });
          sent++;
        } catch (err) {
          this.logger.warn(`Flex message failed, falling back to text: ${err instanceof Error ? err.message : err}`);
          await this.send({
            channel: 'LINE',
            recipient: customer.lineId,
            message,
            relatedId: payment.contractId,
            fallbackPhone: customer.phone || undefined,
          });
          sent++;
        }
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

    this.logger.log(`Overdue notices sent: ${sent}/${overduePayments.length}`);
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
    // Group by branch to send one summary per manager
    const branchGroups = new Map<string, { manager: { name: string; email: string }; contracts: string[] }>();
    for (const contract of overdueContracts) {
      for (const manager of contract.branch.users) {
        const key = manager.email;
        if (!branchGroups.has(key)) {
          branchGroups.set(key, { manager, contracts: [] });
        }
        branchGroups.get(key)!.contracts.push(
          `${contract.contractNumber}: ${contract.customer.name}`,
        );
      }
    }

    for (const [, { manager, contracts }] of branchGroups) {
      await this.send({
        channel: 'IN_APP',
        recipient: manager.email,
        subject: `สัญญาค้างชำระ ${contracts.length} รายการ`,
        message: `สัญญาค้างชำระที่ต้องติดตาม:\n${contracts.map((c) => `- ${c}`).join('\n')}`,
      });
      sent++;
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
