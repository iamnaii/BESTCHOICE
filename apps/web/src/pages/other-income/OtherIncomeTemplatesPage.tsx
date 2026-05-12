import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Trash2, Edit3, PlayCircle, Search, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/useDebounce';
import { otherIncomeApi } from '@/lib/otherIncome';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatThaiDateShort } from '@/lib/date';
import { RenameTemplateModal } from './components/RenameTemplateModal';

export default function OtherIncomeTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const debounced = useDebounce(search, 250);

  // rename state
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  // delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const query = useQuery({
    queryKey: ['other-income-templates', debounced, favoritesOnly],
    queryFn: () => otherIncomeApi.templates.list({ q: debounced || undefined, favoritesOnly }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; isFavorite?: boolean } }) =>
      otherIncomeApi.templates.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['other-income-templates'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => otherIncomeApi.templates.remove(id),
    onSuccess: () => {
      toast.success('ลบ template แล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income-templates'] });
      setDeleteTarget(null);
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: (id: string) => otherIncomeApi.templates.use(id),
    onSuccess: (data) => {
      sessionStorage.setItem('oi-template-prefill', JSON.stringify(data));
      navigate('/other-income/new?fromTemplate=1');
    },
  });

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Templates รายได้อื่น"
        action={
          <button
            onClick={() => navigate('/other-income/new')}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-accent"
          >
            + สร้างเอกสารใหม่
          </button>
        }
      />

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ template"
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm bg-background"
          />
        </div>
        <button
          onClick={() => setFavoritesOnly((v) => !v)}
          className={`px-3 py-2 rounded-md border text-sm inline-flex items-center gap-1 ${
            favoritesOnly ? 'bg-warning/10 border-warning text-warning' : ''
          }`}
        >
          <Star size={14} />
          ที่ชอบ
        </button>
      </div>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {query.data?.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="mx-auto mb-3 opacity-50" size={40} />
            <p>ไม่มี Template — บันทึกจากเอกสารที่ POSTED แล้วเพื่อเริ่มต้น</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {(query.data ?? []).map((t: any) => (
              <li key={t.id} className="rounded-lg border bg-card p-3 flex items-start gap-3">
                <button
                  onClick={() =>
                    updateMutation.mutate({ id: t.id, data: { isFavorite: !t.isFavorite } })
                  }
                  className="mt-1"
                  aria-label={t.isFavorite ? 'ถอด template ออกจากรายการที่ชอบ' : 'เพิ่ม template เข้ารายการที่ชอบ'}
                >
                  <Star
                    size={16}
                    className={
                      t.isFavorite ? 'fill-warning text-warning' : 'text-muted-foreground'
                    }
                  />
                </button>
                <div className="flex-1">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.itemsJson?.length ?? 0} รายการ · ใช้ {t.useCount} ครั้ง
                    {t.lastUsedAt && ` · ล่าสุด ${formatThaiDateShort(t.lastUsedAt)}`}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => applyTemplateMutation.mutate(t.id)}
                    className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1 hover:bg-primary/90"
                  >
                    <PlayCircle size={12} /> ใช้
                  </button>
                  <button
                    onClick={() => setRenameTarget({ id: t.id, name: t.name })}
                    className="p-1.5 rounded-md border hover:bg-accent"
                    title="แก้ชื่อ"
                    aria-label="แก้ชื่อ template"
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ id: t.id, name: t.name })}
                    className="p-1.5 rounded-md border hover:bg-destructive/10 text-destructive"
                    title="ลบ"
                    aria-label="ลบ template"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>

      {/* Rename modal */}
      {renameTarget && (
        <RenameTemplateModal
          defaultName={renameTarget.name}
          isLoading={updateMutation.isPending}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(name) => {
            updateMutation.mutate(
              { id: renameTarget.id, data: { name } },
              { onSuccess: () => setRenameTarget(null) },
            );
          }}
        />
      )}

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="ยืนยันการลบ"
        description={`ลบ "${deleteTarget?.name ?? ''}"?`}
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
