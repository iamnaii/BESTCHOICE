import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import CategoryTreePane from './canned-response-admin/CategoryTreePane';
import TemplateEditorPane from './canned-response-admin/TemplateEditorPane';
import { useReorderMutation } from './canned-response-admin/useReorderMutation';
import type { CannedResponse } from './canned-response-admin/types';

type DeleteTarget =
  | { kind: 'template'; id: string; name: string }
  | { kind: 'category'; name: string; count: number };

export default function CannedResponseAdminPage() {
  useDocumentTitle('ข้อความสำเร็จรูป');
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);

  const query = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses-admin'],
    queryFn: () => api.get('/staff-chat/canned-responses?includeHidden=true').then((r: any) => r.data),
  });

  const templates = query.data ?? [];
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const existingCategories = useMemo(
    () =>
      [...new Set(templates.map((t) => t.category).filter((c): c is string => !!c))].sort((a, b) =>
        a.localeCompare(b, 'th'),
      ),
    [templates],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['canned-responses-admin'] });
    queryClient.invalidateQueries({ queryKey: ['canned-responses-picker'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<CannedResponse>) =>
      api.post('/staff-chat/canned-responses', data).then((r: any) => r.data),
    onSuccess: (created: CannedResponse) => {
      invalidate();
      setSelectedId(created.id);
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'สร้างไม่สำเร็จ'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CannedResponse> }) =>
      api.patch(`/staff-chat/canned-responses/${id}`, patch).then((r: any) => r.data),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/staff-chat/canned-responses/${id}`),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success('ลบแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ลบไม่สำเร็จ'),
  });

  const reorderMutation = useReorderMutation();

  const renameCategoryMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const inCat = templates.filter((t) => (t.category ?? 'อื่นๆ') === oldName);
      await Promise.all(
        inCat.map((t) =>
          api.patch(`/staff-chat/canned-responses/${t.id}`, { category: newName }),
        ),
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success('แก้ชื่อหมวดแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'แก้ชื่อหมวดไม่สำเร็จ'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const inCat = templates.filter((t) => (t.category ?? 'อื่นๆ') === name);
      await Promise.all(inCat.map((t) => api.delete(`/staff-chat/canned-responses/${t.id}`)));
    },
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success('ลบหมวดแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ลบหมวดไม่สำเร็จ'),
  });

  const duplicateCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const inCat = templates.filter((t) => (t.category ?? 'อื่นๆ') === name);
      await Promise.all(
        inCat.map((t) =>
          api.post('/staff-chat/canned-responses', {
            shortcut: `${t.shortcut}-copy-${Date.now().toString(36).slice(-4)}`,
            title: `${t.title} (สำเนา)`,
            content: t.content,
            category: `${name} (สำเนา)`,
            sortOrder: t.sortOrder + 1000,
          }),
        ),
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success('ทำซ้ำหมวดแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ทำซ้ำหมวดไม่สำเร็จ'),
  });

  const duplicateTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const src = templates.find((t) => t.id === id);
      if (!src) throw new Error('not found');
      return api
        .post('/staff-chat/canned-responses', {
          shortcut: `${src.shortcut}-copy-${Date.now().toString(36).slice(-4)}`,
          title: `${src.title} (สำเนา)`,
          content: src.content,
          category: src.category,
          sortOrder: src.sortOrder + 1,
        })
        .then((r: any) => r.data);
    },
    onSuccess: (created: any) => {
      invalidate();
      setSelectedId(created?.id ?? null);
      toast.success('ทำซ้ำแล้ว');
    },
    onError: (e: any) => toast.error(getErrorMessage(e) ?? 'ทำซ้ำไม่สำเร็จ'),
  });

  const handleAddTemplate = (category: string) => {
    const cat = category === 'อื่นๆ' ? null : category;
    createMutation.mutate({
      shortcut: `/new-${Date.now().toString(36).slice(-4)}`,
      title: 'Template ใหม่',
      content: '',
      category: cat,
      sortOrder: Math.max(0, ...templates.map((t) => t.sortOrder)) + 1,
    });
  };

  const handleAddCategory = () => {
    const name = window.prompt('ชื่อหมวดใหม่');
    if (!name || !name.trim()) return;
    createMutation.mutate({
      shortcut: `/new-${Date.now().toString(36).slice(-4)}`,
      title: 'Template ใหม่',
      content: '',
      category: name.trim(),
      sortOrder: Math.max(0, ...templates.map((t) => t.sortOrder)) + 1,
    });
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === 'template') {
      deleteMutation.mutate(confirmDelete.id);
    } else {
      deleteCategoryMutation.mutate(confirmDelete.name);
    }
    setConfirmDelete(null);
  };

  const isCategoryDelete = confirmDelete?.kind === 'category';
  const deleteLoading = deleteMutation.isPending || deleteCategoryMutation.isPending;

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      <PageHeader
        title="ข้อความสำเร็จรูป"
        action={
          <Button onClick={handleAddCategory} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            สร้างชุดข้อความ
          </Button>
        }
      />
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        <div className="flex-1 flex overflow-hidden border border-border rounded-lg m-3">
          <div className="w-96 flex-shrink-0">
            <CategoryTreePane
              templates={templates}
              selectedId={selectedId}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelectTemplate={setSelectedId}
              onAddTemplate={handleAddTemplate}
              onDuplicateTemplate={(id) => duplicateTemplateMutation.mutate(id)}
              onDeleteTemplate={(id) => {
                const t = templates.find((x) => x.id === id);
                if (t) {
                  setConfirmDelete({ kind: 'template', id, name: t.title });
                }
              }}
              onRenameCategory={(oldName, newName) =>
                renameCategoryMutation.mutate({ oldName, newName })
              }
              onDuplicateCategory={(name) => duplicateCategoryMutation.mutate(name)}
              onDeleteCategory={(name) => {
                const count = templates.filter((t) => (t.category ?? 'อื่นๆ') === name).length;
                setConfirmDelete({ kind: 'category', name, count });
              }}
              onReorder={(items) => reorderMutation.mutate(items)}
            />
          </div>
          <TemplateEditorPane
            template={selected}
            existingCategories={existingCategories}
            onSave={async (patch) => {
              if (!selected) return;
              await updateMutation.mutateAsync({ id: selected.id, patch });
            }}
          />
        </div>
      </QueryBoundary>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={isCategoryDelete ? 'ลบหมวดทั้งหมด' : 'ลบ Template'}
        description={
          confirmDelete
            ? confirmDelete.kind === 'category'
              ? `ลบหมวด "${confirmDelete.name}"? จะลบ template ${confirmDelete.count} ตัวในหมวดนี้ด้วย`
              : `ลบ template "${confirmDelete.name}"?`
            : ''
        }
        confirmLabel="ลบ"
        variant="destructive"
        loading={deleteLoading}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
