import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  CheckSquare,
  Plus,
  Calendar,
  Flag,
  X,
  CheckCircle2,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Upload,
  User as UserIcon,
  Tag,
  AlignLeft,
  Type as TypeIcon,
} from 'lucide-react';
import {
  type Todo,
  type TodoPriority,
  type AssigneeRef,
  type Attachment,
  type ChecklistItem,
  priorityConfig,
  formatBytes,
  emptyForm,
} from '../types';

interface TodoFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Todo | null;
  staffUsers: AssigneeRef[];
}

export function TodoForm({ open, onOpenChange, editing, staffUsers }: TodoFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<typeof emptyForm>({ ...emptyForm });
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Sync form when editing changes or dialog opens
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        title: editing.title,
        description: editing.description || '',
        priority: editing.priority,
        status: editing.status,
        dueDate: editing.dueDate ? editing.dueDate.slice(0, 10) : '',
        assigneeId: editing.assigneeId || '',
        tags: editing.tags || [],
        checklist: Array.isArray(editing.checklist) ? editing.checklist : [],
        attachments: Array.isArray(editing.attachments) ? editing.attachments : [],
        tagsInput: '',
      });
    } else {
      setForm({ ...emptyForm });
    }
  }, [open, editing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title?.trim(),
        description: form.description || undefined,
        priority: form.priority,
        status: form.status,
        dueDate: form.dueDate || undefined,
        assigneeId: form.assigneeId || undefined,
        tags: form.tags || [],
        checklist: form.checklist || [],
        attachments: form.attachments || [],
      };
      if (!payload.title) throw new Error('กรุณาระบุชื่องาน');
      if (editing) {
        const { data } = await api.patch(`/todos/${editing.id}`, payload);
        return data;
      }
      const { data } = await api.post('/todos', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'อัปเดตรายการแล้ว' : 'สร้างรายการแล้ว');
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const uploadAttachment = async (file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/todos/upload-attachment', fd, {
        headers: { 'Content-Type': undefined },
      });
      setForm((prev) => ({
        ...prev,
        attachments: [...(prev.attachments || []), data as Attachment],
      }));
      toast.success('อัปโหลดไฟล์สำเร็จ');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const removeAttachment = (url: string) =>
    setForm((prev) => ({
      ...prev,
      attachments: (prev.attachments || []).filter((a) => a.url !== url),
    }));

  /**
   * Fetch a single attachment as a blob and return an object URL.
   * The /todos/attachments/* endpoint requires JWT auth and our
   * token lives in memory (not cookies), so plain <img src> or
   * <a href> wouldn't work — we have to go through the api client
   * which attaches the Authorization header.
   */
  const fetchAttachmentBlob = async (att: Attachment): Promise<string | null> => {
    try {
      // att.url may be stored as "/api/todos/attachments/..." but api client
      // already has baseURL ending in /api, so strip the leading /api prefix
      const url = att.url.startsWith('/api/') ? att.url.slice(4) : att.url;
      const response = await api.get(url, { responseType: 'blob' });
      return URL.createObjectURL(response.data as Blob);
    } catch (err) {
      console.warn('Failed to fetch attachment', att.url, err);
      return null;
    }
  };

  /**
   * Open a non-image attachment in a new tab (PDFs, docs, etc).
   * For images we use the lightbox instead — see openLightbox below.
   */
  const openAttachment = async (att: Attachment) => {
    try {
      const objectUrl = await fetchAttachmentBlob(att);
      if (!objectUrl) {
        toast.error('ไม่สามารถเปิดไฟล์ได้');
        return;
      }
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      // Free the blob after the new tab has had time to load it
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  // When the dialog opens, prefetch a blob URL for every image
  // attachment so we can show inline thumbnails. When the dialog
  // closes (or attachment list changes), revoke them to free memory.
  useEffect(() => {
    if (!open) return;
    const images = (form.attachments || []).filter((a) =>
      a.mimeType?.startsWith('image/'),
    );
    if (images.length === 0) return;

    let cancelled = false;
    const created: string[] = [];

    (async () => {
      for (const img of images) {
        // Skip if we already loaded this one (form mutation re-runs effect)
        if (thumbUrls[img.url]) continue;
        const objectUrl = await fetchAttachmentBlob(img);
        if (cancelled || !objectUrl) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          continue;
        }
        created.push(objectUrl);
        setThumbUrls((prev) => ({ ...prev, [img.url]: objectUrl }));
      }
    })();

    return () => {
      cancelled = true;
      // Revoke any blob URLs created in THIS run only — entries that
      // were already in thumbUrls before the effect started stay alive
      // for the rest of the dialog session.
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // thumbUrls is intentionally read but not in deps — adding it would
    // cause an infinite loop because we setState on it inside the effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.attachments]);

  // When the dialog closes, drop all thumbnails and revoke their URLs.
  useEffect(() => {
    if (open) return;
    setThumbUrls((prev) => {
      Object.values(prev).forEach((u) => URL.revokeObjectURL(u));
      return {};
    });
  }, [open]);

  // Open the full-size lightbox for an image attachment.
  // Reuses the already-loaded thumbnail blob URL when available.
  const openLightbox = async (att: Attachment) => {
    const cached = thumbUrls[att.url];
    if (cached) {
      setLightboxUrl(cached);
      return;
    }
    const objectUrl = await fetchAttachmentBlob(att);
    if (objectUrl) setLightboxUrl(objectUrl);
  };

  // Close lightbox on Escape key
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);

  const addTag = () => {
    const v = (form.tagsInput || '').trim();
    if (!v) return;
    if (form.tags?.includes(v)) return;
    setForm({ ...form, tags: [...(form.tags || []), v], tagsInput: '' });
  };
  const removeTag = (t: string) =>
    setForm({ ...form, tags: (form.tags || []).filter((x) => x !== t) });

  const addChecklist = () => {
    const next: ChecklistItem = { id: crypto.randomUUID(), text: '', done: false };
    setForm({ ...form, checklist: [...(form.checklist || []), next] });
  };
  const updateChecklist = (id: string, patch: Partial<ChecklistItem>) =>
    setForm({
      ...form,
      checklist: (form.checklist || []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  const removeChecklist = (id: string) =>
    setForm({ ...form, checklist: (form.checklist || []).filter((c) => c.id !== id) });

  return (
    <>
      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto p-0 gap-0">
          {/* Gradient header */}
          <DialogHeader className="px-6 py-5 bg-linear-to-r from-primary/10 via-primary/5 to-transparent border-b border-border">
            <DialogTitle className="flex items-center gap-2.5 text-lg">
              <div className="size-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <CheckSquare className="size-5" />
              </div>
              {editing ? 'แก้ไขงาน' : 'เพิ่มงานใหม่'}
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-5 space-y-5">
            {/* Title */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                <TypeIcon className="size-3.5" />
                ชื่องาน <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.title || ''}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors"
                placeholder="เช่น โทรตามลูกค้า A"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                <AlignLeft className="size-3.5" />
                รายละเอียด
              </label>
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
                  }
                }}
                rows={3}
                placeholder="อธิบายรายละเอียดงาน..."
                className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors resize-none overflow-y-auto min-h-[88px]"
              />
            </div>

            {/* Priority + Status as button groups */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  <Flag className="size-3.5" />
                  ความสำคัญ
                </label>
                <div className="flex gap-1.5">
                  {(['LOW', 'MEDIUM', 'HIGH'] as TodoPriority[]).map((p) => {
                    const cfg = priorityConfig[p];
                    const active = form.priority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                          active
                            ? `${cfg.badge} border-current`
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  <CheckCircle2 className="size-3.5" />
                  สถานะ
                </label>
                <div className="flex gap-1.5">
                  {([
                    { v: 'TODO', label: 'รอทำ', color: 'bg-slate-400' },
                    { v: 'DOING', label: 'กำลังทำ', color: 'bg-amber-400' },
                    { v: 'DONE', label: 'เสร็จ', color: 'bg-emerald-500' },
                  ] as const).map((s) => {
                    const active = form.status === s.v;
                    return (
                      <button
                        key={s.v}
                        type="button"
                        onClick={() => setForm({ ...form, status: s.v })}
                        className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold border-2 transition-all ${
                          active
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <span className={`size-1.5 rounded-full ${s.color}`} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Date + Assignee */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  <Calendar className="size-3.5" />
                  ครบกำหนด
                </label>
                <input
                  type="date"
                  value={form.dueDate || ''}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                  <UserIcon className="size-3.5" />
                  ผู้รับมอบหมาย
                </label>
                <select
                  value={form.assigneeId || ''}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                  className="w-full px-4 py-2.5 border border-input rounded-xl text-sm bg-card focus-visible:ring-2 focus-visible:ring-primary/20 focus:border-primary/50 outline-hidden transition-colors"
                >
                  <option value="">ไม่ระบุ</option>
                  {staffUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nickname || u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                <Tag className="size-3.5" />
                แท็ก
              </label>
              <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-input rounded-xl bg-card focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/50 transition-colors">
                {(form.tags || []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary"
                  >
                    #{tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="hover:text-rose-600"
                      aria-label="remove tag"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={form.tagsInput || ''}
                  onChange={(e) => setForm({ ...form, tagsInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder={form.tags?.length ? '' : 'พิมพ์แล้วกด Enter'}
                  className="flex-1 min-w-[120px] outline-hidden bg-transparent text-sm py-0.5"
                />
              </div>
            </div>

            {/* Checklist */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <CheckSquare className="size-3.5" />
                  Checklist
                  {(form.checklist?.length || 0) > 0 && (
                    <span className="text-2xs font-normal text-muted-foreground/70">
                      ({form.checklist?.filter((c) => c.done).length}/{form.checklist?.length})
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  onClick={addChecklist}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded-md transition-colors"
                >
                  <Plus className="size-3" />
                  เพิ่มรายการ
                </button>
              </div>
              <div className="space-y-1.5">
                {(form.checklist || []).length === 0 && (
                  <p className="text-xs text-muted-foreground italic">ยังไม่มีรายการย่อย</p>
                )}
                {(form.checklist || []).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors group"
                  >
                    <button
                      type="button"
                      onClick={() => updateChecklist(c.id, { done: !c.done })}
                      className={`size-4 rounded-md border-2 flex items-center justify-center transition-all shrink-0 ${
                        c.done
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-muted-foreground/30 hover:border-primary'
                      }`}
                    >
                      {c.done && <CheckCircle2 className="size-3" />}
                    </button>
                    <input
                      type="text"
                      value={c.text}
                      onChange={(e) => updateChecklist(c.id, { text: e.target.value })}
                      className={`flex-1 bg-transparent outline-hidden text-sm ${
                        c.done ? 'line-through text-muted-foreground' : ''
                      }`}
                      placeholder="รายการย่อย..."
                    />
                    <button
                      type="button"
                      onClick={() => removeChecklist(c.id)}
                      className="text-muted-foreground/50 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Attachments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Paperclip className="size-3.5" />
                  ไฟล์แนบ
                  {(form.attachments?.length || 0) > 0 && (
                    <span className="text-2xs font-normal text-muted-foreground/70">
                      ({form.attachments?.length})
                    </span>
                  )}
                </label>
              </div>

              {/* Upload zone */}
              <label
                className="flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file) uploadAttachment(file);
                }}
              >
                <Upload className="size-6 text-muted-foreground" />
                <div className="text-xs text-center">
                  <span className="font-semibold text-primary">คลิกเพื่ออัปโหลด</span>{' '}
                  <span className="text-muted-foreground">หรือลากไฟล์มาวาง</span>
                </div>
                <p className="text-2xs text-muted-foreground">ไฟล์สูงสุด 10MB</p>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      uploadAttachment(file);
                      e.target.value = '';
                    }
                  }}
                />
              </label>

              {/* Attachment list */}
              {(form.attachments || []).length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {(form.attachments || []).map((a) => {
                    const isImage = a.mimeType?.startsWith('image/');
                    const thumb = isImage ? thumbUrls[a.url] : undefined;
                    return (
                      <div
                        key={a.url}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors group"
                      >
                        {isImage ? (
                          <button
                            type="button"
                            onClick={() => openLightbox(a)}
                            disabled={!thumb}
                            aria-label={`ดูรูป ${a.name}`}
                            className="size-12 rounded-md overflow-hidden shrink-0 border border-border bg-muted flex items-center justify-center hover:ring-2 hover:ring-primary/40 transition-all disabled:cursor-wait"
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt={a.name}
                                className="size-full object-cover"
                              />
                            ) : (
                              <ImageIcon className="size-4 text-muted-foreground animate-pulse" />
                            )}
                          </button>
                        ) : (
                          <div className="size-12 rounded-md flex items-center justify-center shrink-0 bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            <FileText className="size-5" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => (isImage ? openLightbox(a) : openAttachment(a))}
                            className="text-sm font-medium truncate block hover:text-primary transition-colors text-left w-full"
                          >
                            {a.name || 'ไฟล์แนบ'}
                          </button>
                          <p className="text-2xs text-muted-foreground">
                            {formatBytes(a.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.url)}
                          className="text-muted-foreground/50 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-5 py-2.5 text-sm font-medium border border-input rounded-xl hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 disabled:opacity-50 shadow-sm transition-all"
            >
              {saveMutation.isPending ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'สร้างงาน'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox: full-size image preview. Click backdrop or press Escape
          to close. Sits at z-60 to appear above the edit Dialog (z-50). */}
      {lightboxUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ภาพขยาย"
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 cursor-zoom-out animate-in fade-in"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxUrl(null);
            }}
            className="absolute top-4 right-4 size-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="ปิด"
          >
            <X className="size-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="ภาพแนบ"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
