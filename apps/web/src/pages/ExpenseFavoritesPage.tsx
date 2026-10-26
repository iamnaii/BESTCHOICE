import { NativeSelect } from '@/components/ui/native-select';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Bookmark, Plus, Trash2, Repeat, ArrowLeft, CalendarClock, Pencil } from 'lucide-react';
import { RecurringBillDialog, type ExpenseTemplate } from '@/components/expense-templates/RecurringBillDialog';
import { billMonthKey, recurringCardLine } from '@/components/expense-templates/recurring-template.util';
import { formatNumberDecimal } from '@/utils/formatters';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useUiFlags } from '@/hooks/useUiFlags';

type Template = ExpenseTemplate;

const typeLabels: Record<Template['documentType'], { label: string; cls: string }> = {
  EXPENSE: { label: 'รายจ่าย', cls: 'bg-success/10 text-success border-success/20' },
  CREDIT_NOTE: {
    label: 'ใบลดหนี้',
    cls: 'bg-destructive/10 text-destructive border-destructive/20',
  },
  PAYROLL: { label: 'เงินเดือน', cls: 'bg-info/10 text-info border-info/20' },
  VENDOR_SETTLEMENT: {
    label: 'จ่ายเจ้าหนี้',
    cls: 'bg-muted text-muted-foreground border-border',
  },
};

export default function ExpenseFavoritesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // D1.2.4 follow-up — feature flags drive availability + quota display.
  const { templatesEnabled, maxTemplatesPerUser } = useUiFlags();
  // If OWNER kills the feature mid-session, route the user out instead of
  // showing a half-functional page.
  useEffect(() => {
    if (!templatesEnabled) navigate('/expenses', { replace: true });
  }, [templatesEnabled, navigate]);
  const [filterType, setFilterType] = useState<string>('');
  // ก้อน 6 — กล่องตั้ง/แก้ไขบิลประจำ (template null = ตั้งใหม่)
  const [billDialog, setBillDialog] = useState<{ open: boolean; template: ExpenseTemplate | null }>({ open: false, template: null });
  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    id: string;
    name: string;
  }>({ open: false, id: '', name: '' });

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['expense-templates', filterType],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (filterType) p.set('type', filterType);
      return (await api.get(`/expense-templates?${p}`)).data;
    },
  });

  // โควต้า max_templates_per_user นับเฉพาะแม่แบบธรรมดา — บิลประจำไม่นับ (สเปก §13 ข้อ 5)
  const quotaUsed = templates.filter((t) => !t.isRecurring).length;
  const now = new Date();

  const instantiateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/expense-templates/${id}/instantiate`);
      return data;
    },
    onSuccess: () => {
      toast.success("สร้างเอกสารร่างจาก แม่แบบสำเร็จ");
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      navigate('/expenses');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/expense-templates/${id}`),
    onSuccess: () => {
      toast.success("ลบแม่แบบสำเร็จ");
      queryClient.invalidateQueries({ queryKey: ['expense-templates'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/expenses')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h1 className="text-base font-semibold">
            รายการโปรด{' '}
            <span
              className={
                quotaUsed >= maxTemplatesPerUser
                  ? 'text-destructive font-mono'
                  : 'text-muted-foreground font-mono font-normal'
              }
              title={
                quotaUsed >= maxTemplatesPerUser
                  ? `เต็มโควต้า ${maxTemplatesPerUser} รายการแล้ว — ลบเก่าก่อนสร้างใหม่`
                  : `${quotaUsed} / ${maxTemplatesPerUser} (บิลประจำไม่นับโควต้า)`
              }
            >
              ({quotaUsed}/{maxTemplatesPerUser})
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect wrapperClassName="max-w-full w-auto" aria-label="ประเภทเอกสาร"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm bg-background"
          >
            <option value="">ทุกประเภท</option>
            <option value="EXPENSE">รายจ่าย</option>
            <option value="PAYROLL">เงินเดือน</option>
            <option value="VENDOR_SETTLEMENT">จ่ายเจ้าหนี้</option>
          </NativeSelect>
          <Button variant="outline" size="sm" onClick={() => navigate('/expenses/recurring-bills')}>
            <CalendarClock className="size-3.5" aria-hidden="true" />บิลประจำเดือนนี้
          </Button>
          <Button variant="primary" size="sm" onClick={() => setBillDialog({ open: true, template: null })}>+ บิลประจำ</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">กำลังโหลด...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          ยังไม่มีรายการโปรด — บันทึกจากแบบฟอร์มสร้างเอกสารโดยติ๊ก "บันทึกเป็นรายการโปรด"
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => {
            const t = typeLabels[tpl.documentType];
            const vendor = tpl.prefilledData.vendorName as string | undefined;
            const recurringLine = tpl.isRecurring ? recurringCardLine(tpl, now) : null;
            const amount = tpl.prefilledData.sampleAmount;
            const category = tpl.prefilledData.category as string | undefined;
            const nextMonth = tpl.isRecurring ? billMonthKey(tpl, now) : null;
            return (
              <article
                key={tpl.id}
                aria-label={tpl.name}
                className="rounded-xl border border-border bg-card p-4 hover:shadow-card-hover transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    {tpl.isRecurring ? <Repeat className="size-4 text-primary" aria-hidden="true" /> : <Bookmark className="size-4 text-primary" aria-hidden="true" />}
                    <span className="font-medium">{tpl.name}</span>
                  </div>
                  {tpl.isRecurring ? (
                    <span className="text-xs border rounded px-1.5 py-0.5 bg-primary/10 text-primary border-primary/20">บิลประจำ</span>
                  ) : (
                    <span className={`text-xs border rounded px-1.5 py-0.5 ${t.cls}`}>
                      {t.label}
                    </span>
                  )}
                </div>
                {tpl.isRecurring ? (
                  <>
                    <div className="text-xs text-muted-foreground truncate mb-1">
                      {[vendor, tpl.branch?.name, category, amount != null && amount !== '' ? `ยอดประมาณ ${formatNumberDecimal(String(amount))}` : null].filter(Boolean).join(' · ')}
                    </div>
                    {recurringLine ? (
                      <div className="text-xs text-info mb-3">{recurringLine}</div>
                    ) : (
                      <div className="text-xs text-warning-strong mb-3">กติการอบไม่ครบ — กด "แก้ไข" เพื่อตั้งความถี่/วันครบกำหนด</div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => navigate(`/expenses/recurring-bills${nextMonth ? `?month=${nextMonth}` : ''}`)}
                      >
                        เปิดร่างงวดนี้
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setBillDialog({ open: true, template: tpl })}>
                        <Pencil className="size-3.5" aria-hidden="true" />แก้ไข
                      </Button>
                      <button
                        type="button"
                        aria-label="ลบ"
                        onClick={() =>
                          setConfirmDelete({ open: true, id: tpl.id, name: tpl.name })
                        }
                        className="ml-auto p-1.5 text-destructive hover:bg-destructive/10 rounded"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {vendor && (
                      <div className="text-xs text-muted-foreground truncate mb-2">{vendor}</div>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => instantiateMutation.mutate(tpl.id)}
                        disabled={instantiateMutation.isPending}
                      >
                        <Plus className="size-3.5" /> ใช้
                      </Button>
                      <button
                        type="button"
                        aria-label="ลบ"
                        onClick={() =>
                          setConfirmDelete({ open: true, id: tpl.id, name: tpl.name })
                        }
                        className="ml-auto p-1.5 text-destructive hover:bg-destructive/10 rounded"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      <RecurringBillDialog
        open={billDialog.open}
        template={billDialog.template}
        onClose={() => setBillDialog({ open: false, template: null })}
      />
      <ConfirmDialog
        open={confirmDelete.open}
        onOpenChange={(open) => setConfirmDelete((prev) => ({ ...prev, open }))}
        description={`ลบแม่แบบ "${confirmDelete.name}"?`}
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
      />
    </div>
  );
}
