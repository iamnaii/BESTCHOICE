import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Download, Loader2 } from 'lucide-react';
import { liffApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * Public (no auth) ใบลดหนี้ (Credit Note) viewer — `/cn/:token`.
 *
 * Opened by a customer tapping the "ดูเอกสาร" button on the CN Flex message
 * pushed by CreditNoteDeliveryService (LINE in-app browser, sometimes a plain
 * mobile browser). Mirrors `/pay/:token` (LiffPayment): declared OUTSIDE
 * ProtectedRoute/MainLayout in App.tsx, and fetches through `liffApi` — the
 * pre-existing "public axios instance for LIFF pages" (no Authorization
 * header, no JWT-refresh interceptor, no login redirect on 401) — rather than
 * the authenticated `api` client, since this page never has a staff session.
 *
 * The backend (`GET /receipts/public/:token/pdf`) collapses "unknown token",
 * "expired token", and "soft-deleted receipt" into a single generic 404 so a
 * leaked/guessed URL can't be used to probe which case applies — this page
 * mirrors that by showing one generic Thai message for every failure mode
 * (network error, 404, timeout, etc.) and never surfacing the raw error.
 */
export default function CreditNoteViewPage() {
  const { token } = useParams<{ token: string }>();

  const {
    data: blob,
    isLoading,
    isError,
  } = useQuery<Blob>({
    queryKey: ['cn-view', token],
    queryFn: async () => {
      const res = await liffApi.get(`/receipts/public/${token}/pdf`, { responseType: 'blob' });
      return res.data as Blob;
    },
    enabled: !!token,
    retry: false,
  });

  // Derive the object URL synchronously from the blob (not in a useEffect) so
  // there's no in-between render where isLoading/isError are both false but
  // no URL exists yet. Revoked whenever the blob changes or the page unmounts.
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
    a.download = `ใบลดหนี้-${token}.pdf`;
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
          <h1 className="text-base font-semibold text-foreground leading-snug mb-1.5">
            ไม่พบเอกสาร
          </h1>
          <p className="text-sm text-muted-foreground leading-snug">
            ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว กรุณาติดต่อ BESTCHOICE FINANCE
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
        <span className="text-sm font-semibold text-foreground leading-snug">ใบลดหนี้</span>
        <Button variant="primary" size="sm" onClick={handleDownload} className="gap-1.5">
          <Download className="size-4" strokeWidth={2} />
          ดาวน์โหลด
        </Button>
      </header>
      <iframe title="ใบลดหนี้" src={objectUrl} className="w-full flex-1 border-0" />
    </div>
  );
}
