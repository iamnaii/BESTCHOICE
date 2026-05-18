import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import CompanyFilter from '@/components/CompanyFilter';
import { THAI_MONTHS_FULL } from '@/lib/date';
import {
  FileText,
  Download,
  AlertCircle,
  Send,
  FileCode,
  Settings as SettingsIcon,
} from 'lucide-react';

interface ETaxInvoice {
  paymentId: string;
  paidDate: string | Date | null;
  installmentNo: number;
  contractId: string;
  contractNumber: string;
  customerName: string;
  customerTaxId: string | null;
  amountBeforeVat: number | string;
  vatAmount: number | string;
  total: number | string;
}
interface ETaxListResponse {
  data: ETaxInvoice[];
  total: number;
  page: number;
  limit: number;
}

/** P2-SP5 — XML submission status per Payment, keyed by paymentId */
type ETaxStatus =
  | 'PENDING'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'ERROR';
interface ETaxSubmission {
  id: string;
  paymentId: string;
  status: ETaxStatus;
  rdSubmissionId: string | null;
  rejectReason: string | null;
}

const STATUS_LABEL: Record<ETaxStatus, string> = {
  PENDING: 'รอเซ็น',
  SIGNED: 'รอส่ง',
  SUBMITTED: 'ส่งแล้ว',
  ACCEPTED: 'สรรพากรรับ',
  REJECTED: 'ปฏิเสธ',
  ERROR: 'ข้อผิดพลาด',
};

const STATUS_VARIANT: Record<
  ETaxStatus,
  'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info'
> = {
  PENDING: 'outline',
  SIGNED: 'secondary',
  SUBMITTED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
  ERROR: 'destructive',
};

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden bg-background text-foreground';

function fmtNumber(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return '0.00';
  return v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ETaxInvoicePage() {
  const now = new Date();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const enabled = Boolean(companyId);

  const { data, isLoading, isError, error, refetch } = useQuery<ETaxListResponse>({
    queryKey: ['e-tax', 'invoices', companyId, year, month, page],
    enabled,
    queryFn: async () => {
      const url = `/e-tax/invoices?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}&page=${page}&limit=${LIMIT}`;
      const res = await api.get(url);
      return res.data;
    },
  });

  // P2-SP5 — XML submission state, page-scoped. We load a flat list of
  // recent submissions; the row UI looks up by paymentId. Avoids N+1
  // requests per row.
  const submissionsQuery = useQuery<{ data: ETaxSubmission[] }>({
    queryKey: ['e-tax-xml', 'submissions', companyId, year, month, page],
    enabled,
    queryFn: async () => {
      const res = await api.get('/e-tax-xml?limit=200');
      return res.data;
    },
  });
  const submissionsByPayment = new Map<string, ETaxSubmission>();
  for (const s of submissionsQuery.data?.data ?? []) {
    submissionsByPayment.set(s.paymentId, s);
  }

  // Read ETAX_SUBMIT_MODE via the config integration — drives whether the
  // submit/sign buttons are enabled. Cached by react-query.
  const configQuery = useQuery<{ config: { submitMode?: string } }>({
    queryKey: ['integration-config', 'e-tax', 'public-mode'],
    queryFn: async () => {
      try {
        const res = await api.get('/integrations/e-tax/config');
        return res.data;
      } catch {
        // Non-OWNER reads will 403 — quietly treat as disabled.
        return { config: { submitMode: 'disabled' } };
      }
    },
  });
  const submitEnabled = configQuery.data?.config?.submitMode === 'enabled';

  const generateMutation = useMutation({
    mutationFn: (paymentId: string) =>
      api.post(`/e-tax-xml/generate/${paymentId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('สร้าง XML สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['e-tax-xml', 'submissions'] });
    },
    onError: (e: Error) => toast.error(e.message ?? 'สร้าง XML ล้มเหลว'),
  });

  const submitMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      // Two-step pipeline: sign then submit. Failing sign rolls forward
      // to user toast (no submit attempted).
      await api.post(`/e-tax-xml/${submissionId}/sign`);
      const res = await api.post(`/e-tax-xml/${submissionId}/submit`);
      return res.data;
    },
    onSuccess: () => {
      toast.success('ส่งให้สรรพากรเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['e-tax-xml', 'submissions'] });
    },
    onError: (e: Error) => toast.error(e.message ?? 'ส่งให้สรรพากรล้มเหลว'),
  });

  async function handleDownloadPdf(paymentId: string) {
    try {
      const res = await api.get(`/e-tax/invoices/${paymentId}/pdf`, {
        responseType: 'blob',
      });
      const blob = res.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      // P2-SP3: PDF now complies with ม.86/4 — name as 'tax-invoice'
      a.download = `tax-invoice-${paymentId}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message ?? 'ดาวน์โหลด PDF ล้มเหลว');
    }
  }

  async function handleExportCsv() {
    if (!companyId) {
      toast.error('กรุณาเลือกบริษัทก่อน');
      return;
    }
    try {
      const res = await api.get(
        `/e-tax/export-csv?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}`,
        { responseType: 'blob' },
      );
      const blob = res.data as Blob;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `e-tax-${year}-${String(month).padStart(2, '0')}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error((e as Error).message ?? 'ดาวน์โหลด CSV ล้มเหลว');
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <PageHeader
        title="e-Tax Invoice (สรรพากร)"
        subtitle="ใบกำกับภาษี (กระดาษ ม.86/4) + Export CSV + สร้าง XML ตาม ขมธอ.21-2562"
        icon={<FileText className="size-5" aria-hidden />}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" asChild>
              <Link to="/settings/e-tax-config" aria-label="ตั้งค่า e-Tax">
                <SettingsIcon className="size-4 mr-2" aria-hidden />
                ตั้งค่า
              </Link>
            </Button>
            <Button variant="outline" onClick={handleExportCsv} disabled={!companyId}>
              <Download className="size-4 mr-2" aria-hidden />
              Export CSV (รายเดือน)
            </Button>
          </div>
        }
      />

      {/* P2-SP3: PDF now complies with ม.86/4 paper format (Thai font + full fields).
       * The remaining gap is the XML submission to RD — pending CA cert + ภ.อ.01 registration. */}
      <div
        data-testid="phase2-banner"
        className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mb-4"
      >
        <AlertCircle className="size-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />
        <div className="text-sm text-foreground leading-snug">
          <p className="font-medium mb-1">
            ระยะที่ 1 — ใบกำกับภาษี (กระดาษ ม.86/4) พร้อมพิมพ์มอบลูกค้า
          </p>
          <p className="text-muted-foreground">
            PDF ที่ดาวน์โหลดเป็น <strong>ใบกำกับภาษีตามรูปแบบ ม.86/4 ป.รัษฎากร</strong>
            — มีข้อมูลผู้ออก, ผู้ซื้อ, รายการ, VAT 7%, รวมทั้งสิ้นครบถ้วน
            สามารถพิมพ์มอบให้ลูกค้าและใช้ยื่นภาษีได้ตามกฎหมาย.
          </p>
          <p className="text-muted-foreground mt-1">
            ระยะที่ 2: ส่งใบกำกับภาษีอิเล็กทรอนิกส์ (XML) ให้กรมสรรพากรอัตโนมัติ
            พร้อมลายเซ็นดิจิทัล PKCS#7 — รอลงทะเบียน ภ.อ.01 + อัปโหลด CA cert
            (ดู P2-SP5 roadmap).
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">บริษัท</label>
              <CompanyFilter value={companyId} onChange={setCompanyId} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">ปี (ค.ศ.)</label>
              <input
                type="number"
                value={year}
                onChange={(e) => {
                  setYear(parseInt(e.target.value) || now.getFullYear());
                  setPage(1);
                }}
                className={inputClass}
                min={2020}
                max={2100}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground leading-snug mb-1 block">เดือน</label>
              <select
                value={month}
                onChange={(e) => {
                  setMonth(parseInt(e.target.value));
                  setPage(1);
                }}
                className={inputClass}
              >
                {THAI_MONTHS_FULL.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {!companyId && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground leading-snug">
            กรุณาเลือกบริษัทเพื่อแสดงรายการ
          </CardContent>
        </Card>
      )}

      {enabled && (
        <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {data && (
            <Card data-testid="invoice-list">
              <CardHeader>
                <h3 className="text-sm font-semibold text-foreground leading-snug">
                  รายการชำระเงินมีภาษีมูลค่าเพิ่ม ({data.total} รายการ)
                </h3>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-2">วันที่</th>
                        <th className="py-2 pr-2">สัญญา / งวด</th>
                        <th className="py-2 pr-2">ลูกค้า</th>
                        <th className="py-2 pr-2">เลขประจำตัวผู้เสียภาษี</th>
                        <th className="py-2 pr-2 text-right">ก่อน VAT (฿)</th>
                        <th className="py-2 pr-2 text-right">VAT (฿)</th>
                        <th className="py-2 pr-2 text-right">รวม (฿)</th>
                        <th className="py-2 pr-2">สถานะ XML</th>
                        <th className="py-2 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.length === 0 && (
                        <tr>
                          <td colSpan={9} className="py-4 text-center text-muted-foreground">
                            ไม่มีรายการในงวด
                          </td>
                        </tr>
                      )}
                      {data.data.map((inv) => {
                        const sub = submissionsByPayment.get(inv.paymentId);
                        return (
                          <tr key={inv.paymentId} className="border-b border-border/40">
                            <td className="py-2 pr-2 tabular-nums">
                              {inv.paidDate
                                ? new Date(inv.paidDate).toLocaleDateString('th-TH')
                                : '-'}
                            </td>
                            <td className="py-2 pr-2 font-mono text-xs">
                              {inv.contractNumber} / {inv.installmentNo}
                            </td>
                            <td className="py-2 pr-2">{inv.customerName}</td>
                            <td className="py-2 pr-2 font-mono text-xs">
                              {inv.customerTaxId ?? '-'}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {fmtNumber(inv.amountBeforeVat)}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {fmtNumber(inv.vatAmount)}
                            </td>
                            <td className="py-2 pr-2 text-right tabular-nums">
                              {fmtNumber(inv.total)}
                            </td>
                            <td className="py-2 pr-2">
                              {sub ? (
                                <div className="flex flex-col gap-1">
                                  <Badge
                                    variant={STATUS_VARIANT[sub.status]}
                                    data-testid={`etax-status-${inv.paymentId}`}
                                  >
                                    {STATUS_LABEL[sub.status]}
                                  </Badge>
                                  {sub.rdSubmissionId && (
                                    <span
                                      className="text-[10px] text-muted-foreground font-mono leading-snug"
                                      title="RD submission ID"
                                    >
                                      RD: {sub.rdSubmissionId}
                                    </span>
                                  )}
                                  {sub.rejectReason && (
                                    <span
                                      className="text-[10px] text-destructive leading-snug"
                                      title={sub.rejectReason}
                                    >
                                      {sub.rejectReason.slice(0, 40)}
                                      {sub.rejectReason.length > 40 ? '…' : ''}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground leading-snug">
                                  ยังไม่มี XML
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-2">
                              <div className="flex flex-wrap gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDownloadPdf(inv.paymentId)}
                                  aria-label={`ดาวน์โหลด PDF สัญญา ${inv.contractNumber} งวด ${inv.installmentNo}`}
                                >
                                  <Download className="size-3.5 mr-1.5" aria-hidden />
                                  PDF
                                </Button>
                                {!sub && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => generateMutation.mutate(inv.paymentId)}
                                    disabled={generateMutation.isPending}
                                    aria-label={`สร้าง XML สัญญา ${inv.contractNumber} งวด ${inv.installmentNo}`}
                                  >
                                    <FileCode className="size-3.5 mr-1.5" aria-hidden />
                                    สร้าง XML
                                  </Button>
                                )}
                                {sub &&
                                  (sub.status === 'PENDING' ||
                                    sub.status === 'ERROR' ||
                                    sub.status === 'REJECTED') && (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      disabled={!submitEnabled || submitMutation.isPending}
                                      title={
                                        submitEnabled
                                          ? undefined
                                          : 'ตั้งค่า e-Tax cert ก่อน'
                                      }
                                      onClick={() => submitMutation.mutate(sub.id)}
                                      aria-label={`ส่งให้สรรพากร สัญญา ${inv.contractNumber} งวด ${inv.installmentNo}`}
                                      data-testid={`etax-submit-${inv.paymentId}`}
                                    >
                                      <Send className="size-3.5 mr-1.5" aria-hidden />
                                      ส่งให้สรรพากร
                                    </Button>
                                  )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {data.total > LIMIT && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-muted-foreground leading-snug">
                      หน้า {data.page} จาก {Math.ceil(data.total / LIMIT)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                      >
                        ก่อนหน้า
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= Math.ceil(data.total / LIMIT)}
                      >
                        ถัดไป
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </QueryBoundary>
      )}
    </div>
  );
}

export default ETaxInvoicePage;
