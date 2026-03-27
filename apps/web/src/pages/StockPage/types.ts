export interface StockProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  color: string | null;
  storage: string | null;
  createdAt?: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

export interface BranchSummary {
  branch: { id: string; name: string };
  total: number;
  inStock: number;
  totalValue: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  value: number;
}

export interface BreakdownItem {
  name: string;
  count: number;
  value: number;
}

export interface StockDashboard {
  stockAging: AgingBucket[];
  actionRequired: {
    inspection: number;
    qcPending: number;
    photoPending: number;
    pendingTransfers: number;
    repossessed: number;
    agingOver90: number;
  };
  valueByStatus: { status: string; count: number; value: number }[];
  byCategory: BreakdownItem[];
  byBrand: BreakdownItem[];
  byColor: BreakdownItem[];
  byStorage: BreakdownItem[];
  stockMovement: { month: string; in: number; out: number }[];
  stockTurnover: {
    avgDaysInStock: number;
    soldThisMonth: number;
    soldLastMonth: number;
    currentStock: number;
  };
  topSellers: { name: string; count: number }[];
  slowMovers: { name: string; days: number; costPrice: number }[];
  marginOverview: {
    totalCost: number;
    totalSell: number;
    totalMargin: number;
    avgMarginPct: number;
    avgMarginPerUnit: number;
    itemsWithPrice: number;
  };
}
