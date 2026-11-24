import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export function AccessEditorDialog({
  children,
  busy,
  onClose,
}: {
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  const [opener] = useState(() => document.activeElement);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-hidden p-4 sm:p-6"
        showCloseButton={!busy}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (opener instanceof HTMLElement && opener.isConnected) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
