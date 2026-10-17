/** Managed HTTP read contract. Null means unavailable, never zero. Existing
 * unmanaged clients retain their legacy shapes. UI7 must opt into this contract. */
export interface TenderReadAvailability {
  money: 'FULL' | 'UNAVAILABLE';
  sources: 'COMPLETE' | 'PARTIAL';
  duplicateReferences: 'SCOPED';
  countNote: { required: true; minLength: 5; maxLength: 500 };
}
export interface TenderPerson {
  id: string;
  name: string;
}
export type TenderWorkflowState = 'PENDING_CONFIRM' | 'CONFIRMED' | 'SENT_BACK';
export type TenderMoneyState = 'AWAITING_CONFIRM' | 'REACHED' | 'AT_BRANCH' | 'SENT_BACK';
export type TenderDayState =
  | 'REACHED'
  | 'AT_BRANCH'
  | 'AWAITING_CONFIRM'
  | 'NOT_COUNTED'
  | 'MISSED'
  | 'NO_CASH';
export type TenderDestination = 'OWNER_HOLD' | 'BANK_DEPOSIT' | 'BRANCH_SAFE';
export interface ManagedTenderRound {
  periodStart: string | null;
  floatAmount: number;
  cashIn: number | null;
  cashOut: number | null;
  expectedAmount: number | null;
  movementCount?: number | null;
}
export interface ManagedCashClose {
  id: string;
  branchId: string;
  branchName: string;
  status: TenderWorkflowState;
  attemptNo: number;
  periodStart: string | null;
  countedAt: string;
  floatAmount: number;
  cashIn: number | null;
  cashOut: number | null;
  expectedAmount: number | null;
  countedAmount: number | null;
  varianceAmount: number | null;
  /** For new managed counts this is the unconditional counting note (5–500). */
  varianceReason: string | null;
  sendAmount: number | null;
  countedBy: TenderPerson;
  receivedAmount: number | null;
  receiveVariance: number | null;
  receiveNote: string | null;
  destination: TenderDestination | null;
  confirmedBy: TenderPerson | null;
  confirmedAt: string | null;
  sentBackBy: TenderPerson | null;
  sentBackAt: string | null;
  sentBackReason: string | null;
  journalPosted: boolean | null;
  depositReference: string | null;
  hasDepositSlip: boolean | null;
  canReadSlip: boolean;
  moneyState: TenderMoneyState | null;
  moneyAvailable: boolean;
}
export interface ManagedCashHolding {
  branchId: string;
  branchName: string;
  source: 'OWNER_HOLD' | 'BRANCH_SAFE';
  sourceLabel: string;
  reachedCompany: boolean;
  outstanding: number;
  closeCount: number;
  oldestConfirmedAt: string | null;
  openCloses: { id: string; confirmedAt: string; outstanding: number }[];
  canDeposit: boolean;
  moneyAvailable: boolean;
}
export interface ManagedCashDeposit {
  canReadSlip: boolean;
  id: string;
  branchId: string;
  branchName: string;
  source: 'OWNER_HOLD' | 'BRANCH_SAFE';
  sourceLabel: string;
  amount: number | null;
  reference: string | null;
  note: string | null;
  depositedBy: TenderPerson;
  depositedAt: string;
  journalPosted: boolean | null;
  moneyAvailable: boolean;
}
export interface ManagedCashCloseStatus {
  date: string;
  asOf: string;
  branchId: string;
  branchName: string;
  round: ManagedTenderRound;
  readiness: {
    hasDrawerAccount: boolean;
    floatAmount: number;
    counters: (TenderPerson & { role: null })[];
  };
  closes: ManagedCashClose[];
  awaitingConfirm: ManagedCashClose[];
  holdings: ManagedCashHolding[] | null;
  permissions: { canCount: boolean; canConfirm: boolean; viewerId: string };
  availability: TenderReadAvailability;
  moneyAvailable: boolean;
}
export interface ManagedCashCloseHistory {
  month: string;
  branchId: string | null;
  rows: ManagedCashClose[];
  deposits: ManagedCashDeposit[];
  alerts: {
    unclosedYesterday: {
      branchId: string;
      branchName: string;
      date: string;
      cashIn: number | null;
      moneyAvailable: boolean;
    }[];
    monthShortage:
      | {
          branchId: string;
          branchName: string;
          count: number;
          amount: number;
          moneyAvailable: boolean;
        }[]
      | null;
    awaitingOverOneDay: ManagedCashClose[];
  };
  availability: TenderReadAvailability;
  moneyAvailable?: boolean;
}
export interface ManagedCashCloseOverview {
  date: string;
  today: string;
  asOf: string;
  viewerId: string;
  rows: {
    branchId: string;
    branchName: string;
    state: TenderDayState | null;
    close: ManagedCashClose | null;
    closeCount: number;
    dayCashIn: number | null;
    dayCashOut: number | null;
    lastCashInAt: string | null;
    round: ManagedTenderRound | null;
    canConfirm: boolean;
    moneyAvailable: boolean;
  }[];
  summary: {
    reached: number | null;
    atBranch: number | null;
    awaitingConfirm: number;
    notCounted: number;
    noCash: number;
  };
  strip: {
    dates: string[];
    rows: {
      branchId: string;
      branchName: string;
      cells: TenderDayState[] | null;
      moneyAvailable: boolean;
    }[];
  };
  holdings: ManagedCashHolding[] | null;
  availability: TenderReadAvailability;
}
export interface ManagedCashCloseReminder {
  missed: {
    branchId: string;
    branchName: string;
    date: string;
    cashIn: number | null;
    expectedAmount: number | null;
    moneyAvailable: boolean;
  } | null;
  canCount: boolean;
  availability: TenderReadAvailability;
}
export interface ManagedTenderDailyRow {
  id: string;
  occurredAt: string;
  kind: string;
  direction: 'IN' | 'OUT';
  docType: 'sale' | 'contract' | 'booking' | 'tradeIn';
  docId: string | null;
  docNumber: string | null;
  customerName: string | null;
  method: string;
  reference: string | null;
  amount: string | null;
  seq: number;
  seqTotal: number;
  actorId: string;
  actorName: string;
  branchId: string;
  branchName: string;
  duplicateReference: boolean;
}
export interface ManagedTenderDailySummary {
  date: string;
  scope: 'SCOPED';
  branchId: string | null;
  branches: { id: string; name: string }[];
  totals: {
    cashIn: string | null;
    transferIn: string | null;
    qrIn: string | null;
    totalIn: string | null;
    cashOut: string | null;
    nonCashOut: string | null;
    totalOut: string | null;
    expectedCashInDrawer: string | null;
    inCount: number;
    outCount: number;
  };
  byStaff: {
    actorId: string;
    name: string;
    cashIn: string | null;
    transferIn: string | null;
    qrIn: string | null;
    cashOut: string | null;
    nonCashOut: string | null;
    netCash: string | null;
    count: number;
  }[];
  byKind: {
    kind: string;
    direction: string;
    cash: string | null;
    transfer: string | null;
    qr: string | null;
    total: string | null;
    count: number;
  }[];
  rows: ManagedTenderDailyRow[];
  duplicateReferences: { reference: string; documents: string[] }[];
  availability: TenderReadAvailability;
  moneyAvailable?: boolean;
}
export interface ManagedImportedSaleBucket {
  key: string;
  count: number;
  sales: string;
  profit: string | null;
}
export interface ManagedImportedSalesSummary {
  totals: { count: number; sales: string; profit: string | null; cost: string | null };
  byMonth: ManagedImportedSaleBucket[];
  byChannel: ManagedImportedSaleBucket[];
  bySalesperson: ManagedImportedSaleBucket[];
  byCategory: ManagedImportedSaleBucket[];
}
export interface ManagedImportedSale {
  id: string;
  source: 'TOOLTIFY';
  barcode: string;
  productName: string;
  category: string;
  buyerLabel: string;
  shopLabel: string | null;
  orderNumber: string;
  paymentType: string;
  priceGroup: string;
  saleChannel: string;
  costTotal: string | null;
  listPrice: string;
  salePrice: string;
  profit: string | null;
  salespersonName: string;
  soldAt: string;
  importBatch: string;
  importedAt: string;
}
export interface ManagedImportedSalesList {
  data: ManagedImportedSale[];
  total: number;
  page: number;
  limit: number;
}

/** Count response deliberately does not disclose expected money or variance. */
export interface ManagedCashCountAcknowledgement {
  id: string;
  status: 'PENDING_CONFIRM';
}
/** Upload acknowledgement is existence metadata, not content authorization. */
export interface ManagedCashSlipAcknowledgement {
  id: string;
  hasDepositSlip: true;
}
export const MANAGED_CASH_SLIP_CONTRACT = {
  maxBytes: 5242880,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  cacheControl: 'private, no-store',
} as const;
