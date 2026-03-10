import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Settings, Plus, Save, Undo2, Download, Loader2, BookOpen, Columns2, PenLine, Eye } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';
import type { BlockType } from '@/types/template';
import type { ViewMode } from '@/pages/ContractTemplatesPage';

interface Props {
  onBack?: () => void;
  onToggleCheatSheet?: () => void;
  showCheatSheet?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
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

const VIEW_MODES: { mode: ViewMode; icon: typeof Columns2; label: string }[] = [
  { mode: 'editor', icon: PenLine, label: 'แก้ไข' },
  { mode: 'split', icon: Columns2, label: 'แบ่งหน้า' },
  { mode: 'preview', icon: Eye, label: 'Preview' },
];

export default function HeaderBar({ onBack, onToggleCheatSheet, showCheatSheet, viewMode, onViewModeChange }: Props) {
  const {
    currentTemplate, templates, isSaving, isLoading,
    setShowSettings, setShowExportModal,
    addBlock, saveTemplateToApi, undo, isDirty, loadTemplate,
    previewMode, setPreviewMode,
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
    <div className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-1.5">
      {/* === Left: Navigation & Template === */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1 p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
      )}

      <select
        value={currentTemplate.id}
        onChange={handleTemplateChange}
        disabled={isLoading}
        className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500 max-w-[320px] disabled:opacity-50"
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

      {isDirty && (
        <span className="text-xs font-medium text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">
          ยังไม่บันทึก
        </span>
      )}
      {isSaving && (
        <span className="text-xs text-primary-600 flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" />
          <span>กำลังบันทึก...</span>
        </span>
      )}

      <div className="flex-1" />

      {/* === Center: View Controls === */}
      <div className="flex items-center gap-1.5">
        {/* Preview mode toggle */}
        {(viewMode === 'split' || viewMode === 'preview') && (
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
              previewMode
                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                : 'text-slate-500 border border-slate-200 hover:bg-slate-50'
            }`}
            title="แสดงข้อมูลตัวอย่าง"
          >
            ตัวอย่างข้อมูล
          </button>
        )}

        {/* Cheat sheet toggle */}
        {onToggleCheatSheet && (
          <button
            onClick={onToggleCheatSheet}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
              showCheatSheet
                ? 'bg-amber-100 text-amber-700 border border-amber-300'
                : 'text-slate-500 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <BookOpen size={15} />
            ตัวแปร
          </button>
        )}

        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <Settings size={15} />
          <span className="hidden lg:inline">ตั้งค่า</span>
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-slate-200 mx-1" />

      {/* === Right: Actions === */}
      <div className="flex items-center gap-1.5">
        {/* Add block dropdown */}
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Plus size={15} />
            เพิ่ม
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-52 py-1.5">
              {QUICK_ADD_BLOCKS.map(b => (
                <button
                  key={b.type}
                  onClick={() => handleAddBlock(b.type)}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-600 hover:bg-primary-50 hover:text-primary-700 transition-colors"
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
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          <span className="hidden lg:inline">บันทึก</span>
        </button>

        <button
          onClick={() => undo()}
          className="p-2 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-7 bg-slate-200 mx-1" />

      {/* === Far Right: View Mode & Export === */}
      <div className="flex items-center gap-1.5">
        {/* View mode selector */}
        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
          {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => onViewModeChange(mode)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                viewMode === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
              title={label}
            >
              <Icon size={15} />
              <span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Download size={15} />
          PDF
        </button>
      </div>
    </div>
  );
}
