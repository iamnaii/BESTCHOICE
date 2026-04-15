import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, inspectionStatusMap } from '@/lib/status-badges';
import {
  Package,
  Search,
  CheckCircle2,
  Clock,
  Camera,
  AlertTriangle,
  ArrowRight,
  Warehouse,
} from 'lucide-react';

interface WorkflowProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  status: string;
  category: string;
  createdAt: string;
  branch: { id: string; name: string };
}

const workflowSteps = [
  { key: 'RECEIVED', label: 'รับเข้า', icon: Package, color: 'bg-blue-500' },
  { key: 'INSPECTING', label: 'ตรวจสอบ', icon: Search, color: 'bg-yellow-500' },
  { key: 'QC_PASSED', label: 'ผ่าน QC', icon: CheckCircle2, color: 'bg-green-500' },
  { key: 'IN_STOCK', label: 'เข้าสต็อก', icon: Warehouse, color: 'bg-primary' },
];

export default function InventoryWorkflowPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  const { data: products, isLoading, isError, error, refetch } = useQuery<WorkflowProduct[]>({
    queryKey: ['inventory-workflow', user?.branchId],
    queryFn: async () => {
      const res = await api.get('/products', {
        params: {
          branchId: user?.branchId,
          statuses: 'RECEIVED,INSPECTING,QC_PASSED,IN_STOCK',
          limit: 200,
        },
      });
      return res.data?.data ?? res.data ?? [];
    },
  });

  const grouped = useMemo(() => {
    const map: Record<string, WorkflowProduct[]> = {};
    for (const step of workflowSteps) {
      map[step.key] = [];
    }
    for (const p of products ?? []) {
      if (map[p.status]) {
        map[p.status].push(p);
      }
    }
    return map;
  }, [products]);

  const filtered = selectedStep ? grouped[selectedStep] ?? [] : products ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="ขั้นตอนสต็อก"
        subtitle="ติดตามสถานะสินค้าตั้งแต่รับเข้าจนเข้าสต็อก"
      />

      {/* Workflow Steps Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {workflowSteps.map((step, i) => {
          const count = grouped[step.key]?.length ?? 0;
          const isActive = selectedStep === step.key;
          return (
            <button
              key={step.key}
              onClick={() => setSelectedStep(isActive ? null : step.key)}
              className={`relative p-5 rounded-xl border shadow-sm transition-all text-left hover:shadow-card-hover ${
                isActive
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border/50 bg-card hover:border-primary/30'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`size-9 rounded-lg ${step.color} flex items-center justify-center shadow-sm`}>
                  <step.icon className="size-4 text-white" />
                </div>
                {i < workflowSteps.length - 1 && (
                  <ArrowRight className="size-4 text-muted-foreground/40 absolute right-3 top-5" />
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{step.label}</p>
              <p className="text-2xl font-bold text-foreground mt-1">{count}</p>
              <p className="text-xs text-muted-foreground">รายการ</p>
            </button>
          );
        })}
      </div>

      {/* Product List */}
      <div className="bg-card rounded-xl border border-border/50 shadow-sm">
        <div className="px-5 py-4 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground">
            {selectedStep
              ? `${workflowSteps.find((s) => s.key === selectedStep)?.label ?? ''} — ${filtered.length} รายการ`
              : `สินค้าทั้งหมด — ${filtered.length} รายการ`}
          </h3>
        </div>

        <QueryBoundary
          isLoading={isLoading && !products}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดข้อมูลสินค้าได้"
        >
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Package className="size-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">ไม่พบสินค้าในขั้นตอนนี้</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((product) => {
              const step = workflowSteps.find((s) => s.key === product.status);
              return (
                <div
                  key={product.id}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/inspections/${product.id}`)}
                >
                  <div className={`size-8 rounded-lg ${step?.color ?? 'bg-gray-400'} flex items-center justify-center shrink-0`}>
                    {step?.icon && <step.icon className="size-4 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {product.brand} {product.model}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {product.imeiSerial ?? product.name} · {product.branch.name}
                    </p>
                  </div>
                  {(() => { const cfg = getStatusBadgeProps(product.status, inspectionStatusMap); return <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>; })()}
                </div>
              );
            })}
          </div>
        )}
        </QueryBoundary>
      </div>
    </div>
  );
}
