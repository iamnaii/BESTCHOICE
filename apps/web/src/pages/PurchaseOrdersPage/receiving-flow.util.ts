// รับสินค้า "ทีละเครื่อง" (owner-approved mockup, 2026-09-07): pure helpers behind the one-device
// screens, the accessory count screen, the chip strip and the summary. No React here — the flow
// component and the wizard's ตรวจรับ step both drive their unit arrays through these.
import type { ReceivingUnitForm } from './types';
import { computeDuplicateIndices } from './components/useReceivingDuplicates';
import { anglesComplete, anglesShot } from '@/constants/photo-angles';

export const isAccessoryUnit = (u: Pick<ReceivingUnitForm, 'category'>) => u.category === 'ACCESSORY';
export const isUsedUnit = (u: Pick<ReceivingUnitForm, 'category'>) => u.category === 'PHONE_USED';

export function conditionLabel(u: Pick<ReceivingUnitForm, 'category'>): string {
  if (u.category === 'PHONE_NEW') return 'ใหม่';
  if (u.category === 'PHONE_USED') return 'มือสอง';
  return isAccessoryUnit(u) ? 'อุปกรณ์เสริม' : '-';
}

/** Units of one PO line (or one wizard row) share a key — accessories are counted per key. */
export function unitGroupKey(u: ReceivingUnitForm): string {
  if (u.poItemId) return u.poItemId;
  return ['line', u.category, u.brand, u.model, u.color, u.storage, u.accessoryType, u.accessoryBrand]
    .map((s) => s ?? '')
    .join('|');
}

export type ReceivingScreen =
  | { kind: 'unit'; idx: number }
  | { kind: 'group'; key: string; indices: number[] };

/** Phones get one screen each; accessories share one screen per line (counted, not scanned). */
export function buildScreens(units: ReceivingUnitForm[]): ReceivingScreen[] {
  const screens: ReceivingScreen[] = [];
  units.forEach((u, idx) => {
    if (!isAccessoryUnit(u)) {
      screens.push({ kind: 'unit', idx });
      return;
    }
    const key = unitGroupKey(u);
    const last = screens[screens.length - 1];
    if (last && last.kind === 'group' && last.key === key) last.indices.push(idx);
    else screens.push({ kind: 'group', key, indices: [idx] });
  });
  return screens;
}

export const screenIndices = (s: ReceivingScreen): number[] => (s.kind === 'unit' ? [s.idx] : s.indices);

/** The screen a unit lives on (a phone's own, or its accessory group's). */
export function screenOfUnit(screens: ReceivingScreen[], idx: number): number {
  return Math.max(0, screens.findIndex((s) => screenIndices(s).includes(idx)));
}

const positive = (v: string) => v.trim() !== '' && Number(v) > 0;

/** The first thing still missing on a unit, worded as the next-button hint; null = complete. */
export function unitHint(u: ReceivingUnitForm): string | null {
  const accessory = isAccessoryUnit(u);
  if (!accessory) {
    const imei = u.imeiSerial.trim() !== '';
    const serial = u.serialNumber.trim() !== '';
    if (!imei && !serial) return 'กรอก IMEI และซีเรียลให้ครบก่อน';
    if (!imei) return 'กรอก IMEI ก่อน';
    if (!serial) return 'กรอกหมายเลขซีเรียลก่อน';
  }
  if (u.status === '') return 'เลือกผลตรวจ ผ่าน หรือ ไม่ผ่าน';
  if (u.status === 'REJECT') return u.defectReason ? null : 'เลือกสาเหตุที่ไม่ผ่านก่อน';
  if (isUsedUnit(u)) {
    if (u.batteryHealth.trim() === '') return 'กรอก % แบตเตอรี่ก่อน';
    const battery = Number(u.batteryHealth);
    if (!Number.isFinite(battery) || battery < 0 || battery > 100) return '% แบตเตอรี่ต้องอยู่ระหว่าง 0–100';
    if (!u.warrantyExpired && u.warrantyExpireDate.trim() === '') return 'กรอกวันหมดประกันหรือติ๊กหมดประกันแล้ว';
  }
  if (!positive(u.sellingPrice)) return 'กรอกราคาเงินสดก่อน';
  if (!accessory && !positive(u.installmentPrice)) return 'กรอกราคาผ่อนก่อน';
  return null;
}

export type UnitState = 'todo' | 'done' | 'reject';

export function unitState(u: ReceivingUnitForm): UnitState {
  if (u.status === '' || unitHint(u)) return 'todo';
  return u.status === 'PASS' ? 'done' : 'reject';
}

/** Hint for a whole screen — an accessory group shares its price and reject reason. */
export function screenHint(units: ReceivingUnitForm[], s: ReceivingScreen): string | null {
  for (const idx of screenIndices(s)) {
    const hint = unitHint(units[idx]);
    if (hint) return hint;
  }
  return null;
}

export function screenState(units: ReceivingUnitForm[], s: ReceivingScreen): UnitState {
  const states = screenIndices(s).map((i) => unitState(units[i]));
  if (states.some((x) => x === 'todo')) return 'todo';
  return states.every((x) => x === 'reject') ? 'reject' : 'done';
}

/** Accessory group: the first `received` pieces pass, the rest fail with the group's reason. */
export function setGroupReceived(units: ReceivingUnitForm[], indices: number[], received: number): ReceivingUnitForm[] {
  const n = Math.max(0, Math.min(indices.length, received));
  const next = [...units];
  indices.forEach((idx, i) => {
    next[idx] = { ...next[idx], status: i < n ? 'PASS' : 'REJECT' };
  });
  return next;
}

/** One field on every unit of a group (accessories share price and reject reason). */
export function setGroupField<K extends keyof ReceivingUnitForm>(
  units: ReceivingUnitForm[],
  indices: number[],
  field: K,
  value: ReceivingUnitForm[K],
): ReceivingUnitForm[] {
  const next = [...units];
  indices.forEach((idx) => {
    next[idx] = { ...next[idx], [field]: value };
  });
  return next;
}

/** A device whose prices are still blank takes the prices keyed in on an earlier device of its line. */
export function withPriceDefaults(units: ReceivingUnitForm[], idx: number): ReceivingUnitForm[] {
  const u = units[idx];
  if (!u || (u.sellingPrice.trim() && u.installmentPrice.trim())) return units;
  const key = unitGroupKey(u);
  for (let j = idx - 1; j >= 0; j--) {
    const prev = units[j];
    if (unitGroupKey(prev) !== key) continue;
    if (!prev.sellingPrice.trim() && !prev.installmentPrice.trim()) continue;
    const next = [...units];
    next[idx] = {
      ...u,
      sellingPrice: u.sellingPrice.trim() ? u.sellingPrice : prev.sellingPrice,
      installmentPrice: u.installmentPrice.trim() ? u.installmentPrice : prev.installmentPrice,
    };
    return next;
  }
  return units;
}

export interface ReceivingBlocker {
  idx: number;
  message: string;
}

/** Everything that still blocks the confirm, in unit order; empty = ready to send. */
export function receivingBlockers(units: ReceivingUnitForm[]): ReceivingBlocker[] {
  const out: ReceivingBlocker[] = [];
  units.forEach((u, idx) => {
    const hint = unitHint(u);
    if (hint) out.push({ idx, message: hint });
  });
  computeDuplicateIndices(units).forEach((idx) => out.push({ idx, message: 'IMEI ซ้ำกับเครื่องอื่นในรายการนี้' }));
  return out.sort((a, b) => a.idx - b.idx);
}

/**
 * Used phone that passed but whose six angles are not all shot yet — it lands in the
 * "รอถ่ายรูป" queue instead of going on sale. Soft by design (owner 2026-09-07): the next
 * button never blocks on photos, the hint just says where the unit will end up.
 */
export const needsPhotoQueue = (u: ReceivingUnitForm): boolean =>
  isUsedUnit(u) && u.status === 'PASS' && !anglesComplete(u.anglePhotos);

/** "ถ่ายแล้ว n/6" for a used unit; null for anything without the six-angle panel. */
export function photoProgress(u: ReceivingUnitForm): { shot: number; total: number } | null {
  if (!isUsedUnit(u)) return null;
  return { shot: anglesShot(u.anglePhotos), total: 6 };
}

/** Where the passed units go: straight to the shelf, or the photo queue first. */
export function photoTally(units: ReceivingUnitForm[]): { readyForSale: number; pendingPhotos: number } {
  let readyForSale = 0;
  let pendingPhotos = 0;
  units.forEach((u) => {
    if (unitState(u) !== 'done') return;
    if (needsPhotoQueue(u)) pendingPhotos += 1;
    else readyForSale += 1;
  });
  return { readyForSale, pendingPhotos };
}

export function tally(units: ReceivingUnitForm[]): { passed: number; rejected: number; pending: number } {
  let passed = 0;
  let rejected = 0;
  units.forEach((u) => {
    const st = unitState(u);
    if (st === 'done') passed += 1;
    else if (st === 'reject') rejected += 1;
  });
  return { passed, rejected, pending: units.length - passed - rejected };
}

const looksLikeCode = (s: string) => s !== '' && /^[A-Za-z0-9-]+$/.test(s);

/** Title + subtitle of a unit's screen, from the PO line / wizard row it came from. */
export function unitTitle(u: ReceivingUnitForm): { title: string; subtitle: string } {
  const base = u.label.replace(/ #\d+$/, '');
  if (isAccessoryUnit(u)) {
    const type = u.accessoryType ?? '';
    const typed = [type, u.accessoryBrand].filter(Boolean).join(' ');
    const fromSku = looksLikeCode(type);
    const title = typed && !fromSku ? typed : base;
    const forModel = u.model && !fromSku ? (type === 'ชุดชาร์จ' ? u.model : `สำหรับรุ่น ${u.model}`) : '';
    return { title, subtitle: ['อุปกรณ์เสริม', forModel].filter(Boolean).join(' · ') };
  }
  return { title: u.model || base, subtitle: u.brand ?? '' };
}
