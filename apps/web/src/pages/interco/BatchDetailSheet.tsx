import { useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Paperclip } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatThaiDateShort, formatThaiDateTime } from '@/lib/date';
import {
  BATCH_STATUS_BADGE_VARIANT,
  BATCH_STATUS_LABEL,
  fmtMoney,
  INTERCO_APPROVER_ROLES,
  INTERCO_MAKER_ROLES,
  netAmountOf,
  type BatchDetail,
} from './types';
import { ApproveConfirmDialog } from './ApproveConfirmDialog';
import { ReverseBatchDialog } from './ReverseBatchDialog';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ "รอบจ่าย" → รายละเอียดรอบ (spec §8).
 *
 * ปุ่มตาม role×status (spec §6):
 *   - DRAFT: ส่งอนุมัติ (maker เท่านั้น) / ยกเลิก (ACCOUNTANT, FINANCE_MANAGER ใดก็ได้)
 *   - PENDING_APPROVAL: ถอนกลับ (maker) / ยกเลิก / อนุมัติ (OWNER, FINANCE_MANAGER)
 *   - POSTED: ย้อนกลับ (OWNER, FINANCE_MANAGER)
 *   - REVERSED/CANCELLED: read-only
 */

interface BatchDetailSheetProps {
  batchId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function BatchDetailSheet({ batchId, onClose, onChanged }: BatchDetailSheetProps) {
  const { user } = useAuth();
  const [approveOpen, setApproveOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const detailQuery = useQuery<BatchDetail>({
    queryKey: ['interco-batch', batchId],
    queryFn: async () => (await api.get(`/interco-settlement/batches/${batchId}`)).data,
    enabled: !!batchId,
  });

  const refreshAll = () => {
    detailQuery.refetch();
    onChanged();
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!batchId) throw new Error('no batch');
      return api.post(`/interco-settlement/batches/${batchId}/submit`);
    },
    onSuccess: () => {
      toast.success('ส่งอนุมัติเรียบร้อย');
      refreshAll();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      if (!batchId) throw new Error('no batch');
      return api.post(`/interco-settlement/batches/${batchId}/withdraw`);
    },
    onSuccess: () => {
      toast.success('ถอนกลับเป็นร่างเรียบร้อย');
      refreshAll();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!batchId) throw new Error('no batch');
      return api.post(`/interco-settlement/batches/${batchId}/cancel`);
    },
    onSuccess: () => {
      toast.success('ยกเลิกรอบจ่ายเรียบร้อย');
      setCancelConfirmOpen(false);
      refreshAll();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!batchId) return null;

  const batch = detailQuery.data;
  const isMakerRole = !!user && INTERCO_MAKER_ROLES.includes(user.role);
  const isApproverRole = !!user && INTERCO_APPROVER_ROLES.includes(user.role);
  const isMakerOfBatch = !!user && !!batch && batch.makerId === user.id;

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 flex-wrap">
              {batch?.batchNumber ?? 'รายละเอียดรอบจ่าย'}
              {batch && (
                <Badge variant={BATCH_STATUS_BADGE_VARIANT[batch.status]} appearance="light">
                  {BATCH_STATUS_LABEL[batch.status]}
                </Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          {detailQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> กำลังโหลด...
            </div>
          )}

          {batch && (
            <div className="space-y-5 mt-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm rounded-lg border border-border bg-muted/40 p-4">
                <InfoField label="วันที่โอน" value={formatThaiDateShort(batch.transferDate)} />
                <InfoField
                  label="วันที่ลงบัญชี"
                  value={batch.postedAt ? formatThaiDateTime(batch.postedAt) : '-'}
                />
                <InfoField label="ยอดเจ้าหนี้รวม" value={`฿${fmtMoney(batch.totalAmount)}`} />
                {/* รอบก่อน Phase 2 (netTransferAmount = null) — ไม่มี snapshot หัก
                    จึงไม่โชว์บรรทัดหัก และยอดโอนสุทธิ = ยอดเต็ม (netAmountOf) */}
                {batch.netTransferAmount !== null && (
                  <InfoField
                    label="หักรวม (เครดิตเปลี่ยนเครื่อง + เรียกคืน)"
                    value={
                      <span className={Number(batch.totalDeduction) > 0 ? 'text-warning' : ''}>
                        −฿{fmtMoney(batch.totalDeduction)}
                      </span>
                    }
                  />
                )}
                <InfoField
                  label="ยอดโอนสุทธิ"
                  value={<span className="font-bold">฿{fmtMoney(netAmountOf(batch))}</span>}
                />
                <InfoField
                  label="ยอด SHOP รับจริง"
                  value={`฿${fmtMoney(batch.shopNetAmount ?? batch.shopPostedAmount)}`}
                />
                <InfoField label="บัญชี FINANCE" value={batch.financeBankCode} />
                <InfoField label="บัญชี SHOP" value={batch.shopBankCode} />
                <InfoField label="เลขที่อ้างอิงโอน" value={batch.transferRef ?? '-'} />
                <InfoField
                  label="สลิป/หลักฐาน"
                  value={
                    batch.slipFileKey ? (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="size-3.5" /> แนบแล้ว
                      </span>
                    ) : (
                      '-'
                    )
                  }
                />
                <InfoField label="ผู้สร้างรอบ" value={batch.maker.name} />
                <InfoField label="ผู้อนุมัติ" value={batch.approver?.name ?? '-'} />
                <InfoField label="JE ฝั่ง FINANCE" value={batch.financeEntryNumber ?? '-'} mono />
                <InfoField label="JE ฝั่ง SHOP" value={batch.shopEntryNumber ?? '-'} mono />
                {batch.note && <InfoField label="หมายเหตุ" value={batch.note} full />}
                {batch.status === 'REVERSED' && batch.reverseReason && (
                  <InfoField label="เหตุผลย้อนกลับ" value={batch.reverseReason} full />
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2 leading-snug">
                  รายการสัญญา ({batch.items.length})
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2.5 font-medium text-muted-foreground">สัญญา</th>
                        <th className="text-right p-2.5 font-medium text-muted-foreground">
                          ยอดจัด
                        </th>
                        <th className="text-right p-2.5 font-medium text-muted-foreground">
                          ค่าคอม
                        </th>
                        <th className="text-right p-2.5 font-medium text-muted-foreground">
                          SHOP-ยอดจัด
                        </th>
                        <th className="text-right p-2.5 font-medium text-muted-foreground">
                          SHOP-ค่าคอม
                        </th>
                        <th className="text-right p-2.5 font-medium text-muted-foreground">หัก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.items.map((item) => {
                        const isRecall = item.itemType === 'RECALL';
                        // item รอบเก่า (ก่อน Phase 2) ไม่มีคอลัมน์หัก — Prisma default
                        // ให้ "0.00" เสมอ แต่กันเผื่อ undefined จาก fixture/response เก่า
                        const deduction = Number(
                          (isRecall ? item.recallAmount : item.swapCreditAmount) ?? 0,
                        );
                        return (
                          <tr key={item.id} className="border-t border-border">
                            <td className="p-2.5">
                              <div className="font-medium leading-snug flex items-center gap-1.5 flex-wrap">
                                {item.contract.contractNumber}
                                {isRecall && (
                                  <Badge
                                    variant="warning"
                                    appearance="light"
                                    size="sm"
                                    title="ยกเลิกหลังตัดจ่าย (Flow C-2) — หักเงินคืนจากรอบนี้ ไม่มีเจ้าหนี้ของตัวเอง"
                                  >
                                    เรียกคืน
                                  </Badge>
                                )}
                                {item.legacyNoShop && (
                                  <Badge variant="warning" appearance="light" size="sm">
                                    LEGACY
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {item.contract.customer.name}
                              </div>
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall ? '-' : fmtMoney(item.financedGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall ? '-' : fmtMoney(item.commissionGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall || item.legacyNoShop ? '-' : fmtMoney(item.shopFinancedGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {isRecall || item.legacyNoShop
                                ? '-'
                                : fmtMoney(item.shopCommissionGl)}
                            </td>
                            <td className="p-2.5 text-right tabular-nums">
                              {deduction > 0 ? (
                                <span className="text-warning">−{fmtMoney(deduction)}</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                {batch.status === 'DRAFT' && isMakerRole && isMakerOfBatch && (
                  <Button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                  >
                    {submitMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    ส่งอนุมัติ
                  </Button>
                )}
                {(batch.status === 'DRAFT' || batch.status === 'PENDING_APPROVAL') &&
                  isMakerRole && (
                    <Button
                      variant="outline"
                      onClick={() => setCancelConfirmOpen(true)}
                      disabled={cancelMutation.isPending}
                    >
                      ยกเลิกรอบ
                    </Button>
                  )}
                {batch.status === 'PENDING_APPROVAL' && isMakerRole && isMakerOfBatch && (
                  <Button
                    variant="outline"
                    onClick={() => withdrawMutation.mutate()}
                    disabled={withdrawMutation.isPending}
                  >
                    {withdrawMutation.isPending && (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    )}
                    ถอนกลับเป็นร่าง
                  </Button>
                )}
                {batch.status === 'PENDING_APPROVAL' && isApproverRole && (
                  // คำสั่งเจ้าของ 2026-08-03: ผู้สร้างรอบอนุมัติเองได้ถ้ามีสิทธิ์
                  // (คุมด้วยการกำหนดสิทธิ ไม่ใช่กฎ maker ≠ approver ตายตัว).
                  // ถ้าเปิด SystemConfig `interco_maker_checker_enabled = 'true'`
                  // เซิร์ฟเวอร์จะตอบ 403 ภาษาไทยเอง — ให้เซิร์ฟเวอร์เป็นผู้ตัดสิน
                  // ไม่ปิดปุ่มฝั่งไคลเอนต์ล่วงหน้า
                  <Button onClick={() => setApproveOpen(true)}>อนุมัติ</Button>
                )}
                {batch.status === 'POSTED' && isApproverRole && (
                  <Button variant="destructive" onClick={() => setReverseOpen(true)}>
                    ย้อนกลับรอบจ่าย
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {batch && (
        <>
          <ApproveConfirmDialog
            open={approveOpen}
            onOpenChange={setApproveOpen}
            batch={batch}
            onApproved={refreshAll}
          />
          <ReverseBatchDialog
            open={reverseOpen}
            onOpenChange={setReverseOpen}
            batchId={batch.id}
            batchNumber={batch.batchNumber}
            onReversed={refreshAll}
          />
        </>
      )}

      <ConfirmDialog
        open={cancelConfirmOpen}
        onOpenChange={setCancelConfirmOpen}
        title="ยกเลิกรอบจ่าย"
        description="สัญญาในรอบนี้จะกลับเข้าคิวรอจ่ายทันที — ยืนยันยกเลิก?"
        confirmLabel="ยืนยันยกเลิก"
        variant="destructive"
        loading={cancelMutation.isPending}
        closeOnConfirm={false}
        onConfirm={() => cancelMutation.mutate()}
      />
    </>
  );
}

function InfoField({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <p className="text-xs text-muted-foreground leading-snug">{label}</p>
      <p className={`font-medium leading-snug ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}
