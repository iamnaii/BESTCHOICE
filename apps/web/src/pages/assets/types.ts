// Asset module — shared types & constants (Phase 1)

export type AssetStatus = 'DRAFT' | 'POSTED' | 'REVERSED' | 'DISPOSED' | 'WRITTEN_OFF';
export type AssetCategory = 'EQUIPMENT' | 'IMPROVEMENT' | 'FURNITURE' | 'VEHICLE';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'QR_EWALLET';
export type WhtFormType = 'PND3' | 'PND53';

export interface Asset {
  id: string;
  assetCode: string;
  docNo: string;
  name: string;
  description: string | null;
  category: AssetCategory;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  basePrice: string;
  shippingCost: string;
  installationCost: string;
  otherCapitalized: string;
  hasVat: boolean;
  vatInclusive: boolean;
  vatAmount: string;
  vatAccount: string | null;
  hasWht: boolean;
  whtBaseAmount: string | null;
  whtRate: string | null;
  whtAmount: string;
  whtAccount: string | null;
  whtFormType: WhtFormType | null;
  purchaseCost: string;
  residualValue: string;
  usefulLifeMonths: number;
  monthlyDepr: string;
  accumulatedDepr: string;
  netBookValue: string;
  coaCostAccount: string | null;
  coaDeprAccount: string | null;
  coaExpenseAccount: string | null;
  purchaseDate: string;
  invoiceDate: string | null;
  warrantyExpire: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  invoiceNo: string | null;
  taxInvoiceNo: string | null;
  paymentMethod: PaymentMethod | null;
  paymentAccount: string | null;
  custodian: string | null;
  location: string | null;
  serialNo: string | null;
  prRef: string | null;
  note: string | null;
  status: AssetStatus;
  isOverridden: boolean;
  createdById: string;
  createdBy: { id: string; name: string };
  approverId: string | null;
  approver: { id: string; name: string } | null;
  postedById: string | null;
  postedBy: { id: string; name: string } | null;
  postedAt: string | null;
  reversedById: string | null;
  reversedBy: { id: string; name: string } | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
  updatedAt: string;
  transferHistory?: AssetTransferHistory[];
}

export interface AssetTransferHistory {
  id: string;
  transferId: string;
  assetId: string;
  transferDate: string;
  fromCustodian: string | null;
  toCustodian: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  reason: string;
  transferredById: string;
  transferredBy: { id: string; name: string };
  createdAt: string;
}

export interface AssetSummary {
  draft: number;
  posted: number;
  reversed: number;
  disposed: number;
  writtenOff: number;
  totalPurchaseCost: number | string;
  totalNetBookValue: number | string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string };
}

export interface ListResponse {
  data: Asset[];
  total: number;
  page: number;
  limit: number;
}

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  EQUIPMENT: 'อุปกรณ์สำนักงาน',
  IMPROVEMENT: 'ส่วนปรับปรุงอาคาร',
  FURNITURE: 'เครื่องตกแต่งสำนักงาน',
  VEHICLE: 'ยานพาหนะ',
};

export const CATEGORY_COA: Record<AssetCategory, { cost: string; accDepr: string; expense: string }> = {
  EQUIPMENT: { cost: '12-2101', accDepr: '12-2102', expense: '53-1601' },
  IMPROVEMENT: { cost: '12-2103', accDepr: '12-2104', expense: '53-1602' },
  FURNITURE: { cost: '12-2105', accDepr: '12-2106', expense: '53-1603' },
  VEHICLE: { cost: '12-2107', accDepr: '12-2108', expense: '53-1604' },
};

export const CASH_ACCOUNTS: { code: string; name: string }[] = [
  { code: '11-1101', name: 'เงินสด — สุทธินีย์ คงเดช' },
  { code: '11-1102', name: 'เงินสด — เอกนรินทร์ อาคะนาริน' },
  { code: '11-1103', name: 'เงินสด — พนักงานบัญชี' },
  { code: '11-1201', name: 'ธนาคาร KBank' },
  { code: '11-1202', name: 'ธนาคาร SCB (ค่าใช้จ่าย)' },
  { code: '11-1203', name: 'ธนาคาร SCB (ค่าเสื่อม)' },
];
