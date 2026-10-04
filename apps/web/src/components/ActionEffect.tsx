import { AlertTriangle, Check } from 'lucide-react';

export function ActionEffect({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={warning ? 'text-warning-strong' : 'text-success'}>
        {warning ? (
          <AlertTriangle className="size-4 inline" />
        ) : (
          <Check className="size-4 inline" />
        )}
      </span>
      <span className={warning ? 'text-warning-strong' : 'text-foreground'}>{text}</span>
    </li>
  );
}
