export type CollectionsTabKey = 'today' | 'followup' | 'promise' | 'approval' | 'all' | 'analytics';

export interface PendingEscalation {
  id: string;
  contractNumber: string;
  dunningStage: string;
  pendingDunningStage: string;
  pendingDunningSince: string;
  customer: { id: string; name: string; phone: string };
}

export interface PendingMdmRequest {
  id: string;
  trigger: string;
  includeWallpaper: boolean;
  reason: string;
  proposedAt: string;
  /**
   * Optional — when present and set to EXECUTED_MANUAL / EXECUTED_API, the
   * approval row renders an Unlock button (OWNER only). Absent for raw
   * PENDING requests (which is the common case in the approval queue).
   */
  status?: 'PENDING' | 'APPROVED' | 'EXECUTED_MANUAL' | 'EXECUTED_API' | 'FAILED' | 'REJECTED' | 'UNLOCKED';
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
  proposedBy: { id: string; name: string };
}

export interface ContractRow {
  id: string;
  contractNumber: string;
  status: string;
  dunningStage: string;
  customer: { id: string; name: string; phone: string; lineId: string | null };
  branch: { id: string; name: string };
  assignedTo: { id: string; name: string } | null;
  outstanding: number;
  daysOverdue: number;
  lastCallResult: string | null;
  lastCallAt: string | null;
  noAnswerCount: number;
  settlementDate: string | null;
  needsSkipTracing: boolean;
  deviceLocked: boolean;
  // Card indicator fields (enriched server-side)
  lastContactedAt: string | null;
  brokenPromiseCount: number;
  mdmState: 'NONE' | 'PENDING' | 'LOCKED' | 'UNLOCKED';
  relatedContractsCount: number;
  lastChannel: 'LINE' | 'SMS' | 'CALL' | 'LETTER' | null;
  letterCount: number;
  slipReviewPending: boolean;
  /**
   * ISO timestamp when the current user's snooze on this card expires.
   * Null when no active snooze (the row would be hidden from the queue
   * anyway except for OWNER, who sees everyone's parked work).
   */
  snoozedUntil?: string | null;
  /**
   * 7-day daysOverdue trend vs the same contract one week ago.
   *  - 'UP'   getting worse  (delta > 0)
   *  - 'DOWN' improving      (delta < 0)
   *  - null   no historical snapshot to compare with, OR delta === 0
   */
  trendingArrow?: 'UP' | 'DOWN' | null;
  /**
   * Customer segmentation tags surfaced for chip rendering on the card.
   * Empty array when the customer has no active tags (read-only field —
   * mutations go through the CustomerTagDialog hooks).
   */
  customerTags?: { tag: 'VIP' | 'HIGH_RISK' | 'NEW' | 'LOYAL' | 'BLACKLIST' }[];
  /**
   * Next-Best-Action recommendation computed by the backend rule engine
   * (P3 Task 9). Null when no rule fires (NOOP) — UI hides the chip in
   * that case.
   */
  nextBestAction?: {
    type: 'CALL' | 'SEND_LINE' | 'SEND_LETTER' | 'PROPOSE_LOCK' | 'NOOP';
    label: string;
    reason: string;
  } | null;
}

export type CallResult =
  | 'NO_ANSWER'
  | 'ANSWERED'
  | 'PROMISED'
  | 'REFUSED'
  | 'WRONG_NUMBER'
  | 'OTHER';
