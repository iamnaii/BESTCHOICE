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
    <div className="h-14 bg-white border-b border-slate-200 flex items-center px-5 gap-2.5">
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2.5 py-2 text-sm text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition-colors mr-1"
        >
          <ArrowLeft size={16} />
        </button>
      )}

      {/* Template selector */}
      <select
        value={currentTemplate.id}
        onChange={handleTemplateChange}
        disabled={isLoading}
        className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 max-w-[320px] disabled:opacity-50"
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
          className={`flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg transition-colors ${
            showCheatSheet
              ? 'bg-amber-100 text-amber-700 border border-amber-300'
              : 'text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <BookOpen size={16} />
          ตัวแปร
        </button>
      )}

      <button
        onClick={() => setShowSettings(true)}
        className="flex items-center gap-1.5 px-3.5 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
      >
        <Settings size={16} />
        ตั้งค่า
      </button>

      {/* Add block dropdown */}
      <div className="relative" ref={addMenuRef}>
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Plus size={16} />
          เพิ่ม
        </button>
        {showAddMenu && (
          <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 w-48 py-1">
            {QUICK_ADD_BLOCKS.map(b => (
              <button
                key={b.type}
                onClick={() => handleAddBlock(b.type)}
                className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-primary-50 hover:text-primary-700 transition-colors"
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
        className="flex items-center gap-1.5 px-3.5 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        บันทึก
      </button>

      <button
        onClick={() => undo()}
        className="flex items-center gap-1.5 px-2.5 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={16} />
      </button>

      <button
        onClick={() => setPreviewMode(!previewMode)}
        className={`flex items-center gap-1.5 px-3.5 py-2 text-sm rounded-lg transition-colors ${
          previewMode
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'text-slate-600 border border-slate-200 hover:bg-slate-50'
        }`}
      >
        {previewMode ? <EyeOff size={16} /> : <Eye size={16} />}
        {previewMode ? 'แก้ไข' : 'Preview'}
      </button>

      <button
        onClick={() => setShowExportModal(true)}
        className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Download size={16} />
        PDF
      </button>
    </div>
  );
}
