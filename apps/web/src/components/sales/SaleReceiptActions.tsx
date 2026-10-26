import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link2, MessageCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PdfPreview from '@/components/PdfPreview';
import { Button } from '@/components/ui/button';
import {
  hasSaleReceipt,
  lineResultMessage,
  receiptFilename,
  receiptPdfPath,
  thaiDateShort,
  type SaleReceiptLineResult,
} from './saleReceipt';

export { lineResultMessage, receiptFilename, receiptPdfPath } from './saleReceipt';

export interface SaleReceiptActionsSale {
  id: string;
  saleNumber: string;
  saleType: string;
  deletedAt?: string | null;
}

/**
 * ปุ่มเอกสารของใบขายสด/ไฟแนนซ์นอก (ก้อน 4 · 2026-10-23): พิมพ์ใบเสร็จ A4 · ส่ง LINE ร้าน · คัดลอกลิงก์สาธารณะ 30 วัน.
 * ใช้ทั้งกล่องหลังขายสำเร็จ (POS) และแผงใบขาย (/sales). ใบผ่อนชำระไม่มีใบเสร็จแบบนี้ (ใช้ของสัญญา) · ใบยกเลิกเหลือพิมพ์อย่างเดียว.
 */
export default function SaleReceiptActions({ sale, size = 'md' }: { sale: SaleReceiptActionsSale; size?: 'sm' | 'md' }) {
  const [preview, setPreview] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const lineMutation = useMutation({
    mutationFn: async () => (await api.post(`/sales/${sale.id}/receipt/line`)).data as SaleReceiptLineResult,
    onSuccess: (result) => {
      const m = lineResultMessage(result);
      if (m.kind === 'success') toast.success(m.text);
      else toast.error(m.text);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const shareMutation = useMutation({
    mutationFn: async () => (await api.post(`/sales/${sale.id}/receipt/share`)).data as { url: string; expiresAt: string },
    onSuccess: async ({ url, expiresAt }) => {
      try {
        await navigator.clipboard.writeText(url);
        setFallbackUrl(null);
        toast.success(`คัดลอกลิงก์แล้ว · ใช้ได้ถึง ${thaiDateShort(expiresAt)}`);
      } catch {
        // เบราว์เซอร์ไม่ให้เข้าถึงคลิปบอร์ด (http / สิทธิ์) — โชว์ลิงก์ให้ลากคัดลอกเอง
        setFallbackUrl(url);
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  if (!hasSaleReceipt(sale.saleType)) return null;
  const voided = !!sale.deletedAt;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size={size} onClick={() => setPreview(true)}>
        <Printer aria-hidden="true" />
        พิมพ์ใบเสร็จ
      </Button>
      {!voided && (
        <Button type="button" variant="outline" size={size} disabled={lineMutation.isPending} onClick={() => lineMutation.mutate()}>
          <MessageCircle aria-hidden="true" />
          ส่ง LINE
        </Button>
      )}
      {!voided && (
        <Button type="button" variant="outline" size={size} disabled={shareMutation.isPending} onClick={() => shareMutation.mutate()}>
          <Link2 aria-hidden="true" />
          คัดลอกลิงก์
        </Button>
      )}
      {fallbackUrl && (
        <input
          readOnly
          aria-label="ลิงก์ใบเสร็จ"
          value={fallbackUrl}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 basis-full rounded-md border border-input bg-background px-2 py-1 font-mono text-xs text-foreground"
        />
      )}
      {preview && (
        <PdfPreview
          title="ใบเสร็จรับเงิน"
          path={receiptPdfPath(sale.id)}
          filename={receiptFilename(sale.saleNumber)}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
