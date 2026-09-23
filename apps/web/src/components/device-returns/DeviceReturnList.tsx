import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { conditionGradeMap, getStatusBadgeProps } from '@/lib/status-badges';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { RejectDeviceReturnDialog } from './RejectDeviceReturnDialog';
import {
  canCancelDeviceReturn,
  DEVICE_RETURN_CONFIRM_ROLES,
  DEVICE_RETURN_PREVIEW_ROLES,
  DEVICE_RETURN_KIND_LABEL,
  DEVICE_RETURN_RESEND_ROLES,
  LINE_STATUS_LABEL,
  RETURN_REASON_LABEL,
  type DeviceReturnListResponse,
  type CloseDeviceReturnResponse,
  type DeviceReturnRow,
  type LineNotifyStatus,
} from './types';

interface Props {
  /**
   * FINANCE กด "ยืนยัน" → parent เปิด RepossessionOverlay โหมดยืนยันด้วยแถวนี้ ·
   * role อื่นกด "ดูยอดปิด" → overlay เดียวกันแบบอ่านอย่างเดียว (คำสั่งเจ้าของ 2026-09-23:
   * "คนอื่นคำนวณได้ แต่ผู้จัดการอนุมัติทีหลัง" — overlay ซ่อนปุ่มยืนยันเองตาม role)
   */
  onConfirm: (row: DeviceReturnRow) => void;
}

const LINE_BADGE: Record<LineNotifyStatus, 'success' | 'destructive' | 'warning'> = {
  SENT: 'success',
  FAILED: 'destructive',
  NO_LINE: 'warning',
};

/**
 * ตาราง "ใบรับเครื่องคืน — รอ FINANCE ยืนยัน" (spec 2026-09-20 §7) บนหน้า /repossessions.
 * Query key ขึ้นต้น ['device-returns'] — intake dialog / overlay / reject / cancel
 * invalidate prefix เดียวกันแล้วตารางนี้ + รายการรอยึดเครื่อง refresh พร้อมกัน.
 */
export function DeviceReturnList({ onConfirm }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? '';
  const canConfirm = DEVICE_RETURN_CONFIRM_ROLES.includes(role);
  const canPreview = DEVICE_RETURN_PREVIEW_ROLES.includes(role);
  const canResend = DEVICE_RETURN_RESEND_ROLES.includes(role);
  const [rejectTarget, setRejectTarget] = useState<DeviceReturnRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeviceReturnRow | null>(null);
  const cancelSubmitting = useRef(false);
  const resendSubmitting = useRef(false);

  const { data, isLoading, isError, error, refetch } = useQuery<DeviceReturnListResponse>({
    queryKey: ['device-returns', 'pending-confirm'],
    queryFn: async () => (await api.get('/device-returns?status=PENDING_CONFIRM&limit=100')).data,
    staleTime: 15_000,
  });
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const cancelMutation = useMutation({
    retry: false,
    mutationFn: async (row: DeviceReturnRow) =>
      (await api.post<CloseDeviceReturnResponse>(`/device-returns/${row.id}/cancel`)).data,
    onSuccess: (result, row) => {
      // Closing the intake can succeed even when contract restoration was skipped.
      toast.success(`ยกเลิกใบ ${row.docNumber} แล้ว`, {
        description: result.notice?.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contract', row.contract.id] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      setCancelTarget(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
    onSettled: () => {
      cancelSubmitting.current = false;
    },
  });

  const resendMutation = useMutation({
    retry: false,
    mutationFn: async (row: DeviceReturnRow) =>
      (await api.post<DeviceReturnRow>(`/device-returns/${row.id}/resend-line`)).data,
    onSuccess: (row) => {
      if (row.lineNotifyStatus === 'SENT') {
        toast.success('ส่งไลน์แจ้งลูกค้าอีกครั้งแล้ว');
      } else {
        toast.error(
          row.lineNotifyStatus ? LINE_STATUS_LABEL[row.lineNotifyStatus] : 'ยังไม่ส่งไลน์',
        );
      }
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
    onSettled: () => {
      resendSubmitting.current = false;
    },
  });

  return (
    <Card className="shadow-card mb-6 overflow-hidden leading-snug">
      <CardHeader className="px-4 py-3 border-b bg-secondary flex flex-row items-center justify-between">
        <h3 className="text-sm font-medium text-foreground leading-snug">
          ใบรับเครื่องคืน — รอ FINANCE ยืนยัน
        </h3>
        <Badge variant="warning" appearance="light" size="sm">
          {total} ใบ
        </Badge>
      </CardHeader>
      <QueryBoundary
        isLoading={isLoading && rows.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดใบรับเครื่องคืนได้"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center leading-snug">
            ไม่มีใบรับเครื่องคืนที่รอยืนยัน
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-secondary text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">เลขที่ใบ / วันที่รับ</th>
                  <th className="px-4 py-2 text-left">สัญญา / ลูกค้า</th>
                  <th className="px-4 py-2 text-left">สินค้า</th>
                  <th className="px-4 py-2 text-left">สาขาที่รับ / ผู้ตรวจ</th>
                  <th className="px-4 py-2 text-left">ประเภท / เหตุผล</th>
                  <th className="px-4 py-2 text-right">เกรด / ราคาประเมิน</th>
                  <th className="px-4 py-2 text-left">ไลน์</th>
                  <th className="px-4 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const grade = getStatusBadgeProps(r.conditionGrade, conditionGradeMap);
                  const canCancel = canCancelDeviceReturn(user, r);
                  const showResend = canResend && r.lineNotifyStatus !== 'SENT';
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-muted/50"
                      data-testid={`device-return-row-${r.docNumber}`}
                    >
                      <td className="px-4 py-2">
                        <div className="font-mono font-medium text-primary">{r.docNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateShort(r.deviceReceivedAt)}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{r.contract.contractNumber}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.contract.customer.name}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {r.contract.product.brand} {r.contract.product.model}
                        {r.contract.product.imeiSerial && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {r.contract.product.imeiSerial}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div>{r.receivingBranch.name}</div>
                        <div className="text-xs text-muted-foreground">{r.receivedBy.name}</div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={r.returnKind === 'REPOSSESSION' ? 'destructive' : 'warning'}
                          appearance="light"
                          size="sm"
                        >
                          {DEVICE_RETURN_KIND_LABEL[r.returnKind]}
                        </Badge>
                        <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                          {RETURN_REASON_LABEL[r.returnReason]}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Badge variant={grade.variant} appearance={grade.appearance} size="sm">
                          {grade.label}
                        </Badge>
                        <div className="text-sm font-mono">
                          {formatNumberDecimal(r.appraisalPrice, 2)} ฿
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {r.lineNotifyStatus ? (
                          <Badge
                            variant={LINE_BADGE[r.lineNotifyStatus]}
                            appearance="light"
                            size="sm"
                          >
                            {LINE_STATUS_LABEL[r.lineNotifyStatus]}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" appearance="light" size="sm">
                            ยังไม่ส่ง
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-3">
                          {canPreview && !canConfirm && (
                            <button
                              type="button"
                              onClick={() => onConfirm(r)}
                              title="ดูตัวเลขยอดปิด/กำไรขาดทุน — ยืนยันได้เฉพาะเจ้าของ / ผจก.การเงิน"
                              className="px-3 py-1.5 border border-input rounded-lg text-sm font-medium text-foreground hover:bg-accent transition-colors"
                            >
                              ดูยอดปิด
                            </button>
                          )}
                          {canConfirm && (
                            <>
                              <button
                                type="button"
                                onClick={() => onConfirm(r)}
                                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                              >
                                ยืนยัน
                              </button>
                              <button
                                type="button"
                                onClick={() => setRejectTarget(r)}
                                className="text-destructive hover:text-destructive/80 text-sm font-medium"
                              >
                                ส่งกลับ
                              </button>
                            </>
                          )}
                          {showResend && (
                            <button
                              type="button"
                              onClick={() => {
                                if (resendSubmitting.current) return;
                                resendSubmitting.current = true;
                                resendMutation.mutate(r);
                              }}
                              disabled={resendMutation.isPending}
                              title="ส่งไลน์แจ้งลูกค้าอีกครั้ง"
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm font-medium disabled:opacity-50"
                            >
                              <Send className="h-3.5 w-3.5" />
                              ส่งซ้ำไลน์
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => setCancelTarget(r)}
                              className="text-warning-strong hover:text-warning-strong/80 text-sm font-medium"
                            >
                              ยกเลิก
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>

      <RejectDeviceReturnDialog target={rejectTarget} onClose={() => setRejectTarget(null)} />

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => {
          if (!open && !cancelSubmitting.current) setCancelTarget(null);
        }}
        title="ยกเลิกใบรับเครื่องคืน"
        description={
          cancelTarget
            ? `ยกเลิกใบ ${cancelTarget.docNumber} สัญญา ${cancelTarget.contract.contractNumber}? ลูกค้าจะได้รับไลน์แจ้งว่าใบถูกยกเลิก`
            : ''
        }
        confirmLabel="ยืนยันยกเลิกใบ"
        variant="destructive"
        loading={cancelMutation.isPending}
        closeOnConfirm={false}
        onConfirm={() => {
          if (!cancelTarget || cancelSubmitting.current) return;
          cancelSubmitting.current = true;
          cancelMutation.mutate(cancelTarget);
        }}
      />
    </Card>
  );
}
