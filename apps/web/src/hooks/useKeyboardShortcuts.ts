import { useEffect } from 'react';
import { useTemplateStore } from '@/store/templateStore';

export function useKeyboardShortcuts() {
  const { saveTemplateToApi, undo, setShowExportModal } = useTemplateStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            saveTemplateToApi();
            break;
          case 'z':
            if (!e.shiftKey) {
              e.preventDefault();
              undo();
            }
            break;
          case 'p':
            e.preventDefault();
            setShowExportModal(true);
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveTemplateToApi, undo, setShowExportModal]);
}
