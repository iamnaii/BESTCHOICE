import { ComponentProps, ReactNode, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ModalProps {
  isOpen?: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus'];
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
  'full': 'max-w-[95vw]',
};

export default function Modal({ isOpen, onClose, title, children, size = 'md', onCloseAutoFocus }: ModalProps) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={`${sizeClasses[size]} w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] p-4 sm:p-6`}
        aria-describedby={undefined}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={onCloseAutoFocus ?? ((event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div data-slot="modal-body" className={`-mx-2 min-h-0 px-2 py-2 overflow-y-auto ${size === 'full' ? 'max-h-[90dvh]' : 'max-h-[calc(100dvh-10rem)]'}`}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
