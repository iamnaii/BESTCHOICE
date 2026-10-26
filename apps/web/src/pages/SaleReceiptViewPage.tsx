import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { liffApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * หน้าสาธารณะ (ไม่มี auth) ของใบเสร็จรับเงินขายสด — `/r/:token` (ก้อน 4 · 2026-10-23).
 *
 * ลูกค้าเปิดจากปุ่ม "เปิดใบเสร็จ" ใน LINE ร้าน / QR บนกระดาษ / ลิงก์ที่พนักงานคัดลอกส่ง.
 * ลอกจาก `CreditNoteViewPage` (`/cn/:token`): ประกาศนอก ProtectedRoute/MainLayout ใน App.tsx
 * และดึงผ่าน `liffApi` (ไม่มี Authorization header / ไม่ redirect ไป login) เพราะหน้านี้ไม่มี session พนักงาน.
 *
 * ฝั่ง API (`GET /sales/receipt/public/:token/pdf`) ตอบ 404 ข้อความเดียวกันทุกกรณี (ไม่รู้จัก/หมดอายุ/ใบยกเลิก)
 * หน้านี้จึงแสดงข้อความกลางเดียวกับทุกความล้มเหลว และไม่โชว์ error ดิบ.
 */
export default function SaleReceiptViewPage() {
  const { token } = useParams<{ token: string }>();

  const { data: blob, isLoading, isError } = useQuery<Blob>({
    queryKey: ['sale-receipt-view', token],
    queryFn: async () => {
      const res = await liffApi.get(`/sales/receipt/public/${token}/pdf`, { responseType: 'blob' });
      return res.data as Blob;
    },
    enabled: !!token,
    retry: false,
  });

  const objectUrl = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const handleDownload = () => {
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `ใบเสร็จ-${token}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!token || isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="w-full max-w-sm rounded-2xl border border-border/50 bg-card shadow-sm p-6 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-destructive/10">
            <AlertCircle className="size-7 text-destructive" strokeWidth={1.75} />
          </div>
          <h1 className="text-base font-semibold text-foreground leading-snug mb-1.5">ไม่พบเอกสาร</h1>
          <p className="text-sm text-muted-foreground leading-snug">
            ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว กรุณาติดต่อร้าน BESTCHOICE
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !objectUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-8 animate-spin text-primary" strokeWidth={1.75} />
          <p className="text-sm text-muted-foreground leading-snug">กำลังโหลดเอกสาร...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/50 bg-card px-4 py-3">
        <span className="text-sm font-semibold text-foreground leading-snug">ใบเสร็จรับเงิน</span>
        <Button variant="primary" size="sm" onClick={handleDownload} className="gap-1.5">
          <Download className="size-4" strokeWidth={2} />
          ดาวน์โหลด
        </Button>
      </header>
      <iframe title="ใบเสร็จรับเงิน" src={objectUrl} className="w-full flex-1 border-0" />
    </div>
  );
}
