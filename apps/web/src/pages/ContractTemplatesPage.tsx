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

export default function ContractTemplatesPage() {
  const navigate = useNavigate();
  const [showCheatSheet, setShowCheatSheet] = useState(false);
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

  return (
    <div className="-m-6 flex flex-col bg-gray-100" style={{ fontFamily: "'Sarabun', sans-serif", height: 'calc(100vh - 56px)' }}>
      {/* Header Bar */}
      <HeaderBar onBack={() => {
        if (isDirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกหรือไม่?')) return;
        navigate('/');
      }} onToggleCheatSheet={() => setShowCheatSheet(v => !v)} showCheatSheet={showCheatSheet} />

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Cheat Sheet Panel (collapsible) */}
        {showCheatSheet && <CheatSheet />}

        {/* Main Panel: Editor or Preview */}
        {previewMode ? (
          <DocumentPreview />
        ) : (
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <BlockList />
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
