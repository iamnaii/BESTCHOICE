import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  CUSTOMER_INSTALLMENT_STATES,
  CUSTOMER_INSTALLMENT_STATE_STATUSES,
  CUSTOMER_PURCHASE_KINDS,
  CUSTOMER_PURCHASED_WITHIN,
  PROSPECT_CONTACTED_WITHIN,
  PROSPECT_SOURCES,
} from '@installment/shared';
import type { TableSort } from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import { customerCreditStatusMap } from '@/lib/status-badges';
import { honouredSortKeys } from '../sortKeys';
import type {
  CustomerListResponse,
  CustomerTabSummary,
  CustomerView,
  CustomerViewCounts,
  ProspectListResponse,
  ProspectTabSummary,
} from '../types';

/**
 * URL state + ทั้งสอง query ของหน้า /customers — พี่น้องของ
 * `pages/StockPage/hooks/useStockProducts.ts` และคัดลอกกติกามาทั้งชุด:
 *
 * - อ่านตรงจาก `searchParams` ไม่มี `useState` เงา (ยกเว้นช่องค้นหาที่ debounce)
 * - เขียนด้วยการ copy `prev` ลง `URLSearchParams` ใหม่ → `delete` เมื่อเป็นค่าเริ่มต้น →
 *   `next.delete('page')` → `{ replace: true }` เสมอ
 *   (ส่ง object literal เข้า `setSearchParams` จะล้าง `?zone=` ของ LayoutContext ทิ้ง)
 * - ตัวกรองของอีกแท็บอ่านเป็น `''` ตอนที่ไม่ได้อยู่แท็บนั้น — ไม่ใช่แค่ซ่อน control
 *   ไม่งั้นลิงก์เก่าที่พก `?precheck=` จะกรองรายการลูกค้าอยู่โดยมองไม่เห็น
 * - `setView` ลบคีย์ของอีกแท็บ + `sortBy`/`sortDirection`/`page`
 *
 * ⚠️ API ของ /customers ใช้ `sortBy` + **`sortOrder`** (customers.controller.ts) ส่วน
 * /stock/products ใช้ `sortDirection` — URL ที่นี่คง `sortDirection` ไว้ให้เหมือนกันทั้งบ้าน
 * แล้ว **แปลงเป็น `sortOrder` ใน buildParams** ถ้าลอกมาตรง ๆ การเรียงจะตายเงียบ
 */

const CUSTOMER_FILTER_KEYS = [
  'purchase',
  'state',
  'bought',
  'tier',
  'branchId',
  'source',
  'fromChat',
] as const;
const PROSPECT_FILTER_KEYS = ['source', 'precheck', 'tag', 'contacted', 'owner'] as const;
/** ลิงก์เก่าจากแดชบอร์ด — `?contractStatus=` ไม่มีผู้อ่านอีกแล้ว จึง map ตอนอ่าน */
const LEGACY_KEYS = ['contractStatus', 'hasOverdue'] as const;

const CUSTOMER_TIERS = ['GOLD', 'GOOD', 'NEW', 'RISKY', 'BLACKLIST'] as const;
const CUSTOMER_TAGS = ['VIP', 'HIGH_RISK', 'NEW', 'LOYAL', 'BLACKLIST'] as const;

/** บทบาทที่ `GET /branches` ยอมให้เห็นข้ามสาขา (CROSS_BRANCH_ROLES ฝั่ง API) */
const BRANCH_FILTER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

const PAGE_LIMIT = 50;

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : '';
}

/**
 * `?contractStatus=ACTIVE` (DashboardWatchList ยุคเก่า) → `purchase=INSTALLMENT&state=ACTIVE`
 * แปลงตอน **อ่าน** ไม่เขียน URL ใหม่ — หน้านี้มีผู้เขียน URL ตอน mount ได้ตัวเดียว
 * (เอฟเฟกต์ `?new=1`) เพิ่มตัวที่สองแล้วสองฝั่งจะทับกัน
 */
function legacyStateOf(contractStatus: string | null): string {
  if (!contractStatus) return '';
  const hit = CUSTOMER_INSTALLMENT_STATES.find((state) =>
    CUSTOMER_INSTALLMENT_STATE_STATUSES[state].includes(contractStatus),
  );
  return hit ?? '';
}

export interface UseCustomersQueryResult {
  view: CustomerView;
  setView: (view: CustomerView) => void;
  isBuyers: boolean;
  search: string;
  setSearch: (value: string) => void;
  debouncedSearch: string;
  page: number;
  setPage: (page: number) => void;
  sort: TableSort | null;
  setSort: (sort: TableSort | null) => void;
  /** ตัวกรองแท็บลูกค้า */
  purchase: string;
  state: string;
  bought: string;
  tier: string;
  branchId: string;
  /** ตัวกรองแท็บผู้สนใจ */
  source: string;
  fromChat: string;
  precheck: string;
  tag: string;
  contacted: string;
  owner: string;
  setFilter: (key: string, value: string) => void;
  /** ตั้งหลายคีย์พร้อมกัน (การ์ด KPI) — ค่าว่าง = ลบคีย์นั้น */
  setFilters: (patch: Record<string, string>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  branches: { id: string; name: string }[];
  canFilterBranch: boolean;
  staff: { id: string; name: string }[];
  customerResult?: CustomerListResponse;
  prospectResult?: ProspectListResponse;
  summary?: CustomerTabSummary | ProspectTabSummary;
  viewCounts?: CustomerViewCounts;
  total: number;
  totalPages: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** พารามิเตอร์ที่ส่งให้ API — ปุ่มส่งออก Excel ใช้ตัวเดียวกันเพื่อให้กรองตรงกัน */
  buildParams: (targetPage?: number, targetLimit?: number) => Record<string, string>;
}

export function useCustomersQuery(): UseCustomersQueryResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canFilterBranch = BRANCH_FILTER_ROLES.includes(user?.role ?? '');

  const view: CustomerView = searchParams.get('view') === 'prospects' ? 'prospects' : 'customers';
  const isBuyers = view === 'customers';

  // --- ตัวกรองแท็บลูกค้า (อ่านเป็น '' เมื่ออยู่แท็บผู้สนใจ) ---
  const legacyContractStatus = searchParams.get('contractStatus');
  const legacyHasOverdue = searchParams.get('hasOverdue') === 'true';
  const rawPurchase = pick(searchParams.get('purchase'), CUSTOMER_PURCHASE_KINDS);
  const purchase = isBuyers
    ? rawPurchase || (legacyContractStatus || legacyHasOverdue ? 'INSTALLMENT' : '')
    : '';
  const state =
    isBuyers && purchase === 'INSTALLMENT'
      ? pick(searchParams.get('state'), CUSTOMER_INSTALLMENT_STATES) ||
        (legacyHasOverdue ? 'OVERDUE' : legacyStateOf(legacyContractStatus))
      : '';
  const bought = isBuyers ? pick(searchParams.get('bought'), CUSTOMER_PURCHASED_WITHIN) : '';
  const tier = isBuyers ? pick(searchParams.get('tier'), CUSTOMER_TIERS) : '';
  const branchId = isBuyers && canFilterBranch ? (searchParams.get('branchId') ?? '') : '';

  // --- ตัวกรองแท็บผู้สนใจ (source ใช้ได้ทั้งสองแท็บ — แท็บลูกค้าก็กรองที่มาได้) ---
  const source = pick(searchParams.get('source'), PROSPECT_SOURCES);
  /** เฉพาะแท็บลูกค้า — "มาจากแชท" คือ CustomerRow ที่ API ปะ chatPlaceholder ให้ */
  const fromChat = isBuyers && searchParams.get('fromChat') === 'true' ? 'true' : '';
  const precheck = !isBuyers
    ? pick(searchParams.get('precheck'), Object.keys(customerCreditStatusMap))
    : '';
  const tag = !isBuyers
    ? (searchParams.get('tag') ?? '')
        .split(',')
        .filter((t) => (CUSTOMER_TAGS as readonly string[]).includes(t))
        .join(',')
    : '';
  const contacted = !isBuyers ? pick(searchParams.get('contacted'), PROSPECT_CONTACTED_WITHIN) : '';
  const owner = !isBuyers ? (searchParams.get('owner') ?? '') : '';

  // --- เรียง ---
  // รายการที่ API เรียงได้จริง (แคบกว่าของ packages/shared — ดู sortKeys.ts)
  const sortKeys = honouredSortKeys(isBuyers);
  const sortBy = searchParams.get('sortBy') ?? '';
  const sort: TableSort | null = sortKeys.includes(sortBy)
    ? { key: sortBy, direction: searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc' }
    : null;

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(search);

  const write = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setView = useCallback(
    (value: CustomerView) => {
      write((next) => {
        if (value === 'prospects') next.set('view', 'prospects');
        else next.delete('view');
        [
          ...CUSTOMER_FILTER_KEYS,
          ...PROSPECT_FILTER_KEYS,
          ...LEGACY_KEYS,
          'sortBy',
          'sortDirection',
        ].forEach((key) => next.delete(key));
      });
    },
    [write],
  );

  const setFilters = useCallback(
    (patch: Record<string, string>) => {
      write((next) => {
        // ลิงก์เก่าต้องหลุดไปทันทีที่ผู้ใช้แตะตัวกรองจริง ไม่งั้นมันกรองซ้อนอยู่เบื้องหลัง
        LEGACY_KEYS.forEach((key) => next.delete(key));
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        // "การซื้อ" ที่ไม่ใช่ผ่อน ไม่มีสถานะย่อย
        if (patch.purchase !== undefined && patch.purchase !== 'INSTALLMENT' && !patch.state) {
          next.delete('state');
        }
      });
    },
    [write],
  );

  const setFilter = useCallback(
    (key: string, value: string) => setFilters({ [key]: value }),
    [setFilters],
  );

  const setSort = useCallback(
    (value: TableSort | null) => {
      write((next) => {
        if (value && sortKeys.includes(value.key)) {
          next.set('sortBy', value.key);
          next.set('sortDirection', value.direction);
        } else {
          next.delete('sortBy');
          next.delete('sortDirection');
        }
      });
    },
    [write, sortKeys],
  );

  const setPage = useCallback(
    (value: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value > 1) next.set('page', String(value));
          else next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    write((next) => {
      [
        'q',
        ...CUSTOMER_FILTER_KEYS,
        ...PROSPECT_FILTER_KEYS,
        ...LEGACY_KEYS,
        'sortBy',
        'sortDirection',
      ].forEach((key) => next.delete(key));
    });
  }, [write]);

  // ซิงก์ค่าค้นหาที่ debounce แล้วลง ?q=
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (current === debouncedSearch) return;
    write((next) => {
      if (debouncedSearch) next.set('q', debouncedSearch);
      else next.delete('q');
    });
  }, [debouncedSearch, searchParams, write]);

  const buildParams = useCallback(
    (targetPage = page, targetLimit = PAGE_LIMIT) => {
      const params: Record<string, string> = {};
      // ส่ง view ชัดเจนเสมอ — ไม่ส่ง = "ทุกคน" ซึ่งเป็นพฤติกรรมที่ตัวเลือกลูกค้าหน้าอื่นพึ่งอยู่
      params.view = view;
      if (debouncedSearch) params.search = debouncedSearch;
      if (source) params.source = source;
      if (isBuyers) {
        // ⚠️ ชื่อพารามิเตอร์คือ `purchase` ไม่ใช่ `saleType` — ValidationPipe ตั้ง
        // `whitelist: true` (ไม่มี forbidNonWhitelisted) ⇒ คีย์ที่ DTO ไม่รู้จักถูก
        // **ตัดทิ้งเงียบ ๆ** ไม่ใช่ 400 ⇒ ส่งชื่อผิด = ตัวกรองตายโดยไม่มีใครรู้
        if (purchase) params.purchase = purchase;
        if (state) params.state = state;
        if (bought) params.purchasedWithin = bought;
        if (tier) params.tier = tier;
        if (branchId) params.branchId = branchId;
        if (fromChat) params.fromChat = 'true';
      } else {
        if (precheck) params.creditCheckStatus = precheck;
        if (tag) params.tag = tag;
        if (contacted) params.contacted = contacted;
        if (owner) params.assignedToId = owner;
      }
      if (sort) {
        params.sortBy = sort.key;
        // ⚠️ API รับ `sortOrder` ไม่ใช่ `sortDirection`
        params.sortOrder = sort.direction;
      }
      params.page = String(targetPage);
      params.limit = String(targetLimit);
      return params;
    },
    [
      view,
      isBuyers,
      debouncedSearch,
      purchase,
      state,
      bought,
      tier,
      branchId,
      source,
      fromChat,
      precheck,
      tag,
      contacted,
      owner,
      sort,
      page,
    ],
  );

  const queryKey = useMemo(() => ['customers', buildParams()] as const, [buildParams]);

  const listQuery = useQuery<CustomerListResponse | ProspectListResponse>({
    queryKey,
    queryFn: async () => {
      const { data } = await api.get('/customers', { params: buildParams() });
      return data;
    },
  });

  const branchesQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: canFilterBranch,
  });

  /**
   * รายชื่อพนักงานสำหรับตัวกรอง "ผู้ดูแล" — `GET /users` เป็น `@Roles('OWNER')`
   * (users.controller.ts:61-62) ⇒ บทบาทอื่นได้เฉพาะตัวเลือก "ทุกคน / ยังไม่มีผู้ดูแล"
   * ซึ่งยังกรองได้จริงเพราะ sentinel `unassigned` ไม่ต้องมีรายชื่อ
   */
  const staffQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ['users', 'staff-filter'],
    queryFn: async () => {
      const { data } = await api.get('/users', { params: { limit: 200 } });
      return Array.isArray(data) ? data : (data?.data ?? []);
    },
    enabled: !isBuyers && user?.role === 'OWNER',
  });

  const result = listQuery.data;
  const customerResult = isBuyers ? (result as CustomerListResponse | undefined) : undefined;
  const prospectResult = isBuyers ? undefined : (result as ProspectListResponse | undefined);

  const hasActiveFilters = Boolean(
    debouncedSearch ||
      (isBuyers
        ? purchase || state || bought || tier || branchId || source || fromChat
        : source || precheck || tag || contacted || owner),
  );

  return {
    view,
    setView,
    isBuyers,
    search,
    setSearch,
    debouncedSearch,
    page,
    setPage,
    sort,
    setSort,
    purchase,
    state,
    bought,
    tier,
    branchId,
    source,
    fromChat,
    precheck,
    tag,
    contacted,
    owner,
    setFilter,
    setFilters,
    clearFilters,
    hasActiveFilters,
    branches: branchesQuery.data ?? [],
    canFilterBranch,
    staff: staffQuery.data ?? [],
    customerResult,
    prospectResult,
    summary: result?.summary,
    viewCounts: result?.viewCounts,
    total: result?.total ?? 0,
    totalPages: Math.max(1, result?.totalPages ?? 1),
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    buildParams,
  };
}
