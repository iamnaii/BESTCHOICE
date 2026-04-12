import { useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Plus, Pencil, Trash2, X, Save, MessageSquareText } from 'lucide-react';

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  sortOrder: number;
  createdAt: string;
}

const CATEGORIES = [
  { value: 'greeting', label: 'ทักทาย' },
  { value: 'payment', label: 'การชำระเงิน' },
  { value: 'sales', label: 'การขาย' },
  { value: 'general', label: 'ทั่วไป' },
  { value: 'closing', label: 'ปิดการสนทนา' },
];

const CATEGORY_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label])
);

const emptyForm = {
  shortcut: '',
  title: '',
  content: '',
  category: 'general',
  sortOrder: 0,
};

export default function CannedResponseAdminPage() {
  useDocumentTitle('ข้อความสำเร็จรูป');
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    id: string;
    title: string;
  }>({ open: false, id: '', title: '' });

  const {
    data: responses = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses'],
    queryFn: async () => {
      const { data } = await api.get('/staff-chat/canned-responses');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof emptyForm) => {
      const { data } = await api.post('/staff-chat/canned-responses', {
        ...payload,
        shortcut: payload.shortcut.startsWith('/')
          ? payload.shortcut
          : `/${payload.shortcut}`,
        sortOrder: Number(payload.sortOrder) || 0,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
      toast.success('สร้างข้อความสำเร็จรูปแล้ว');
      resetForm();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: typeof emptyForm }) => {
      const { data } = await api.patch(`/staff-chat/canned-responses/${id}`, {
        ...payload,
        shortcut: payload.shortcut.startsWith('/')
          ? payload.shortcut
          : `/${payload.shortcut}`,
        sortOrder: Number(payload.sortOrder) || 0,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
      toast.success('แก้ไขข้อความสำเร็จรูปแล้ว');
      resetForm();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/staff-chat/canned-responses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
      toast.success('ลบข้อความสำเร็จรูปแล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setIsCreating(false);
  };

  const startEdit = (item: CannedResponse) => {
    setEditingId(item.id);
    setIsCreating(false);
    setForm({
      shortcut: item.shortcut,
      title: item.title,
      content: item.content,
      category: item.category || 'general',
      sortOrder: item.sortOrder,
    });
  };

  const startCreate = () => {
    setEditingId(null);
    setIsCreating(true);
    setForm(emptyForm);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.shortcut.trim() || !form.title.trim() || !form.content.trim()) {
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const confirmDelete = (item: CannedResponse) => {
    setDeleteConfirm({ open: true, id: item.id, title: item.title });
  };

  const handleDelete = () => {
    deleteMutation.mutate(deleteConfirm.id);
    setDeleteConfirm({ open: false, id: '', title: '' });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <PageHeader
        title="จัดการข้อความสำเร็จรูป"
        subtitle="สร้าง แก้ไข ลบ Quick Reply สำหรับพนักงานแชท"
        icon={<MessageSquareText className="size-5" />}
        action={
          !isCreating && !editingId ? (
            <button
              onClick={startCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-4" />
              เพิ่มข้อความ
            </button>
          ) : undefined
        }
      />

      {/* Create / Edit Form */}
      {(isCreating || editingId) && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-foreground">
            {editingId ? 'แก้ไขข้อความสำเร็จรูป' : 'เพิ่มข้อความสำเร็จรูปใหม่'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Shortcut */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Shortcut <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    /
                  </span>
                  <input
                    type="text"
                    value={form.shortcut.replace(/^\//, '')}
                    onChange={(e) =>
                      setForm({ ...form, shortcut: e.target.value.replace(/^\//, '') })
                    }
                    placeholder="greeting"
                    className="w-full rounded-lg border border-input bg-background py-2 pl-7 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  ชื่อ <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="ทักทายลูกค้า"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Category */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  หมวดหมู่
                </label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sort Order */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  ลำดับ
                </label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm({ ...form, sortOrder: Number(e.target.value) || 0 })
                  }
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Content */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                เนื้อหา <span className="text-destructive">*</span>
              </label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={3}
                placeholder="สวัสดีค่ะ {customerName} ยินดีให้บริการค่ะ"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                ตัวแปรที่ใช้ได้: <code className="rounded bg-muted px-1 py-0.5">{'{customerName}'}</code>{' '}
                <code className="rounded bg-muted px-1 py-0.5">{'{amountDue}'}</code>{' '}
                <code className="rounded bg-muted px-1 py-0.5">{'{dueDate}'}</code>
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Save className="size-4" />
                {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                <X className="size-4" />
                ยกเลิก
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <QueryBoundary isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
        {responses.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <MessageSquareText className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">
              ยังไม่มีข้อความสำเร็จรูป
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              กดปุ่ม "เพิ่มข้อความ" เพื่อเริ่มสร้าง
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Shortcut
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    ชื่อ
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    เนื้อหา
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    หมวดหมู่
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    ลำดับ
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody>
                {responses.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-primary">
                        {item.shortcut}
                      </code>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{item.title}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                      {item.content.length > 60
                        ? `${item.content.slice(0, 60)}...`
                        : item.content}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        {CATEGORY_LABEL_MAP[item.category || ''] || item.category || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">
                      {item.sortOrder}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                          title="แก้ไข"
                        >
                          <Pencil className="size-3.5" />
                          แก้ไข
                        </button>
                        <button
                          onClick={() => confirmDelete(item)}
                          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                          title="ลบ"
                        >
                          <Trash2 className="size-3.5" />
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryBoundary>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm({ ...deleteConfirm, open })}
        title="ยืนยันการลบ"
        description={`ต้องการลบข้อความ "${deleteConfirm.title}" หรือไม่?`}
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
