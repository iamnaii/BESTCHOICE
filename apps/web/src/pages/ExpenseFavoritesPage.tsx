import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Bookmark, Plus, Trash2, Repeat, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Template {
  id: string;
  name: string;
  documentType: 'EXPENSE' | 'CREDIT_NOTE' | 'PAYROLL' | 'VENDOR_SETTLEMENT';
  branchId: string;
  prefilledData: Record<string, unknown>;
  isRecurring: boolean;
  recurringDay: number | null;
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

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
  const [filterType, setFilterType] = useState<string>('');
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

  const instantiateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/expense-templates/${id}/instantiate`);
      return data;
    },
    onSuccess: () => {
      toast.success('สร้างเอกสารร่างจาก template สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      navigate('/expenses');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/expense-templates/${id}`),
    onSuccess: () => {
      toast.success('ลบ template สำเร็จ');
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
          <h1 className="text-base font-semibold">รายการโปรด ({templates.length})</h1>
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background"
        >
          <option value="">ทุกประเภท</option>
          <option value="EXPENSE">รายจ่าย</option>
          <option value="PAYROLL">เงินเดือน</option>
          <option value="VENDOR_SETTLEMENT">จ่ายเจ้าหนี้</option>
        </select>
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
            return (
              <div
                key={tpl.id}
                className="rounded-xl border border-border bg-card p-4 hover:shadow-card-hover transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Bookmark className="size-4 text-primary" />
                    <span className="font-medium">{tpl.name}</span>
                  </div>
                  <span className={`text-2xs border rounded px-1.5 py-0.5 ${t.cls}`}>
                    {t.label}
                  </span>
                </div>
                {vendor && (
                  <div className="text-xs text-muted-foreground truncate mb-2">{vendor}</div>
                )}
                {tpl.isRecurring && (
                  <div className="flex items-center gap-1 text-xs text-info mb-3">
                    <Repeat className="size-3" />
                    <span>ทุกวันที่ {tpl.recurringDay}</span>
                  </div>
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
                    onClick={() =>
                      setConfirmDelete({ open: true, id: tpl.id, name: tpl.name })
                    }
                    className="ml-auto p-1.5 text-destructive hover:bg-destructive/10 rounded"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete.open}
        onOpenChange={(open) => setConfirmDelete((prev) => ({ ...prev, open }))}
        description={`ลบ template "${confirmDelete.name}"?`}
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
      />
    </div>
  );
}
