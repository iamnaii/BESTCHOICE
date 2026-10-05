import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';
import type { GoodsReceivingRecord, PurchaseOrder } from '../types';
import { bangkokTodayIso, earliestSupplierDocIso, supplierDocErrors } from '../supplier-doc.util';
import { buildTaxInvoiceFormData, taxInvoiceResultMessage, type TaxInvoiceRecordResult } from '../tax-invoice.util';

interface Props {
  open: boolean;
  onClose: () => void;
  po: PurchaseOrder | null;
  receiving: GoodsReceivingRecord | null;
  onRecorded: (result: TaxInvoiceRecordResult) => void;
}

const INPUT_CLS =
  'w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

/** ก้อน 5 Q1/Q2 — ใบกำกับภาษีที่มาหลังรับของ: เลขที่ + วันที่บังคับ · รูปไม่บังคับ · เคลมย้อนให้สัญญาที่รอ แล้วโชว์ผล */
export default function TaxInvoiceDialog({ open, onClose, po, receiving, onRecorded }: Props) {
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [result, setResult] = useState<TaxInvoiceRecordResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const today = bangkokTodayIso();

  useEffect(() => {
    if (open) {
      setNumber(receiving?.taxInvoice?.number ?? '');
      setDate(receiving?.taxInvoice?.date ?? '');
      setPhoto(null);
      setResult(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, [open, receiving]);

  const errors = useMemo(() => supplierDocErrors({ type: 'TAX_INVOICE', number, date }, ''), [number, date]);
  const debouncedNumber = useDebounce(number.trim(), 300);
  const dupCheck = useQuery({
    queryKey: ['purchase-orders', 'receiving-doc-check', 'tax-invoice', po?.supplier.id, debouncedNumber],
    queryFn: async () =>
      (await api.get('/purchase-orders/receiving-doc-check', { params: { supplierId: po!.supplier.id, docNumber: debouncedNumber } })).data as {
        duplicates: { grNumber: string; poNumber: string }[];
      },
    enabled: open && !!po && debouncedNumber.length > 0,
  });
  const duplicates = (dupCheck.data?.duplicates ?? []).filter((d) => d.grNumber !== receiving?.grNumber);

  const record = useMutation({
    mutationFn: async () =>
      (await api.post(`/purchase-orders/${po!.id}/goods-receivings/${receiving!.id}/tax-invoice`, buildTaxInvoiceFormData({ number, date }, photo))).data as TaxInvoiceRecordResult,
    onSuccess: (r) => {
      setResult(r);
      toast.success(taxInvoiceResultMessage(r));
      onRecorded(r);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const canSubmit = !!po && !!receiving && number.trim().length > 0 && !!date && !errors.number && !errors.date && !record.isPending;

  return (
    <Modal isOpen={open} onClose={onClose} title={receiving?.taxInvoice ? 'แก้ใบกำกับภาษี' : 'บันทึกใบกำกับภาษี'} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) record.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-xs text-muted-foreground leading-snug">
          ใบรับของ {receiving?.grNumber} · {po?.supplier.name} — เมื่อบันทึก ระบบจะเคลมภาษีซื้อย้อนให้สัญญาผ่อนของเครื่องในใบนี้ที่รออยู่ ลงวันเปิดสัญญา
        </p>
        <div>
          <label htmlFor="ti-number" className="block text-sm font-medium text-foreground mb-1">เลขที่ใบกำกับภาษี</label>
          <input id="ti-number" className={INPUT_CLS} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} />
          {errors.number && <p className="mt-1 text-xs text-destructive leading-snug">{errors.number}</p>}
          {duplicates.length > 0 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-warning-strong leading-snug">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              เลขที่นี้เคยใช้กับใบรับของ {duplicates.map((d) => `${d.grNumber} (${d.poNumber})`).join(', ')} — บันทึกได้ แต่ตรวจให้แน่ใจ
            </p>
          )}
        </div>
        <div>
          <label htmlFor="ti-date" className="block text-sm font-medium text-foreground mb-1">วันที่ในใบกำกับ</label>
          <input id="ti-date" type="date" className={INPUT_CLS} value={date} max={today} min={earliestSupplierDocIso(today)} onChange={(e) => setDate(e.target.value)} />
          {errors.date && <p className="mt-1 text-xs text-destructive leading-snug">{errors.date}</p>}
        </div>
        <div>
          <label htmlFor="ti-photo" className="block text-sm font-medium text-foreground mb-1">รูปใบกำกับ (ไม่บังคับ · JPEG/PNG/WebP ≤ 5MB)</label>
          <input id="ti-photo" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </div>
        {result && (
          <div className="rounded-lg bg-success/5 border border-success/20 p-3 text-sm">
            <p className="flex items-center gap-1.5 text-success leading-snug">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              {taxInvoiceResultMessage(result)}
            </p>
            {result.claimed.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {result.claimed.map((c) => (
                  <li key={c.contractId}>
                    {c.contractNumber} · {c.journalEntryNo} · {c.amount} ฿{c.postedOnInvoiceDate ? ' · ลงวันนี้ (งวดเดือนเปิดสัญญาปิดแล้ว)' : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{result ? 'ปิด' : 'ยกเลิก'}</Button>
          {!result && <Button type="submit" disabled={!canSubmit}>บันทึกใบกำกับภาษี</Button>}
        </div>
      </form>
    </Modal>
  );
}
