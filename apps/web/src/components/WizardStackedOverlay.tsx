import { createPortal } from 'react-dom';
import { FocusScope } from '@radix-ui/react-focus-scope';

interface Props {
  /** Tailwind max-width class for the panel — pass a literal so the scanner sees it. */
  maxWidthClass?: 'max-w-xl' | 'max-w-2xl';
  children: React.ReactNode;
}

/**
 * Full-screen overlay stacked ABOVE the RecordPaymentWizard's modal Radix
 * Dialog, portaled to document.body (the DialogContent has a CSS transform,
 * which would otherwise become the containing block for position:fixed).
 *
 * An open modal Dialog actively fights outside content on three fronts; each
 * needs an explicit escape here:
 *
 * - body gets `pointer-events: none` → `pointer-events-auto` on the backdrop
 *   re-enables clicks (commit 82f84065).
 * - react-remove-scroll preventDefault()s wheel/touchmove that bubble to
 *   document from outside the DialogContent → stopPropagation at the panel
 *   lets it scroll.
 * - the Dialog's FocusScope yanks focus back into the DialogContent on any
 *   focus change outside it → mounting our own trapped FocusScope pauses the
 *   wizard's via Radix's scope stack, so text inputs here are typable. Radix
 *   portalled widgets inside (Select, etc.) mount their own scope and compose
 *   the same way.
 *
 * Also used standalone (no wizard open, e.g. ContractDetailPage) — the trap
 * and escapes are correct modal-overlay behavior there too.
 */
export function WizardStackedOverlay({ maxWidthClass = 'max-w-xl', children }: Props) {
  const stopScrollLock = (e: React.SyntheticEvent) => e.stopPropagation();

  // NOTE: backdrop-blur (backdrop-filter) makes this div the containing block
  // for position:fixed DESCENDANTS — children using `fixed inset-0` (e.g. a
  // nested confirm dialog) only fill the viewport because this div is itself
  // fixed inset-0 with no padding/border. Don't add padding here.
  return createPortal(
    <div className="fixed inset-0 z-50 pointer-events-auto bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <FocusScope asChild loop trapped>
        <div
          className={`w-full ${maxWidthClass} bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]`}
          onWheel={stopScrollLock}
          onTouchMove={stopScrollLock}
        >
          {children}
        </div>
      </FocusScope>
    </div>,
    document.body,
  );
}
