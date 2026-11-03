import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ContractStatus, DunningEventTrigger, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FINANCE_LINE_RECIPIENT_SELECT,
  financeLineRecipient,
} from '../line-oa/services/otp-verified-customer';
import { DunningRuleService } from './dunning-rule.service';
import { DunningRuleResolverService } from './dunning-rule-resolver.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/notification-category.enum';
import { PaymentLinkService } from '../line-oa/payment-links/payment-link.service';
import {
  LEGACY_LINK_GRACE_BLOCK_REASON,
  LEGACY_LINK_GRACE_EXEMPT,
} from '../notifications/legacy-link-grace';
import {
  dueOutstanding,
  dueUnpaidPaymentsWhere,
  installmentOwed,
  noticeDueWindow,
} from '../notifications/payment-notice-dedupe';
import { formatDateShort } from '../../utils/thai-date.util';

/**
 * ผลของ `notificationsService.send` → สถานะ `DunningAction` (+ ข้อความ `result`) — Task 30 ข้อ 2: ข้อความที่ถูกระงับเพราะช่วงผ่อนผัน
 * หลังผูก LINE ของสัญญานำเข้า = `SKIPPED` (ตั้งใจไม่ส่ง — ไม่ให้ขึ้นเป็นรายการล้มเหลวที่พนักงานกดส่งซ้ำ) · นอกนั้นเหมือนเดิม
 */
function actionOutcome(sendResult: { id: string; status: string; blockReason?: string }): {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  result: string;
} {
  const result = `notificationId:${sendResult.id}`;
  if (sendResult.status === 'SENT') return { status: 'SENT', result };
  if (sendResult.blockReason === LEGACY_LINK_GRACE_BLOCK_REASON) {
    return { status: 'SKIPPED', result: `${LEGACY_LINK_GRACE_BLOCK_REASON} ${result}` };
  }
  return { status: 'FAILED', result };
}

/** ตัวแปรในข้อความที่มาจากงวด — ไม่มีงวดให้เติม = ข้อความมีช่องว่าง (รอบ 6 m7) */
const PAYMENT_TEMPLATE_VARS = ['installmentNo', 'amount', 'dueDate'] as const;
/** ผลของ DunningAction เมื่อข้อความต้องใช้งวดแต่สัญญาไม่มีงวดค้าง */
const NO_DUE_INSTALLMENT = 'NO_DUE_INSTALLMENT';

export interface TemplateVars {
  customerName: string;
  contractNumber: string;
  amount: string;
  dueDate: string;
  daysOverdue: string;
  installmentNo: string;
  trackingNumber?: string;
  /** วันที่ลูกค้านัดชำระ (กฎ `CALL_ANSWERED_PROMISE`) */
  settlementDate?: string;
}

/**
 * ค่าที่ผู้เรียกกฎตามเหตุการณ์บอกเองได้ — `amount` เป็นตัวเลข (ใช้ทั้งในข้อความและยอดของลิงก์ชำระ) เช่น ยอดที่ลูกค้านัด (รอบ 7 I4)
 */
export type EventTriggerExtras = Partial<Omit<TemplateVars, 'amount'>> & {
  amount?: Prisma.Decimal | number;
};

/** รูปแบบยอดเงินในข้อความกฎทวง (เดิมของ engine) */
export function formatTemplateAmount(amount: Prisma.Decimal | number): string {
  return new Prisma.Decimal(amount).toNumber().toLocaleString('th-TH');
}

/**
 * Task 30 รอบ 7 I4 — กฎที่ข้อความพูดถึง "ยอดค้าง" ของทั้งสัญญา (แจ้งล็อก "ชำระยอดค้าง … เพื่อปลดล็อค") ⇒ `{{amount}}` = ยอดค้างที่ถึงกำหนดรวม
 * (`dueOutstanding` — นิยามเดียวกับแจ้งสถานะ) + ลิงก์ไม่ผูกงวดยอดเดียวกัน (Task 39) · กฎอื่นที่ข้อความระบุงวด ⇒ ยอดคงค้างของงวดนั้น
 * (`installmentOwed`) + ลิงก์ผูกงวดนั้น
 */
const CONTRACT_TOTAL_AMOUNT_EVENTS: ReadonlySet<DunningEventTrigger> = new Set(['DEVICE_LOCKED']);

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
    const now = new Date();

    let executed = 0;
    let skipped = 0;
    let failed = 0;

    let rules: Awaited<ReturnType<DunningRuleService['findAllActiveRules']>>;
    try {
      rules = await this.ruleService.findAllActiveRules();
    } catch (err) {
      Sentry.captureException(err, {
        tags: { service: 'DunningEngineService', method: 'executeRules' },
      });
      this.logger.error(
        `Failed to load active dunning rules: ${err instanceof Error ? err.message : err}`,
      );
      throw err;
    }

    for (const rule of rules) {
      try {
        if (rule.triggerDay === null) continue; // event-triggered rules fire via executeEventTrigger, not this scheduled loop
        const payments = await this.findPaymentsForRule(rule.triggerDay, now);

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

            const daysOverdue = rule.triggerDay > 0 ? rule.triggerDay : 0;

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

            // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
            const financeLineId = financeLineRecipient(payment.contract.customer);
            if (rule.includePaymentLink && financeLineId) {
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

            const isNotificationChannel = rule.channel === 'LINE' || rule.channel === 'SMS';

            let status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' = 'PENDING';
            let result: string | undefined;

            if (isNotificationChannel && rule.autoExecute) {
              const recipient =
                rule.channel === 'LINE' ? financeLineId : payment.contract.customer.phone;

              if (recipient) {
                const finalMessage = paymentLinkUrl
                  ? `${messageContent}\n\nชำระเงินออนไลน์: ${paymentLinkUrl}`
                  : messageContent;

                try {
                  const sendResult = await this.notificationsService.send({
                    channel: rule.channel as 'LINE' | 'SMS',
                    channelKey: rule.channel === 'LINE' ? 'line-finance' : undefined,
                    recipient,
                    message: finalMessage,
                    relatedId: payment.contractId,
                    fallbackPhone:
                      rule.channel === 'LINE'
                        ? (payment.contract.customer.phone ?? undefined)
                        : undefined,
                    customerId: payment.contract.customer.id,
                    category: NotificationCategory.DUNNING,
                  });

                  ({ status, result } = actionOutcome(sendResult));
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
                status = 'SKIPPED';
                result = 'no recipient';
              }
            }
            // CALL_TASK / INTERNAL_ALERT — create as PENDING without sending

            await this.prisma.dunningAction.create({
              data: {
                dunningRuleId: rule.id,
                contractId: payment.contractId,
                paymentId: payment.id,
                channel: rule.channel,
                status,
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

    this.logger.log(
      `DunningEngine run complete: executed=${executed}, skipped=${skipped}, failed=${failed}`,
    );
    return { executed, skipped, failed };
  }

  /**
   * Find payments matching the rule's triggerDay offset from today.
   * - Negative triggerDay: payments due in abs(triggerDay) days (pre-due reminders, PENDING status, ACTIVE contracts)
   * - Positive triggerDay: payments overdue by triggerDay days (PENDING/OVERDUE/PARTIALLY_PAID, OVERDUE/DEFAULT contracts)
   *
   * Task 30 รอบ 4 m2 — วันตามปฏิทินไทย (`noticeDueWindow` นิยามเดียวของ "T±n" ของผู้ส่งข้อความเรื่องงวด) ไม่ขึ้นกับ TZ เครื่อง ·
   * เดิมใช้ `setHours` ตาม TZ เครื่อง และ `today + triggerDay` ทำให้ทิศกลับด้านกับความหมายข้างบน (กฎ -3 ได้งวดที่ครบไปแล้ว 3 วัน ·
   * กฎ +1 ได้งวดที่ครบพรุ่งนี้) — หน้าจอ/DTO บอก "ลบ = ก่อนครบกำหนด · บวก = หลังครบกำหนด"
   */
  private async findPaymentsForRule(triggerDay: number, now: Date) {
    const isPreDue = triggerDay < 0;

    return this.prisma.payment.findMany({
      where: {
        deletedAt: null,
        dueDate: noticeDueWindow(now, -triggerDay),
        ...(isPreDue
          ? {
              status: 'PENDING',
              contract: { status: 'ACTIVE', deletedAt: null },
            }
          : {
              status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] as PaymentStatus[] },
              contract: {
                status: { in: ['OVERDUE', 'DEFAULT'] as ContractStatus[] },
                deletedAt: null,
              },
            }),
      },
      include: {
        contract: {
          include: {
            customer: {
              select: { id: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT, phone: true },
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
    extras: EventTriggerExtras = {},
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
      include: {
        customer: {
          select: { id: true, name: true, ...FINANCE_LINE_RECIPIENT_SELECT, phone: true },
        },
      },
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

    // Task 30 รอบ 6 m7 — ผู้เรียกที่ไม่ได้ระบุงวด (ทางบันทึกการโทร `contact-log.service.ts` · ล็อก/ปลดล็อก · จดหมาย) เดิมได้งวด/ยอด/วันครบเป็นค่าว่าง
    // ⇒ ลูกค้าเห็น "ชำระงวดที่  ยอด  ฿" · ใช้งวดค้างที่ครบกำหนดแล้วงวดแรกของสัญญา (นิยามเดียวกับยอดของแจ้งสถานะ/ขั้นทวง)
    const payment = paymentId
      ? await this.prisma.payment.findUnique({ where: { id: paymentId } })
      : await this.prisma.payment.findFirst({
          where: { contractId, ...dueUnpaidPaymentsWhere(new Date()) },
          orderBy: { installmentNo: 'asc' },
        });

    // Task 30 รอบ 7 I4 — ยอดที่ข้อความบอก + ลิงก์ชำระต้องครอบยอดเดียวกัน (เดิม m7 ใส่ค่างวดเต็มของงวดเก่าสุด + ลิงก์งวดเดียว):
    // ผู้เรียกบอกยอด (นัดชำระ) → ยอดนั้น · กฎยอดค้างทั้งสัญญา (แจ้งล็อก) → ยอดค้างที่ถึงกำหนดรวม · นอกนั้น → ยอดคงค้างของงวดที่ข้อความระบุ
    const { amount: givenAmount, ...givenVars } = extras;
    let amount: { value: Prisma.Decimal; linkInstallmentNo?: number } | null;
    if (givenAmount !== undefined) {
      amount = { value: new Prisma.Decimal(givenAmount) };
    } else if (CONTRACT_TOTAL_AMOUNT_EVENTS.has(eventKey)) {
      const due = await this.prisma.payment.findMany({
        where: { contractId, ...dueUnpaidPaymentsWhere(new Date()) },
        select: { amountDue: true, amountPaid: true, lateFee: true, lateFeeWaived: true },
      });
      const total = dueOutstanding(due);
      amount = total > 0 ? { value: new Prisma.Decimal(total) } : null;
    } else {
      amount = payment
        ? { value: installmentOwed(payment), linkInstallmentNo: payment.installmentNo }
        : null;
    }

    const vars: TemplateVars = {
      customerName: contract.customer.name,
      contractNumber: contract.contractNumber,
      amount: amount ? formatTemplateAmount(amount.value) : '',
      dueDate: payment ? formatDateShort(payment.dueDate) : '',
      daysOverdue: '',
      installmentNo: payment ? String(payment.installmentNo) : '',
      ...givenVars,
    };

    const templateBody = await this.resolveTemplateBody(rule);
    const messageContent = this.renderTemplate(templateBody, vars);

    // ไม่มีงวด/ยอดให้เติม แต่ข้อความต้องบอก ⇒ ไม่ส่งข้อความที่มีช่องว่าง (เก็บ DunningAction SKIPPED ให้ตรวจย้อนได้ — รอบ 6 m7)
    const missingVar = (key: (typeof PAYMENT_TEMPLATE_VARS)[number]) =>
      key === 'amount' ? !amount : !payment && !givenVars[key];
    if (
      PAYMENT_TEMPLATE_VARS.some((key) => templateBody.includes(`{{${key}}}`) && missingVar(key))
    ) {
      await this.prisma.dunningAction.create({
        data: {
          dunningRuleId: rule.id,
          contractId,
          paymentId: paymentId ?? undefined,
          channel: rule.channel,
          status: 'SKIPPED',
          messageContent,
          result: NO_DUE_INSTALLMENT,
          paymentLinkUrl: null,
          executedAt: null,
        },
      });
      return;
    }

    let paymentLinkUrl: string | undefined;
    // ปลายทาง LINE การเงิน = แถว OTP ของลูกค้า (Task 22 I-1 ง) ไม่ใช่คอลัมน์ line_id_finance ที่อาจค้าง
    const financeLineId = financeLineRecipient(contract.customer);
    // Task 39 (ทาง ก ของรอบ 8 I5) — แนบลิงก์ตามสวิตช์ "แนบลิงก์ชำระเงิน" ของกฎ (m12) · ยอดของลิงก์ = ยอดในข้อความเสมอ:
    // ข้อความระบุงวด → ลิงก์ผูกงวดนั้น (หน้า `/pay/:token` ส่งเลขงวด · intent เทียบยอดคงค้างของงวด) · ยอดค้างรวม (แจ้งล็อก) / ยอดนัด
    // (นัดชำระ) → ลิงก์ไม่ผูกงวด (`installmentBound = false` — หน้าเว็บส่ง token · intent ใช้ยอดของลิงก์ · webhook กระจาย FIFO)
    if (rule.includePaymentLink && amount && financeLineId) {
      try {
        const link = await this.paymentLinkService.createPaymentLink(
          contractId,
          amount.linkInstallmentNo,
          amount.value.toNumber(),
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
      const recipient = rule.channel === 'LINE' ? financeLineId : contract.customer.phone;
      if (recipient) {
        const finalMessage = paymentLinkUrl
          ? `${messageContent}\n\nชำระเงินออนไลน์: ${paymentLinkUrl}`
          : messageContent;
        try {
          const sendResult = await this.notificationsService.send(
            {
              channel: rule.channel as 'LINE' | 'SMS',
              channelKey: rule.channel === 'LINE' ? 'line-finance' : undefined,
              recipient,
              message: finalMessage,
              relatedId: contractId,
              fallbackPhone:
                rule.channel === 'LINE' ? (contract.customer.phone ?? undefined) : undefined,
              customerId: contract.customer.id,
              category: NotificationCategory.DUNNING,
            },
            // แจ้งล็อก/ปลดล็อกเครื่องต้องถึงแม้อยู่ในช่วงผ่อนผันหลังผูก LINE (Task 30 รอบ 3 M5)
            { legacyGraceExempt: LEGACY_LINK_GRACE_EXEMPT.dunningEvents.has(eventKey) },
          );
          ({ status, result } = actionOutcome(sendResult));
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
        channel: rule.channel,
        status,
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
