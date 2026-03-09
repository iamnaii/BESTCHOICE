import { Settings, Plus, Save, Undo2, Eye, EyeOff, Download, Loader2 } from 'lucide-react';
import { useTemplateStore } from '@/store/templateStore';

export default function HeaderBar() {
  const {
    currentTemplate, templates, previewMode, isSaving, isLoading,
    setPreviewMode, setShowSettings, setShowExportModal,
    addBlock, saveTemplateToApi, undo, isDirty, loadTemplate,
  } = useTemplateStore();

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id && id !== currentTemplate.id) {
      if (isDirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการเปลี่ยนเทมเพลตหรือไม่?')) return;
      loadTemplate(id);
    }
  };

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3">
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

      {isDirty && <span className="text-xs text-amber-600">* ยังไม่ได้บันทึก</span>}
      {isSaving && <span className="text-xs text-blue-600 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> กำลังบันทึก...</span>}

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
        onClick={() => saveTemplateToApi()}
        disabled={isSaving}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
      >
        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
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
