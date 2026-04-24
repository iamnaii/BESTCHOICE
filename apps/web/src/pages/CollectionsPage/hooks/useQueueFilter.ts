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

/**
 * Tab identifier — used to namespace URL query params so that filter state on
 * one tab doesn't leak to another when the user switches tabs. Each tab's
 * filter params are prefixed with a unique 2-char key so the 4 tabs can
 * coexist in the same URL without collision.
 */
export type QueueFilterTab = 'queue' | 'follow-up' | 'promise' | 'all';

const TAB_PREFIX: Record<QueueFilterTab, string> = {
  queue: 'q_',
  'follow-up': 'f_',
  promise: 'p_',
  all: 'a_',
};

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

// Canonical filter key names (suffix — real URL key is `<prefix><name>`).
const FILTER_NAMES = [
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
] as const;

function namespacedKeys(prefix: string): Set<string> {
  return new Set(FILTER_NAMES.map((n) => `${prefix}${n}`));
}

function serialize(
  state: QueueFilterState,
  baseParams: URLSearchParams,
  prefix: string,
): URLSearchParams {
  const out = new URLSearchParams();
  const ownKeys = namespacedKeys(prefix);
  // preserve params that don't belong to this tab (other tabs' namespaced
  // filter state + non-filter params like ?view=incoming or other tabs' URLs)
  baseParams.forEach((value: string, key: string) => {
    if (!ownKeys.has(key)) out.set(key, value);
  });
  if (state.assigned) out.set(`${prefix}assigned`, state.assigned);
  if (state.branchId) out.set(`${prefix}branchId`, state.branchId);
  if (state.overdueBuckets?.length) out.set(`${prefix}buckets`, state.overdueBuckets.join(','));
  if (state.minOutstanding !== undefined)
    out.set(`${prefix}minOutstanding`, String(state.minOutstanding));
  if (state.maxOutstanding !== undefined)
    out.set(`${prefix}maxOutstanding`, String(state.maxOutstanding));
  if (state.contractStatuses?.length)
    out.set(`${prefix}statuses`, state.contractStatuses.join(','));
  if (state.productTypes?.length) out.set(`${prefix}products`, state.productTypes.join(','));
  if (state.minLetterCount !== undefined)
    out.set(`${prefix}minLetterCount`, String(state.minLetterCount));
  if (state.lastContacted) out.set(`${prefix}lastContacted`, state.lastContacted);
  if (state.lineResponse) out.set(`${prefix}lineResponse`, state.lineResponse);
  if (state.minBrokenPromise !== undefined)
    out.set(`${prefix}minBrokenPromise`, String(state.minBrokenPromise));
  if (state.hasActivePromise !== undefined)
    out.set(`${prefix}hasActivePromise`, String(state.hasActivePromise));
  if (state.mdmState) out.set(`${prefix}mdmState`, state.mdmState);
  if (state.showSkipTracing) out.set(`${prefix}showSkipTracing`, 'true');
  if (state.slipReviewPending) out.set(`${prefix}slipReviewPending`, 'true');
  return out;
}

/**
 * Per-tab filter state hook. Each tab (queue/follow-up/promise/all) holds its
 * own filter state in URL params, namespaced with a 2-char prefix so switching
 * tabs doesn't leak filter state between them.
 *
 * Backward-compatible: calling without a tab arg defaults to 'queue' to keep
 * existing consumers working during the refactor.
 */
export function useQueueFilter(
  tab: QueueFilterTab = 'queue',
): [QueueFilterState, (patch: Partial<QueueFilterState>) => void, () => void] {
  const [params, setParams] = useSearchParams();
  const prefix = TAB_PREFIX[tab];

  const state: QueueFilterState = useMemo(() => {
    const assignedRaw = params.get(`${prefix}assigned`);
    const minOut = numParam(params.get(`${prefix}minOutstanding`));
    const maxOut = numParam(params.get(`${prefix}maxOutstanding`));
    const minLetter = numParam(params.get(`${prefix}minLetterCount`));
    const minBroken = numParam(params.get(`${prefix}minBrokenPromise`));
    return {
      assigned: assignedRaw ?? undefined,
      branchId: params.get(`${prefix}branchId`) ?? undefined,
      overdueBuckets:
        (params.get(`${prefix}buckets`)?.split(',').filter(Boolean) as OverdueBucketOption[]) ??
        undefined,
      minOutstanding: minOut,
      maxOutstanding: maxOut,
      contractStatuses: params.get(`${prefix}statuses`)?.split(',').filter(Boolean),
      productTypes: params.get(`${prefix}products`)?.split(',').filter(Boolean),
      minLetterCount: minLetter,
      lastContacted:
        (params.get(`${prefix}lastContacted`) as LastContactedOption | null) ?? undefined,
      lineResponse:
        (params.get(`${prefix}lineResponse`) as LineResponseOption | null) ?? undefined,
      minBrokenPromise: minBroken,
      hasActivePromise: boolParam(params.get(`${prefix}hasActivePromise`)),
      mdmState: (params.get(`${prefix}mdmState`) as MdmStateOption | null) ?? undefined,
      showSkipTracing: params.get(`${prefix}showSkipTracing`) === 'true' || undefined,
      slipReviewPending: params.get(`${prefix}slipReviewPending`) === 'true' || undefined,
    };
  }, [params, prefix]);

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
      setParams(serialize(next, params, prefix), { replace: true });
    },
    [state, params, setParams, prefix],
  );

  const reset = useCallback(() => {
    const next = new URLSearchParams();
    const ownKeys = namespacedKeys(prefix);
    params.forEach((value: string, key: string) => {
      if (!ownKeys.has(key)) next.set(key, value);
    });
    setParams(next, { replace: true });
  }, [params, setParams, prefix]);

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
