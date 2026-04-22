import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShoppingBag, Package, Truck, CheckCircle2, XCircle } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateShort } from '@/utils/formatters';

type OnlineOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_BANK_REVIEW'
  | 'PAID'
  | 'PACKING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

interface OnlineOrder {
  id: string;
  orderNumber: string;
  customerName?: string | null;
  fullName?: string | null;
  phone?: string | null;
  status: OnlineOrderStatus;
  totalAmount: string | number;
  trackingNumber?: string | null;
  paymentMethod?: string | null;
  createdAt: string;
  items?: Array<{ productName?: string; quantity?: number }>;
}

interface OnlineOrdersResponse {
  data: OnlineOrder[];
  total?: number;
}

const STATUS_TABS: Array<{ key: OnlineOrderStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'PENDING_BANK_REVIEW', label: 'รอตรวจสลิป' },
  { key: 'PAID', label: 'ชำระแล้ว' },
  { key: 'PACKING', label: 'กำลังแพ็ค' },
  { key: 'SHIPPED', label: 'จัดส่งแล้ว' },
  { key: 'DELIVERED', label: 'ส่งถึงลูกค้า' },
  { key: 'CANCELLED', label: 'ยกเลิก' },
];

const STATUS_BADGE: Record<OnlineOrderStatus, { label: string; variant: 'primary' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  PENDING_PAYMENT: { label: 'รอชำระ', variant: 'warning' },
  PENDING_BANK_REVIEW: { label: 'รอตรวจสลิป', variant: 'warning' },
  PAID: { label: 'ชำระแล้ว', variant: 'success' },
  PACKING: { label: 'กำลังแพ็ค', variant: 'primary' },
  SHIPPED: { label: 'จัดส่งแล้ว', variant: 'primary' },
  DELIVERED: { label: 'ส่งถึงแล้ว', variant: 'success' },
  CANCELLED: { label: 'ยกเลิก', variant: 'destructive' },
  REFUNDED: { label: 'คืนเงิน', variant: 'secondary' },
};

function formatMoney(v: string | number | undefined | null): string {
  if (v === null || v === undefined) return '-';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function OnlineOrdersPage() {
  useDocumentTitle('คำสั่งซื้อออนไลน์');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<OnlineOrderStatus | 'ALL'>('ALL');
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  const [cancelReasonInputs, setCancelReasonInputs] = useState<Record<string, string>>({});

  const { data, isLoading, isError, error, refetch } = useQuery<OnlineOrdersResponse>({
    queryKey: ['admin-online-orders', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const qs = params.toString();
      const res = await api.get(`/admin/online-orders${qs ? `?${qs}` : ''}`);
      const body = res.data;
      if (Array.isArray(body)) return { data: body, total: body.length };
      return body;
    },
  });

  const confirmBankMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/online-orders/${id}/confirm-bank`),
    onSuccess: () => {
      toast.success('ยืนยันการรับเงินเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['admin-online-orders'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const shipMutation = useMutation({
    mutationFn: async ({ id, trackingNumber }: { id: string; trackingNumber: string }) =>
      api.patch(`/admin/online-orders/${id}/ship`, { trackingNumber }),
    onSuccess: (_data, vars) => {
      toast.success('บันทึกการส่งเรียบร้อย');
      setTrackingInputs((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin-online-orders'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deliverMutation = useMutation({
    mutationFn: async (id: string) => api.patch(`/admin/online-orders/${id}/deliver`),
    onSuccess: () => {
      toast.success('บันทึกว่าส่งถึงแล้ว');
      queryClient.invalidateQueries({ queryKey: ['admin-online-orders'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/admin/online-orders/${id}/cancel`, { reason }),
    onSuccess: (_d, vars) => {
      toast.success('ยกเลิกคำสั่งซื้อเรียบร้อย');
      setCancelReasonInputs((prev) => {
        const next = { ...prev };
        delete next[vars.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['admin-online-orders'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const orders = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="คำสั่งซื้อออนไลน์"
        subtitle="จัดการคำสั่งซื้อจากหน้าร้านออนไลน์ — ยืนยันสลิป จัดส่ง และติดตามสถานะ"
        icon={<ShoppingBag className="size-5" />}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-sm leading-snug transition-colors ${
              statusFilter === tab.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left font-medium">เลขที่</th>
                <th className="px-4 py-3 text-left font-medium">ลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium">ยอดรวม</th>
                <th className="px-4 py-3 text-left font-medium">สถานะ</th>
                <th className="px-4 py-3 text-left font-medium">วันที่สั่ง</th>
                <th className="px-4 py-3 text-left font-medium">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    ไม่มีคำสั่งซื้อในสถานะนี้
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const badge = STATUS_BADGE[order.status];
                  const tracking = trackingInputs[order.id] ?? '';
                  const cancelReason = cancelReasonInputs[order.id] ?? '';
                  return (
                    <tr key={order.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium text-foreground">{order.orderNumber}</td>
                      <td className="px-4 py-3 text-foreground">
                        <div className="leading-snug">{order.customerName ?? order.fullName ?? '-'}</div>
                        {order.phone && (
                          <div className="text-xs text-muted-foreground leading-snug">{order.phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-foreground">{formatMoney(order.totalAmount)}</td>
                      <td className="px-4 py-3">
                        {badge ? (
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        ) : (
                          <Badge variant="secondary">{order.status}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDateShort(order.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2 min-w-[240px]">
                          {order.status === 'PENDING_BANK_REVIEW' && (
                            <Button
                              size="sm"
                              onClick={() => confirmBankMutation.mutate(order.id)}
                              disabled={confirmBankMutation.isPending}
                            >
                              <CheckCircle2 className="size-4 mr-1.5" />
                              ยืนยันสลิป
                            </Button>
                          )}
                          {(order.status === 'PAID' || order.status === 'PACKING') && (
                            <div className="flex flex-col gap-1.5">
                              <Input
                                variant="sm"
                                placeholder="เลขพัสดุ"
                                value={tracking}
                                onChange={(e) =>
                                  setTrackingInputs((prev) => ({ ...prev, [order.id]: e.target.value }))
                                }
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  if (!tracking.trim()) {
                                    toast.error('กรุณาระบุเลขพัสดุ');
                                    return;
                                  }
                                  shipMutation.mutate({ id: order.id, trackingNumber: tracking.trim() });
                                }}
                                disabled={shipMutation.isPending}
                              >
                                <Package className="size-4 mr-1.5" />
                                ส่ง
                              </Button>
                            </div>
                          )}
                          {order.status === 'SHIPPED' && (
                            <>
                              {order.trackingNumber && (
                                <div className="text-xs text-muted-foreground leading-snug">
                                  เลขพัสดุ: {order.trackingNumber}
                                </div>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => deliverMutation.mutate(order.id)}
                                disabled={deliverMutation.isPending}
                              >
                                <Truck className="size-4 mr-1.5" />
                                ส่งถึงแล้ว
                              </Button>
                            </>
                          )}
                          {(order.status === 'PENDING_PAYMENT' ||
                            order.status === 'PENDING_BANK_REVIEW' ||
                            order.status === 'PAID' ||
                            order.status === 'PACKING') && (
                            <div className="flex gap-1.5">
                              <Input
                                variant="sm"
                                placeholder="เหตุผลยกเลิก"
                                value={cancelReason}
                                onChange={(e) =>
                                  setCancelReasonInputs((prev) => ({
                                    ...prev,
                                    [order.id]: e.target.value,
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (!cancelReason.trim()) {
                                    toast.error('กรุณาระบุเหตุผลยกเลิก');
                                    return;
                                  }
                                  cancelMutation.mutate({
                                    id: order.id,
                                    reason: cancelReason.trim(),
                                  });
                                }}
                                disabled={cancelMutation.isPending}
                              >
                                <XCircle className="size-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
