import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { CannedResponseQuickReply, QuickReplyType } from './types';

interface Props { cannedResponseId: string; }

function SortableQuickReplyRow({
  qr, onChange, onDelete,
}: {
  qr: CannedResponseQuickReply;
  onChange: (patch: Partial<CannedResponseQuickReply>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: qr.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={`border border-border rounded-lg p-3 bg-card ${isDragging ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground p-1" aria-label="ลากเพื่อย้าย">
          <GripVertical className="w-4 h-4" />
        </button>
        <select
          value={qr.type}
          onChange={(e) => onChange({ type: e.target.value as QuickReplyType })}
          className="text-xs border border-border rounded px-2 py-1 bg-background"
        >
          <option value="MESSAGE">ส่งข้อความ</option>
          <option value="POSTBACK">Postback</option>
          <option value="URL">เปิด URL</option>
        </select>
        <div className="flex-1" />
        <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" title="ลบ">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-2">
        <Input
          value={qr.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="ป้ายปุ่ม (เช่น 'สนใจผ่อน')"
          className="text-sm"
        />
        {qr.type === 'POSTBACK' && (
          <Input
            value={qr.payload ?? ''}
            onChange={(e) => onChange({ payload: e.target.value })}
            placeholder="Payload (ส่งเข้าระบบ bot)"
            className="text-xs font-mono"
          />
        )}
        {qr.type === 'URL' && (
          <>
            <Input
              value={qr.url ?? ''}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://..."
              className="text-xs font-mono"
            />
            <p className="text-[11px] text-amber-700 leading-snug">
              ⚠ URL quick reply ใช้ได้กับ LINE เต็มที่ — บน Facebook จะเปลี่ยนเป็น text+payload
              (ลูกค้าต้องกดส่งเอง URL ไม่เปิด browser)
            </p>
          </>
        )}
        {qr.type === 'MESSAGE' && (
          <Input
            value={qr.message ?? ''}
            onChange={(e) => onChange({ message: e.target.value })}
            placeholder="ข้อความที่จะถูกส่งเป็นลูกค้า"
            className="text-sm"
          />
        )}
      </div>
    </div>
  );
}

export default function QuickReplyEditor({ cannedResponseId }: Props) {
  const qc = useQueryClient();

  const listQ = useQuery<CannedResponseQuickReply[]>({
    queryKey: ['canned-response-qr', cannedResponseId],
    queryFn: () => api.get(`/staff-chat/canned-responses/${cannedResponseId}/quick-replies`).then((r: any) => r.data),
  });

  const items = listQ.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['canned-response-qr', cannedResponseId] });

  const createMut = useMutation({
    mutationFn: () => api.post(`/staff-chat/canned-responses/${cannedResponseId}/quick-replies`, { label: 'ปุ่มใหม่', type: 'MESSAGE', message: '' }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'สร้างไม่สำเร็จ'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CannedResponseQuickReply> }) =>
      api.patch(`/staff-chat/canned-responses/quick-replies/${id}`, patch),
    onSuccess: () => invalidate(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/staff-chat/canned-responses/quick-replies/${id}`),
    onSuccess: () => invalidate(),
  });

  const reorderMut = useMutation({
    mutationFn: (xs: Array<{ id: string; sortOrder: number }>) =>
      api.patch('/staff-chat/canned-responses/quick-replies/reorder', { items: xs }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'เรียงลำดับไม่สำเร็จ'),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIdx = items.findIndex((q) => q.id === active.id);
    const toIdx = items.findIndex((q) => q.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reorderMut.mutate(reordered.map((q, i) => ({ id: q.id, sortOrder: i })));
  };

  const canAdd = items.length < 13;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold leading-snug">Quick Reply ({items.length}/13)</h4>
        {canAdd && (
          <Button size="sm" variant="outline" onClick={() => createMut.mutate()}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            เพิ่ม Quick Reply
          </Button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((q) => q.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((qr) => (
              <SortableQuickReplyRow
                key={qr.id}
                qr={qr}
                onChange={(patch) => updateMut.mutate({ id: qr.id, patch })}
                onDelete={() => deleteMut.mutate(qr.id)}
              />
            ))}
            {items.length === 0 && (
              <p className="text-xs text-muted-foreground italic">ยังไม่มี Quick Reply — เพิ่มได้สูงสุด 13 ปุ่ม</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
