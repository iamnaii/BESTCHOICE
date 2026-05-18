import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Loader2,
  Lock,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { THAI_MONTHS_FULL } from '@/lib/date';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountRow {
  code: string;
  name: string;
  balance: string;
}

interface OpenMonth {
  month: number;
  status: string;
}

interface PreviewResponse {
  year: number;
  revenues: AccountRow[];
  expenses: AccountRow[];
  revenueTotal: string;
  expenseTotal: string;
  netIncome: string;
  isProfit: boolean;
  totalSteps: number;
  alreadyClosed: boolean;
  closedAt: string | null;
  closingBatchId: string | null;
  openMonths: OpenMonth[];
}

interface PostResponse {
  year: number;
  batchId: string;
  step1: { entryNo: string; journalEntryId: string };
  step2: { entryNo: string; journalEntryId: string };
  step3: { entryNo: string; journalEntryId: string } | null;
  netIncome: string;
  revenueTotal: string;
  expenseTotal: string;
}

// ─── Formatters ─────────────────────────────────────────────────────────────

const fmtTHB = (s: string) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(s));

// ─── Reverse form schema ────────────────────────────────────────────────────

const reverseSchema = z.object({
  reason: z
    .string()
    .min(10, 'เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร')
    .max(500, 'เหตุผลยาวเกินไป (สูงสุด 500 ตัวอักษร)'),
});
type ReverseFormValues = z.infer<typeof reverseSchema>;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function YearEndClosingPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const defaultYear = currentYear - 1;

  const [year, setYear] = useState<number>(defaultYear);
  const [postConfirmOpen, setPostConfirmOpen] = useState(false);
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const [lastPosted, setLastPosted] = useState<PostResponse | null>(null);

  const isOwner = user?.role === 'OWNER';
  const canPost = isOwner || user?.role === 'ACCOUNTANT';

  // ─── Preview query (manual trigger via refetch) ─────────────────────────
  const previewQuery = useQuery<PreviewResponse>({
    queryKey: ['year-end-closing-preview', year],
    queryFn: async () => {
      const { data } = await api.post<PreviewResponse>(
        '/accounting/year-end-closing/preview',
        { year },
      );
      return data;
    },
    enabled: false, // user clicks "Preview" to trigger
  });

  const preview = previewQuery.data;

  // ─── Post mutation ─────────────────────────────────────────────────────
  const postMutation = useMutation<PostResponse, unknown, void>({
    mutationFn: async () => {
      const { data } = await api.post<PostResponse>('/accounting/year-end-closing', { year });
      return data;
    },
    onSuccess: (data) => {
      toast.success(`ปิดบัญชีปี ${year} เรียบร้อย — สร้าง JE 3 รายการ`);
      setLastPosted(data);
      queryClient.invalidateQueries({ queryKey: ['year-end-closing-preview', year] });
      void previewQuery.refetch();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ─── Reverse mutation ──────────────────────────────────────────────────
  const reverseMutation = useMutation<unknown, unknown, ReverseFormValues>({
    mutationFn: async (values) => {
      const { data } = await api.post('/accounting/year-end-closing/reverse', {
        year,
        reason: values.reason,
      });
      return data;
    },
    onSuccess: () => {
      toast.success(`กลับรายการปิดบัญชีปี ${year} เรียบร้อย`);
      setReverseDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['year-end-closing-preview', year] });
      void previewQuery.refetch();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ─── Reverse form ─────────────────────────────────────────────────────
  const reverseForm = useForm<ReverseFormValues>({
    resolver: standardSchemaResolver(reverseSchema),
    defaultValues: { reason: '' },
  });

  // ─── Year options (current - 6 ... current - 1) ───────────────────────
  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, i) => currentYear - 1 - i),
    [currentYear],
  );

  const isFutureYear = year >= currentYear;
  const blockPost = !canPost || isFutureYear || (preview?.openMonths.length ?? 0) > 0 || preview?.alreadyClosed === true;

  return (
    <>
      <PageHeader
        title="ปิดบัญชีสิ้นปี"
        subtitle="ปิดยอดรายได้/ค่าใช้จ่ายเข้า Income Summary (39-9999) แล้วโอนเข้ากำไรสะสม (33-1101)"
        icon={<CalendarCheck className="h-6 w-6" />}
      />

      <div className="space-y-6 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto pb-12">
        {/* Year selector + Preview */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold leading-snug">เลือกปีที่ต้องการปิดบัญชี</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label htmlFor="year-input" className="text-sm font-medium leading-snug">
                  ปี (ค.ศ.)
                </label>
                <div className="flex gap-2">
                  <select
                    id="year-input"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min={2020}
                    max={currentYear - 1}
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    className="w-28"
                    aria-label="ปีกำหนดเอง"
                  />
                </div>
              </div>
              <Button
                onClick={() => void previewQuery.refetch()}
                disabled={previewQuery.isFetching || isFutureYear}
              >
                {previewQuery.isFetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    กำลังคำนวณ...
                  </>
                ) : (
                  'ดูตัวอย่างการปิดบัญชี'
                )}
              </Button>
            </div>
            {isFutureYear && (
              <p className="text-sm text-destructive leading-snug">
                ไม่สามารถปิดบัญชีปี {year} ได้ — เลือกปีที่ผ่านมา (น้อยกว่า {currentYear})
              </p>
            )}
          </CardContent>
        </Card>

        <QueryBoundary
          isLoading={previewQuery.isLoading}
          isError={previewQuery.isError}
          error={previewQuery.error}
          onRetry={() => void previewQuery.refetch()}
        >
          {preview && (
            <>
              {/* Already closed banner */}
              {preview.alreadyClosed && (
                <Card className="border-success/40 bg-success/5">
                  <CardContent className="flex items-start gap-3 pt-6">
                    <Lock className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold leading-snug">
                        ปี {preview.year} ปิดบัญชีไปแล้ว
                      </p>
                      {preview.closedAt && (
                        <p className="text-sm text-muted-foreground leading-snug">
                          วันที่บันทึก: {new Date(preview.closedAt).toLocaleString('th-TH')}
                        </p>
                      )}
                      {preview.closingBatchId && (
                        <p className="text-xs text-muted-foreground leading-snug font-mono">
                          Batch ID: {preview.closingBatchId}
                        </p>
                      )}
                    </div>
                    {isOwner && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReverseDialogOpen(true)}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        กลับรายการ
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Open months warning */}
              {preview.openMonths.length > 0 && (
                <Card className="border-destructive/40 bg-destructive/5">
                  <CardContent className="flex items-start gap-3 pt-6">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-semibold leading-snug text-destructive">
                        ต้องปิดงวดบัญชีรายเดือนก่อนปิดบัญชีปี
                      </p>
                      <p className="text-sm text-muted-foreground leading-snug">
                        เดือนที่ยังไม่ปิด (สถานะ {preview.openMonths[0]?.status}):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {preview.openMonths.map((m) => (
                          <Badge key={m.month} variant="destructive" appearance="light">
                            {THAI_MONTHS_FULL[m.month - 1]}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug mt-2">
                        ไปที่หน้า{' '}
                        <a href="/monthly-close" className="text-primary underline">
                          ปิดบัญชีรายเดือน
                        </a>{' '}
                        เพื่อปิดงวดที่เหลือ
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Net Income summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="border-success/30">
                  <CardContent className="pt-6">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground leading-snug">
                      รายได้รวม
                    </p>
                    <p className="text-2xl font-bold leading-snug mt-1.5">
                      {fmtTHB(preview.revenueTotal)}
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug mt-1">
                      {preview.revenues.length} บัญชี
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-destructive/30">
                  <CardContent className="pt-6">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground leading-snug">
                      ค่าใช้จ่ายรวม
                    </p>
                    <p className="text-2xl font-bold leading-snug mt-1.5">
                      {fmtTHB(preview.expenseTotal)}
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug mt-1">
                      {preview.expenses.length} บัญชี
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className={
                    preview.isProfit ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5'
                  }
                >
                  <CardContent className="pt-6">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground leading-snug">
                      {preview.isProfit ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {preview.isProfit ? (
                        <TrendingUp className="h-5 w-5 text-success" />
                      ) : (
                        <TrendingDown className="h-5 w-5 text-destructive" />
                      )}
                      <p className="text-2xl font-bold leading-snug">{fmtTHB(preview.netIncome)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug mt-1">
                      โอนเข้า 33-1101 กำไรสะสม
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Account detail tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AccountTable
                  title="รายได้ (Cr → 39-9999)"
                  rows={preview.revenues}
                  total={preview.revenueTotal}
                  totalLabel="รวมรายได้"
                />
                <AccountTable
                  title="ค่าใช้จ่าย (39-9999 → Dr)"
                  rows={preview.expenses}
                  total={preview.expenseTotal}
                  totalLabel="รวมค่าใช้จ่าย"
                />
              </div>

              {/* Post action */}
              <Card>
                <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-snug">
                      จะสร้าง Journal Entry รวม {preview.totalSteps} รายการ
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug">
                      บันทึกวันที่ 31 ธันวาคม {preview.year} 23:59 — ไม่สามารถแก้ไขได้หลังบันทึก
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    disabled={blockPost || postMutation.isPending}
                    onClick={() => setPostConfirmOpen(true)}
                  >
                    {postMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        กำลังบันทึก...
                      </>
                    ) : (
                      <>
                        <Lock className="mr-2 h-4 w-4" />
                        ปิดบัญชีปี {preview.year}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Posted JE links */}
              {lastPosted && (
                <Card className="border-primary/40 bg-primary/5">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                      <h3 className="text-base font-semibold leading-snug">บันทึกเรียบร้อย</h3>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5 text-sm">
                      <li>
                        <span className="text-muted-foreground">Step 1 (รายได้):</span>{' '}
                        <span className="font-mono font-medium">{lastPosted.step1.entryNo}</span>
                      </li>
                      <li>
                        <span className="text-muted-foreground">Step 2 (ค่าใช้จ่าย):</span>{' '}
                        <span className="font-mono font-medium">{lastPosted.step2.entryNo}</span>
                      </li>
                      {lastPosted.step3 && (
                        <li>
                          <span className="text-muted-foreground">Step 3 (โอน 33-1101):</span>{' '}
                          <span className="font-mono font-medium">{lastPosted.step3.entryNo}</span>
                        </li>
                      )}
                      <li className="pt-2 text-xs text-muted-foreground font-mono">
                        Batch ID: {lastPosted.batchId}
                      </li>
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </QueryBoundary>
      </div>

      {/* Post confirmation */}
      <ConfirmDialog
        open={postConfirmOpen}
        onOpenChange={setPostConfirmOpen}
        title={`ยืนยันการปิดบัญชีปี ${year}`}
        description={`การปิดบัญชีจะสร้าง JE ${preview?.totalSteps ?? 3} รายการ และไม่สามารถแก้ไขได้ — เฉพาะ OWNER เท่านั้นที่กลับรายการได้`}
        confirmLabel={`ปิดบัญชีปี ${year}`}
        cancelLabel="ยกเลิก"
        variant="destructive"
        loading={postMutation.isPending}
        onConfirm={() => postMutation.mutate()}
      />

      {/* Reverse dialog (OWNER) */}
      <Dialog open={reverseDialogOpen} onOpenChange={setReverseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>กลับรายการปิดบัญชีปี {year}</DialogTitle>
            <DialogDescription className="leading-snug">
              จะสร้าง JE กลับรายการตรงข้ามทั้ง 3 รายการ — รายการเดิมจะคงอยู่เพื่อ audit trail
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={reverseForm.handleSubmit((values) => reverseMutation.mutate(values))}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <label htmlFor="reverse-reason" className="text-sm font-medium leading-snug">
                เหตุผล (อย่างน้อย 10 ตัวอักษร)
              </label>
              <Textarea
                id="reverse-reason"
                rows={4}
                placeholder="ระบุเหตุผลการกลับรายการอย่างละเอียด..."
                {...reverseForm.register('reason')}
                disabled={reverseMutation.isPending}
              />
              {reverseForm.formState.errors.reason && (
                <p className="text-xs text-destructive leading-snug">
                  {reverseForm.formState.errors.reason.message}
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReverseDialogOpen(false)}
                disabled={reverseMutation.isPending}
              >
                ยกเลิก
              </Button>
              <Button type="submit" variant="destructive" disabled={reverseMutation.isPending}>
                {reverseMutation.isPending ? 'กำลังกลับรายการ...' : 'ยืนยันกลับรายการ'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Account Table ──────────────────────────────────────────────────────────

function AccountTable({
  title,
  rows,
  total,
  totalLabel,
}: {
  title: string;
  rows: AccountRow[];
  total: string;
  totalLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <h3 className="text-sm font-semibold leading-snug">{title}</h3>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-snug">ไม่มีรายการ</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 font-medium">รหัส</th>
                  <th className="py-2 font-medium">ชื่อบัญชี</th>
                  <th className="py-2 font-medium text-right">ยอดสุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-b border-border/40">
                    <td className="py-1.5 font-mono text-xs">{r.code}</td>
                    <td className="py-1.5 leading-snug">{r.name}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{fmtTHB(r.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="py-2" />
                  <td className="py-2 leading-snug">{totalLabel}</td>
                  <td className="py-2 text-right tabular-nums">{fmtTHB(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
