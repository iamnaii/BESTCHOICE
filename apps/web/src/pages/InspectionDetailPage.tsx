import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  Warehouse,
} from 'lucide-react';

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

const statusConfig: Record<string, { label: string; class: string; icon: typeof Package }> = {
  RECEIVED: { label: 'รอตรวจ', class: 'bg-blue-100 text-blue-700', icon: Package },
  INSPECTING: { label: 'กำลังตรวจ', class: 'bg-yellow-100 text-yellow-700', icon: Clock },
  QC_PASSED: { label: 'ผ่าน QC', class: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  QC_FAILED: { label: 'ไม่ผ่าน QC', class: 'bg-red-100 text-red-700', icon: XCircle },
  IN_STOCK: { label: 'เข้าสต็อกแล้ว', class: 'bg-primary/10 text-primary', icon: Warehouse },
};

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: _user } = useAuth();

  const { data: product, isLoading } = useQuery<ProductDetail>({
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
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
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

  const currentStatus = statusConfig[product.status] ?? {
    label: product.status,
    class: 'bg-gray-100 text-gray-700',
    icon: Package,
  };
  const StatusIcon = currentStatus.icon;

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
    { label: 'วันที่รับ', value: new Date(product.createdAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) },
  ];

  // Available next-status transitions
  const transitions: Record<string, { label: string; status: string; variant: string }[]> = {
    RECEIVED: [
      { label: 'เริ่มตรวจสอบ', status: 'INSPECTING', variant: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
    ],
    INSPECTING: [
      { label: 'ผ่าน QC', status: 'QC_PASSED', variant: 'bg-green-500 hover:bg-green-600 text-white' },
      { label: 'ไม่ผ่าน QC', status: 'QC_FAILED', variant: 'bg-red-500 hover:bg-red-600 text-white' },
    ],
    QC_PASSED: [
      { label: 'เข้าสต็อก', status: 'IN_STOCK', variant: 'bg-primary hover:bg-primary/90 text-white' },
    ],
    QC_FAILED: [
      { label: 'ตรวจใหม่', status: 'INSPECTING', variant: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
    ],
  };

  const availableTransitions = transitions[product.status] ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="รายละเอียดการตรวจสอบ"
        subtitle={`${product.brand} ${product.model}`}
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
        <div className="lg:col-span-2 bg-card rounded-xl border border-border">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">ข้อมูลสินค้า</h3>
            <span className={`text-xs px-3 py-1.5 rounded-full font-medium inline-flex items-center gap-1.5 ${currentStatus.class}`}>
              <StatusIcon className="size-3.5" />
              {currentStatus.label}
            </span>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {infoItems.map((item) => (
              <div key={item.label}>
                <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                <p className="text-sm font-medium text-foreground">{item.value}</p>
              </div>
            ))}
          </div>
          {product.notes && (
            <div className="px-5 pb-5">
              <p className="text-xs text-muted-foreground mb-1">หมายเหตุ</p>
              <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3">{product.notes}</p>
            </div>
          )}
        </div>

        {/* Actions Panel */}
        <div className="bg-card rounded-xl border border-border">
          <div className="px-5 py-4 border-b border-border">
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
                <CheckCircle2 className="size-8 mx-auto mb-2 text-green-500" />
                <p className="text-sm">สินค้าเข้าสต็อกแล้ว</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
