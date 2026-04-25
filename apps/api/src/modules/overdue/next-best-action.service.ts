import { Injectable } from '@nestjs/common';

/**
 * Next-Best-Action recommendation (P3 Task 9 — C2).
 *
 * Pure rule-based engine. Given a snapshot of an overdue contract row, return
 * the single most useful action a collector can take right now. The chip on
 * ContractCard renders the result; clicking the chip opens the matching
 * dialog (SEND_LINE → SendLineAdHocDialog, CALL → ContactLogDialog, etc.).
 *
 * Rules in priority order — first match wins:
 *  1. preferredContactTime hour bucket matches now → CALL
 *  2. preferredChannel = LINE AND lineLastSeen < 1h → SEND_LINE
 *  3. brokenPromiseCount ≥ 2 AND no firm letter sent → SEND_LETTER
 *  4. daysOverdue > 60 AND mdmState = NONE → PROPOSE_LOCK
 *  5. else → NOOP
 *
 * The function is intentionally pure (no DB I/O) so queue.service can call it
 * after enrichment without a new round-trip per row.
 */
export type NextBestActionType =
  | 'CALL'
  | 'SEND_LINE'
  | 'SEND_LETTER'
  | 'PROPOSE_LOCK'
  | 'NOOP';

export interface NextBestAction {
  type: NextBestActionType;
  /** Short Thai label for the chip body. */
  label: string;
  /** Plain Thai sentence the user reads on hover / opens. */
  reason: string;
}

/**
 * Inputs the rule engine consumes. Provided by queue.service after
 * enrichment. preferredContactTime / preferredChannel / lineLastSeen are
 * optional — when undefined the corresponding rule is skipped without
 * spuriously firing.
 */
export interface NextBestActionInput {
  /**
   * Hour-bucket label representing the customer's preferred contact window.
   * One of 'morning' (08–12), 'afternoon' (13–17), 'evening' (18–21).
   * Undefined → rule 1 skipped.
   */
  preferredContactTime?: 'morning' | 'afternoon' | 'evening';
  preferredChannel?: 'LINE' | 'SMS' | 'CALL';
  /** ISO timestamp the customer was last seen on LINE OA. */
  lineLastSeen?: string | Date | null;
  brokenPromiseCount: number;
  /** Whether a firm letter (stage ≥ FIRM) has already been dispatched. */
  hasFirmLetter: boolean;
  daysOverdue: number;
  mdmState: 'NONE' | 'PENDING' | 'LOCKED' | 'UNLOCKED';
  /** Customer must have a LINE id for SEND_LINE to be a valid action. */
  hasLineId: boolean;
  /** "Now" — injectable for deterministic tests. Defaults to new Date(). */
  now?: Date;
}

@Injectable()
export class NextBestActionService {
  /**
   * Map preferredContactTime label → [startHour, endHourExclusive] in local
   * (Bangkok wall-clock) time. We deliberately use Bangkok regardless of
   * server timezone because collectors all work Bangkok hours.
   */
  private static readonly TIME_BUCKETS: Record<
    NonNullable<NextBestActionInput['preferredContactTime']>,
    [number, number]
  > = {
    morning: [8, 12],
    afternoon: [13, 17],
    evening: [18, 21],
  };

  recommend(input: NextBestActionInput): NextBestAction {
    const now = input.now ?? new Date();

    // Rule 1: preferred-time match → CALL.
    if (input.preferredContactTime) {
      const [start, endExclusive] =
        NextBestActionService.TIME_BUCKETS[input.preferredContactTime];
      const bangkokHour = this.bangkokHour(now);
      if (bangkokHour >= start && bangkokHour < endExclusive) {
        return {
          type: 'CALL',
          label: 'โทรเลย',
          reason: `ลูกค้าสะดวกรับสายช่วงนี้ (${input.preferredContactTime})`,
        };
      }
    }

    // Rule 2: LINE preferred + active in last hour → SEND_LINE.
    if (input.preferredChannel === 'LINE' && input.hasLineId && input.lineLastSeen) {
      const ts = new Date(input.lineLastSeen).getTime();
      if (Number.isFinite(ts) && now.getTime() - ts < 60 * 60 * 1000) {
        return {
          type: 'SEND_LINE',
          label: 'ส่ง LINE ตอนนี้',
          reason: 'ลูกค้าออนไลน์ใน LINE ภายใน 1 ชม.',
        };
      }
    }

    // Rule 3: chronic broken promises + no firm letter yet → SEND_LETTER.
    if (input.brokenPromiseCount >= 2 && !input.hasFirmLetter) {
      return {
        type: 'SEND_LETTER',
        label: 'ส่งจดหมายเตือนหนัก',
        reason: `ผิดนัด ${input.brokenPromiseCount} ครั้ง — ยกระดับเป็นจดหมายโทนหนัก`,
      };
    }

    // Rule 4: overdue > 60d and no MDM lock yet → PROPOSE_LOCK.
    if (input.daysOverdue > 60 && input.mdmState === 'NONE') {
      return {
        type: 'PROPOSE_LOCK',
        label: 'เสนอล็อคเครื่อง',
        reason: `เลยกำหนด ${input.daysOverdue} วัน ยังไม่ได้ล็อค MDM`,
      };
    }

    return {
      type: 'NOOP',
      label: 'ไม่มีคำแนะนำ',
      reason: 'ไม่มีรูปแบบไหนที่ตรงเงื่อนไข',
    };
  }

  /**
   * Hour-of-day in Asia/Bangkok wall clock. Bangkok is fixed UTC+7 (no DST)
   * so a simple offset add works without a TZ lookup.
   */
  private bangkokHour(d: Date): number {
    const bangkok = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return bangkok.getUTCHours();
  }
}
