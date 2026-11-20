/**
 * Decide what the AppleHouse importer does to each grade-A Apple row of
 * `trade_in_valuations`. Pure — no Prisma — so the rules are unit-tested
 * (`src/modules/trade-in/applehouse-import-plan.spec.ts`) and the importer
 * (`seed-sell-valuations-applehouse.ts`) only executes the plan.
 *
 * Rules (the refresh runs unattended every 2 weeks, so each one protects a
 * decision a person made):
 * - A price the shop set is kept: edited after import (note starts with
 *   SHOP_OVERRIDE_PREFIX — written by `TradeInValuationService` when staff change
 *   an AppleHouse price) or entered by hand (note not from any benchmark script).
 * - A row the importer withdrew because the source had no price is restored
 *   when the source prices it again. Rows deleted any other way stay deleted.
 * - Source-managed rows missing from the snapshot are withdrawn and marked so
 *   a later run can restore them.
 */

export const APPLEHOUSE_NOTE_PREFIX = 'อ้างอิง applehouseth.com ';
export const SHOP_OVERRIDE_PREFIX = 'ร้านปรับราคาแล้ว';
export const AUTO_WITHDRAWN_PREFIX = 'ถอนอัตโนมัติ (แหล่งไม่มีราคา) · ';
/** Note of the market rows imported before Yellobe (2026-07-18). */
const LEGACY_MARKET_NOTE = 'อ้างอิงราคาตลาด 2026-07-18';

export interface SnapshotPrice {
  model: string;
  storage: string;
  basePrice: number;
}

export interface ExistingValuation {
  id: string;
  model: string;
  storage: string;
  basePrice: { toString(): string } | number | string;
  note: string | null;
  deletedAt: Date | null;
}

export type ImportAction =
  | { kind: 'create'; model: string; storage: string; basePrice: number; note: string }
  | { kind: 'update'; id: string; model: string; storage: string; from: number; basePrice: number; note: string }
  | { kind: 'restore'; id: string; model: string; storage: string; basePrice: number; note: string }
  | { kind: 'keep-shop-price'; id: string; model: string; storage: string; shopPrice: number; sourcePrice: number }
  | { kind: 'skip-deleted'; id: string; model: string; storage: string }
  | { kind: 'withdraw'; id: string; model: string; storage: string; note: string };

export const valuationKey = (model: string, storage: string) =>
  `${model.toLowerCase()}|${storage.toLowerCase()}`;

/** Rows whose price came from a benchmark script rather than a person. */
export function isSourceManaged(note: string | null): boolean {
  if (!note) return false;
  return note.includes('yellobe') || note === LEGACY_MARKET_NOTE || note.startsWith(APPLEHOUSE_NOTE_PREFIX);
}

/**
 * A soft-deleted row the importer itself withdrew, so it may come back.
 * The 2026-09-21 switch from Yellobe withdrew rows without a marker; every
 * deleted Apple grade-A row on prod has its deleted_at inside that one import
 * transaction (checked 2026-11-20), so legacy source notes count as withdrawn
 * by the importer.
 */
export function isAutoWithdrawn(row: Pick<ExistingValuation, 'note' | 'deletedAt'>): boolean {
  if (!row.deletedAt || !row.note) return false;
  return row.note.startsWith(AUTO_WITHDRAWN_PREFIX) || row.note.includes('yellobe') || row.note === LEGACY_MARKET_NOTE;
}

export function planAppleHouseImport(
  existing: ExistingValuation[],
  snapshot: SnapshotPrice[],
  note: string,
): ImportAction[] {
  const byKey = new Map<string, ExistingValuation>();
  for (const row of existing) {
    const id = valuationKey(row.model, row.storage);
    if (byKey.has(id)) throw new Error(`Duplicate normalized model/storage rows (${id}); reconcile before importing`);
    byKey.set(id, row);
  }
  const snapshotKeys = new Set(snapshot.map(row => valuationKey(row.model, row.storage)));
  const actions: ImportAction[] = [];

  for (const row of snapshot) {
    const old = byKey.get(valuationKey(row.model, row.storage));
    if (!old) {
      actions.push({ kind: 'create', model: row.model, storage: row.storage, basePrice: row.basePrice, note });
    } else if (old.deletedAt) {
      actions.push(isAutoWithdrawn(old)
        ? { kind: 'restore', id: old.id, model: old.model, storage: old.storage, basePrice: row.basePrice, note }
        : { kind: 'skip-deleted', id: old.id, model: old.model, storage: old.storage });
    } else if (old.note?.startsWith(SHOP_OVERRIDE_PREFIX) || !isSourceManaged(old.note)) {
      // Edited after import, or entered by hand before the source listed the model.
      actions.push({ kind: 'keep-shop-price', id: old.id, model: old.model, storage: old.storage,
        shopPrice: Number(old.basePrice.toString()), sourcePrice: row.basePrice });
    } else {
      actions.push({ kind: 'update', id: old.id, model: old.model, storage: old.storage,
        from: Number(old.basePrice.toString()), basePrice: row.basePrice, note });
    }
  }

  for (const old of existing) {
    if (old.deletedAt || !isSourceManaged(old.note)) continue;
    if (snapshotKeys.has(valuationKey(old.model, old.storage))) continue;
    actions.push({ kind: 'withdraw', id: old.id, model: old.model, storage: old.storage,
      note: `${AUTO_WITHDRAWN_PREFIX}${old.note}` });
  }
  return actions;
}

/** Unattended imports stop for a person when the source looks wrong. */
export const GUARD_MAX_PRICE_MOVE = 0.15;
export const GUARD_MAX_WITHDRAW_SHARE = 0.2;

/**
 * Reasons an unattended import must not write (empty = safe). Compares against
 * what is live in the database, not a file: a price moving 15% or more in one
 * round, or the source dropping 20% or more of the models it used to price,
 * usually means the source page changed rather than the market.
 */
export function checkImportGuard(plan: ImportAction[], existing: ExistingValuation[]): string[] {
  const reasons: string[] = [];
  for (const action of plan) {
    if (action.kind !== 'update' || action.from <= 0) continue;
    const move = (action.basePrice - action.from) / action.from;
    if (Math.abs(move) >= GUARD_MAX_PRICE_MOVE) {
      reasons.push(`${action.model} ${action.storage} ราคาขยับ ${Math.round(move * 100)}% (${action.from} → ${action.basePrice})`);
    }
  }
  const managed = existing.filter(row => !row.deletedAt && isSourceManaged(row.note)).length;
  const withdrawn = plan.filter(action => action.kind === 'withdraw').length;
  if (managed > 0 && withdrawn / managed >= GUARD_MAX_WITHDRAW_SHARE) {
    reasons.push(`รุ่นที่ AppleHouse ไม่มีราคาแล้ว ${withdrawn} จาก ${managed} รุ่น`);
  }
  return reasons;
}
