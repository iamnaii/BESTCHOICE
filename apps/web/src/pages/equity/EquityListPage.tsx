import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Landmark, Plus, Users, CalendarDays, Coins } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getErrorMessage } from '@/lib/api';
import { equityApi, STATUS_COLORS, STATUS_LABELS, TXN_TYPE_LABELS } from '@/lib/equity';
import type { EquityDocument, Shareholder } from '@/lib/equity.types';
import { formatThaiDateShort } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';

function docTotal(d: EquityDocument): number {
  if (d.txnType === 'PRIOR_ADJ') return parseFloat(d.paAmount ?? '0');
  return d.lines.reduce(
    (s, l) => s + parseFloat(l.amount) + (d.txnType === 'CAP_INC' ? parseFloat(l.premium) : 0),
    0,
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const SH_TYPE_LABELS: Record<string, string> = {
  INDIVIDUAL: 'บุคคลธรรมดา',
  JURISTIC_TH: 'นิติบุคคลไทย',
  JURISTIC_FOREIGN: 'นิติบุคคลต่างชาติ',
};

function ShareholdersTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['equity', 'shareholders'], queryFn: equityApi.shareholders });
  const [form, setForm] = useState({ name: '', taxId: '', shares: '', type: 'INDIVIDUAL' });
  const createMut = useMutation({
    mutationFn: () =>
      equityApi.createShareholder({
        name: form.name,
        taxId: form.taxId || undefined,
        shares: form.shares ? parseInt(form.shares, 10) : 0,
        type: form.type as Shareholder['type'],
      }),
    onSuccess: () => {
      toast.success('เพิ่มผู้ถือหุ้นแล้ว');
      setForm({ name: '', taxId: '', shares: '', type: 'INDIVIDUAL' });
      qc.invalidateQueries({ queryKey: ['equity', 'shareholders'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <input
              className="border border-border rounded-md px-3 py-2 text-sm bg-background md:col-span-2"
              placeholder="ชื่อผู้ถือหุ้น"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="border border-border rounded-md px-3 py-2 text-sm bg-background"
              placeholder="เลขผู้เสียภาษี"
              value={form.taxId}
              onChange={(e) => setForm({ ...form, taxId: e.target.value })}
            />
            <select
              className="border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              {Object.entries(SH_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <Button disabled={!form.name || createMut.isPending} onClick={() => createMut.mutate()}>
              <Plus className="h-4 w-4 mr-1" /> เพิ่ม
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                <th className="py-2">ชื่อ</th>
                <th>เลขผู้เสียภาษี</th>
                <th>ประเภท</th>
                <th className="text-right">หุ้น</th>
                <th className="text-right">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((s) => (
                <tr key={s.id} className="border-b border-border">
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="font-mono text-xs">{s.taxId ?? '—'}</td>
                  <td>{SH_TYPE_LABELS[s.type]}</td>
                  <td className="text-right font-mono">{s.shares.toLocaleString('th-TH')}</td>
                  <td className="text-right">{s.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                </tr>
              ))}
              {(q.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground leading-snug">
                    ยังไม่มีผู้ถือหุ้น — เพิ่มตาม บอจ.5
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </QueryBoundary>
  );
}

export default function EquityListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'docs' | 'shareholders'>('docs');
  const [statusFilter, setStatusFilter] = useState('');
  const listQuery = useQuery({
    queryKey: ['equity', 'list', { statusFilter }],
    queryFn: () => equityApi.list({ status: statusFilter || undefined, limit: 100 }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="ส่วนของผู้ถือหุ้น (Equity)"
        subtitle="เพิ่มทุน · ลดทุน · ปันผล · กรรมการถอนเงิน · ปรับปรุงย้อนหลัง"
        icon={<Landmark size={20} />}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/finance/dividend-register">
                <Coins className="h-4 w-4 mr-1" /> ทะเบียนปันผล
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/finance/year-end-closing">
                <CalendarDays className="h-4 w-4 mr-1" /> ปิดบัญชีสิ้นปี
              </Link>
            </Button>
            <Button onClick={() => navigate('/finance/equity/new')}>
              <Plus className="h-4 w-4 mr-1" /> บันทึกธุรกรรมใหม่
            </Button>
          </div>
        }
      />

      <div className="flex gap-1 border-b border-border">
        {(
          [
            ['docs', 'เอกสารธุรกรรม'],
            ['shareholders', 'ทะเบียนผู้ถือหุ้น'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px leading-snug ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {key === 'shareholders' && <Users className="h-4 w-4 inline mr-1" />}
            {label}
          </button>
        ))}
      </div>

      {tab === 'shareholders' ? (
        <ShareholdersTab />
      ) : (
        <QueryBoundary
          isLoading={listQuery.isLoading}
          isError={listQuery.isError}
          error={listQuery.error}
          onRetry={listQuery.refetch}
        >
          <Card>
            <CardContent className="pt-4">
              <div className="mb-3">
                <select
                  className="border border-border rounded-md px-3 py-2 text-sm bg-background"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">สถานะทั้งหมด</option>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                    <th className="py-2">เลขที่</th>
                    <th>วันที่</th>
                    <th>ประเภท</th>
                    <th>คำอธิบาย</th>
                    <th className="text-right">จำนวนเงิน</th>
                    <th className="text-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.data ?? []).map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-border hover:bg-accent cursor-pointer"
                      onClick={() => navigate(`/finance/equity/${d.id}`)}
                    >
                      <td className="py-2 font-mono text-xs font-semibold">{d.docNumber}</td>
                      <td>{formatThaiDateShort(d.txnDate)}</td>
                      <td>{TXN_TYPE_LABELS[d.txnType]}</td>
                      <td className="text-muted-foreground max-w-[280px] truncate leading-snug">
                        {d.description ?? '—'}
                      </td>
                      <td className="text-right font-mono">
                        {formatNumberDecimal(docTotal(d), 2)}
                      </td>
                      <td className="text-right">
                        <StatusBadge status={d.status} />
                      </td>
                    </tr>
                  ))}
                  {(listQuery.data?.data ?? []).length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-10 text-center text-muted-foreground leading-snug"
                      >
                        ยังไม่มีเอกสาร
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </QueryBoundary>
      )}
    </div>
  );
}
