import { useState, useMemo } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import CategoryHeader from './CategoryHeader';
import TemplateItem from './TemplateItem';
import {
  groupByCategory,
  moveItemInList,
  moveItemAcrossCategories,
  moveCategory,
  flattenToReorderItems,
} from './reorder-logic';
import type { CannedResponse, ReorderItem } from './types';

interface Props {
  templates: CannedResponse[];
  selectedId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectTemplate: (id: string) => void;
  onAddTemplate: (category: string) => void;
  onDuplicateTemplate: (id: string) => void;
  onDeleteTemplate: (id: string) => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onDuplicateCategory: (name: string) => void;
  onDeleteCategory: (name: string) => void;
  onReorder: (items: ReorderItem[]) => void;
}

export default function CategoryTreePane(props: Props) {
  const {
    templates, selectedId, searchQuery, onSearchChange,
    onSelectTemplate, onAddTemplate, onDuplicateTemplate, onDeleteTemplate,
    onRenameCategory, onDuplicateCategory, onDeleteCategory, onReorder,
  } = props;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.content.toLowerCase().includes(q) ||
        t.shortcut.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q),
    );
  }, [templates, searchQuery]);

  const groups = useMemo(() => groupByCategory(filteredTemplates), [filteredTemplates]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const toggleCategory = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as { type: 'category' | 'template'; categoryName: string } | undefined;
    const overData = over.data.current as { type: 'category' | 'template'; categoryName: string } | undefined;
    if (!activeData || !overData) return;

    let newList: CannedResponse[] | null = null;

    if (activeData.type === 'category') {
      const groupOrder = groups.map((g) => g.name);
      const toIdx = groupOrder.indexOf(overData.categoryName);
      if (toIdx >= 0) {
        newList = moveCategory(templates, activeData.categoryName, toIdx);
      }
    } else if (activeData.type === 'template') {
      const activeId = String(active.id);
      if (overData.type === 'template') {
        if (activeData.categoryName === overData.categoryName) {
          const group = groups.find((g) => g.name === activeData.categoryName);
          if (group) {
            const toIdx = group.items.findIndex((x) => x.id === String(over.id));
            if (toIdx >= 0) newList = moveItemInList(templates, activeId, toIdx);
          }
        } else {
          const targetGroup = groups.find((g) => g.name === overData.categoryName);
          if (targetGroup) {
            const toIdx = targetGroup.items.findIndex((x) => x.id === String(over.id));
            newList = moveItemAcrossCategories(templates, activeId, overData.categoryName, Math.max(toIdx, 0));
          }
        }
      } else if (overData.type === 'category') {
        newList = moveItemAcrossCategories(templates, activeId, overData.categoryName, 0);
      }
    }

    if (newList) {
      onReorder(flattenToReorderItems(newList));
    }
  };

  const sortableIds = groups.flatMap((g) => [
    `__category__${g.name}`,
    ...(expanded.has(g.name) ? g.items.map((i) => i.id) : []),
  ]);

  return (
    <div className="flex flex-col h-full border-r border-border bg-card">
      <div className="px-3 py-3 border-b border-border bg-muted/30">
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="ค้นหา..."
          className="text-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center leading-snug">
            ยังไม่มี template
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            {groups.map((group) => {
              const isExp = expanded.has(group.name);
              return (
                <div key={group.name}>
                  <CategoryHeader
                    name={group.name}
                    count={group.items.length}
                    isExpanded={isExp}
                    onToggle={() => toggleCategory(group.name)}
                    onRename={(newName) => onRenameCategory(group.name, newName)}
                    onDuplicate={() => onDuplicateCategory(group.name)}
                    onDelete={() => onDeleteCategory(group.name)}
                  />
                  {isExp && (
                    <div className="pl-5">
                      {group.items.map((item) => (
                        <TemplateItem
                          key={item.id}
                          template={item}
                          isSelected={selectedId === item.id}
                          onSelect={() => onSelectTemplate(item.id)}
                          onDuplicate={() => onDuplicateTemplate(item.id)}
                          onDelete={() => onDeleteTemplate(item.id)}
                        />
                      ))}
                      <button
                        onClick={() => onAddTemplate(group.name)}
                        className="w-full px-4 py-1.5 text-left text-sm text-primary hover:bg-primary/5 flex items-center gap-2"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        เพิ่มประเภทข้อความ
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
      {activeDragId && (
        <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
          กำลังลาก...
        </div>
      )}
    </div>
  );
}
