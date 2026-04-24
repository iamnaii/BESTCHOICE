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
