import { useEffect } from 'react';
import { useTemplateStore } from '@/store/templateStore';
import toast from 'react-hot-toast';

export function useKeyboardShortcuts() {
  const { saveTemplate, undo, setShowExportModal } = useTemplateStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 's':
            e.preventDefault();
            saveTemplate();
            toast.success('บันทึกแล้ว');
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
  }, [saveTemplate, undo, setShowExportModal]);
}
