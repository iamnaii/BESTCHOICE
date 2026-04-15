import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateShort } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { getStatusBadgeProps, productStatusMap, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import DataTable from '@/components/ui/DataTable';
import { displayAddress } from '@/components/ui/AddressForm';

interface SupplierPaymentMethod {
  id: string;
  paymentMethod: string;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  creditTermDays: number | null;
  isDefault: boolean;
}

interface Supplier {
  id: string;
  name: string;
  contactName: string;
  nickname: string | null;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  address: string | null;
  taxId: string | null;
  hasVat: boolean;
  paymentMethods: SupplierPaymentMethod[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { products: number; purchaseOrders: number };
}

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  CHECK: 'เช็ค',
  CREDIT: 'เครดิต',
};

interface ProductRecord {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  createdAt: string;
  branch: { id: string; name: string };
  po: { id: string; poNumber: string; orderDate: string } | null;
}

interface PORecord {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  totalAmount: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  paidAmount: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  items: { id: string; brand: string; model: string; quantity: number; unitPrice: string; receivedQty: number }[];
  _count: { products: number };
}


const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const { data: supplier, isLoading: supplierLoading, isError: supplierError, error: supplierErrorObj, refetch: supplierRefetch } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const { data } = await api.get(`/suppliers/${id}`);
      return data;
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ supplierId, isActive }: { supplierId: string; isActive: boolean }) => {
      return api.patch(`/suppliers/${supplierId}`, { isActive });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success(variables.isActive ? 'เปิดใช้งานผู้ขายสำเร็จ' : 'ซ่อนผู้ขายสำเร็จ');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery<{
    products: ProductRecord[];
    purchaseOrders: PORecord[];
  }>({
    queryKey: ['supplier-history', id],
    queryFn: async () => {
      const { data } = await api.get(`/suppliers/${id}/purchase-history`);
      return data;
    },
  });

  if (supplierLoading) {
    return <QueryBoundary isLoading={true} isError={false}>{null}</QueryBoundary>;
  }

  if (supplierError) {
    return <QueryBoundary isLoading={false} isError={true} error={supplierErrorObj} onRetry={supplierRefetch} errorTitle="ไม่สามารถโหลดข้อมูลผู้ขายได้">{null}</QueryBoundary>;
  }

  if (!supplier) {
    return <div className="text-center py-12 text-muted-foreground">ไม่พบข้อมูลผู้ขาย</div>;
  }

  const totalCost = history?.products.reduce((sum, p) => sum + parseFloat(p.costPrice), 0) || 0;

  const productColumns = [
    { key: 'name', label: 'สินค้า', render: (p: ProductRecord) => (
      <div>
        <div className="font-medium">{p.brand} {p.model}</div>
        <div className="text-xs text-muted-foreground">{p.name}</div>
      </div>
    )},
    { key: 'imeiSerial', label: 'IMEI/Serial', render: (p: ProductRecord) => (
      <span className="font-mono text-xs">{p.imeiSerial || '-'}</span>
    )},
    { key: 'category', label: 'ประเภท', render: (p: ProductRecord) => (
      <span className="text-xs">{categoryLabels[p.category] || p.category}</span>
    )},
    { key: 'costPrice', label: 'ราคาทุน', render: (p: ProductRecord) => (
      <span className="font-medium">{parseFloat(p.costPrice).toLocaleString()} ฿</span>
    )},
    { key: 'status', label: 'สถานะ', render: (p: ProductRecord) => {
      const cfg = getStatusBadgeProps(p.status, productStatusMap);
      return <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>;
    }},
    { key: 'branch', label: 'สาขา', render: (p: ProductRecord) => (
      <span className="text-xs">{p.branch.name}</span>
    )},
    { key: 'createdAt', label: 'วันที่รับ', render: (p: ProductRecord) => (
      <span className="text-xs">{formatDateShort(p.createdAt)}</span>
    )},
  ];

  const poColumns = [
    { key: 'poNumber', label: 'เลข PO', render: (po: PORecord) => (
      <span className="font-mono text-sm font-medium">{po.poNumber}</span>
    )},
    { key: 'orderDate', label: 'วันที่สั่ง', render: (po: PORecord) => (
      <span className="text-sm">{formatDateShort(po.orderDate)}</span>
    )},
    { key: 'status', label: 'สถานะ', render: (po: PORecord) => {
      const cfg = getStatusBadgeProps(po.status, poStatusMap);
      return <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>;
    }},
    { key: 'items', label: 'รายการ', render: (po: PORecord) => (
      <div className="text-xs">
        {po.items.map((item, i) => (
          <div key={i}>{item.brand} {item.model} x{item.quantity} ({item.receivedQty} รับแล้ว)</div>
        ))}
      </div>
    )},
    { key: 'totalAmount', label: 'ยอดรวม', render: (po: PORecord) => (
      <span className="font-medium">{parseFloat(po.totalAmount).toLocaleString()} ฿</span>
    )},
    { key: 'paymentStatus', label: 'การจ่ายเงิน', render: (po: PORecord) => {
      const cfg = getStatusBadgeProps(po.paymentStatus || 'UNPAID', poPaymentStatusMap);
      return (
        <div>
          <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>
          {po.paymentMethod && (
            <div className="text-xs text-muted-foreground mt-0.5">{paymentMethodLabels[po.paymentMethod] || po.paymentMethod}</div>
          )}
          {po.paidAmount && Number(po.paidAmount) > 0 && (
            <div className="text-xs text-muted-foreground mt-0.5">{Number(po.paidAmount).toLocaleString()} ฿</div>
          )}
        </div>
      );
    }},
    { key: 'createdBy', label: 'ผู้สร้าง', render: (po: PORecord) => (
      <span className="text-xs">{po.createdBy.name}</span>
    )},
  ];

  return (
    <div>
      <PageHeader
        title={supplier.name}
        subtitle="รายละเอียดผู้ขาย"
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink asChild><Link to="/suppliers">ผู้ขาย</Link></BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>{supplier.name}</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        action={
          <div className="flex gap-2">
            {isManager && (
              <button
                onClick={() => {
                  const action = supplier.isActive ? 'ซ่อน' : 'เปิดใช้งาน';
                  setConfirmDialog({ open: true, message: `ต้องการ${action}ผู้ขาย "${supplier.name}" ?`, action: () => toggleActiveMutation.mutate({ supplierId: supplier.id, isActive: !supplier.isActive }) });
                }}
                disabled={toggleActiveMutation.isPending}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  supplier.isActive
                    ? 'text-destructive border-destructive/30 hover:bg-destructive/5 dark:hover:bg-destructive/10'
                    : 'text-success border-success/30 hover:bg-success/5 dark:hover:bg-success/10'
                }`}
              >
                {supplier.isActive ? 'ซ่อนผู้ขาย' : 'เปิดใช้งาน'}
              </button>
            )}
            <button
              onClick={() => navigate('/suppliers')}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg"
            >
              กลับ
            </button>
          </div>
        }
      />

      {/* ข้อมูลผู้ขาย */}
      <div className="rounded-xl border border-border/50 bg-card p-5 mb-6 shadow-sm relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">ข้อมูลผู้ขาย</h2>
          <Badge variant={supplier.isActive ? 'success' : 'destructive'} appearance="light">
            {supplier.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoField label="ชื่อ - นามสกุล (ผู้ติดต่อ)" value={supplier.contactName} />
          <InfoField label="ชื่อเล่น" value={supplier.nickname} />
          <InfoField label="เบอร์โทร" value={supplier.phone} />
          <InfoField label="เบอร์สำรอง" value={supplier.phoneSecondary} />
          <InfoField label="LINE ID" value={supplier.lineId} />
          <InfoField label="เลขประจำตัวผู้เสียภาษี (Tax ID Number)" value={supplier.taxId} />
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">สถานะ VAT</div>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                supplier.hasVat ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-muted text-muted-foreground'
              }`}
            >
              {supplier.hasVat ? 'มี VAT (7%)' : 'ไม่มี VAT'}
            </span>
          </div>
          <InfoField
            label="วันที่เพิ่ม"
            value={formatDateShort(supplier.createdAt)}
          />
          <InfoField label="ที่อยู่" value={displayAddress(supplier.address)} />
          {supplier.notes && <InfoField label="หมายเหตุ" value={supplier.notes} />}
        </div>
      </div>

      {/* Payment Methods Card */}
      <div className="rounded-xl border border-border/50 bg-card p-5 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4">ข้อมูลการชำระเงิน ({supplier.paymentMethods?.length || 0} วิธี)</h2>
        {supplier.paymentMethods?.length ? (
          <div className="space-y-3">
            {supplier.paymentMethods.map((pm) => (
              <div key={pm.id} className="border border-border/60 rounded-xl p-4 bg-muted/40">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary dark:bg-primary/15">
                    {paymentMethodLabels[pm.paymentMethod] || pm.paymentMethod}
                  </span>
                  {pm.isDefault && (
                    <span className="px-2.5 py-0.5 rounded-full text-2xs font-semibold bg-warning/10 text-warning dark:bg-warning/15">
                      ค่าเริ่มต้น
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {pm.creditTermDays != null && (
                    <InfoField label="เครดิต" value={`${pm.creditTermDays} วัน`} />
                  )}
                  <InfoField label="ธนาคาร" value={pm.bankName} />
                  <InfoField label="ชื่อบัญชี" value={pm.bankAccountName} />
                  <InfoField label="เลขบัญชี" value={pm.bankAccountNumber} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลการชำระเงิน</p>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="สินค้าทั้งหมด" value={`${supplier._count.products} ชิ้น`} accent="border-l-primary" />
        <StatCard label="PO ทั้งหมด" value={`${supplier._count.purchaseOrders} รายการ`} accent="border-l-info" />
        <StatCard label="มูลค่าสินค้ารวม" value={`${totalCost.toLocaleString()} ฿`} accent="border-l-success" />
      </div>

      {/* Purchase Orders */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Purchase Orders ({history?.purchaseOrders.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={poColumns}
            data={history?.purchaseOrders || []}
            isLoading={historyLoading}
            emptyMessage="ยังไม่มี PO"
          />
        </CardContent>
      </Card>

      {/* Products (Purchase History) */}
      <Card>
        <CardHeader>
          <CardTitle>ประวัติการซื้อสินค้า ({history?.products.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={productColumns}
            data={history?.products || []}
            isLoading={historyLoading}
            emptyMessage="ยังไม่มีสินค้าจากผู้ขายนี้"
          />
        </CardContent>
      </Card>
      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} onConfirm={confirmDialog.action} />
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm text-foreground">{value || '-'}</div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className={`rounded-xl border border-border/50 bg-card p-5 shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r-full ${accent ? accent.replace('border-l-', 'bg-') : 'bg-primary'}`} />
      <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
      <div className="text-lg font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}
