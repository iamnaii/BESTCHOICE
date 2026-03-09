import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplateStore } from '@/store/templateStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import EditorSidebar from '@/components/template-editor/layout/EditorSidebar';
import HeaderBar from '@/components/template-editor/layout/HeaderBar';
import CheatSheet from '@/components/template-editor/layout/CheatSheet';
import BlockList from '@/components/template-editor/editor/BlockList';
import BlockEditModal from '@/components/template-editor/editor/BlockEditModal';
import DocumentPreview from '@/components/template-editor/preview/DocumentPreview';
import SettingsModal from '@/components/template-editor/modals/SettingsModal';
import PDFExportModal from '@/components/template-editor/pdf/PDFExportModal';

// Auto-save interval (30 seconds)
const AUTO_SAVE_INTERVAL = 30_000;

export default function ContractTemplatesPage() {
  const navigate = useNavigate();
  const [activeSidebarId, setActiveSidebarId] = useState('template');
  const {
    previewMode, editingBlock, showSettings, showExportModal,
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

  const handleBack = () => {
    if (isDirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกหรือไม่?')) return;
    navigate('/');
  };

  return (
    <div className="-m-6 flex bg-gray-100" style={{ fontFamily: "'Sarabun', sans-serif", height: 'calc(100vh - 56px)' }}>
      {/* Left Sidebar */}
      <EditorSidebar activeId={activeSidebarId} onSelect={setActiveSidebarId} onBack={handleBack} />

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Bar */}
        <HeaderBar />

        {/* Content Area: CheatSheet + Editor/Preview */}
        <div className="flex-1 flex overflow-hidden">
          {/* Cheat Sheet Panel */}
          <CheatSheet />

          {/* Main Panel: Editor or Preview */}
          {previewMode ? (
            <DocumentPreview />
          ) : (
            <div className="flex-1 overflow-y-auto bg-gray-50">
              <BlockList />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {editingBlock && <BlockEditModal />}
      {showSettings && <SettingsModal />}
      {showExportModal && <PDFExportModal />}
    </div>
  );
}
