// ─── Shared types & constants for AssetManagementPage ───

export interface Asset {
  id: string;
  assetCode: string;
  name: string;
  description: string | null;
  category: string;
  costValue: string;
  salvageValue: string;
  usefulLife: number;
  accumulatedDepreciation: string;
  purchaseDate: string;
  status: string;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

export interface AssetSummary {
  totalCount: number;
  totalCostValue: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
}

export interface Branch {
  id: string;
  name: string;
}

export const categoryLabels: Record<string, string> = {
  BUILDING: 'อาคาร',
  VEHICLE: 'ยานพาหนะ',
  EQUIPMENT: 'อุปกรณ์',
  FURNITURE: 'เฟอร์นิเจอร์',
  COMPUTER: 'คอมพิวเตอร์',
  LEASEHOLD: 'สิทธิการเช่า',
  OTHER: 'อื่นๆ',
};

export const categoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({
  value,
  label,
}));

export const statusFilterOptions: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: 'ใช้งาน' },
  { value: 'FULLY_DEPRECIATED', label: 'หมดค่าเสื่อม' },
  { value: 'DISPOSED', label: 'จำหน่ายแล้ว' },
];

export const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const emptyForm = {
  assetCode: '',
  name: '',
  description: '',
  category: 'EQUIPMENT',
  branchId: '',
  costValue: '',
  salvageValue: '0',
  usefulLife: '5',
  purchaseDate: new Date().toISOString().split('T')[0],
  depreciationAccountCode: '',
  accumulatedDepreAccountCode: '',
  assetAccountCode: '',
};

export type AssetForm = typeof emptyForm;
