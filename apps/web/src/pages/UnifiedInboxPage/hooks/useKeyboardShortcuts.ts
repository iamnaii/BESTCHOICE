import { useEffect, useCallback } from 'react';

interface ShortcutActions {
  onOpenPalette: () => void;
  onResolve?: () => void;
  onEscape?: () => void;
}

const isEditableTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || node.isContentEditable;
};

export function useKeyboardShortcuts(actions: ShortcutActions) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      // Don't hijack shortcuts while the user is typing in a field — Cmd+K /
      // Ctrl+Shift+R would otherwise yank focus out of the composer mid-message.
      // Escape stays active everywhere so it can still close the palette.
      const typing = isEditableTarget(e.target);

      // Cmd+K or Ctrl+K -> open command palette
      if (!typing && (e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        actions.onOpenPalette();
      }
      // Cmd+Shift+R or Ctrl+Shift+R -> resolve session
      if (!typing && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
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
