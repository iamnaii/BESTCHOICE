import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RepairCenterCombobox } from '@/pages/insurance/components/RepairCenterCombobox';
import ReplacementProductPicker from './ReplacementProductPicker';
import { afterSalesKeys, PAYER_LABEL, type CaseDetail, type Payer } from './after-sales';

/**
 * ห้า dialog + 1 ConfirmDialog wrapper ของ Step 5 (เปลี่ยนเครื่อง — Task 11). ทุก mutation:
 * onSuccess → toast.success + invalidateQueries(afterSalesKeys.all) + ปิด dialog,
 * onError → toast.error(getErrorMessage). mirror ของ `RepairActionDialogs.tsx` (PR 1).
 */
const inputClass =
  'h-11 w-full rounded-lg border border-input bg-background px-3.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';
const areaClass =
  'w-full resize-none rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm leading-snug text-foreground placeholder:text-muted-foreground/70';

const REJECT_MIN_REASON = 10;
const CANCEL_SWAP_MIN_REASON = 10;

interface DialogBaseProps {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ยืนยันเปลี่ยนเครื่อง — ครอบทั้งเคส SAME_MODEL_EXCHANGE ปกติ (มี replacementProductId ติดมาจาก
 * ตอนแจ้งปัญหาแล้ว ไม่ต้องเลือกซ้ำ) และเคส REPAIR ที่ "ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิม" (ต้องเลือกเครื่อง
 * ทดแทนใหม่ผ่าน ReplacementProductPicker เพราะยังไม่เคยเลือกไว้ — ดู exchange-confirm.dto.ts)
 */
export function ConfirmExchangeDialog({
  caseId,
  open,
  onOpenChange,
  data,
}: DialogBaseProps & { data: CaseDetail }) {
  const queryClient = useQueryClient();
  const fromRepair = data.outcome === 'REPAIR';
  const [checkCondition, setCheckCondition] = useState(false);
  const [checkImei, setCheckImei] = useState(false);
  const [checkSigned, setCheckSigned] = useState(false);
  const [note, setNote] = useState('');
  const [replacementProductId, setReplacementProductId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCheckCondition(false);
      setCheckImei(false);
      setCheckSigned(false);
      setNote('');
      setReplacementProductId(null);
    }
  }, [open]);

  const valid = checkCondition && checkImei && (!fromRepair || !!replacementProductId);

  const mutate = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (note.trim()) body.note = note.trim();
      if (fromRepair && replacementProductId) body.replacementProductId = replacementProductId;
      return (await api.post(`/after-sales/${caseId}/exchange/confirm`, body)).data;
    },
    onSuccess: () => {
      toast.success('ยืนยันเปลี่ยนเครื่องแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ยืนยันเปลี่ยนเครื่อง</DialogTitle>
          <DialogDescription>
            {fromRepair
              ? 'เลือกเครื่องทดแทนจากสต๊อกก่อนยืนยัน — ระบบจะเปิดสัญญาใหม่ให้ทันที'
              : 'ตรวจสอบเครื่องเดิม/เครื่องใหม่ก่อนยืนยัน'}
          </DialogDescription>
        </DialogHeader>

        {fromRepair && (
          <ReplacementProductPicker
            imei={data.deviceImei ?? ''}
            sameModel
            value={replacementProductId}
            onChange={setReplacementProductId}
          />
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
            <input
              type="checkbox"
              checked={checkCondition}
              onChange={(e) => setCheckCondition(e.target.checked)}
              className="h-4.5 w-4.5"
            />
            สภาพเครื่องเดิมตรงรูป
          </label>
          <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
            <input
              type="checkbox"
              checked={checkImei}
              onChange={(e) => setCheckImei(e.target.checked)}
              className="h-4.5 w-4.5"
            />
            เครื่องใหม่จากสต๊อกสาขานี้ IMEI ตรง
          </label>
          <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
            <input
              type="checkbox"
              checked={checkSigned}
              onChange={(e) => setCheckSigned(e.target.checked)}
              className="h-4.5 w-4.5"
            />
            ลูกค้าเซ็นใบส่งมอบแล้ว
          </label>
        </div>

        <div className="space-y-1">
          <label htmlFor="ce-note" className="block text-xs leading-snug text-muted-foreground">
            หมายเหตุ
          </label>
          <textarea
            id="ce-note"
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={areaClass}
          />
        </div>

        <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-snug text-warning-strong">
          <p className="font-semibold">เมื่อกดยืนยัน ระบบจะทำให้:</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>สัญญาเดิมปิดเป็น &quot;เปลี่ยนเครื่องชำรุด&quot; และกลับรายการบัญชีอัตโนมัติ</li>
            <li>
              เปิดสัญญาใหม่เงื่อนไขเดิมด้วยเครื่องที่เลือก — ต้องเปิดใช้ที่หน้าสัญญาก่อนส่งมอบ
            </li>
            <li>เครื่องเดิม → รอส่งเคลมผู้จัดจำหน่าย · บันทึกผู้ยืนยันในไทม์ไลน์</li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยันเปลี่ยนเครื่อง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ปฏิเสธคำขอเปลี่ยนเครื่อง — kind='SAME_MODEL' ยิง `/exchange/reject` (MGR),
 * kind='PRICED' ยิง `/reject` (OWNER เท่านั้น — ด่านสิทธิ์อยู่ที่ปุ่มที่เปิด dialog นี้แล้ว) */
export function RejectExchangeDialog({
  caseId,
  open,
  onOpenChange,
  kind,
}: DialogBaseProps & { kind: 'SAME_MODEL' | 'PRICED' }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const valid = reason.trim().length >= REJECT_MIN_REASON;
  const path = kind === 'SAME_MODEL' ? 'exchange/reject' : 'reject';

  const mutate = useMutation({
    mutationFn: async () =>
      (await api.post(`/after-sales/${caseId}/${path}`, { reason: reason.trim() })).data,
    onSuccess: () => {
      toast.success('ปฏิเสธคำขอแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ปฏิเสธคำขอเปลี่ยนเครื่อง</DialogTitle>
          <DialogDescription>เคสนี้จะถูกปิดเป็นสถานะยกเลิก</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="re-reason" className="block text-xs leading-snug text-muted-foreground">
            เหตุผลที่ปฏิเสธ <span className="text-destructive">*</span> (อย่างน้อย{' '}
            {REJECT_MIN_REASON} ตัวอักษร)
          </label>
          <textarea
            id="re-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={areaClass}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ปิด
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยันปฏิเสธ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** เปลี่ยนใจ — จาก "เปลี่ยนรุ่นเดิม" กลับไปเป็น "ซ่อม" ก่อนผจก.ยืนยัน (STAFF — ดู switch-to-repair.dto.ts) */
export function SwitchToRepairDialog({
  caseId,
  open,
  onOpenChange,
  defaultPayer,
}: DialogBaseProps & { defaultPayer: Payer }) {
  const queryClient = useQueryClient();
  const [payer, setPayer] = useState<Payer>(defaultPayer);
  const [estimatedCost, setEstimatedCost] = useState('');
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (open) {
      setPayer(defaultPayer);
      setEstimatedCost('');
      setSupplier(null);
    }
  }, [open, defaultPayer]);

  const estimatedCostParsed = Number(estimatedCost);
  const estimatedCostValid =
    estimatedCost.trim() === '' || (!Number.isNaN(estimatedCostParsed) && estimatedCostParsed >= 0);

  const mutate = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { payer };
      if (estimatedCost.trim()) body.estimatedCost = estimatedCostParsed;
      if (supplier) body.repairSupplierId = supplier.id;
      return (await api.post(`/after-sales/${caseId}/switch-to-repair`, body)).data;
    },
    onSuccess: () => {
      toast.success('เปลี่ยนเป็นซ่อมแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>เปลี่ยนเป็น &quot;ซ่อม&quot; แทน</DialogTitle>
          <DialogDescription>เคสนี้จะเปิดใบซ่อมใหม่แทนการเปลี่ยนรุ่นเดิม</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="sw-payer" className="block text-xs leading-snug text-muted-foreground">
            ผู้จ่ายค่าซ่อม <span className="text-destructive">*</span>
          </label>
          <select
            id="sw-payer"
            value={payer}
            onChange={(e) => setPayer(e.target.value as Payer)}
            className={inputClass}
          >
            {(['SHOP', 'CUSTOMER', 'SUPPLIER_CLAIM'] as const).map((p) => (
              <option key={p} value={p}>
                {PAYER_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="sw-cost" className="block text-xs leading-snug text-muted-foreground">
            ค่าซ่อมประมาณ
          </label>
          <input
            id="sw-cost"
            inputMode="decimal"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            className={inputClass}
          />
          {!estimatedCostValid && (
            <p className="text-xs leading-snug text-destructive">กรอกเป็นตัวเลขตั้งแต่ 0 ขึ้นไป</p>
          )}
        </div>
        <div className="space-y-1">
          <span className="block text-xs leading-snug text-muted-foreground">
            ศูนย์ซ่อม (ไม่บังคับ)
          </span>
          <RepairCenterCombobox
            value={supplier?.id ?? ''}
            displayName={supplier?.name}
            onSelect={(s) => setSupplier(s)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!estimatedCostValid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยัน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** อนุมัติคำขอเปลี่ยนเครื่องแบบมีราคา — MEMO บังคับ 2 checkbox, PRICED ยืนยันเฉยๆ (engine เปิดใช้
 * สัญญาใหม่ที่หน้าสัญญาต่างหาก — approve แค่สร้างสัญญาใหม่ DRAFT ให้) */
export function ApprovePricedDialog({
  caseId,
  open,
  onOpenChange,
  mode,
}: DialogBaseProps & { mode: 'MEMO' | 'PRICED' }) {
  const queryClient = useQueryClient();
  const [addendumSigned, setAddendumSigned] = useState(false);
  const [mdmSwapped, setMdmSwapped] = useState(false);

  useEffect(() => {
    if (open) {
      setAddendumSigned(false);
      setMdmSwapped(false);
    }
  }, [open]);

  const valid = mode === 'PRICED' || (addendumSigned && mdmSwapped);

  const mutate = useMutation({
    mutationFn: async () => {
      const body = mode === 'MEMO' ? { memoAddendumSigned: true, memoMdmSwapped: true } : {};
      return (await api.post(`/after-sales/${caseId}/approve`, body)).data;
    },
    onSuccess: () => {
      toast.success('อนุมัติแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>อนุมัติเปลี่ยนเครื่อง</DialogTitle>
          <DialogDescription>
            {mode === 'MEMO'
              ? 'รุ่น/ความจุ/ราคาเท่าเดิม — สลับเครื่องบนสัญญาเดิม ไม่มีสัญญาใหม่'
              : 'ระบบจะสร้างสัญญาใหม่ (DRAFT) ให้ — ต้องเปิดใช้ที่หน้าสัญญาก่อนส่งมอบ'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'MEMO' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
              <input
                type="checkbox"
                checked={addendumSigned}
                onChange={(e) => setAddendumSigned(e.target.checked)}
                className="h-4.5 w-4.5"
              />
              เซ็น ADDENDUM แล้ว
            </label>
            <label className="flex items-center gap-2 text-sm leading-snug text-foreground">
              <input
                type="checkbox"
                checked={mdmSwapped}
                onChange={(e) => setMdmSwapped(e.target.checked)}
                className="h-4.5 w-4.5"
              />
              สลับ MDM แล้ว
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'อนุมัติ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ยกเลิกคำขอเปลี่ยนเครื่องแบบมีราคาที่อนุมัติไปแล้ว — MGR */
export function CancelSwapDialog({ caseId, open, onOpenChange }: DialogBaseProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const valid = reason.trim().length >= CANCEL_SWAP_MIN_REASON;

  const mutate = useMutation({
    mutationFn: async () =>
      (await api.post(`/after-sales/${caseId}/cancel-swap`, { reason: reason.trim() })).data,
    onSuccess: () => {
      toast.success('ยกเลิกคำขอแล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยกเลิกคำขอเปลี่ยนเครื่อง</DialogTitle>
          <DialogDescription>คำขอที่อนุมัติไปแล้วจะถูกยกเลิก</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="cs-reason" className="block text-xs leading-snug text-muted-foreground">
            เหตุผลที่ยกเลิก <span className="text-destructive">*</span> (อย่างน้อย{' '}
            {CANCEL_SWAP_MIN_REASON} ตัวอักษร)
          </label>
          <textarea
            id="cs-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={areaClass}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutate.isPending}>
            ปิด
          </Button>
          <Button
            variant="destructive"
            disabled={!valid || mutate.isPending}
            onClick={() => mutate.mutate()}
          >
            {mutate.isPending ? 'กำลังบันทึก…' : 'ยืนยันยกเลิก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ส่งมอบเครื่องใหม่ให้ลูกค้า — ปิดเคส (engine ปฏิเสธ 400 เมื่อสัญญาใหม่ยังเป็น DRAFT) */
export function DeliverExchangeConfirm({ caseId, open, onOpenChange }: DialogBaseProps) {
  const queryClient = useQueryClient();

  const mutate = useMutation({
    mutationFn: async () => (await api.post(`/after-sales/${caseId}/exchange/deliver`, {})).data,
    onSuccess: () => {
      toast.success('ส่งมอบเครื่องใหม่แล้ว');
      queryClient.invalidateQueries({ queryKey: afterSalesKeys.all });
      onOpenChange(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="ส่งมอบเครื่องใหม่"
      description="ส่งมอบเครื่องใหม่ให้ลูกค้าแล้ว — ระบบจะปิดเคส"
      confirmLabel="ยืนยันส่งมอบ"
      loading={mutate.isPending}
      onConfirm={() => mutate.mutate()}
    />
  );
}
