import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { formatDateShort } from '@/utils/formatters';
import { exportToExcel } from '@/utils/excel.util';
import { Download } from 'lucide-react';

interface OverduePayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  status: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
}

interface CallLog {
  id: string;
  callDate: string;
  result: string;
  notes: string;
  calledBy: { name: string };
}

interface TimelineEvent {
  date: string;
  type: string;
  description: string;
}

export default function OverduePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwnerOrManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const isOwner = user?.role === 'OWNER';
  const [filter, setFilter] = useState<'OVERDUE' | 'all'>('OVERDUE');
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [dunningFilter, setDunningFilter] = useState('');
  const debouncedSearch = useDebounce(searchTerm);
  const [timelineContractId, setTimelineContractId] = useState<string | null>(null);
  const [callLogForm, setCallLogForm] = useState({ result: 'NO_ANSWER', notes: '' });

  // Branches list for filter (OWNER only)
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
    enabled: isOwner,
  });

  const { data: overduePayments = [], isLoading } = useQuery<OverduePayment[]>({
    queryKey: ['overdue-payments', filter, debouncedSearch, branchFilter, dunningFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchFilter) params.set('branchId', branchFilter);
      if (dunningFilter) params.set('dunningStage', dunningFilter);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data.data;
    },
  });

  const runCronMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/overdue/cron/run-daily');
      return data;
    },
    onSuccess: (data) => {
      toast.success(`คำนวณค่าปรับเสร็จ: ${data.lateFees.updated} รายการ, สถานะ: ${data.statuses.overdueCount} OVERDUE, ${data.statuses.defaultCount} DEFAULT`);
      queryClient.invalidateQueries({ queryKey: ['overdue-payments'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const calcLateFeeMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post('/overdue/cron/calculate-late-fees'); return data; },
    onSuccess: () => { toast.success('คำนวณค่าปรับสำเร็จ'); queryClient.invalidateQueries({ queryKey: ['overdue-payments'] }); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post('/overdue/cron/update-statuses'); return data; },
    onSuccess: () => { toast.success('อัปเดตสถานะสัญญาสำเร็จ'); queryClient.invalidateQueries({ queryKey: ['overdue-payments'] }); },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const { data: timeline = [] } = useQuery<TimelineEvent[]>({
    queryKey: ['overdue-timeline', timelineContractId],
    queryFn: async () => { const { data } = await api.get(`/overdue/contracts/${timelineContractId}/timeline`); return data; },
    enabled: !!timelineContractId,
  });

  const { data: callLogs = [] } = useQuery<CallLog[]>({
    queryKey: ['overdue-call-logs', timelineContractId],
    queryFn: async () => { const { data } = await api.get(`/overdue/contracts/${timelineContractId}/call-logs`); return data.data; },
    enabled: !!timelineContractId,
  });

  const addCallLogMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/overdue/call-logs', {
        contractId: timelineContractId,
        ...callLogForm,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการโทรสำเร็จ');
      setCallLogForm({ result: 'NO_ANSWER', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['overdue-call-logs', timelineContractId] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Calculate summary stats (memoized to avoid recomputing on every render)
  const { totalLateFees, totalOutstanding, uniqueContracts } = useMemo(() => ({
    totalLateFees: overduePayments.reduce((sum, p) => { const v = parseFloat(p.lateFee); return sum + (isNaN(v) ? 0 : v); }, 0),
    totalOutstanding: overduePayments.reduce((sum, p) => { const due = parseFloat(p.amountDue); const paid = parseFloat(p.amountPaid); return sum + ((isNaN(due) ? 0 : due) - (isNaN(paid) ? 0 : paid)); }, 0),
    uniqueContracts: new Set(overduePayments.map((p) => p.contract.id)).size,
  }), [overduePayments]);

  const navigateToContract = useCallback((id: string) => navigate(`/contracts/${id}`), [navigate]);

  const columns = useMemo(() => [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (p: OverduePayment) => (
        <button onClick={() => navigateToContract(p.contract.id)} className="text-left">
          <div className="font-mono text-sm text-primary hover:underline">{p.contract.contractNumber}</div>
          <div className="text-xs text-muted-foreground">{p.contract.customer.name}</div>
        </button>
      ),
    },
    {
      key: 'customer',
      label: 'เบอร์โทร',
      render: (p: OverduePayment) => <span className="text-sm">{p.contract.customer.phone}</span>,
    },
    {
      key: 'installmentNo',
      label: 'งวดที่',
      render: (p: OverduePayment) => <span className="font-medium">{p.installmentNo}</span>,
    },
    {
      key: 'dueDate',
      label: 'วันครบกำหนด',
      render: (p: OverduePayment) => {
        const due = new Date(p.dueDate);
        const now = new Date();
        const daysLate = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        return (
          <div>
            <div className="text-sm">{formatDateShort(due)}</div>
            {daysLate > 0 && <div className="text-xs text-destructive font-medium">เกินกำหนด {daysLate} วัน</div>}
          </div>
        );
      },
    },
    {
      key: 'amountDue',
      label: 'ยอดค้าง',
      render: (p: OverduePayment) => {
        const outstanding = parseFloat(p.amountDue) - parseFloat(p.amountPaid);
        return <span className="text-sm font-medium">{outstanding.toLocaleString()} ฿</span>;
      },
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: OverduePayment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? (
          <span className="text-sm font-medium text-destructive">{fee.toLocaleString()} ฿</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        );
      },
    },
    {
      key: 'total',
      label: 'ยอดรวม',
      render: (p: OverduePayment) => {
        const total = (parseFloat(p.amountDue) || 0) + (parseFloat(p.lateFee) || 0) - (parseFloat(p.amountPaid) || 0);
        return <span className="text-sm font-bold text-destructive">{total.toLocaleString()} ฿</span>;
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: OverduePayment) => <span className="text-xs">{p.contract.branch.name}</span>,
    },
    {
      key: 'actions',
      label: '',
      render: (p: OverduePayment) => (
        <button
          onClick={() => setTimelineContractId(p.contract.id)}
          className="text-primary hover:text-primary/80 text-xs font-medium"
        >
          ติดตาม
        </button>
      ),
    },
  ], [navigateToContract]);

  return (
    <div>
      <PageHeader
        title="ค่าปรับ & ค้างชำระ"
        subtitle="ระบบคำนวณค่าปรับล่าช้าและติดตามการค้างชำระ"
        action={
          isOwnerOrManager && (
            <div className="flex gap-2">
              <button
                onClick={() => calcLateFeeMutation.mutate()}
                disabled={calcLateFeeMutation.isPending}
                className="px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted disabled:opacity-50"
              >
                {calcLateFeeMutation.isPending ? 'กำลัง...' : 'คำนวณค่าปรับ'}
              </button>
              <button
                onClick={() => updateStatusMutation.mutate()}
                disabled={updateStatusMutation.isPending}
                className="px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted disabled:opacity-50"
              >
                {updateStatusMutation.isPending ? 'กำลัง...' : 'อัปเดตสถานะ'}
              </button>
              <button
                onClick={() => runCronMutation.mutate()}
                disabled={runCronMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {runCronMutation.isPending ? 'กำลังคำนวณ...' : 'คำนวณค่าปรับ'}
              </button>
            </div>
          )
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 lg:gap-5 mb-6">
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-destructive">
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สัญญาค้างชำระ</div>
            <div className="text-2xl font-bold text-destructive">{uniqueContracts}</div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">รายการค้างชำระ</div>
            <div className="text-2xl font-bold">{overduePayments.length}</div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ยอดค้างรวม</div>
            <div className="text-2xl font-bold">{totalOutstanding.toLocaleString()} ฿</div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-card-hover transition-all border-l-[3px] border-l-destructive">
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ค่าปรับรวม</div>
            <div className="text-2xl font-bold text-destructive">{totalLateFees.toLocaleString()} ฿</div>
          </CardContent>
        </Card>
      </div>

      {/* Dunning Workflow Pipeline */}
      <Card className="shadow-card mb-6">
        <CardContent className="p-4">
          <div className="text-xs font-medium text-muted-foreground mb-3">ขั้นตอนติดตามหนี้</div>
          <div className="flex items-center gap-2 overflow-x-auto">
            {[
              { stage: 'REMINDER', label: 'แจ้งเตือน', color: 'bg-warning/10 text-warning border-warning/30', desc: '1-7 วัน' },
              { stage: 'NOTICE', label: 'แจ้งค้างชำระ', color: 'bg-warning/10 text-warning border-warning/30', desc: '8-30 วัน' },
              { stage: 'FINAL_WARNING', label: 'เตือนครั้งสุดท้าย', color: 'bg-destructive/10 text-destructive border-destructive/30', desc: '31-60 วัน' },
              { stage: 'LEGAL_ACTION', label: 'ดำเนินคดี', color: 'bg-destructive/20 text-destructive border-destructive/50', desc: '>60 วัน' },
            ].map((s, i) => (
              <div key={s.stage} className="flex items-center gap-2">
                {i > 0 && <div className="text-muted-foreground">→</div>}
                <div className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${s.color}`}>
                  <div>{s.label}</div>
                  <div className="text-[10px] opacity-70">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Info box */}
      <div className="bg-warning/5 dark:bg-warning/10 border border-warning/20 rounded-lg p-4 mb-4">
        <div className="text-sm text-warning">
          <strong>กฎค่าปรับ:</strong> 100 บาท/วัน สูงสุด 200 บาท/งวด |
          ค้าง &gt; 7 วัน → สถานะ OVERDUE |
          ค้าง 2 งวดติดต่อกัน → สถานะ DEFAULT
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="ค้นหาเลขสัญญา, ชื่อลูกค้า..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm min-w-[250px] focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus:border-transparent"
        />
        {overduePayments.length > 0 && (
          <button
            onClick={async () => {
              try {
                await exportToExcel({
                  columns: [
                    { header: 'เลขสัญญา', key: 'contractNumber', width: 15 },
                    { header: 'ลูกค้า', key: 'customer', width: 20 },
                    { header: 'เบอร์โทร', key: 'phone', width: 15 },
                    { header: 'งวดที่', key: 'installmentNo', width: 10 },
                    { header: 'ยอดค้าง', key: 'outstanding', width: 15 },
                    { header: 'ค่าปรับ', key: 'lateFee', width: 15 },
                    { header: 'วันครบกำหนด', key: 'dueDate', width: 15 },
                    { header: 'จำนวนวันเลย', key: 'daysLate', width: 15 },
                  ],
                  data: overduePayments.map((p) => {
                    const due = new Date(p.dueDate);
                    const now = new Date();
                    const daysLate = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
                    return {
                      contractNumber: p.contract.contractNumber,
                      customer: p.contract.customer.name,
                      phone: p.contract.customer.phone,
                      installmentNo: p.installmentNo,
                      outstanding: (parseFloat(p.amountDue) - parseFloat(p.amountPaid)).toLocaleString(),
                      lateFee: parseFloat(p.lateFee).toLocaleString(),
                      dueDate: formatDateShort(due),
                      daysLate,
                    };
                  }),
                  sheetName: 'ค้างชำระ',
                  filename: `overdue_${new Date().toISOString().slice(0, 10)}.xlsx`,
                });
                toast.success('ส่งออก Excel สำเร็จ');
              } catch {
                toast.error('ไม่สามารถส่งออก Excel ได้');
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
          >
            <Download className="size-4" />
            ส่งออก Excel
          </button>
        )}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'OVERDUE' | 'all')}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        >
          <option value="OVERDUE">เฉพาะเกินกำหนด</option>
          <option value="all">ทั้งหมด</option>
        </select>
        {isOwner && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <select
          value={dunningFilter}
          onChange={(e) => setDunningFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm"
        >
          <option value="">ทุกระดับติดตาม</option>
          <option value="NONE">ปกติ</option>
          <option value="REMINDER">แจ้งเตือน (1-7 วัน)</option>
          <option value="NOTICE">แจ้งค้างชำระ (8-30 วัน)</option>
          <option value="FINAL_WARNING">เตือนสุดท้าย (31-60 วัน)</option>
          <option value="LEGAL_ACTION">ดำเนินคดี (&gt;60 วัน)</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
      ) : (
        <DataTable columns={columns} data={overduePayments} emptyMessage="ไม่มีรายการค้างชำระ" />
      )}

      {/* Timeline & Call Logs Drawer */}
      {timelineContractId && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setTimelineContractId(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-md bg-background shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">ติดตามหนี้</h3>
              <button onClick={() => setTimelineContractId(null)} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
            </div>
            <div className="p-4 space-y-6">
              {/* Timeline */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Timeline</h4>
                {timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">ยังไม่มีข้อมูล</p>
                ) : (
                  <div className="space-y-2">
                    {timeline.map((e, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <div className="text-xs text-muted-foreground whitespace-nowrap">{formatDateShort(e.date)}</div>
                        <div>
                          <div className="font-medium">{e.type}</div>
                          <div className="text-xs text-muted-foreground">{e.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Call Logs */}
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">ประวัติการโทร</h4>
                {callLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">ยังไม่มีประวัติการโทร</p>
                ) : (
                  <div className="space-y-2">
                    {callLogs.map((log) => (
                      <div key={log.id} className="border rounded-lg p-2 text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">{log.result}</span>
                          <span className="text-xs text-muted-foreground">{formatDateShort(log.callDate)}</span>
                        </div>
                        {log.notes && <div className="text-xs text-muted-foreground mt-1">{log.notes}</div>}
                        <div className="text-xs text-muted-foreground">โดย {log.calledBy.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Call Log Form */}
              <div className="border-t pt-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">บันทึกการโทร</h4>
                <div className="space-y-2">
                  <select
                    value={callLogForm.result}
                    onChange={(e) => setCallLogForm({ ...callLogForm, result: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="NO_ANSWER">ไม่รับสาย</option>
                    <option value="PROMISED_TO_PAY">สัญญาจะชำระ</option>
                    <option value="REFUSED">ปฏิเสธ</option>
                    <option value="WRONG_NUMBER">เบอร์ผิด</option>
                    <option value="OTHER">อื่นๆ</option>
                  </select>
                  <textarea
                    value={callLogForm.notes}
                    onChange={(e) => setCallLogForm({ ...callLogForm, notes: e.target.value })}
                    placeholder="หมายเหตุ..."
                    rows={2}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                  <button
                    onClick={() => addCallLogMutation.mutate()}
                    disabled={addCallLogMutation.isPending}
                    className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    {addCallLogMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการโทร'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
