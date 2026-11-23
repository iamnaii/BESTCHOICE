import type { ComponentProps } from 'react';
import { Toaster as Sonner } from 'sonner';
import { AlertTriangle, CheckCircle2, CircleX, Info, Loader2, X } from '@/lib/icons';

type ToasterProps = ComponentProps<typeof Sonner>;

const statusIcons: NonNullable<ToasterProps['icons']> = {
  success: <CheckCircle2 size={16} aria-hidden="true" />,
  info: <Info size={16} aria-hidden="true" />,
  warning: <AlertTriangle size={16} aria-hidden="true" />,
  error: <CircleX size={16} aria-hidden="true" />,
  loading: <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />,
  close: <X size={16} aria-hidden="true" />,
};

export function Toaster({ icons, ...props }: ToasterProps) {
  return <Sonner {...props} icons={{ ...statusIcons, ...icons }} />;
}
