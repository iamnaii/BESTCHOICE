import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Settings, Plus, Save, Undo2, Eye, EyeOff, Download, Loader2, BookOpen } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';
import type { BlockType } from '@/types/template';

interface Props {
  onBack?: () => void;
  onToggleCheatSheet?: () => void;
  showCheatSheet?: boolean;
}

const QUICK_ADD_BLOCKS: { type: BlockType; label: string }[] = [
  { type: 'paragraph', label: 'ข้อความ' },
  { type: 'clause', label: 'ข้อสัญญา' },
  { type: 'heading', label: 'หัวเรื่อง' },
  { type: 'subheading', label: 'หัวข้อย่อย' },
  { type: 'party-info', label: 'คู่สัญญา' },
  { type: 'product-info', label: 'ข้อมูลสินค้า' },
  { type: 'payment-table', label: 'ตารางค่างวด' },
  { type: 'signature-block', label: 'ช่องลายเซ็น' },
  { type: 'photo-attachment', label: 'แนบรูปภาพ' },
];

export default function HeaderBar({ onBack, onToggleCheatSheet, showCheatSheet }: Props) {
  const {
    currentTemplate, templates, previewMode, isSaving, isLoading,
    setPreviewMode, setShowSettings, setShowExportModal,
    addBlock, saveTemplateToApi, undo, isDirty, loadTemplate,
  } = useTemplateStore();

  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showAddMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showAddMenu]);

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id && id !== currentTemplate.id) {
      if (isDirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการเปลี่ยนเทมเพลตหรือไม่?')) return;
      loadTemplate(id);
    }
  };

  const handleAddBlock = (type: BlockType) => {
    addBlock(type);
    setShowAddMenu(false);
  };

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-2">
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50 transition-colors mr-1"
        >
          <ArrowLeft size={16} />
        </button>
      )}

      {/* Template selector */}
      <select
        value={currentTemplate.id}
        onChange={handleTemplateChange}
        disabled={isLoading}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 max-w-[320px] disabled:opacity-50"
      >
        {templates.length === 0 && (
          <option value="">กำลังโหลด...</option>
        )}
        {templates.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {isDirty && <span className="text-xs text-amber-600">*</span>}
      {isSaving && <span className="text-xs text-blue-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /></span>}

      <div className="flex-1" />

      {/* Cheat sheet toggle */}
      {onToggleCheatSheet && (
        <button
          onClick={onToggleCheatSheet}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
            showCheatSheet
              ? 'bg-amber-100 text-amber-700 border border-amber-300'
              : 'text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          <BookOpen size={14} />
          ตัวแปร
        </button>
      )}

      <button
        onClick={() => setShowSettings(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Settings size={14} />
        ตั้งค่า
      </button>

      {/* Add block dropdown */}
      <div className="relative" ref={addMenuRef}>
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Plus size={14} />
          เพิ่ม
        </button>
        {showAddMenu && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 w-48 py-1">
            {QUICK_ADD_BLOCKS.map(b => (
              <button
                key={b.type}
                onClick={() => handleAddBlock(b.type)}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-violet-50 hover:text-violet-700 transition-colors"
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => saveTemplateToApi()}
        disabled={isSaving}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        บันทึก
      </button>

      <button
        onClick={() => undo()}
        className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={14} />
      </button>

      <button
        onClick={() => setPreviewMode(!previewMode)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
          previewMode
            ? 'bg-violet-600 text-white hover:bg-violet-700'
            : 'text-gray-700 border border-gray-300 hover:bg-gray-50'
        }`}
      >
        {previewMode ? <EyeOff size={14} /> : <Eye size={14} />}
        {previewMode ? 'แก้ไข' : 'Preview'}
      </button>

      <button
        onClick={() => setShowExportModal(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
      >
        <Download size={14} />
        PDF
      </button>
    </div>
  );
}
