import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, inspectionStatusMap } from '@/lib/status-badges';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  Warehouse,
} from 'lucide-react';
import { formatDateMedium } from '@/utils/formatters';

interface ProductDetail {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  status: string;
  category: string;
  color: string | null;
  storage: string | null;
  costPrice: string;
  condition: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
}

const statusIconMap: Record<string, typeof Package> = {
  RECEIVED: Package,
  INSPECTING: Clock,
  QC_PASSED: CheckCircle2,
  QC_FAILED: XCircle,
  IN_STOCK: Warehouse,
};

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: product, isLoading, isError, error, refetch } = useQuery<ProductDetail>({
    queryKey: ['inspection-detail', id],
    queryFn: async () => {
      const res = await api.get(`/products/${id}`);
      return res.data;
    },
    enabled: !!id,
  });

  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      await api.patch(`/products/${id}`, { status: newStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection-detail', id] });
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-workflow'] });
      toast.success('อัปเดตสถานะสำเร็จ');
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  if (isLoading) {
    return <QueryBoundary isLoading={true} isError={false}>{null}</QueryBoundary>;
  }

  if (isError) {
    return <QueryBoundary isLoading={false} isError={true} error={error} onRetry={refetch} errorTitle="ไม่สามารถโหลดข้อมูลสินค้าได้">{null}</QueryBoundary>;
  }

  if (!product) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Package className="size-12 mx-auto mb-4 opacity-40" />
        <p className="text-lg font-medium">ไม่พบสินค้า</p>
        <button
          onClick={() => navigate('/inspections')}
          className="mt-4 text-sm text-primary hover:underline"
        >
          กลับไปรายการตรวจสอบ
        </button>
      </div>
    );
  }

  const currentStatusCfg = getStatusBadgeProps(product.status, inspectionStatusMap);
  const StatusIcon = statusIconMap[product.status] ?? Package;

  const infoItems = [
    { label: 'ชื่อสินค้า', value: product.name },
    { label: 'ยี่ห้อ', value: product.brand },
    { label: 'รุ่น', value: product.model },
    { label: 'IMEI / Serial', value: product.imeiSerial ?? '-' },
    { label: 'หมวดหมู่', value: product.category },
    { label: 'สี', value: product.color ?? '-' },
    { label: 'ความจุ', value: product.storage ?? '-' },
    { label: 'สภาพ', value: product.condition ?? '-' },
    { label: 'ราคาทุน', value: `${Number(product.costPrice).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท` },
    { label: 'สาขา', value: product.branch.name },
    { label: 'ผู้ขาย', value: product.supplier?.name ?? '-' },
    { label: 'วันที่รับ', value: formatDateMedium(product.createdAt) },
  ];

  // Available next-status transitions
  const transitions: Record<string, { label: string; status: string; variant: string }[]> = {
    RECEIVED: [
      { label: 'เริ่มตรวจสอบ', status: 'INSPECTING', variant: 'bg-warning text-warning-foreground hover:bg-warning/90' },
    ],
    INSPECTING: [
      { label: 'ผ่าน QC', status: 'QC_PASSED', variant: 'bg-success text-success-foreground hover:bg-success/90' },
      { label: 'ไม่ผ่าน QC', status: 'QC_FAILED', variant: 'bg-destructive text-destructive-foreground hover:bg-destructive/90' },
    ],
    QC_PASSED: [
      { label: 'เข้าสต็อก', status: 'IN_STOCK', variant: 'bg-primary hover:bg-primary/90 text-white' },
    ],
    QC_FAILED: [
      { label: 'ตรวจใหม่', status: 'INSPECTING', variant: 'bg-warning text-warning-foreground hover:bg-warning/90' },
    ],
  };

  const availableTransitions = transitions[product.status] ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="รายละเอียดการตรวจสอบ"
        subtitle={`${product.brand} ${product.model}`}
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink asChild><Link to="/inspections">ตรวจสอบ</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>{product.brand} {product.model}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        action={
          <button
            onClick={() => navigate('/inspections')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            กลับ
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Product Info */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border/50 shadow-sm">
          <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold">ข้อมูลสินค้า</h3>
            <Badge variant={currentStatusCfg.variant} appearance={currentStatusCfg.appearance} className="inline-flex items-center gap-1.5">
              <StatusIcon className="size-3.5" />
              {currentStatusCfg.label}
            </Badge>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {infoItems.map((item) => (
              <div key={item.label}>
                <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{item.label}</p>
                <p className="text-sm font-medium text-foreground">{item.value}</p>
              </div>
            ))}
          </div>
          {product.notes && (
            <div className="px-5 pb-5">
              <p className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">หมายเหตุ</p>
              <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3">{product.notes}</p>
            </div>
          )}
        </div>

        {/* Actions Panel */}
        <div className="bg-card rounded-xl border border-border/50 shadow-sm">
          <div className="px-5 py-4 border-b border-border/50">
            <h3 className="text-sm font-semibold">ดำเนินการ</h3>
          </div>
          <div className="p-5 space-y-3">
            {availableTransitions.length > 0 ? (
              availableTransitions.map((t) => (
                <button
                  key={t.status}
                  onClick={() => updateStatus.mutate(t.status)}
                  disabled={updateStatus.isPending}
                  className={`w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${t.variant}`}
                >
                  {updateStatus.isPending ? 'กำลังอัปเดต...' : t.label}
                </button>
              ))
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <CheckCircle2 className="size-8 mx-auto mb-2 text-success" />
                <p className="text-sm">สินค้าเข้าสต็อกแล้ว</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
