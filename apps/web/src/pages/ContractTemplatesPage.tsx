import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplateStore } from '@/store/templateStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import HeaderBar from '@/components/template-editor/layout/HeaderBar';
import CheatSheet from '@/components/template-editor/layout/CheatSheet';
import BlockList from '@/components/template-editor/editor/BlockList';
import BlockEditModal from '@/components/template-editor/editor/BlockEditModal';
import DocumentPreview from '@/components/template-editor/preview/DocumentPreview';
import SettingsModal from '@/components/template-editor/modals/SettingsModal';
import PDFExportModal from '@/components/template-editor/pdf/PDFExportModal';

// Auto-save interval (30 seconds)
const AUTO_SAVE_INTERVAL = 30_000;

export type ViewMode = 'split' | 'editor' | 'preview';

export default function ContractTemplatesPage() {
  const navigate = useNavigate();
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const {
    editingBlock, showSettings, showExportModal,
    isDirty, saveTemplate, saveTemplateToApi, fetchTemplates, loadFromLocalStorage,
  } = useTemplateStore();

  // Keyboard shortcuts
  useKeyboardShortcuts();

  // Fetch templates from API on mount, load localStorage draft as fallback
  useEffect(() => {
    loadFromLocalStorage();
    fetchTemplates();
  }, [fetchTemplates, loadFromLocalStorage]);

  // Auto-save every 30 seconds when dirty — save to both localStorage and API
  useEffect(() => {
    if (!isDirty) return;
    const timer = setInterval(() => {
      saveTemplate();
      saveTemplateToApi();
    }, AUTO_SAVE_INTERVAL);
    return () => clearInterval(timer);
  }, [isDirty, saveTemplate, saveTemplateToApi]);

  const showEditor = viewMode === 'split' || viewMode === 'editor';
  const showPreview = viewMode === 'split' || viewMode === 'preview';

  return (
    <div className="-m-6 flex flex-col bg-slate-50" style={{ fontFamily: "'TH Sarabun PSK', sans-serif", height: 'calc(100vh - 56px)' }}>
      {/* Header Bar */}
      <HeaderBar
        onBack={() => {
          if (isDirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกหรือไม่?')) return;
          navigate('/');
        }}
        onToggleCheatSheet={() => setShowCheatSheet(v => !v)}
        showCheatSheet={showCheatSheet}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Cheat Sheet Panel (collapsible) */}
        {showCheatSheet && <CheatSheet />}

        {/* Editor Panel */}
        {showEditor && (
          <div className={`overflow-y-auto bg-slate-50 ${showPreview ? 'w-1/2 border-r border-slate-200' : 'flex-1'}`}>
            {/* Section label */}
            <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 px-5 py-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Editor — Blocks</span>
            </div>
            <BlockList />
          </div>
        )}

        {/* Preview Panel */}
        {showPreview && (
          <div className={showEditor ? 'w-1/2' : 'flex-1'}>
            {/* Section label */}
            <div className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-sm border-b border-slate-200 px-5 py-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Preview — A4 Document</span>
            </div>
            <DocumentPreview compact={showEditor} />
          </div>
        )}
      </div>

      {/* Modals */}
      {editingBlock && <BlockEditModal />}
      {showSettings && <SettingsModal />}
      {showExportModal && <PDFExportModal />}
    </div>
  );
}
