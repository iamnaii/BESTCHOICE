import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { FileText } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';
import BlockItem from './BlockItem';

export default function BlockList() {
  const { currentTemplate, reorderBlocks } = useTemplateStore();
  const blocks = currentTemplate.blocks;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = blocks.map(b => b.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newIds = [...ids];
    newIds.splice(oldIndex, 1);
    newIds.splice(newIndex, 0, active.id as string);
    reorderBlocks(newIds);
  };

  return (
    <div className="space-y-3 p-5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {(() => {
            let clauseCounter = 0;
            return blocks.map((block, index) => {
              const clauseIndex = block.type === 'clause' ? ++clauseCounter : undefined;
              return <BlockItem key={block.id} block={block} index={index} totalBlocks={blocks.length} clauseIndex={clauseIndex} />;
            });
          })()}
        </SortableContext>
      </DndContext>

      {blocks.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <FileText size={48} className="mx-auto mb-4 text-slate-300" />
          <p className="text-lg font-medium text-slate-500 mb-2">ยังไม่มี block</p>
          <p className="text-base">กดปุ่ม "เพิ่ม" ด้านบนเพื่อเริ่มสร้างเอกสาร</p>
        </div>
      )}
    </div>
  );
}
