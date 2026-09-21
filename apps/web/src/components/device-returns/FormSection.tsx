import { AlertTriangle, Check } from 'lucide-react';

/* ─── Shared form helpers (token-only styling, mirrors EarlyPayoffOverlay) ───────────
 * ใช้ร่วมกันโดย RepossessionOverlay (โหมดยืนยัน) และ DeviceReturnIntakeDialog */

export function Section({
  icon,
  title,
  subtitle,
  tone = 'primary',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: 'primary' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const iconClass =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning-strong'
        : 'bg-primary/10 text-primary';
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`flex items-center justify-center size-8 rounded-lg ${iconClass}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Row({
  label,
  value,
  bold,
  destructive,
}: {
  label: string;
  value: string;
  bold?: boolean;
  destructive?: boolean;
}) {
  const valueClass = destructive
    ? 'text-destructive font-medium'
    : bold
      ? 'font-semibold text-foreground'
      : 'text-foreground';
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span className={`leading-snug ${valueClass}`}>{value}</span>
    </div>
  );
}

export function Effect({ text, warning }: { text: string; warning?: boolean }) {
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
