import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Copy, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CannedResponse } from './types';

interface Props {
  template: CannedResponse;
  isSelected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function TemplateItem({ template, isSelected, onSelect, onDuplicate, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: template.id,
    data: { type: 'template', categoryName: template.category ?? 'อื่นๆ' },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 py-1.5 pr-2 cursor-pointer hover:bg-accent text-sm leading-snug',
        isSelected && 'bg-primary/10 border-l-2 border-primary',
        isDragging && 'opacity-50',
      )}
      onClick={onSelect}
    >
      <button
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
        title="ลากเพื่อย้าย"
        aria-label="ลากเพื่อย้าย"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <span className="flex-1 truncate text-foreground">{template.title}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
          title="ทำซ้ำ"
          aria-label="ทำซ้ำ"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
          title="ลบ"
          aria-label="ลบ"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
