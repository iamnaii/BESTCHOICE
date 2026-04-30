import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../prisma/prisma.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { HolidayService } from './holiday.service';
import {
  NotificationCategory,
  COMPLIANCE_CHECKED_CATEGORIES,
  FREQUENCY_CAP_CATEGORIES,
} from './notification-category.enum';
import { isWithinBusinessHours, nextBusinessHourOpen } from '../../utils/business-hours.util';
import type { NotificationChannel } from '@prisma/client';

/**
 * Identification prefix required by พ.ร.บ.การทวงถามหนี้ มาตรา 8 on every
 * dunning communication.
 */
const DUNNING_IDENTIFICATION_PREFIX = '[BESTCHOICE FINANCE]';

/**
 * Forbidden content patterns for dunning messages. Matches trigger Sentry
 * warnings (manual review pattern, not blocking).
 *
 * `allowedInLegalAction: true` — pattern is only acceptable when the dunning
 * stage is LEGAL_ACTION (i.e., real legal-action notice). Outside that stage
 * such language is considered non-compliant under พ.ร.บ.ทวงถามหนี้ มาตรา 11.
 */
const FORBIDDEN_PATTERNS: {
  pattern: RegExp;
  reason: string;
  allowedInLegalAction: boolean;
}[] = [
  { pattern: /(ข่มขู่|ขู่)/, reason: 'threatening language', allowedInLegalAction: false },
  { pattern: /(ดูถูก|เหยียดหยาม)/, reason: 'insult', allowedInLegalAction: false },
  { pattern: /(ระยำ|เหี้ย|ส้นตีน)/, reason: 'profanity', allowedInLegalAction: false },
  { pattern: /(แจ้งความ|ฟ้องร้อง|ดำเนินคดี)/, reason: 'legal threat', allowedInLegalAction: true },
];

export interface ComplianceContext {
  channel: NotificationChannel;
  customerId?: string;
  contractId?: string;
  category: NotificationCategory;
  bypassCompliance?: boolean;
}

export type ComplianceBlockReason =
  | 'OUTSIDE_HOURS'
  | 'FREQUENCY_CAP'
  | 'NO_CONSENT'
  | 'HOLIDAY_BLOCK';

export interface CanSendResult {
  allowed: boolean;
  reason?: ComplianceBlockReason;
  retryAfter?: Date;
}

/**
 * Single decision point for whether a notification may be sent right now.
 *
 * Gates (in order):
 * 1. Bypass flag — explicit override (e.g., manual staff send-now)
 * 2. Category bypass — TRANSACTIONAL (receipts) and STAFF skip all compliance
 * 3. Time-window — Asia/Bangkok 8-20 weekday, 8-18 weekend/holiday
 * 4. PDPA consent — required for any customer-facing send (DUNNING/REMINDER/MARKETING)
 * 5. Frequency cap — 1/day per (customer + contract) for DUNNING only
 *
 * Compliance basis: พ.ร.บ.ทวงถามหนี้ พ.ศ. 2558 มาตรา 9 + PDPA.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private prisma: PrismaService,
    private pdpa: PDPAService,
    private holiday: HolidayService,
  ) {}

  async canSend(ctx: ComplianceContext): Promise<CanSendResult> {
    if (ctx.bypassCompliance) return { allowed: true };

    if (
      ctx.category === NotificationCategory.TRANSACTIONAL ||
      ctx.category === NotificationCategory.STAFF
    ) {
      return { allowed: true };
    }

    if (!COMPLIANCE_CHECKED_CATEGORIES.has(ctx.category)) {
      return { allowed: true };
    }

    const now = new Date();
    const isWeekendOrHoliday = this.isWeekendOrHoliday(now);

    if (!isWithinBusinessHours(now, isWeekendOrHoliday)) {
      return {
        allowed: false,
        reason: 'OUTSIDE_HOURS',
        retryAfter: nextBusinessHourOpen(now, isWeekendOrHoliday),
      };
    }

    if (ctx.customerId) {
      const hasConsent = await this.pdpa.hasActiveConsent(ctx.customerId);
      if (!hasConsent) {
        this.logger.debug(`Compliance: no PDPA consent for customer ${ctx.customerId}`);
        return { allowed: false, reason: 'NO_CONSENT' };
      }
    }

    if (
      FREQUENCY_CAP_CATEGORIES.has(ctx.category) &&
      ctx.customerId &&
      ctx.contractId
    ) {
      const todayStart = this.startOfBangkokDay(now);
      const count = await this.prisma.notificationLog.count({
        where: {
          customerId: ctx.customerId,
          relatedId: ctx.contractId,
          category: ctx.category,
          status: 'SENT',
          sentAt: { gte: todayStart },
          deletedAt: null,
        },
      });
      if (count >= 1) {
        return {
          allowed: false,
          reason: 'FREQUENCY_CAP',
          retryAfter: nextBusinessHourOpen(now, isWeekendOrHoliday),
        };
      }
    }

    return { allowed: true };
  }

  private isWeekendOrHoliday(date: Date): boolean {
    if (this.holiday.isHoliday(date)) return true;
    const weekday = date.toLocaleString('en-US', {
      timeZone: 'Asia/Bangkok',
      weekday: 'short',
    });
    return weekday === 'Sat' || weekday === 'Sun';
  }

  /**
   * Ensure dunning messages start with the creditor identification prefix
   * `[BESTCHOICE FINANCE]`. If missing, auto-prepend and Sentry-warn so the
   * upstream template can be fixed.
   *
   * Compliance basis: พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558 มาตรา 8 — ผู้ทวงถามหนี้
   * ต้องระบุชื่อเจ้าหนี้บนทุกการสื่อสาร.
   */
  ensureIdentificationPrefix(message: string, category: NotificationCategory): string {
    if (category !== NotificationCategory.DUNNING) return message;
    if (message.startsWith(DUNNING_IDENTIFICATION_PREFIX)) return message;

    const preview = message.slice(0, 60);
    this.logger.warn(
      `Dunning message missing identification prefix — auto-prepending: "${preview}..."`,
    );
    Sentry.captureMessage(
      `Dunning message missing [BESTCHOICE FINANCE] prefix — auto-prepended`,
      {
        level: 'warning',
        tags: { module: 'notifications', compliance: 'identification-prefix' },
        extra: { messagePreview: preview },
      },
    );

    return `${DUNNING_IDENTIFICATION_PREFIX} ${message}`;
  }

  /**
   * Scan a dunning message for forbidden content patterns (threats, insults,
   * profanity, legal threats outside LEGAL_ACTION stage). Returns a list of
   * matched reason strings. Sentry-warns on any match — does NOT block the
   * send (manual review pattern).
   *
   * Compliance basis: พ.ร.บ.การทวงถามหนี้ พ.ศ. 2558 มาตรา 11 — ห้ามทวงถามหนี้
   * ในลักษณะข่มขู่ ใช้ความรุนแรง ดูหมิ่น เปิดเผยความเป็นหนี้.
   */
  scanForbiddenContent(message: string, dunningStage?: string): string[] {
    const matches: string[] = [];
    for (const { pattern, reason, allowedInLegalAction } of FORBIDDEN_PATTERNS) {
      if (pattern.test(message)) {
        if (allowedInLegalAction && dunningStage === 'LEGAL_ACTION') continue;
        matches.push(reason);
      }
    }

    if (matches.length > 0) {
      const preview = message.slice(0, 100);
      this.logger.warn(
        `Forbidden content detected: ${matches.join(', ')} — message: "${preview.slice(0, 60)}..."`,
      );
      Sentry.captureMessage(
        `Notification content review needed: ${matches.join(', ')}`,
        {
          level: 'warning',
          tags: { module: 'notifications', compliance: 'content-guardrails' },
          extra: { messagePreview: preview, dunningStage: dunningStage ?? null },
        },
      );
    }

    return matches;
  }

  private startOfBangkokDay(date: Date): Date {
    const localDate = date.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return new Date(`${localDate}T00:00:00+07:00`);
  }
}
