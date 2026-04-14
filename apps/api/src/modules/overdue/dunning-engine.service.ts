import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningRuleService } from './dunning-rule.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import { formatDateShort } from '../../utils/thai-date.util';

export interface TemplateVars {
  customerName: string;
  contractNumber: string;
  amount: string;
  dueDate: string;
  daysOverdue: string;
  installmentNo: string;
}

@Injectable()
export class DunningEngineService {
  private readonly logger = new Logger(DunningEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleService: DunningRuleService,
    private readonly notificationsService: NotificationsService,
    private readonly paymentLinkService: PaymentLinkService,
  ) {}

  /**
   * Replace {{variable}} placeholders in a template string.
   * Unknown variables are left as-is.
   */
  renderTemplate(template: string, vars: TemplateVars): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = (vars as unknown as Record<string, string>)[key];
      return value !== undefined ? value : match;
    });
  }

  /**
   * Check whether a DunningAction already exists for the given combination (dedup).
   */
  async hasExistingAction(
    dunningRuleId: string,
    contractId: string,
    paymentId: string | null,
  ): Promise<boolean> {
    const existing = await this.prisma.dunningAction.findFirst({
      where: {
        dunningRuleId,
        contractId,
        paymentId: paymentId ?? undefined,
        deletedAt: null,
      },
    });
    return existing !== null;
  }

  /**
   * Main engine: load all active rules, find matching payments, execute.
   */
  async executeRules(): Promise<{ executed: number; skipped: number; failed: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let executed = 0;
    let skipped = 0;
    let failed = 0;

    let rules: Awaited<ReturnType<DunningRuleService['findAllActiveRules']>>;
    try {
      rules = await this.ruleService.findAllActiveRules();
    } catch (err) {
      Sentry.captureException(err, { tags: { service: 'DunningEngineService', method: 'executeRules' } });
      this.logger.error(`Failed to load active dunning rules: ${err instanceof Error ? err.message : err}`);
      throw err;
    }

    for (const rule of rules) {
      try {
        const payments = await this.findPaymentsForRule(rule.triggerDay, today);

        for (const payment of payments) {
          try {
            const alreadyExecuted = await this.hasExistingAction(
              rule.id,
              payment.contractId,
              payment.id,
            );

            if (alreadyExecuted) {
              this.logger.debug(
                `Skipping dedup: rule=${rule.id} contract=${payment.contractId} payment=${payment.id}`,
              );
              skipped++;
              continue;
            }

            const daysOverdue =
              rule.triggerDay > 0
                ? rule.triggerDay
                : 0;

            const vars: TemplateVars = {
              customerName: payment.contract.customer.name,
              contractNumber: payment.contract.contractNumber,
              amount: payment.amountDue.toNumber().toLocaleString('th-TH'),
              dueDate: formatDateShort(payment.dueDate),
              daysOverdue: String(daysOverdue),
              installmentNo: String(payment.installmentNo),
            };

            const messageContent = this.renderTemplate(rule.messageTemplate, vars);

            let paymentLinkUrl: string | undefined;

            if (rule.includePaymentLink && payment.contract.customer.lineId) {
              try {
                const link = await this.paymentLinkService.createPaymentLink(
                  payment.contractId,
                  payment.installmentNo,
                );
                paymentLinkUrl = link.url;
              } catch (linkErr) {
                Sentry.captureException(linkErr, {
                  tags: { service: 'DunningEngineService', method: 'createPaymentLink' },
                  extra: { contractId: payment.contractId, paymentId: payment.id },
                });
                this.logger.warn(
                  `Failed to create payment link for contract ${payment.contractId}: ${linkErr instanceof Error ? linkErr.message : linkErr}`,
                );
              }
            }

            const isNotificationChannel =
              rule.channel === 'LINE' || rule.channel === 'SMS';

            let status: 'PENDING' | 'SENT' | 'FAILED' = 'PENDING';
            let result: string | undefined;

            if (isNotificationChannel && rule.autoExecute) {
              const recipient =
                rule.channel === 'LINE'
                  ? payment.contract.customer.lineId
                  : payment.contract.customer.phone;

              if (recipient) {
                const finalMessage = paymentLinkUrl
                  ? `${messageContent}\n\nชำระเงินออนไลน์: ${paymentLinkUrl}`
                  : messageContent;

                try {
                  const sendResult = await this.notificationsService.send({
                    channel: rule.channel as 'LINE' | 'SMS',
                    recipient,
                    message: finalMessage,
                    relatedId: payment.contractId,
                    fallbackPhone:
                      rule.channel === 'LINE' ? payment.contract.customer.phone : undefined,
                  });

                  status = sendResult.status === 'SENT' ? 'SENT' : 'FAILED';
                  result = `notificationId:${sendResult.id}`;
                } catch (sendErr) {
                  Sentry.captureException(sendErr, {
                    tags: { service: 'DunningEngineService', method: 'send' },
                    extra: { ruleId: rule.id, contractId: payment.contractId },
                  });
                  status = 'FAILED';
                  result = sendErr instanceof Error ? sendErr.message : 'send error';
                  failed++;
                }
              } else {
                status = 'SKIPPED' as any;
                result = 'no recipient';
              }
            }
            // CALL_TASK / INTERNAL_ALERT — create as PENDING without sending

            await this.prisma.dunningAction.create({
              data: {
                dunningRuleId: rule.id,
                contractId: payment.contractId,
                paymentId: payment.id,
                channel: rule.channel as any,
                status: status as any,
                messageContent,
                result: result ?? null,
                paymentLinkUrl: paymentLinkUrl ?? null,
                executedAt: isNotificationChannel && rule.autoExecute ? new Date() : null,
              },
            });

            if (status !== 'FAILED') {
              executed++;
            }
          } catch (paymentErr) {
            Sentry.captureException(paymentErr, {
              tags: { service: 'DunningEngineService', method: 'processPayment' },
              extra: { ruleId: rule.id, paymentId: payment.id },
            });
            this.logger.error(
              `Failed to process payment ${payment.id} for rule ${rule.id}: ${paymentErr instanceof Error ? paymentErr.message : paymentErr}`,
            );
            failed++;
          }
        }
      } catch (ruleErr) {
        Sentry.captureException(ruleErr, {
          tags: { service: 'DunningEngineService', method: 'processRule' },
          extra: { ruleId: rule.id },
        });
        this.logger.error(
          `Failed to process rule ${rule.id}: ${ruleErr instanceof Error ? ruleErr.message : ruleErr}`,
        );
        failed++;
      }
    }

    this.logger.log(`DunningEngine run complete: executed=${executed}, skipped=${skipped}, failed=${failed}`);
    return { executed, skipped, failed };
  }

  /**
   * Find payments matching the rule's triggerDay offset from today.
   * - Negative triggerDay: payments due in abs(triggerDay) days (pre-due reminders, PENDING status, ACTIVE contracts)
   * - Positive triggerDay: payments overdue by triggerDay days (PENDING/OVERDUE/PARTIALLY_PAID, OVERDUE/DEFAULT contracts)
   */
  private async findPaymentsForRule(triggerDay: number, today: Date) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + triggerDay); // negative = future, positive = past

    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const isPreDue = triggerDay < 0;

    return this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        dueDate: { gte: dayStart, lte: dayEnd },
        ...(isPreDue
          ? {
              status: 'PENDING',
              contract: { status: 'ACTIVE', deletedAt: null },
            }
          : {
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] as any[] },
              contract: { status: { in: ['OVERDUE', 'DEFAULT'] as any[] }, deletedAt: null },
            }),
      },
      include: {
        contract: {
          include: {
            customer: {
              select: { id: true, name: true, lineId: true, phone: true },
            },
          },
        },
      },
    });
  }

  /**
   * Get paginated action history for a contract.
   */
  async getActionsForContract(
    contractId: string,
    page = 1,
    limit = 50,
  ): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.dunningAction.findMany({
        where: { contractId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          dunningRule: { select: { id: true, name: true, triggerDay: true, channel: true } },
        },
      }),
      this.prisma.dunningAction.count({
        where: { contractId, deletedAt: null },
      }),
    ]);

    return { data, total, page, limit };
  }
}
