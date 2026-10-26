import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTemplateStore } from '@/store/templateStore';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import HeaderBar from '@/components/template-editor/layout/HeaderBar';
import CheatSheet from '@/components/template-editor/layout/CheatSheet';
import BlockList from '@/components/template-editor/editor/BlockList';
import BlockEditModal from '@/components/template-editor/editor/BlockEditModal';
import DocumentPreview from '@/components/template-editor/preview/DocumentPreview';
import SettingsModal from '@/components/template-editor/modals/SettingsModal';
import PDFExportModal from '@/components/template-editor/pdf/PDFExportModal';
import { useIsMobile } from '@/hooks/useIsMobile';

// Auto-save interval (30 seconds)
const AUTO_SAVE_INTERVAL = 30_000;

export type ViewMode = 'split' | 'editor' | 'preview';

export default function ContractTemplatesPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const {
    editingBlock, showSettings, showExportModal,
    isDirty, saveTemplate, saveTemplateToApi, fetchTemplates, loadFromLocalStorage,
  } = useTemplateStore();
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

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

  const effectiveView = isMobile && viewMode === 'split' ? 'editor' : viewMode;
  const showEditor = effectiveView === 'split' || effectiveView === 'editor';
  const showPreview = effectiveView === 'split' || effectiveView === 'preview';

  return (
    <div className="flex min-w-0 max-w-full flex-col overflow-hidden bg-secondary/80 font-sans min-h-[28rem] h-[calc(100dvh-10rem)] lg:h-[calc(100dvh-7rem)]">
      {/* Header Bar */}
      <HeaderBar
        onBack={() => {
          if (isDirty) {
            setConfirmDialog({ open: true, message: 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการออกหรือไม่?', action: () => navigate('/') });
            return;
          }
          navigate('/');
        }}
        onToggleCheatSheet={() => setShowCheatSheet(v => !v)}
        showCheatSheet={showCheatSheet}
        viewMode={effectiveView}
        onViewModeChange={setViewMode}
      />

      {/* Content Area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row overflow-hidden">
        {/* Cheat Sheet Panel (collapsible) */}
        {showCheatSheet && <CheatSheet />}

        {/* Editor Panel */}
        {showEditor && (
          <div className={`min-h-0 min-w-0 overflow-y-auto bg-secondary ${showPreview ? 'w-1/2 border-r border-border' : 'flex-1'}`}>
            <BlockList />
          </div>
        )}

        {/* Preview Panel */}
        {showPreview && (
          <div className={`min-h-0 min-w-0 ${showEditor ? 'w-1/2' : 'flex-1'}`}>
            <DocumentPreview compact={showEditor} />
          </div>
        )}
      </div>

      {/* Modals */}
      {editingBlock && <BlockEditModal />}
      {showSettings && <SettingsModal />}
      {showExportModal && <PDFExportModal />}
      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} onConfirm={confirmDialog.action} />
    </div>
  );
}
