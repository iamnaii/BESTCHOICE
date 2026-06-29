import { useMemo } from 'react';
import type { ReceivingUnitForm } from '../types';

/** Pure: indices of PASS units whose normalized IMEI collides with another PASS unit. */
export function computeDuplicateIndices(units: ReceivingUnitForm[]): Set<number> {
  const seen = new Map<string, number[]>();
  units.forEach((unit, idx) => {
    if (unit.status !== 'PASS') return;
    const key = unit.imeiSerial.trim().toLowerCase();
    if (!key) return;
    const arr = seen.get(key) ?? [];
    arr.push(idx);
    seen.set(key, arr);
  });
  const dupes = new Set<number>();
  for (const arr of seen.values()) {
    if (arr.length > 1) arr.forEach((i) => dupes.add(i));
  }
  return dupes;
}

export function useReceivingDuplicates(units: ReceivingUnitForm[]): Set<number> {
  return useMemo(() => computeDuplicateIndices(units), [units]);
}
