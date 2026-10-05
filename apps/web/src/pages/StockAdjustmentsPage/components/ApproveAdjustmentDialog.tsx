import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getStatusBadgeProps, productStatusMap, stockAdjustmentReasonMap, stockAdjustmentStatusMap } from '@/lib/status-badges';
import { formatDateTime } from '@/utils/formatters';
import type { CurrentActor } from '../types';
import {
  BOOKED_SOURCE_LABEL,
  canCancel,
  canDecide,
  deviceLabel,
  formatBaht,
  productStatusLabel,
  rejectFormErrors,
} from '../stock-adjustment.util';
import { useAdjustmentDetail, useAdjustmentMutations, useAdjustmentPreview } from '../hooks/useStockAdjustments';
import JournalPreviewBox from './JournalPreviewBox';

interface Props {
  adjustmentId: string | null;
  onClose: () => void;
  user: CurrentActor;
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

/** กล่องพิจารณา/ดูคำขอ — เจ้าของอนุมัติ·ไม่อนุมัติ · ผู้ขอยกเลิก · ทุกคนดูรายละเอียด+รูป+ผลบัญชี */
export default function ApproveAdjustmentDialog({ adjustmentId, onClose, user }: Props) {
  const detail = useAdjustmentDetail(adjustmentId);
  const row = detail.data;
  const pending = row?.status === 'PENDING_APPROVAL';
  const preview = useAdjustmentPreview(pending ? row.product.id : null, pending ? row.reason : '');
  const { approve, reject, cancel } = useAdjustmentMutations();
  const [rejectReason, setRejectReason] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setRejectReason('');
    setConfirmApprove(false);
    setConfirmCancel(false);
  }, [adjustmentId]);

  const rejectErrors = rejectFormErrors(rejectReason);
  const decide = !!row && canDecide(row, user);
  const cancellable = !!row && canCancel(row, user);
  const busy = approve.isPending || reject.isPending || cancel.isPending;

  return (
    <Modal isOpen={!!adjustmentId} onClose={onClose} title={row?.requestNumber ? `คำขอ ${row.requestNumber}` : 'คำขอตัดสินค้า'} size="lg">
      {detail.isLoading || !row ? (
        <div className="text-sm text-muted-foreground">กำลังโหลด...</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const r = getStatusBadgeProps(row.reason, stockAdjustmentReasonMap);
              const s = getStatusBadgeProps(row.status, stockAdjustmentStatusMap);
              return (
                <>
                  <Badge variant={r.variant} appearance={r.appearance}>{r.label}</Badge>
                  <Badge variant={s.variant} appearance={s.appearance}>{s.label}</Badge>
                </>
              );
            })()}
            <span className="text-xs text-muted-foreground leading-snug">
              ขอโดย {row.adjustedBy.name} · {formatDateTime(row.createdAt)} · สาขา {row.branch.name}
            </span>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="font-medium text-sm leading-snug">{deviceLabel(row.product)}</div>
            <div className="text-xs text-muted-foreground leading-snug mt-0.5">
              {row.product.name}
              {row.product.costPrice != null && ` · ต้นทุน ${formatBaht(row.product.costPrice)}`} · สถานะก่อนขอ {productStatusLabel(row.previousStatus)}
            </div>
            <div className="mt-1">
              {(() => {
                const cfg = getStatusBadgeProps(row.product.status, productStatusMap);
                return (
                  <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                    ตอนนี้: {cfg.label}
                  </Badge>
                );
              })()}
            </div>
            {row.notes && <div className="mt-2 text-sm leading-snug whitespace-pre-line">{row.notes}</div>}
          </div>

          {row.photoUrls.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">รูปหลักฐาน ({row.photoUrls.length})</div>
              <div className="flex flex-wrap gap-2">
                {row.photoUrls.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                    <img src={url} alt={`รูปหลักฐาน ${i + 1}`} className="h-24 w-24 rounded-md object-cover border border-border" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {pending ? (
            <JournalPreviewBox preview={preview.data} isLoading={preview.isLoading} />
          ) : (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-snug space-y-1">
              {row.status === 'APPROVED' && (
                <>
                  <div>
                    อนุมัติโดย {row.approvedBy?.name ?? '-'} · {row.approvedAt ? formatDateTime(row.approvedAt) : '-'}
                  </div>
                  {row.journalEntryNo ? (
                    <div>
                      รายการบัญชี <span className="font-mono">{row.journalEntryNo}</span>
                      {row.costAmount ? ` · ${formatBaht(row.costAmount)}` : ''}
                      {row.inventoryAccountCode ? ` · ${row.inventoryAccountCode}` : ''}
                      {row.bookedSource ? ` · ที่มา ${BOOKED_SOURCE_LABEL[row.bookedSource] ?? row.bookedSource}` : ''}
                    </div>
                  ) : row.inventoryBooked === false ? (
                    <div className="text-warning-strong">ไม่มีรายการบัญชี — เครื่องไม่เคยลงบัญชีรับเข้า (แจ้งฝ่ายบัญชีแล้ว)</div>
                  ) : (
                    <div className="text-muted-foreground">ไม่มีรายการบัญชี</div>
                  )}
                </>
              )}
              {row.status === 'REJECTED' && (
                <div>
                  ไม่อนุมัติโดย {row.rejectedBy?.name ?? '-'} · {row.rejectedAt ? formatDateTime(row.rejectedAt) : '-'}
                  {row.rejectedReason ? ` — ${row.rejectedReason}` : ''}
                </div>
              )}
              {row.status === 'CANCELED' && (
                <div>
                  ยกเลิกคำขอโดย {row.canceledBy?.name ?? '-'} · {row.canceledAt ? formatDateTime(row.canceledAt) : '-'}
                </div>
              )}
            </div>
          )}

          {decide && (
            <div>
              <label htmlFor="sa-reject-reason" className="block text-sm font-medium text-foreground mb-1">
                เหตุผลที่ไม่อนุมัติ <span className="text-muted-foreground font-normal">(กรอกเมื่อจะไม่อนุมัติ · 10–500 ตัวอักษร)</span>
              </label>
              <textarea
                id="sa-reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                className={INPUT_CLS}
                placeholder="เช่น เครื่องยังอยู่ ให้ตรวจนับใหม่"
              />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {cancellable && (
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmCancel(true)}>
                ยกเลิกคำขอ
              </Button>
            )}
            {decide && (
              <>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || rejectErrors.length > 0}
                  title={rejectErrors[0]}
                  onClick={() => reject.mutate({ id: row.id, reason: rejectReason.trim() }, { onSuccess: onClose })}
                >
                  ไม่อนุมัติ
                </Button>
                <Button type="button" disabled={busy || preview.isLoading} onClick={() => setConfirmApprove(true)}>
                  {preview.data?.journalLines.length ? 'อนุมัติและลงบัญชี' : 'อนุมัติ'}
                </Button>
              </>
            )}
            {!decide && !cancellable && (
              <Button type="button" variant="outline" onClick={onClose}>
                ปิด
              </Button>
            )}
          </div>

          <ConfirmDialog
            open={confirmApprove}
            onOpenChange={setConfirmApprove}
            title="ยืนยันอนุมัติ"
            description={
              preview.data?.journalLines.length
                ? `อนุมัติ ${row.requestNumber ?? ''} — เครื่องจะเป็น "${productStatusLabel(preview.data.productStatusAfter)}" และลงบัญชี ${formatBaht(
                    preview.data.costAmount,
                  )} ทันที`
                : `อนุมัติ ${row.requestNumber ?? ''} — ${preview.data?.journalNote ?? 'ไม่ลงบัญชี'}`
            }
            confirmLabel="อนุมัติ"
            loading={approve.isPending}
            onConfirm={() => approve.mutate(row.id, { onSuccess: onClose })}
          />
          <ConfirmDialog
            open={confirmCancel}
            onOpenChange={setConfirmCancel}
            title="ยกเลิกคำขอ"
            description={`ยกเลิก ${row.requestNumber ?? 'คำขอนี้'} — เครื่องจะกลับสถานะ "${productStatusLabel(row.previousStatus)}"`}
            confirmLabel="ยกเลิกคำขอ"
            variant="destructive"
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate(row.id, { onSuccess: onClose })}
          />
        </div>
      )}
    </Modal>
  );
}
