import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { CashAccountVisualPicker } from '@/components/expense-form-v4/CashAccountVisualPicker';
import { CASH_ACCOUNT_CODES, SHOP_CASH_ACCOUNT_CODES } from '@/components/CashAccountSelect';
import { useAuth } from '@/contexts/AuthContext';
import { formatNumberDecimal } from '@/utils/formatters';
import { ShieldCheck, Download, Send } from 'lucide-react';

/**
 * สปส.1-10 — เงินสมทบประกันสังคมรายเดือน (payroll round 2, 2026-08-06).
 * นิติบุคคลเดียว ยื่นรวมทุกสาขา/ทุกฝั่ง; การนำส่ง (JE) แยกตามสมุด SHOP/FINANCE
 * (design D1 — แต่ละฝั่งจ่ายจากธนาคารของตัวเอง).
 */

interface SsoItem {
  scope: 'SHOP' | 'FINANCE';
  employeeName: string;
  employeeTaxId: string | null;
  wage: string;
  ssoEmployee: string;
  ssoEmployer: string;
  payrollDocNumber: string;
}

interface ScopeTotal {
  count: number;
  employeeTotal: string;
  employerTotal: string;
  grandTotal: string;
}

interface SsoPreview {
  periodKey: string;
  items: SsoItem[];
  count: number;
  employeeTotal: string;
  employerTotal: string;
  grandTotal: string;
  perScope: { shop: ScopeTotal; finance: ScopeTotal };
}

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

export default function SsoReportPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [remitScope, setRemitScope] = useState<'SHOP' | 'FINANCE' | null>(null);
  const [depositAccountCode, setDepositAccountCode] = useState('');
  const [payDate, setPayDate] = useState(todayIso());

  const period = `${year}-${String(month).padStart(2, '0')}`;
  const canRemit = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const query = useQuery({
    queryKey: ['sso-1-10', year, month],
    queryFn: () =>
      api
        .get<SsoPreview>(`/tax/sso-1-10-preview?year=${year}&month=${month}`)
        .then((r) => r.data),
  });

  const remitMutation = useMutation({
    mutationFn: async () => {
      if (!remitScope) throw new Error('ไม่ได้เลือกฝั่ง');
      const { data } = await api.post('/tax/payroll-remit/sso', {
        scope: remitScope,
        period,
        depositAccountCode,
        payDate,
      });
      return data as { entryNo: string; total: string };
    },
    onSuccess: (data) => {
      toast.success(`นำส่ง ปกส. สำเร็จ — ${data.entryNo} (${formatNumberDecimal(parseFloat(data.total), 2)} ฿)`);
      setRemitScope(null);
      queryClient.invalidateQueries({ queryKey: ['sso-1-10'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const openRemit = (scope: 'SHOP' | 'FINANCE') => {
    setRemitScope(scope);
    setDepositAccountCode(scope === 'SHOP' ? 'S11-1202' : '11-1201');
    setPayDate(todayIso());
  };

  const downloadXlsx = async () => {
    try {
      const res = await api.get(`/tax/export-xlsx?form=SSO110&year=${year}&month=${month}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SSO110-${period}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const data = query.data;
  const scopeCard = (label: string, scope: 'SHOP' | 'FINANCE', t?: ScopeTotal) => (
    <Card>
      <CardContent className="pt-4 space-y-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold font-mono tabular-nums">
          {formatNumberDecimal(parseFloat(t?.grandTotal ?? '0'), 2)} ฿
        </div>
        <div className="text-xs text-muted-foreground leading-snug">
          ผู้ประกันตน {t?.count ?? 0} คน · ลูกจ้าง{' '}
          {formatNumberDecimal(parseFloat(t?.employeeTotal ?? '0'), 2)} + นายจ้าง{' '}
          {formatNumberDecimal(parseFloat(t?.employerTotal ?? '0'), 2)}
        </div>
        {canRemit && parseFloat(t?.grandTotal ?? '0') > 0 && (
          <Button size="sm" className="mt-2 gap-1.5" onClick={() => openRemit(scope)}>
            <Send className="size-3.5" /> นำส่งฝั่ง {scope}
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="ประกันสังคม (สปส.1-10) — รายเดือน"
        icon={<ShieldCheck className="size-5" />}
      />
      <Card>
        <CardHeader className="flex flex-row gap-3 items-center flex-wrap pb-4">
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
          <Button variant="outline" size="sm" className="gap-1.5 ml-auto" onClick={downloadXlsx}>
            <Download className="size-3.5" /> ดาวน์โหลด Excel
          </Button>
        </CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={query.refetch}
          >
            {data && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Card>
                    <CardContent className="pt-4 space-y-1">
                      <div className="text-xs text-muted-foreground">รวมนำส่งทั้งบริษัท</div>
                      <div className="text-lg font-semibold font-mono tabular-nums text-primary">
                        {formatNumberDecimal(parseFloat(data.grandTotal), 2)} ฿
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ผู้ประกันตน {data.count} คน
                      </div>
                    </CardContent>
                  </Card>
                  {scopeCard('ฝั่งหน้าร้าน (SHOP)', 'SHOP', data.perScope.shop)}
                  {scopeCard('ฝั่งส่วนกลาง (FINANCE)', 'FINANCE', data.perScope.finance)}
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>ชื่อผู้ประกันตน</TableHead>
                      <TableHead>เลขบัตรประชาชน</TableHead>
                      <TableHead className="text-right">ค่าจ้าง</TableHead>
                      <TableHead className="text-right">สมทบลูกจ้าง</TableHead>
                      <TableHead className="text-right">สมทบนายจ้าง</TableHead>
                      <TableHead>ฝั่ง</TableHead>
                      <TableHead>เอกสาร</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          ไม่มีใบเงินเดือนที่ POST แล้วในงวดนี้
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.items.map((it, i) => (
                        <TableRow key={i}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="leading-snug">{it.employeeName}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {it.employeeTaxId ?? '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumberDecimal(parseFloat(it.wage), 2)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumberDecimal(parseFloat(it.ssoEmployee), 2)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatNumberDecimal(parseFloat(it.ssoEmployer), 2)}
                          </TableCell>
                          <TableCell className="text-xs">{it.scope}</TableCell>
                          <TableCell className="font-mono text-xs">{it.payrollDocNumber}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>

      <Dialog open={remitScope !== null} onOpenChange={(o) => !o && setRemitScope(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              นำส่งเงินสมทบ ปกส. งวด {period} — ฝั่ง {remitScope}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-snug">
              ระบบจะลงบัญชีล้างเจ้าหนี้เงินสมทบ (ลูกจ้าง + นายจ้าง) และตัดเงินจากบัญชีที่เลือก
              — ยอดคำนวณจากใบเงินเดือนที่ POST แล้วของงวดนี้เท่านั้น
            </p>
            <div>
              <label className="block text-xs font-medium mb-1">จ่ายจากบัญชี</label>
              <CashAccountVisualPicker
                value={depositAccountCode}
                onChange={setDepositAccountCode}
                codes={remitScope === 'SHOP' ? SHOP_CASH_ACCOUNT_CODES : CASH_ACCOUNT_CODES}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">วันที่จ่าย</label>
              <ThaiDateInput
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemitScope(null)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => remitMutation.mutate()}
              disabled={remitMutation.isPending || !depositAccountCode}
            >
              ยืนยันนำส่ง
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
