import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import SellerPaymentFields from '@/components/trade-in/SellerPaymentFields';
import { Label } from '@/components/ui/label';
import SignaturePadFull from '@/components/signing/SignaturePadFull';
import { AlertTriangle } from 'lucide-react';
import type { TradeIn, AcceptFormState, AcceptRequest } from '../types';

interface AcceptModalProps {
  item: TradeIn | null;
  form: AcceptFormState;
  isPending: boolean;
  onChange: (patch: Partial<AcceptFormState>) => void;
  onConfirm: (id: string, body: AcceptRequest) => void;
  onClose: () => void;
}

export default function AcceptModal({
  item,
  form,
  isPending,
  onChange,
  onConfirm,
  onClose,
}: AcceptModalProps) {
  const { user } = useAuth();
  // Mirror CROSS_BRANCH_ROLES ฝั่ง backend (branch-access.util.ts) — role อื่นล็อกสาขาตัวเอง
  const canPickBranch = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');
  const needBranch = !!item && !item.branchId;
  const [branchId, setBranchId] = useState<string>('');
  useEffect(() => {
    if (item) setBranchId(item.branchId ?? user?.branchId ?? '');
  }, [item, user?.branchId]);
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: needBranch && canPickBranch,
  });

  const isCredit = item?.flow === 'EXCHANGE';

  function handleConfirm() {
    if (!item) return;
    if (needBranch && !branchId) {
      toast.error('กรุณาเลือกสาขาที่รับเครื่อง');
      return;
    }
    if (!form.idCardVerified || !form.sellerConsentSigned) {
      toast.error('กรุณายืนยันการตรวจบัตรและความยินยอมก่อน');
      return;
    }
    if (!isCredit && form.paymentMethod === 'TRANSFER') {
      if (!form.transferBankName || !form.transferAccountNumber || !form.transferAccountName) {
        toast.error('กรุณากรอกข้อมูลการโอนให้ครบ');
        return;
      }
    }
    if (!form.sellerSignatureBase64) {
      toast.error('กรุณาให้ผู้ขายลงลายเซ็นก่อน');
      return;
    }
    const isTransfer = !isCredit && form.paymentMethod === 'TRANSFER';
    onConfirm(item.id, { ...form,
      paymentMethod: isCredit ? 'TRADE_IN_CREDIT' : form.paymentMethod,
      transferBankName: isTransfer ? form.transferBankName : '',
      transferAccountNumber: isTransfer ? form.transferAccountNumber : '',
      transferAccountName: isTransfer ? form.transferAccountName : '',
      ...(needBranch ? { branchId } : {}),
    });
  }

  return (
    <Modal isOpen={!!item} onClose={() => { if (!isPending) onClose(); }} title={isCredit ? "ยืนยันรับเครื่องเทิร์น" : "ยืนยันการรับซื้อเครื่อง"} size="md">
      {item && (
        <div className="space-y-4">
          <div className="rounded-lg bg-warning/10 dark:bg-warning/15 border border-warning/20 dark:border-warning/30 p-3 text-xs text-warning flex gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>กรุณายืนยันตามขั้นตอนป้องกันการรับซื้อของโจรก่อนกดยอมรับ</div>
          </div>
          <div className="text-sm">
            <p>
              <strong>อุปกรณ์:</strong> {item.deviceBrand} {item.deviceModel}
            </p>
            <p>
              <strong>ผู้ขาย:</strong> {item.customer?.name || item.sellerName || '-'}
            </p>
            <p>
              <strong>ราคาตกลง:</strong> ฿{Number(item.offeredPrice ?? 0).toLocaleString()}
            </p>
          </div>

          {needBranch && (
            <div>
              <Label>สาขาที่รับเครื่อง *</Label>
              {canPickBranch ? (
                <select
                  className="mt-1.5 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  disabled={isPending}
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  <option value="">-- เลือกสาขา --</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">
                  รับเข้าสาขาของคุณโดยอัตโนมัติ (รายการออนไลน์ยังไม่ผูกสาขา)
                </p>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              disabled={isPending}
              className="mt-1"
              checked={form.idCardVerified}
              onChange={(e) => onChange({ idCardVerified: e.target.checked })}
            />
            <span className="text-sm">ตรวจบัตรประชาชนผู้ขายแล้วและตรงกับใบหน้า</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              disabled={isPending}
              className="mt-1"
              checked={form.sellerConsentSigned}
              onChange={(e) => onChange({ sellerConsentSigned: e.target.checked })}
            />
            <span className="text-sm">ผู้ขายเซ็นยืนยันว่าเป็นเจ้าของเครื่องโดยชอบด้วยกฎหมาย</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              disabled={isPending}
              className="mt-1"
              checked={form.policeReportAcknowledged}
              onChange={(e) => onChange({ policeReportAcknowledged: e.target.checked })}
            />
            <span className="text-sm">
              แจ้งผู้ขายแล้วว่าหากเป็นของโจรจะถูกดำเนินคดีตามกฎหมาย
            </span>
          </label>

          {/* Payment method */}
          {isCredit ? (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
              <p className="font-medium">เครดิตเทิร์นเครื่อง ฿{Number(item.offeredPrice ?? 0).toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">ขั้นตอนนี้บันทึกการรับเครื่องและยอดเครดิตที่ตกลง ยังไม่นำเครดิตไปหักยอดขายหรือสัญญา</p>
            </div>
          ) : <SellerPaymentFields value={form} onChange={onChange} disabled={isPending} />}

          {/* ลายเซ็นผู้ขาย */}
          <div className="border-t pt-3">
            <Label>ลายเซ็นผู้ขาย *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              ผู้ขายลงนามยืนยันการขายและความเป็นเจ้าของ
            </p>
            <SignaturePadFull
              isPending={isPending}
              onSign={() => {
                /* handled by submit button */
              }}
              onDraftChange={(dataUrl) =>
                onChange({ sellerSignatureBase64: dataUrl || '' })
              }
              buttonText=""
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              ยกเลิก
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending ? 'กำลังบันทึก...' : isCredit ? 'ยืนยันรับเครื่องเทิร์น' : 'ยืนยันรับซื้อ'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
