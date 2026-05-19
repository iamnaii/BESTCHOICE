/**
 * ETaxPage — e-Tax Invoice document center (SP2 frontend)
 *
 * Uses the existing /e-tax/invoices endpoint (Phase 2-SP5).
 * Requires companyId + year + month selection before data loads.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import CompanyFilter from '@/components/CompanyFilter';
import { formatNumberDecimal, formatDateMedium } from '@/utils/formatters';
import { FileText, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface ETaxInvoice {
  paymentId: string;
  paidDate: string | Date | null;
  installmentNo: number;
  contractNumber: string;
  customerName: string;
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

interface ETaxSubmission {
  id: string;
  paymentId: string;
  status: 'PENDING' | 'SIGNED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
  rdSubmissionId: string | null;
  rejectReason: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'รอเซ็น',
  SIGNED: 'รอส่ง',
  SUBMITTED: 'ส่งแล้ว',
  ACCEPTED: 'สรรพากรรับ',
  REJECTED: 'ปฏิเสธ',
  ERROR: 'ข้อผิดพลาด',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  SIGNED: 'bg-blue-500/15 text-blue-700',
  SUBMITTED: 'bg-amber-500/15 text-amber-700',
  ACCEPTED: 'bg-emerald-500/15 text-emerald-700',
  REJECTED: 'bg-red-500/15 text-red-700',
  ERROR: 'bg-red-500/15 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'bg-muted text-muted-foreground';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export default function ETaxPage() {
  const now = new Date();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const enabled = Boolean(companyId);

  const invoicesQuery = useQuery<ETaxListResponse>({
    queryKey: ['e-tax-finance', 'invoices', companyId, year, month],
    enabled,
    queryFn: () =>
      api
        .get<ETaxListResponse>(
          `/e-tax/invoices?companyId=${encodeURIComponent(companyId)}&year=${year}&month=${month}&limit=200`,
        )
        .then((r) => r.data),
  });

  const submissionsQuery = useQuery<{ data: ETaxSubmission[] }>({
    queryKey: ['e-tax-finance', 'submissions'],
    enabled,
    queryFn: () =>
      api.get<{ data: ETaxSubmission[] }>('/e-tax-xml?limit=500').then((r) => r.data),
  });

  const submissionsByPayment = new Map<string, ETaxSubmission>();
  for (const s of submissionsQuery.data?.data ?? []) {
    submissionsByPayment.set(s.paymentId, s);
  }

  const generateMutation = useMutation({
    mutationFn: (paymentId: string) =>
      api.post(`/e-tax-xml/generate/${paymentId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('สร้าง XML สำเร็จ');
      qc.invalidateQueries({ queryKey: ['e-tax-finance', 'submissions'] });
    },
    onError: (e: Error) => toast.error(e.message ?? 'สร้าง XML ล้มเหลว'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="e-Tax Invoice — Document Center"
        icon={<FileText className="size-5" />}
      />
      <Card>
        <CardHeader className="flex flex-row gap-3 items-center flex-wrap pb-4">
          <CompanyFilter value={companyId} onChange={setCompanyId} />
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[year - 2, year - 1, year, year + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y + 543}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  เดือน {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {!companyId ? (
            <div className="text-center text-muted-foreground py-12">
              กรุณาเลือกบริษัทเพื่อดูรายการ e-Tax Invoice
            </div>
          ) : (
            <QueryBoundary
              isLoading={invoicesQuery.isLoading}
              isError={invoicesQuery.isError}
              error={invoicesQuery.error}
              onRetry={invoicesQuery.refetch}
            >
              {invoicesQuery.data && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead>สัญญา</TableHead>
                      <TableHead>งวด</TableHead>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead className="text-right">ก่อน VAT (฿)</TableHead>
                      <TableHead className="text-right">VAT (฿)</TableHead>
                      <TableHead className="text-right">รวม (฿)</TableHead>
                      <TableHead className="text-center">สถานะ XML</TableHead>
                      <TableHead className="text-center">การกระทำ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoicesQuery.data.data.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="text-center text-muted-foreground py-10"
                        >
                          ไม่มีรายการในงวดที่เลือก
                        </TableCell>
                      </TableRow>
                    ) : (
                      invoicesQuery.data.data.map((inv) => {
                        const sub = submissionsByPayment.get(inv.paymentId);
                        const isFailed = sub?.status === 'REJECTED' || sub?.status === 'ERROR';
                        return (
                          <TableRow key={inv.paymentId}>
                            <TableCell>
                              {inv.paidDate ? formatDateMedium(String(inv.paidDate)) : '—'}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {inv.contractNumber}
                            </TableCell>
                            <TableCell className="text-center">{inv.installmentNo}</TableCell>
                            <TableCell className="text-sm leading-snug">
                              {inv.customerName}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatNumberDecimal(Number(inv.amountBeforeVat), 2)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatNumberDecimal(Number(inv.vatAmount), 2)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {formatNumberDecimal(Number(inv.total), 2)}
                            </TableCell>
                            <TableCell className="text-center">
                              {sub ? <StatusBadge status={sub.status} /> : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="flex items-center justify-center gap-1">
                                {sub?.status === 'ACCEPTED' && (
                                  <Button variant="outline" size="sm" asChild>
                                    <a
                                      href={`/api/e-tax/invoices/${inv.paymentId}/pdf`}
                                      target="_blank"
                                      rel="noreferrer"
                                      aria-label="ดาวน์โหลด PDF"
                                    >
                                      <Download className="size-4" />
                                    </a>
                                  </Button>
                                )}
                                {(isFailed || !sub) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => generateMutation.mutate(inv.paymentId)}
                                    disabled={generateMutation.isPending}
                                    aria-label="สร้าง XML ใหม่"
                                  >
                                    <RefreshCw className="size-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </QueryBoundary>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
