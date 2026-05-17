import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router';

/**
 * Global keyboard shortcuts for the app.
 * Returns state for the shortcuts help overlay.
 *
 * D1.4.1.2 — when `disabled` is true (`show_keyboard_shortcuts=false`),
 * the global "?" help-dialog binding becomes a no-op. Navigation shortcuts
 * (Alt+N/C/P/S/D, Ctrl+/) keep working — they're power-user productivity
 * features, not UI affordances the flag aims to hide. The flag's intent
 * is to suppress *advertised* shortcuts, not lock out users who already
 * know them.
 */
export function useGlobalShortcuts(options?: { disabled?: boolean }) {
  const disabled = options?.disabled ?? false;
  const navigate = useNavigate();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const isInputFocused = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target;

      // Shift+? — toggle shortcuts help (allow even in inputs)
      if (e.shiftKey && e.key === '?') {
        // Don't fire if user is typing in an input
        if (isInputFocused(target)) return;
        // D1.4.1.2 — suppress help dialog when keyboard shortcuts are disabled
        if (disabled) return;
        e.preventDefault();
        setShowShortcutsHelp((prev) => !prev);
        return;
      }

      // Escape — close help overlay or blur active element
      if (e.key === 'Escape') {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
          return;
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        return;
      }

      // Skip all other shortcuts if user is typing in an input/textarea
      if (isInputFocused(target)) return;

      // Ctrl+/ or Cmd+/ — focus search input
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        const searchInput =
          document.querySelector<HTMLInputElement>('input[type="search"]') ||
          document.querySelector<HTMLInputElement>('input[placeholder*="ค้นหา"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Alt+key navigation shortcuts
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'n':
            e.preventDefault();
            navigate('/contracts/create');
            break;
          case 'c':
            e.preventDefault();
            navigate('/customers');
            break;
          case 'p':
            e.preventDefault();
            navigate('/payments');
            break;
          case 's':
            e.preventDefault();
            navigate('/stock');
            break;
          case 'd':
            e.preventDefault();
            navigate('/');
            break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, isInputFocused, showShortcutsHelp, disabled]);

  return { showShortcutsHelp, setShowShortcutsHelp };
}
