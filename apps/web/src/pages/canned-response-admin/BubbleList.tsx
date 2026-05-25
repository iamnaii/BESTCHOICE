import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Type, Image as ImageIcon, Smile, CreditCard, MapPin, Video, Braces } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';
import BubbleEditor from './BubbleEditor';
import ChannelChips from './ChannelChips';
import type { CannedResponseBubble, BubbleType } from './types';

interface Props { cannedResponseId: string; }

const TYPE_LABEL: Record<BubbleType, string> = {
  TEXT: 'ข้อความ',
  IMAGE: 'รูป',
  STICKER: 'สติ๊กเกอร์',
  CARD: 'การ์ด',
  LOCATION: 'สถานที่',
  VIDEO: 'วิดีโอ',
  JSON: 'JSON',
};
const TYPE_ICON = {
  TEXT: Type,
  IMAGE: ImageIcon,
  STICKER: Smile,
  CARD: CreditCard,
  LOCATION: MapPin,
  VIDEO: Video,
  JSON: Braces,
} as const;

function SortableBubbleRow({ bubble, onChange, onDelete }: { bubble: CannedResponseBubble; onChange: (p: Partial<CannedResponseBubble>) => void; onDelete: () => void; }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bubble.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const Icon = TYPE_ICON[bubble.type];
  return (
    <div ref={setNodeRef} style={style} className={`border border-border rounded-lg p-3 bg-card ${isDragging ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground p-1" aria-label="ลากเพื่อย้าย">
          <GripVertical className="w-4 h-4" />
        </button>
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{TYPE_LABEL[bubble.type]}</span>
        <div className="flex-1" />
        <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" title="ลบ" aria-label="ลบ">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="mb-2">
        <ChannelChips
          selectedChannels={bubble.channels ?? []}
          onChange={(channels) => onChange({ channels })}
        />
      </div>
      <BubbleEditor bubble={bubble} onChange={onChange} />
    </div>
  );
}

export default function BubbleList({ cannedResponseId }: Props) {
  const qc = useQueryClient();

  const bubblesQ = useQuery<CannedResponseBubble[]>({
    queryKey: ['canned-response-bubbles', cannedResponseId],
    queryFn: () => api.get(`/staff-chat/canned-responses/${cannedResponseId}/bubbles`).then((r: any) => r.data),
  });

  const bubbles = bubblesQ.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['canned-response-bubbles', cannedResponseId] });
    qc.invalidateQueries({ queryKey: ['canned-responses-admin'] });
    qc.invalidateQueries({ queryKey: ['canned-responses-picker'] });
  };

  const createMut = useMutation({
    mutationFn: (type: BubbleType) =>
      api.post(`/staff-chat/canned-responses/${cannedResponseId}/bubbles`, { type }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'สร้างไม่สำเร็จ'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CannedResponseBubble> }) =>
      api.patch(`/staff-chat/canned-responses/bubbles/${id}`, patch),
    onSuccess: () => invalidate(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/staff-chat/canned-responses/bubbles/${id}`),
    onSuccess: () => invalidate(),
  });

  const reorderMut = useMutation({
    mutationFn: (items: Array<{ id: string; sortOrder: number }>) =>
      api.patch('/staff-chat/canned-responses/bubbles/reorder', { items }),
    onSuccess: () => invalidate(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'เรียงลำดับไม่สำเร็จ'),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIdx = bubbles.findIndex((b) => b.id === active.id);
    const toIdx = bubbles.findIndex((b) => b.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...bubbles];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    reorderMut.mutate(reordered.map((b, i) => ({ id: b.id, sortOrder: i })));
  };

  const canAdd = bubbles.length < 5;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold leading-snug">ข้อความ ({bubbles.length}/5 บับเบิ้ล)</h4>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={bubbles.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {bubbles.map((bubble) => (
              <SortableBubbleRow
                key={bubble.id}
                bubble={bubble}
                onChange={(patch) => updateMut.mutate({ id: bubble.id, patch })}
                onDelete={() => deleteMut.mutate(bubble.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {bubbles.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground leading-snug border border-dashed border-border rounded-lg">
          ยังไม่มี bubble — เพิ่มประเภทข้อความด้านล่าง
        </div>
      )}
      {canAdd ? (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground w-full">เพิ่มประเภท:</span>
          {(['TEXT', 'IMAGE', 'STICKER', 'CARD', 'LOCATION', 'VIDEO', 'JSON'] as const).map((t) => {
            const Icon = TYPE_ICON[t];
            return (
              <Button key={t} size="sm" variant="outline" onClick={() => createMut.mutate(t)}>
                <Icon className="w-3.5 h-3.5 mr-1.5" /> {TYPE_LABEL[t]}
              </Button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">ถึงขีดจำกัด 5 บับเบิ้ลแล้ว — ลบบางบับเบิ้ลก่อนเพิ่มใหม่</p>
      )}
    </div>
  );
}
