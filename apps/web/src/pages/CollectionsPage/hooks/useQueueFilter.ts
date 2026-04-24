import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type OverdueBucketOption = '1-7' | '8-30' | '31-60' | '61-90' | '90+';
export type LastContactedOption = 'today' | 'this_week' | 'never' | 'over_7_days';
export type LineResponseOption = 'responded' | 'ignored' | 'blocked' | 'no_line';
export type MdmStateOption = 'not_locked' | 'locked' | 'pending';

export interface QueueFilterState {
  assigned?: 'self' | 'unassigned' | string;
  branchId?: string;
  overdueBuckets?: OverdueBucketOption[];
  minOutstanding?: number;
  maxOutstanding?: number;
  contractStatuses?: string[];
  productTypes?: string[];
  minLetterCount?: number;
  lastContacted?: LastContactedOption;
  lineResponse?: LineResponseOption;
  minBrokenPromise?: number;
  hasActivePromise?: boolean;
  mdmState?: MdmStateOption;
  showSkipTracing?: boolean;
  slipReviewPending?: boolean;
}

const boolParam = (v: string | null): boolean | undefined => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
};

const numParam = (v: string | null): number | undefined => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function serialize(state: QueueFilterState, baseParams: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  // preserve non-filter params (e.g. ?view=incoming)
  baseParams.forEach((value: string, key: string) => {
    if (!FILTER_KEYS.has(key)) out.set(key, value);
  });
  if (state.assigned) out.set('assigned', state.assigned);
  if (state.branchId) out.set('branchId', state.branchId);
  if (state.overdueBuckets?.length) out.set('buckets', state.overdueBuckets.join(','));
  if (state.minOutstanding !== undefined) out.set('minOutstanding', String(state.minOutstanding));
  if (state.maxOutstanding !== undefined) out.set('maxOutstanding', String(state.maxOutstanding));
  if (state.contractStatuses?.length) out.set('statuses', state.contractStatuses.join(','));
  if (state.productTypes?.length) out.set('products', state.productTypes.join(','));
  if (state.minLetterCount !== undefined) out.set('minLetterCount', String(state.minLetterCount));
  if (state.lastContacted) out.set('lastContacted', state.lastContacted);
  if (state.lineResponse) out.set('lineResponse', state.lineResponse);
  if (state.minBrokenPromise !== undefined)
    out.set('minBrokenPromise', String(state.minBrokenPromise));
  if (state.hasActivePromise !== undefined)
    out.set('hasActivePromise', String(state.hasActivePromise));
  if (state.mdmState) out.set('mdmState', state.mdmState);
  if (state.showSkipTracing) out.set('showSkipTracing', 'true');
  if (state.slipReviewPending) out.set('slipReviewPending', 'true');
  return out;
}

const FILTER_KEYS = new Set([
  'assigned',
  'branchId',
  'buckets',
  'minOutstanding',
  'maxOutstanding',
  'statuses',
  'products',
  'minLetterCount',
  'lastContacted',
  'lineResponse',
  'minBrokenPromise',
  'hasActivePromise',
  'mdmState',
  'showSkipTracing',
  'slipReviewPending',
]);

export function useQueueFilter(): [
  QueueFilterState,
  (patch: Partial<QueueFilterState>) => void,
  () => void,
] {
  const [params, setParams] = useSearchParams();

  const state: QueueFilterState = useMemo(() => {
    const assignedRaw = params.get('assigned');
    const minOut = numParam(params.get('minOutstanding'));
    const maxOut = numParam(params.get('maxOutstanding'));
    const minLetter = numParam(params.get('minLetterCount'));
    const minBroken = numParam(params.get('minBrokenPromise'));
    return {
      assigned: assignedRaw ?? undefined,
      branchId: params.get('branchId') ?? undefined,
      overdueBuckets: (params.get('buckets')?.split(',').filter(Boolean) as OverdueBucketOption[]) ??
        undefined,
      minOutstanding: minOut,
      maxOutstanding: maxOut,
      contractStatuses: params.get('statuses')?.split(',').filter(Boolean),
      productTypes: params.get('products')?.split(',').filter(Boolean),
      minLetterCount: minLetter,
      lastContacted: (params.get('lastContacted') as LastContactedOption | null) ?? undefined,
      lineResponse: (params.get('lineResponse') as LineResponseOption | null) ?? undefined,
      minBrokenPromise: minBroken,
      hasActivePromise: boolParam(params.get('hasActivePromise')),
      mdmState: (params.get('mdmState') as MdmStateOption | null) ?? undefined,
      showSkipTracing: params.get('showSkipTracing') === 'true' || undefined,
      slipReviewPending: params.get('slipReviewPending') === 'true' || undefined,
    };
  }, [params]);

  const setFilter = useCallback(
    (patch: Partial<QueueFilterState>) => {
      const next: QueueFilterState = { ...state, ...patch };
      // Strip undefined/empty values
      (Object.keys(next) as (keyof QueueFilterState)[]).forEach((k) => {
        const v = next[k];
        if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
          delete next[k];
        }
      });
      setParams(serialize(next, params), { replace: true });
    },
    [state, params, setParams],
  );

  const reset = useCallback(() => {
    const next = new URLSearchParams();
    params.forEach((value: string, key: string) => {
      if (!FILTER_KEYS.has(key)) next.set(key, value);
    });
    setParams(next, { replace: true });
  }, [params, setParams]);

  return [state, setFilter, reset];
}

export function countActiveFilters(f: QueueFilterState): number {
  let n = 0;
  if (f.assigned) n++;
  if (f.branchId) n++;
  if (f.overdueBuckets?.length) n++;
  if (f.minOutstanding !== undefined || f.maxOutstanding !== undefined) n++;
  if (f.contractStatuses?.length) n++;
  if (f.productTypes?.length) n++;
  if (f.minLetterCount !== undefined) n++;
  if (f.lastContacted) n++;
  if (f.lineResponse) n++;
  if (f.minBrokenPromise !== undefined) n++;
  if (f.hasActivePromise !== undefined) n++;
  if (f.mdmState) n++;
  if (f.showSkipTracing) n++;
  if (f.slipReviewPending) n++;
  return n;
}
