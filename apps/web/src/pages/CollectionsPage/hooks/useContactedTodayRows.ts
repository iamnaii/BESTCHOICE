import { useMemo } from 'react';
import { isToday } from '../utils/today';
import type { ContractRow } from '../types';

/** Counts describe the current page; server pagination remains authoritative. */
export function useContactedTodayRows(rawRows: ContractRow[], hideContactedToday: boolean) {
  const rows = useMemo(
    () => (hideContactedToday ? rawRows.filter((r) => !isToday(r.lastCallAt)) : rawRows),
    [rawRows, hideContactedToday],
  );
  const contactedTodayCount = useMemo(
    () => rawRows.filter((r) => isToday(r.lastCallAt)).length,
    [rawRows],
  );
  return { rows, contactedTodayCount, remainingCount: rawRows.length - contactedTodayCount };
}
