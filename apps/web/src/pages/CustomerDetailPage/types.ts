import type {
  CustomerChatRoom,
  CustomerInstallmentBalance,
  CustomerLatestPurchase,
  CustomerPurchaseSummary,
  CustomerWarranty,
  ProspectSource,
} from '@/pages/CustomersPage/types';
import type { CustomerTagType } from '@/pages/CollectionsPage/hooks/useCustomerTags';

export interface ReferenceData {
  prefix?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

export interface CustomerDetail {
  id: string;
  nationalId: string;
  prefix: string | null;
  name: string;
  nickname: string | null;
  isForeigner: boolean;
  birthDate: string | null;
  phone: string | null;
  chatPlaceholder?: boolean;
  phoneSecondary: string | null;
  email: string | null;
  lineIdFinance: string | null;
  lineIdShop: string | null;
  facebookLink: string | null;
  facebookName: string | null;
  facebookFriends: string | null;
  googleMapLink: string | null;
  addressIdCard: string | null;
  addressCurrent: string | null;
  occupation: string | null;
  occupationDetail: string | null;
  salary: string | null;
  workplace: string | null;
  addressWork: string | null;
  references: ReferenceData[] | null;
  documents: string[] | null;
  createdAt: string;
  contracts: {
    id: string;
    contractNumber: string;
    status: string;
    sellingPrice: string;
    monthlyPayment: string;
    totalMonths: number;
    createdAt: string;
    product: { id: string; name: string; brand: string; model: string };
    branch: { id: string; name: string };
  }[];
  /** การซื้อที่ไม่ผ่านสัญญาผ่อน — ขายสด / ไฟแนนซ์นอก (API กรอง contractId: null มาให้แล้ว) */
  sales?: {
    id: string;
    saleNumber: string;
    saleType: string;
    netAmount: string;
    createdAt: string;
    shopWarrantyEndDate: string | null;
    product: { id: string; brand: string; model: string; imeiSerial: string | null } | null;
    branch: { id: string; name: string } | null;
  }[];
  /** ค่าดิบ เช่น CHAT_FACEBOOK — ใช้แสดงผลเท่านั้น ห้าม derive ธงผู้สนใจจากค่านี้ (ใช้ chatPlaceholder) */
  acquisitionSource: string | null;
  /** CustomerCreditCheckStatus — ป้ายอ่านจาก customerCreditStatusMap */
  creditCheckStatus: string;
  tags: { tag: CustomerTagType }[];
  source: ProspectSource;
  purchase: CustomerPurchaseSummary | null;
  latestPurchase: CustomerLatestPurchase | null;
  warranty: CustomerWarranty | null;
  installmentBalance: CustomerInstallmentBalance | null;
  chatRooms: CustomerChatRoom[];
  lastContactAt: string | null;
  assignedTo: { id: string; name: string } | null;
  openContracts: ContractProgress[];
}

export interface RiskFlag {
  hasRisk: boolean;
  riskLevel: string;
  overdueContracts: { id: string; contractNumber: string; status: string }[];
}

export interface CreditCheckItem {
  checkType?: string;
  id: string;
  status: string;
  bankName: string | null;
  statementFiles: string[];
  statementMonths: number;
  aiScore: number | null;
  aiSummary: string | null;
  aiRecommendation: string | null;
  aiAnalysis: Record<string, unknown> | null;
  reviewNotes: string | null;
  checkedBy: { id: string; name: string } | null;
  contract: { id: string; contractNumber: string } | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  user: { id: string; name: string; email: string };
  createdAt: string;
}

/** การ์ด "สัญญาที่กำลังผ่อน" — ต้องตรงกับ apps/api/src/modules/customers/services/customer-contract-progress.ts */
export interface ContractProgress {
  id: string;
  contractNumber: string;
  status: string;
  productLabel: string;
  imeiSerial: string | null;
  branchName: string | null;
  startedAt: string;
  monthlyPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  outstanding: number;
  nextDueDate: string | null;
  nextAmountDue: number | null;
  firstOverdueInstallmentNo: number | null;
  firstOverdueDueDate: string | null;
  mdmLocked: boolean;
  shopWarrantyEndDate: string | null;
  centerWarrantyEndDate: string | null;
  lastCall: { calledAt: string; result: string; notes: string | null; callerName: string | null } | null;
}
