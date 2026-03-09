import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import toast from 'react-hot-toast';
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
  const [activeSidebarId, setActiveSidebarId] = useState('template');
  const {
    previewMode, editingBlock, showSettings, showExportModal,
    isDirty, saveTemplate, loadFromLocalStorage,
  } = useTemplateStore();

  // Keyboard shortcuts
  useKeyboardShortcuts();

  // Load draft from localStorage on mount
  useEffect(() => {
    loadFromLocalStorage();
  }, [loadFromLocalStorage]);

  // Auto-save every 30 seconds when dirty
  useEffect(() => {
    if (!isDirty) return;
    const timer = setInterval(() => {
      saveTemplate();
      toast.success('บันทึกอัตโนมัติ', { duration: 1500, icon: '💾' });
    }, AUTO_SAVE_INTERVAL);
    return () => clearInterval(timer);
  }, [isDirty, saveTemplate]);

  return (
    <div className="fixed inset-0 flex bg-gray-100" style={{ fontFamily: "'Sarabun', sans-serif" }}>
      {/* Left Sidebar */}
      <EditorSidebar activeId={activeSidebarId} onSelect={setActiveSidebarId} />

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
