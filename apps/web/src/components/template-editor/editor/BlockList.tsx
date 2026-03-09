import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
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
    <div className="space-y-2 p-4">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, index) => (
            <BlockItem key={block.id} block={block} index={index} totalBlocks={blocks.length} />
          ))}
        </SortableContext>
      </DndContext>

      {blocks.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-2">ยังไม่มี block</p>
          <p className="text-sm">กดปุ่ม "เพิ่มข้อมูล" เพื่อเริ่มสร้างเอกสาร</p>
        </div>
      )}
    </div>
  );
}
