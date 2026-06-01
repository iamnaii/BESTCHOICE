/**
 * InternalControlActionBar — shared type contracts.
 *
 * The bar is consumed by three accounting modules (Other Income, Expense,
 * Asset). Each module maps its own domain status / events into these
 * generic shapes before passing them to the bar.
 */

export type IcabModule = 'other_income' | 'expense' | 'asset';

export type IcabStatus = 'DRAFT' | 'READY' | 'POSTED' | 'REVERSED';

/**
 * One row in the audit timeline. Maps from the central `AuditLog` model
 * (`apps/api/prisma/schema.prisma`) — modules are responsible for
 * pre-filtering to the events relevant to a single document.
 */
export interface IcabAuditEvent {
  /** Canonical event marker. `*` allows module-specific extensions. */
  event:
    | 'CREATED'
    | 'SUBMITTED_FOR_APPROVAL'
    | 'APPROVED'
    | 'POSTED'
    | 'REJECTED'
    | 'REVERSED'
    | (string & {});
  userId: string;
  userName: string;
  /** ISO timestamp from `AuditLog.createdAt`. */
  timestamp: string;
  /** Human-readable subject — e.g. document number or reason text. */
  detail?: string;
  /** Free-form note attached to the event (e.g. reverse reason). */
  reason?: string;
}

/**
 * Minimum profile the bar needs to decide which buttons to render.
 * Source: `useAuth().user` plus the new `canReverseOverride` flag.
 */
export interface IcabCurrentUser {
  id: string;
  role: string;
  name: string;
  /** New flag (CUSTOM mode of reversePermission). */
  canReverseOverride?: boolean | null;
}

/**
 * Module → label mappings. Centralised here so callers stay
 * declarative — they only pass `module="other_income"` and the bar
 * picks up the right print button label, document prefix, etc.
 */
export const ICAB_MODULE_DEFAULTS: Record<
  IcabModule,
  { printLabel: string; reverseDocSuffix: string }
> = {
  other_income: { printLabel: 'พิมพ์ใบเสร็จ', reverseDocSuffix: '-R' },
  expense: { printLabel: 'พิมพ์ใบสำคัญจ่าย', reverseDocSuffix: '-V' },
  asset: { printLabel: 'พิมพ์ใบรับสินทรัพย์', reverseDocSuffix: '-R' },
};

/** Reason row served by `GET /settings/reverse-reasons/active`. */
export interface IcabReverseReason {
  id: string;
  label: string;
  sortOrder?: number;
  isActive?: boolean;
}
