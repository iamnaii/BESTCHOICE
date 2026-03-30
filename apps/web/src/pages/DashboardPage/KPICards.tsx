import {
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Warehouse,
} from 'lucide-react';

interface KPIs {
  contracts: { total: number; active: number; overdue: number; default: number; completed: number };
  products: { total: number; inStock: number };
  financial: { totalReceivable: number; totalLateFees: number; todayPayments: number; todayPaymentCount: number };
  overdueRate: number;
}

interface KPICardsProps {
  kpis: KPIs;
  navigate: (path: string) => void;
}

export default function KPICards({ kpis, navigate }: KPICardsProps) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 text-white p-6 lg:p-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="cursor-pointer" onClick={() => navigate('/contracts')}>
          <div className="flex items-center gap-2 mb-2">
            <FileCheck className="size-4 opacity-70" />
            <span className="text-xs text-white/70 font-medium">สัญญาทั้งหมด</span>
          </div>
          <div className="text-2xl lg:text-3xl font-bold">{kpis.contracts.total}</div>
          <div className="text-xs text-white/60 mt-1">ปกติ {kpis.contracts.active}</div>
        </div>
        <div className="cursor-pointer" onClick={() => navigate('/overdue')}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="size-4 opacity-70" />
            <span className="text-xs text-white/70 font-medium">ค้าง/ผิดนัด</span>
          </div>
          <div className="text-2xl lg:text-3xl font-bold">{(kpis.contracts.overdue ?? 0) + (kpis.contracts.default ?? 0)}</div>
          <div className="text-xs text-white/60 mt-1">{(kpis.overdueRate ?? 0).toFixed(1)}%</div>
        </div>
        <div className="cursor-pointer" onClick={() => navigate('/payments')}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="size-4 opacity-70" />
            <span className="text-xs text-white/70 font-medium">ยอดรับวันนี้</span>
          </div>
          <div className="text-2xl lg:text-3xl font-bold">฿{kpis.financial.todayPayments.toLocaleString()}</div>
          <div className="text-xs text-white/60 mt-1">{kpis.financial.todayPaymentCount} รายการ</div>
        </div>
        <div className="cursor-pointer" onClick={() => navigate('/stock')}>
          <div className="flex items-center gap-2 mb-2">
            <Warehouse className="size-4 opacity-70" />
            <span className="text-xs text-white/70 font-medium">สินค้าในสต็อก</span>
          </div>
          <div className="text-2xl lg:text-3xl font-bold">{kpis.products.inStock}</div>
          <div className="text-xs text-white/60 mt-1">จาก {kpis.products.total}</div>
        </div>
      </div>
    </div>
  );
}
