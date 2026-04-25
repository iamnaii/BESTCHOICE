import { useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

/**
 * Collections-specific keyboard shortcut handler.
 *
 * Implements the spec from `docs/superpowers/plans/2026-04-25-collections-ui-p1.md` Task 9:
 * - Global: `?` opens help overlay; `Esc` closes
 * - Tab nav: 2-key combo `G` then `Q/F/P/A/N/L` (1.5s timeout for second key)
 * - Card actions: `J/K` or `↓/↑` move focus; `Enter` open Customer 360; `L` LINE; `C` log call;
 *   `P` payment; `S` snooze; `A` assign
 * - `/` focuses the filter chips search input (first text input within FilterChipsBar)
 *
 * Inputs are auto-disabled by `react-hotkeys-hook` (it skips when focus is on
 * input/textarea/contentEditable). We rely on its built-in detection via
 * `enableOnFormTags` defaulting to false.
 *
 * Lives outside `CollectionsPage` so the hook can be re-used by sub-tabs and the
 * existing `useKeyboardShortcuts` (template-page hook) is left untouched.
 */
export interface CollectionsKeyboardCallbacks {
  /** Tab navigation: queue / followup / promise / approval / aNalytics / aLl */
  onSwitchTab?: (tab: 'today' | 'followup' | 'promise' | 'approval' | 'analytics' | 'all') => void;
  /** Move focus inside the active queue (J/K or arrow keys) */
  onMoveFocus?: (direction: 1 | -1) => void;
  /** Enter — open Customer 360 for currently focused card */
  onOpenFocused?: () => void;
  /** L — open LINE composer for focused card */
  onLineFocused?: () => void;
  /** C — open call-log dialog for focused card */
  onCallFocused?: () => void;
  /** P — open payment-record dialog for focused card */
  onPaymentFocused?: () => void;
  /** S — open snooze dialog for focused card */
  onSnoozeFocused?: () => void;
  /** A — open assign dialog for focused card */
  onAssignFocused?: () => void;
}

const G_PREFIX_TIMEOUT_MS = 1500;

export function useCollectionsKeyboard(callbacks: CollectionsKeyboardCallbacks) {
  const [helpOpen, setHelpOpen] = useState(false);
  // `G` prefix state: true while we are waiting for the second key after a `G`.
  const [waitingForGSecond, setWaitingForGSecond] = useState(false);
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearGTimeout = useCallback(() => {
    if (gTimeoutRef.current) {
      clearTimeout(gTimeoutRef.current);
      gTimeoutRef.current = null;
    }
  }, []);

  const startGPrefix = useCallback(() => {
    setWaitingForGSecond(true);
    clearGTimeout();
    gTimeoutRef.current = setTimeout(() => {
      setWaitingForGSecond(false);
      gTimeoutRef.current = null;
    }, G_PREFIX_TIMEOUT_MS);
  }, [clearGTimeout]);

  const consumeGPrefix = useCallback(() => {
    setWaitingForGSecond(false);
    clearGTimeout();
  }, [clearGTimeout]);

  useEffect(() => () => clearGTimeout(), [clearGTimeout]);

  // ------- Global help / escape -------
  useHotkeys(
    'shift+/',
    (e) => {
      e.preventDefault();
      setHelpOpen((open) => !open);
    },
    { preventDefault: true },
  );

  useHotkeys('esc', () => {
    setHelpOpen(false);
    consumeGPrefix();
  });

  // ------- Focus filter search -------
  useHotkeys(
    '/',
    (e) => {
      // Built-in input detection skips this when typing — so a bare `/` from any
      // non-input focus jumps straight to the chip-bar search input.
      e.preventDefault();
      const input =
        document.querySelector<HTMLInputElement>('[data-collections-search] input') ||
        document.querySelector<HTMLInputElement>('input[placeholder*="ค้นหา"]');
      input?.focus();
      input?.select?.();
    },
    { preventDefault: true },
  );

  // ------- G-prefix tab navigation -------
  useHotkeys('g', () => startGPrefix(), { enabled: !waitingForGSecond });

  useHotkeys(
    'q',
    () => {
      if (!waitingForGSecond) return;
      consumeGPrefix();
      callbacks.onSwitchTab?.('today');
    },
    { enabled: waitingForGSecond },
    [waitingForGSecond, callbacks.onSwitchTab],
  );

  useHotkeys(
    'f',
    () => {
      if (!waitingForGSecond) return;
      consumeGPrefix();
      callbacks.onSwitchTab?.('followup');
    },
    { enabled: waitingForGSecond },
    [waitingForGSecond, callbacks.onSwitchTab],
  );

  useHotkeys(
    'p',
    () => {
      if (waitingForGSecond) {
        consumeGPrefix();
        callbacks.onSwitchTab?.('promise');
      } else {
        callbacks.onPaymentFocused?.();
      }
    },
    [waitingForGSecond, callbacks.onSwitchTab, callbacks.onPaymentFocused],
  );

  useHotkeys(
    'a',
    () => {
      if (waitingForGSecond) {
        consumeGPrefix();
        callbacks.onSwitchTab?.('approval');
      } else {
        callbacks.onAssignFocused?.();
      }
    },
    [waitingForGSecond, callbacks.onSwitchTab, callbacks.onAssignFocused],
  );

  useHotkeys(
    'n',
    () => {
      if (!waitingForGSecond) return;
      consumeGPrefix();
      callbacks.onSwitchTab?.('analytics');
    },
    { enabled: waitingForGSecond },
    [waitingForGSecond, callbacks.onSwitchTab],
  );

  useHotkeys(
    'l',
    () => {
      if (waitingForGSecond) {
        consumeGPrefix();
        callbacks.onSwitchTab?.('all');
      } else {
        callbacks.onLineFocused?.();
      }
    },
    [waitingForGSecond, callbacks.onSwitchTab, callbacks.onLineFocused],
  );

  // ------- Card navigation / actions -------
  useHotkeys(
    'j, down',
    (e) => {
      e.preventDefault();
      callbacks.onMoveFocus?.(1);
    },
    { preventDefault: true },
    [callbacks.onMoveFocus],
  );

  useHotkeys(
    'k, up',
    (e) => {
      e.preventDefault();
      callbacks.onMoveFocus?.(-1);
    },
    { preventDefault: true },
    [callbacks.onMoveFocus],
  );

  useHotkeys('enter', () => callbacks.onOpenFocused?.(), [callbacks.onOpenFocused]);

  useHotkeys('c', () => callbacks.onCallFocused?.(), [callbacks.onCallFocused]);
  useHotkeys('s', () => callbacks.onSnoozeFocused?.(), [callbacks.onSnoozeFocused]);

  return {
    helpOpen,
    setHelpOpen,
    /** Indicator: true while waiting for the second key of a `G` combo */
    waitingForGSecond,
  };
}
