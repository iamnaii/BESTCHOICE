export interface OcrBookBankResult {
  accountName: string | null;
  accountNo: string | null;
  bankName: string | null;
  branchName: string | null;
  accountType: string | null;
  balance: number | null;
  lastTransactionDate: string | null;
  confidence: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  nationalId: string;
  salary: string | null;
  occupation: string | null;
  addressCurrentType: string | null;
  salaryPayDay: number | null;
}

export interface OcrSalarySlipResult {
  netSalary: number | null;
  employerName: string | null;
  slipDate: string | null;
  payDay: number | null;
  bankName: string | null;
  confidence: number;
}

export interface OcrBankStatementResult {
  accountName: string | null;
  bankName: string | null;
  totalIncome: number | null;
  totalExpense: number | null;
  balance: number | null;
  transactionCount: number | null;
  dateRange: string | null;
  confidence: number;
}

export interface CustomerHistory {
  totalContracts: number;
  closedContracts: number;
  activeContracts: number;
  onTimePaymentPct: number;
  currentOutstanding: number;
  isReturning: boolean;
}

export interface RiskScoreResult {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
  debtToIncome: number;
  recommendedPayDay: number | null;
  recommendation: string;
}

export interface AiAnalysisData {
  monthlyIncome?: number;
  averageBalance?: number;
  affordabilityRatio?: number;
  incomeConsistency?: string;
  riskFactors?: string[];
  positiveFactors?: string[];
  [key: string]: unknown;
}

export interface CreditCheckItem {
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: AiAnalysisData | null;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  checkedAt: string | null;
  customer: { id: string; name: string; phone: string; salary: string | null; occupation: string | null };
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}

export interface CreditCheckSummary {
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  avgScore: number;
}

export interface CreditChecksResponse {
  data: CreditCheckItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: CreditCheckSummary;
}

export interface Branch {
  id: string;
  name: string;
}

export const BANK_OPTIONS = [
  'กสิกรไทย',
  'กรุงเทพ',
  'กรุงไทย',
  'ไทยพาณิชย์',
  'ออมสิน',
  'ธ.ก.ส.',
  'กรุงศรี',
  'ทหารไทยธนชาต',
];

export const statusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอวิเคราะห์', className: 'bg-muted text-foreground' },
  APPROVED: { label: 'ผ่าน', className: 'bg-success/10 text-success dark:bg-success/15' },
  REJECTED: { label: 'ไม่ผ่าน', className: 'bg-destructive/10 text-destructive dark:bg-destructive/15' },
  MANUAL_REVIEW: { label: 'ต้องตรวจเพิ่ม', className: 'bg-warning/10 text-warning dark:bg-warning/15' },
};

export function getRiskBadge(aiScore: number | null) {
  if (aiScore === null) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        รอวิเคราะห์
      </span>
    );
  }
  if (aiScore >= 70) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success dark:bg-success/15">
        ความเสี่ยงต่ำ
      </span>
    );
  }
  if (aiScore >= 50) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning dark:bg-warning/15">
        ความเสี่ยงปานกลาง
      </span>
    );
  }
  if (aiScore >= 40) {
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning dark:bg-warning/15">
        ต้องตรวจเพิ่ม
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive dark:bg-destructive/15">
      ความเสี่ยงสูง
    </span>
  );
}
