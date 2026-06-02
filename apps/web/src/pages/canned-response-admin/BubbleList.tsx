import { useEffect, useMemo } from 'react';
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
import type { CannedResponseBubble, BubbleType, Channel } from './types';
import { CHANNEL_LABELS } from './types';
import type { ChannelTabValue } from './ChannelTabs';
import { reorderBubbles } from './bubble-reorder-logic';

interface Props {
  cannedResponseId: string;
  /** Active channel tab — filters visible bubbles + scopes newly-created bubbles. 'ALL' = no filter. */
  channelFilter?: ChannelTabValue;
  /** Reports total bubble count per channel for tab badges */
  onCountsChange?: (counts: Partial<Record<ChannelTabValue, number>>) => void;
}

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

export default function BubbleList({ cannedResponseId, channelFilter = 'ALL', onCountsChange }: Props) {
  const qc = useQueryClient();

  const bubblesQ = useQuery<CannedResponseBubble[]>({
    queryKey: ['canned-response-bubbles', cannedResponseId],
    queryFn: () => api.get(`/staff-chat/canned-responses/${cannedResponseId}/bubbles`).then((r: any) => r.data),
  });

  // Memoise so the reference is stable across renders. `bubblesQ.data ?? []`
  // built a fresh [] on every render while the query was pending, which made the
  // counts-reporting effect below (dep: [allBubbles]) re-run every render →
  // onCountsChange → parent setState → re-render → loop that starved the query's
  // own resolution microtask, hanging forever.
  const allBubbles = useMemo(() => bubblesQ.data ?? [], [bubblesQ.data]);

  // Bubble is visible in a channel tab if channels[] is empty (= all-channels)
  // OR explicitly includes the active channel.
  const visibleBubbles =
    channelFilter === 'ALL'
      ? allBubbles
      : allBubbles.filter(
          (b) => (b.channels ?? []).length === 0 || (b.channels ?? []).includes(channelFilter),
        );

  // Report counts to parent for tab badges (visibility per tab)
  useEffect(() => {
    if (!onCountsChange) return;
    const counts: Partial<Record<ChannelTabValue, number>> = { ALL: allBubbles.length };
    for (const ch of Object.keys(CHANNEL_LABELS) as Channel[]) {
      counts[ch] = allBubbles.filter(
        (b) => (b.channels ?? []).length === 0 || (b.channels ?? []).includes(ch),
      ).length;
    }
    onCountsChange(counts);
  }, [allBubbles, onCountsChange]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['canned-response-bubbles', cannedResponseId] });
    qc.invalidateQueries({ queryKey: ['canned-responses-admin'] });
    qc.invalidateQueries({ queryKey: ['canned-responses-picker'] });
  };

  const createMut = useMutation({
    mutationFn: (type: BubbleType) =>
      api.post(`/staff-chat/canned-responses/${cannedResponseId}/bubbles`, {
        type,
        // When a specific channel tab is active, scope the new bubble to that channel.
        // ALL → empty array (applies to every channel — default behaviour).
        channels: channelFilter === 'ALL' ? [] : [channelFilter],
      }),
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
    // Reorder uses ALL bubbles' sortOrder, not just visible ones — preserves
    // cross-channel ordering when active tab is filtered. Logic extracted into
    // `reorderBubbles` so it can be unit-tested (bubble-reorder-logic.test.ts).
    reorderMut.mutate(reorderBubbles(allBubbles, String(active.id), String(over.id)));
  };

  // Cap of 5 applies to TOTAL bubbles in the template (LINE push limit).
  const canAdd = allBubbles.length < 5;
  const isFiltered = channelFilter !== 'ALL';
  const filterLabel = isFiltered ? CHANNEL_LABELS[channelFilter as Channel] : '';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold leading-snug">
          ข้อความ ({visibleBubbles.length}/{allBubbles.length} แสดง · {allBubbles.length}/5 บับเบิ้ล)
        </h4>
      </div>
      {isFiltered && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          แสดงเฉพาะ bubble ที่ใช้กับ <strong>{filterLabel}</strong> — bubble ที่สร้างใหม่จะถูกตั้ง channel เป็น{' '}
          {filterLabel} โดยอัตโนมัติ (แก้ได้ผ่าน chips ในแต่ละ bubble)
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleBubbles.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {visibleBubbles.map((bubble) => (
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
      {visibleBubbles.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground leading-snug border border-dashed border-border rounded-lg">
          {isFiltered
            ? `ยังไม่มี bubble สำหรับ ${filterLabel} — เพิ่มด้านล่าง`
            : 'ยังไม่มี bubble — เพิ่มประเภทข้อความด้านล่าง'}
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
        <p className="text-xs text-muted-foreground leading-snug">
          ถึงขีดจำกัด 5 บับเบิ้ลแล้ว (รวมทุก channel) — ลบบางบับเบิ้ลก่อนเพิ่มใหม่
        </p>
      )}
    </div>
  );
}
