import { Lightbulb } from 'lucide-react';

/**
 * Next-Best-Action chip (P3 Task 9 — C2). Renders a single recommendation
 * computed server-side by NextBestActionService. Clicking dispatches the
 * relevant action via callback (parent decides which dialog to open).
 *
 * Hidden entirely when type === 'NOOP' so the row stays uncluttered when
 * no rule fires.
 */
export type NextBestActionType =
  | 'CALL'
  | 'SEND_LINE'
  | 'SEND_LETTER'
  | 'PROPOSE_LOCK'
  | 'NOOP';

export interface NextBestActionPayload {
  type: NextBestActionType;
  label: string;
  reason: string;
}

interface Props {
  action: NextBestActionPayload | null | undefined;
  /**
   * Fires with the chosen action type. Parent maps to the right dialog
   * (CALL → ContactLogDialog, SEND_LINE → SendLineAdHocDialog, etc.). When
   * undefined the chip renders read-only.
   */
  onClick?: (type: NextBestActionType) => void;
}

export default function NextBestActionChip({ action, onClick }: Props) {
  if (!action || action.type === 'NOOP') return null;

  const interactive = !!onClick;

  const className = `inline-flex items-center gap-1 rounded-full border border-info/30 bg-info/10 text-info text-2xs font-medium px-2 py-0.5 leading-snug ${
    interactive ? 'hover:bg-info/20 transition-colors cursor-pointer' : ''
  }`;

  const inner = (
    <>
      <Lightbulb className="size-3" aria-hidden="true" />
      {action.label}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onClick(action.type)}
        title={action.reason}
        aria-label={`คำแนะนำ: ${action.label} — ${action.reason}`}
        data-testid="next-best-action-chip"
      >
        {inner}
      </button>
    );
  }

  return (
    <span
      className={className}
      title={action.reason}
      data-testid="next-best-action-chip"
    >
      {inner}
    </span>
  );
}
