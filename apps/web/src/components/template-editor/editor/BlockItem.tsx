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
}

export default function BlockItem({ block, index, totalBlocks }: Props) {
  const { updateBlock, deleteBlock, duplicateBlock, moveBlock, setEditingBlock, toggleCollapse } = useTemplateStore();

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
  const displayContent = plainText.substring(0, 120);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group border rounded-lg bg-white transition-shadow ${
        isDragging ? 'shadow-lg border-violet-300' : 'border-gray-200 hover:border-violet-200 hover:shadow-sm'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
        >
          <GripVertical size={16} />
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => toggleCollapse(block.id)}
          className="text-gray-400 hover:text-gray-600"
        >
          {block.collapsed ? <ChevronRight size={14} /> : <ChevronDownIcon size={14} />}
        </button>

        {/* Type badge */}
        <span className="text-xs px-2.5 py-0.5 bg-violet-50 text-violet-700 rounded-full font-medium">
          {label}
        </span>

        {/* Clause number */}
        {block.clauseNumber ? (
          <span className="text-xs text-gray-500 font-medium">
            ข้อ {block.clauseNumber}{block.clauseTitle ? `: ${block.clauseTitle}` : ''}
          </span>
        ) : null}

        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => moveBlock(index, Math.max(0, index - 1))}
            disabled={index === 0}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            title="เลื่อนขึ้น"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => moveBlock(index, Math.min(totalBlocks - 1, index + 1))}
            disabled={index === totalBlocks - 1}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            title="เลื่อนลง"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setEditingBlock(block)}
            className="p-1 text-gray-400 hover:text-blue-600"
            title="แก้ไข"
          >
            <Edit3 size={14} />
          </button>
          <button
            onClick={() => duplicateBlock(block.id)}
            className="p-1 text-gray-400 hover:text-green-600"
            title="สำเนา"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 text-gray-400 hover:text-red-600"
            title="ลบ"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Content preview */}
      {!block.collapsed && (
        <div
          className="px-4 py-2 text-sm text-gray-600 cursor-pointer hover:bg-gray-50"
          onClick={() => setEditingBlock(block)}
        >
          {displayContent || <span className="text-gray-400 italic">คลิกเพื่อเพิ่มเนื้อหา...</span>}
          {block.subItems && block.subItems.length > 0 && (
            <div className="mt-1 text-xs text-gray-400">
              {block.subItems.length} ข้อย่อย
            </div>
          )}
        </div>
      )}
    </div>
  );
}
