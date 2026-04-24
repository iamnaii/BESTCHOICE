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
  status?: 'PENDING' | 'EXECUTED_MANUAL' | 'EXECUTED_API' | 'REJECTED' | 'UNLOCKED' | 'LOCKED';
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
}

export type CallResult =
  | 'NO_ANSWER'
  | 'ANSWERED'
  | 'PROMISED'
  | 'REFUSED'
  | 'WRONG_NUMBER'
  | 'OTHER';
