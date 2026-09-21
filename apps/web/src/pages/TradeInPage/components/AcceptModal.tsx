import { DeviceOriginField } from '@/components/product/DeviceDisclosureFields';
import { useState, useEffect } from 'react';
import { TRADE_IN_DECLARATION_VERSION, tradeInEvidenceError } from '@installment/shared';
import SellerDeclaration from '@/components/trade-in/SellerDeclaration';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import SellerPaymentFields from '@/components/trade-in/SellerPaymentFields';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
  const [identifiers, setIdentifiers] = useState({ imei: '', serialNumber: '', imeiMissingReason: '', serialNumberMissingReason: '',
    sellerName: '', sellerPhone: '', sellerIdCardNumber: '', sellerAddress: '' });
  useEffect(() => {
    if (item) {
      setBranchId(item.branchId ?? user?.branchId ?? '');
      setIdentifiers({ imei: item.imei ?? '', serialNumber: item.serialNumber ?? '',
        imeiMissingReason: item.imeiMissingReason ?? '', serialNumberMissingReason: item.serialNumberMissingReason ?? '',
        sellerName: item.sellerName ?? item.customer?.name ?? '', sellerPhone: item.sellerPhone ?? '',
        sellerIdCardNumber: item.sellerIdCardNumber ?? '', sellerAddress: item.sellerAddress ?? '' });
    }
  }, [item, user?.branchId]);
  const { data: branches } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: needBranch && canPickBranch,
  });

  const isCredit = item?.flow === 'EXCHANGE';

  function changeIdentifiers(patch: Partial<typeof identifiers>) {
    setIdentifiers((current) => ({ ...current, ...patch }));
    onChange({ idCardVerified: false, sellerConsentSigned: false, sellerSignatureBase64: '' });
  }

  function handleConfirm() {
    if (!item) return;
    const evidenceError = tradeInEvidenceError(identifiers);
    if (evidenceError) { toast.error(evidenceError); return; }
    if (identifiers.imei && !/^\d{15}$/.test(identifiers.imei)) {
      toast.error('IMEI ต้องเป็นตัวเลข 15 หลัก');
      return;
    }
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
      ...identifiers,
      declarationVersion: TRADE_IN_DECLARATION_VERSION,
      imei: identifiers.imei || null,
      serialNumber: identifiers.serialNumber.trim() || null,
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              ['sellerName', 'ชื่อผู้ขายตามบัตรประชาชน', 200],
              ['sellerPhone', 'เบอร์โทรผู้ขาย', 10],
              ['sellerIdCardNumber', 'เลขบัตรประชาชน', 13],
              ['sellerAddress', 'ที่อยู่ตามหลักฐาน', 2000],
            ] as const).map(([field, label, max]) => <div key={field}>
              <Label htmlFor={`accept-${field}`}>{label} *</Label>
              <Input id={`accept-${field}`} value={identifiers[field]} maxLength={max} disabled={isPending}
                onChange={(e) => changeIdentifiers({ [field]: e.target.value })} />
            </div>)}
            <div>
              <Label htmlFor="accept-imei">IMEI</Label>
              <Input id="accept-imei" className="mt-1 font-mono" disabled={isPending}
                inputMode="numeric" maxLength={15} placeholder="15 หลัก" value={identifiers.imei}
                onChange={(e) => changeIdentifiers({ imei: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <Label htmlFor="accept-serial">Serial Number</Label>
              <Input id="accept-serial" className="mt-1 font-mono" disabled={isPending}
                maxLength={100} placeholder="หมายเลขเครื่อง" value={identifiers.serialNumber}
                onChange={(e) => changeIdentifiers({ serialNumber: e.target.value })} />
            </div>
          </div>

          {!identifiers.imei && <div><Label htmlFor="accept-imei-reason">เหตุผลที่ไม่มี IMEI *</Label><Input id="accept-imei-reason" disabled={isPending} maxLength={300} value={identifiers.imeiMissingReason} onChange={(e) => changeIdentifiers({ imeiMissingReason: e.target.value })} /></div>}
          {!identifiers.serialNumber.trim() && <div><Label htmlFor="accept-serial-reason">เหตุผลที่ไม่มี Serial Number *</Label><Input id="accept-serial-reason" disabled={isPending} maxLength={300} value={identifiers.serialNumberMissingReason} onChange={(e) => changeIdentifiers({ serialNumberMissingReason: e.target.value })} /></div>}
          <DeviceOriginField value={form.deviceOrigin} onChange={(deviceOrigin) => onChange({ deviceOrigin })} disabled={isPending} />

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
          <SellerDeclaration />
          <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-muted">
            <input
              type="checkbox"
              disabled={isPending}
              className="mt-1"
              checked={form.sellerConsentSigned}
              onChange={(e) => onChange({ sellerConsentSigned: e.target.checked })}
            />
            <span className="text-sm">ผู้ขายได้อ่านและยอมรับคำรับรองผู้ขายทุกข้อ</span>
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
              แจ้งผู้ขายแล้วว่าหากพบเหตุสงสัย บริษัทจะตรวจสอบและดำเนินการตามกฎหมาย
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
            <Label className="mt-3 block">ลายเซ็นผู้ขาย *</Label>
            <p className="text-xs text-muted-foreground mb-2">
              ลงนามยืนยันรายการรับเครื่องและคำรับรองผู้ขายข้างต้น
            </p>
            <SignaturePadFull
              key={`${item.id}:${JSON.stringify(identifiers)}`}
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
