import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ChevronDown, ChevronRight, Copy, Pencil, Trash2, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  name: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRename: (newName: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function CategoryHeader({ name, count, isExpanded, onToggle, onRename, onDuplicate, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `__category__${name}`,
    data: { type: 'category', categoryName: name },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const [isRenaming, setIsRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) inputRef.current?.focus();
  }, [isRenaming]);

  const startRename = () => {
    setDraft(name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center gap-2 py-2 pr-2 hover:bg-accent/60 text-sm font-medium leading-snug',
        isDragging && 'opacity-50',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-0.5"
        title="ลากเพื่อย้ายหมวด"
        aria-label="ลากเพื่อย้ายหมวด"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onToggle}
        className="text-muted-foreground hover:text-foreground"
        title={isExpanded ? 'ย่อ' : 'ขยาย'}
        aria-label={isExpanded ? 'ย่อ' : 'ขยาย'}
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {isRenaming ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onBlur={commitRename}
            className="flex-1 bg-background border border-border rounded px-1.5 py-0.5 text-sm"
            aria-label="แก้ชื่อหมวด"
          />
          <button onClick={commitRename} className="p-1 text-primary hover:bg-primary/5 rounded" title="บันทึก" aria-label="บันทึก">
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setIsRenaming(false)} className="p-1 text-muted-foreground hover:bg-muted rounded" title="ยกเลิก" aria-label="ยกเลิก">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-foreground cursor-pointer" onClick={onToggle}>{name}</span>
          <span className="text-[10px] text-muted-foreground">{count}</span>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
            <button onClick={onDuplicate} className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded" title="ทำซ้ำหมวด" aria-label="ทำซ้ำหมวด">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button onClick={startRename} className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded" title="แก้ชื่อ" aria-label="แก้ชื่อ">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" title="ลบหมวด" aria-label="ลบหมวด">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
