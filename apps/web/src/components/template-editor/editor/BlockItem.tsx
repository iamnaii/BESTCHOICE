import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ChevronUp, ChevronDown, Edit3, Copy, Trash2, ChevronRight, ChevronDown as ChevronDownIcon } from 'lucide-react';
import type { Block } from '@/types/template';
import { BLOCK_TYPES } from '@/constants/blockTypes';
import { useTemplateStore } from '@/store/templateStore';

interface Props {
  block: Block;
  index: number;
  totalBlocks: number;
  clauseIndex?: number;
}

const TYPE_COLORS: Record<string, string> = {
  'heading': 'bg-blue-50 text-blue-700',
  'subheading': 'bg-blue-50 text-blue-600',
  'paragraph': 'bg-slate-100 text-slate-600',
  'clause': 'bg-amber-50 text-amber-700',
  'party-info': 'bg-emerald-50 text-emerald-700',
  'product-info': 'bg-teal-50 text-teal-700',
  'payment-table': 'bg-purple-50 text-purple-700',
  'signature-block': 'bg-pink-50 text-pink-700',
  'photo-attachment': 'bg-indigo-50 text-indigo-700',
  'contract-header': 'bg-sky-50 text-sky-700',
  'agreement': 'bg-slate-100 text-slate-600',
  'emergency-contacts': 'bg-orange-50 text-orange-700',
  'attachment-list': 'bg-violet-50 text-violet-700',
  'column': 'bg-cyan-50 text-cyan-700',
  'column-vertical': 'bg-cyan-50 text-cyan-700',
  'numbered': 'bg-slate-100 text-slate-600',
};

export default function BlockItem({ block, index, totalBlocks, clauseIndex }: Props) {
  const { deleteBlock, duplicateBlock, moveBlock, setEditingBlock, toggleCollapse } = useTemplateStore();

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const blockType = BLOCK_TYPES.find(t => t.value === block.type);
  const label = blockType?.label || block.type;

  const handleDelete = () => {
    if (confirm('ต้องการลบ block นี้?')) {
      deleteBlock(block.id);
    }
  };

  // Truncate content for display (strip HTML tags if rich text)
  const plainText = block.content.replace(/<[^>]*>/g, '').replace(/\{\{[^}]*\}\}/g, '[…]');
  const displayContent = plainText.substring(0, 160);

  const badgeColor = TYPE_COLORS[block.type] || 'bg-primary-50 text-primary-700';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group border rounded-xl bg-white transition-all ${
        isDragging ? 'shadow-lg border-primary-300' : 'border-slate-200 hover:border-primary-200 hover:shadow-md'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 -ml-1"
        >
          <GripVertical size={18} />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => toggleCollapse(block.id)}
          className="text-slate-400 hover:text-slate-600 -ml-1"
        >
          {block.collapsed ? <ChevronRight size={16} /> : <ChevronDownIcon size={16} />}
        </button>

        {/* Type badge */}
        <span className={`text-xs px-3 py-1.5 rounded-full font-semibold tracking-wide ${badgeColor}`}>
          {label}
        </span>

        {/* Clause number */}
        {block.type === 'clause' && clauseIndex ? (
          <span className="text-sm text-slate-600 font-medium">
            ข้อ {clauseIndex}{block.clauseTitle ? ` — ${block.clauseTitle}` : ''}
          </span>
        ) : null}

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => moveBlock(index, Math.max(0, index - 1))}
            disabled={index === 0}
            className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded-lg hover:bg-slate-100"
            title="เลื่อนขึ้น"
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={() => moveBlock(index, Math.min(totalBlocks - 1, index + 1))}
            disabled={index === totalBlocks - 1}
            className="p-2 text-slate-400 hover:text-slate-600 disabled:opacity-30 rounded-lg hover:bg-slate-100"
            title="เลื่อนลง"
          >
            <ChevronDown size={16} />
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1" />

          <button
            onClick={() => setEditingBlock(block)}
            className="p-2 text-slate-400 hover:text-primary-600 rounded-lg hover:bg-primary-50"
            title="แก้ไข"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => duplicateBlock(block.id)}
            className="p-2 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-50"
            title="สำเนา"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={handleDelete}
            className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
            title="ลบ"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Content preview */}
      {!block.collapsed && (
        <div
          className="px-5 py-3.5 text-sm leading-relaxed text-slate-600 cursor-pointer hover:bg-slate-50/60 rounded-b-xl transition-colors"
          onClick={() => setEditingBlock(block)}
        >
          {displayContent || <span className="text-slate-400 italic">คลิกเพื่อเพิ่มเนื้อหา...</span>}
        </div>
      )}
    </div>
  );
}
