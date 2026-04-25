import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { DunningEventTrigger } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningRuleService } from './dunning-rule.service';
import { DunningRuleResolverService } from './dunning-rule-resolver.service';
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
  trackingNumber?: string;
}

@Injectable()
export class DunningEngineService {
  private readonly logger = new Logger(DunningEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleService: DunningRuleService,
    private readonly notificationsService: NotificationsService,
    private readonly paymentLinkService: PaymentLinkService,
    private readonly resolver: DunningRuleResolverService,
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
   * P3 E2: when a DunningRule has `templateName` set, look up the SmsTemplate
   * by name and use its body. Falls back to the inline `messageTemplate` if
   * the reference is missing/inactive — keeps dunning resilient to template
   * deletions and supports the backward-compatible default.
   */
  async resolveTemplateBody(rule: {
    messageTemplate: string;
    templateName?: string | null;
  }): Promise<string> {
    if (!rule.templateName) return rule.messageTemplate;
    const tpl = await this.prisma.smsTemplate.findFirst({
      where: { name: rule.templateName, deletedAt: null, active: true },
      select: { body: true },
    });
    return tpl?.body ?? rule.messageTemplate;
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
        if (rule.triggerDay === null) continue; // event-triggered rules fire via executeEventTrigger, not this scheduled loop
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

            // Resolve customer-tag conditions (P3 Task 7). The resolver may
            // tell us to skip this rule entirely (e.g. tagConditions.skipForTags
            // matches), defer the send by N days (VIP +3 default), or jump
            // straight to firm tone (HIGH_RISK / BLACKLIST skipSoft).
            const customerTags = await this.resolver.fetchTagsForCustomer(
              payment.contract.customer.id,
            );
            const resolution = this.resolver.resolve(rule, customerTags);
            if (resolution.action === 'skip') {
              this.logger.debug(
                `Tag-condition skip: rule=${rule.id} contract=${payment.contractId} reason=${resolution.reason}`,
              );
              skipped++;
              continue;
            }
            if (resolution.delayDays > 0) {
              // Defer: re-check on the day the delay expires. Today's run
              // simply skips so the dedup guard doesn't lock the rule out.
              this.logger.debug(
                `Tag-condition delay: rule=${rule.id} contract=${payment.contractId} +${resolution.delayDays}d`,
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

            // P3 E2: prefer body from referenced SmsTemplate (when set + active)
            // over the inline messageTemplate. Falls back silently if the
            // template was deleted/deactivated so dunning never breaks.
            const templateBody = await this.resolveTemplateBody(rule);
            const messageContent = this.renderTemplate(templateBody, vars);

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
   * Execute a single event-triggered dunning rule. Fired from call-log events,
   * MDM approval, letter dispatch, etc. Not called by the scheduled cron.
   *
   * Dedup window: 4h per (rule, contract, payment). Prevents accidental spam
   * if the same event fires twice quickly.
   *
   * Failure is non-fatal — the caller's business action (call log, MDM flip,
   * letter dispatch) should not roll back because LINE send failed. Errors are
   * captured to Sentry and logged.
   */
  async executeEventTrigger(
    eventKey: DunningEventTrigger,
    contractId: string,
    paymentId: string | null,
    callLogId: string | null,
    extraVars: Partial<TemplateVars> = {},
  ): Promise<void> {
    const rule = await this.prisma.dunningRule.findFirst({
      where: { eventTrigger: eventKey, isActive: true, deletedAt: null },
    });
    if (!rule) return; // no configured rule = no-op

    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const recent = await this.prisma.dunningAction.findFirst({
      where: {
        dunningRuleId: rule.id,
        contractId,
        paymentId: paymentId ?? undefined,
        createdAt: { gte: fourHoursAgo },
        deletedAt: null,
      },
    });
    if (recent) return;

    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: { select: { id: true, name: true, lineId: true, phone: true } } },
    });
    if (!contract) return;

    // Tag-condition resolution (P3 Task 7) — skip / delay also applies to
    // event-triggered rules so the policy holds across both scheduled and
    // ad-hoc dispatches.
    const eventTags = await this.resolver.fetchTagsForCustomer(contract.customer.id);
    const eventResolution = this.resolver.resolve(rule, eventTags);
    if (eventResolution.action === 'skip') {
      this.logger.debug(
        `Tag-condition skip (event): rule=${rule.id} contract=${contractId} reason=${eventResolution.reason}`,
      );
      return;
    }
    if (eventResolution.delayDays > 0) {
      // Event-triggered rules are inherently "now"; if a delay is requested
      // we suppress this dispatch and let the periodic engine pick it up.
      this.logger.debug(
        `Tag-condition delay (event): rule=${rule.id} contract=${contractId} +${eventResolution.delayDays}d — suppressed`,
      );
      return;
    }

    const payment = paymentId
      ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
      : null;

    const vars: TemplateVars = {
      customerName: contract.customer.name,
      contractNumber: contract.contractNumber,
      amount: payment ? payment.amountDue.toNumber().toLocaleString('th-TH') : '',
      dueDate: payment ? formatDateShort(payment.dueDate) : '',
      daysOverdue: '',
      installmentNo: payment ? String(payment.installmentNo) : '',
      ...extraVars,
    };

    const templateBody = await this.resolveTemplateBody(rule);
    const messageContent = this.renderTemplate(templateBody, vars);

    let paymentLinkUrl: string | undefined;
    if (rule.includePaymentLink && payment && contract.customer.lineId) {
      try {
        const link = await this.paymentLinkService.createPaymentLink(
          contractId,
          payment.installmentNo,
        );
        paymentLinkUrl = link.url;
      } catch (err) {
        Sentry.captureException(err, {
          tags: {
            service: 'DunningEngineService',
            method: 'executeEventTrigger.paymentLink',
          },
          extra: { eventKey, contractId, paymentId },
        });
      }
    }

    let status: 'SENT' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
    let result: string | null = null;

    if (rule.autoExecute && (rule.channel === 'LINE' || rule.channel === 'SMS')) {
      const recipient =
        rule.channel === 'LINE' ? contract.customer.lineId : contract.customer.phone;
      if (recipient) {
        const finalMessage = paymentLinkUrl
          ? `${messageContent}\n\nชำระเงินออนไลน์: ${paymentLinkUrl}`
          : messageContent;
        try {
          const sendResult = await this.notificationsService.send({
            channel: rule.channel as 'LINE' | 'SMS',
            recipient,
            message: finalMessage,
            relatedId: contractId,
            fallbackPhone:
              rule.channel === 'LINE' ? contract.customer.phone : undefined,
          });
          status = sendResult.status === 'SENT' ? 'SENT' : 'FAILED';
          result = `notificationId:${sendResult.id}`;
        } catch (err) {
          status = 'FAILED';
          result = err instanceof Error ? err.message : 'send error';
          Sentry.captureException(err, {
            tags: {
              service: 'DunningEngineService',
              method: 'executeEventTrigger.send',
            },
            extra: { eventKey, contractId, paymentId },
          });
        }
      } else {
        result = 'no recipient';
      }
    }

    await this.prisma.dunningAction.create({
      data: {
        dunningRuleId: rule.id,
        contractId,
        paymentId: paymentId ?? undefined,
        channel: rule.channel as any,
        status: status as any,
        messageContent,
        result,
        paymentLinkUrl: paymentLinkUrl ?? null,
        executedAt: status === 'SENT' ? new Date() : null,
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
