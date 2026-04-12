import { useEffect, useCallback } from 'react';

interface ShortcutActions {
  onOpenPalette: () => void;
  onResolve?: () => void;
  onEscape?: () => void;
}

export function useKeyboardShortcuts(actions: ShortcutActions) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K -> open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        actions.onOpenPalette();
      }
      // Cmd+Shift+R or Ctrl+Shift+R -> resolve session
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        actions.onResolve?.();
      }
      // Escape -> close palette or deselect
      if (e.key === 'Escape') {
        actions.onEscape?.();
      }
    },
    [actions],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
