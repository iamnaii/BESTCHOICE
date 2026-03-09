import { Settings, Plus, Save, Undo2, Eye, EyeOff, Download } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';

export default function HeaderBar() {
  const {
    currentTemplate, templates, previewMode,
    setPreviewMode, setShowSettings, setShowExportModal,
    addBlock, saveTemplate, undo, selectTemplate, isDirty,
  } = useTemplateStore();

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
      {/* Template selector */}
      <select
        value={currentTemplate.name}
        onChange={e => selectTemplate(e.target.value)}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-violet-500 focus:border-violet-500 max-w-[320px]"
      >
        {templates.map(t => (
          <option key={t.id} value={t.name}>
            {t.name}{t.id === 'hire-purchase' ? ' ⭐' : ''}
          </option>
        ))}
      </select>

      {isDirty && <span className="text-xs text-amber-600">* ยังไม่ได้บันทึก</span>}

      <div className="flex-1" />

      {/* Action buttons */}
      <button
        onClick={() => setShowSettings(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Settings size={14} />
        ตั้งค่า
      </button>

      <button
        onClick={() => addBlock('paragraph')}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Plus size={14} />
        เพิ่มข้อมูล
      </button>

      <button
        onClick={() => saveTemplate()}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Save size={14} />
        บันทึก
      </button>

      <button
        onClick={() => undo()}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <Undo2 size={14} />
        Undo
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
        Export PDF
      </button>
    </div>
  );
}
