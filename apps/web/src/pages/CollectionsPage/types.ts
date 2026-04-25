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
}

export type CallResult =
  | 'NO_ANSWER'
  | 'ANSWERED'
  | 'PROMISED'
  | 'REFUSED'
  | 'WRONG_NUMBER'
  | 'OTHER';
