import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TableSort } from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { useLatestSearchParams } from '@/hooks/useLatestSearchParams';
import api from '@/lib/api';
import type { BookingListResponse, BookingSummary, BranchOption } from '../types';

/**
 * URL state + query ของหน้า /bookings — ลอกกติกาจาก `pages/CustomersPage/hooks/useCustomersQuery.ts`:
 * อ่านตรงจาก searchParams (ไม่มี useState เงา ยกเว้นช่องค้นหาที่ debounce) · เขียนผ่าน
 * `useLatestSearchParams` เท่านั้น · ค่าเริ่มต้นไม่เขียนคีย์ · เปลี่ยนตัวกรองแล้วลบ page
 *
 * มุมมอง (ลำดับความสำคัญเมื่อมีหลายคีย์): status → expiring → all → open (ค่าเริ่มต้น)
 */
export type BookingView = 'open' | 'all' | 'status' | 'expiring';
export type BookingKpiKey = 'open' | 'pendingDeposit' | 'paid' | 'expiring' | 'closed' | '';

export const BOOKING_PAGE_LIMIT = 50;
const STATUS_VALUES = [
  'PENDING_DEPOSIT',
  'PAID',
  'CONVERTED',
  'CANCELED',
  'EXPIRED',
  'CLOSED',
] as const;
const SORT_KEYS = ['expireDate', 'createdAt'] as const;
const FILTER_KEYS = [
  'status',
  'all',
  'expiring',
  'branchId',
  'from',
  'to',
  'q',
  'sortBy',
  'sortDirection',
  'page',
] as const;
/** บทบาทที่ GET /branches ยอมให้เห็นข้ามสาขา (CROSS_BRANCH_ROLES ฝั่ง API) */
const BRANCH_FILTER_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

/** วันไทย YYYY-MM-DD — ค่าอื่นจากลิงก์ที่พิมพ์เอง (API ตอบ 400 รูปแบบวันที่) ถือว่าไม่มี */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (value: string | null): string => (value && DATE_ONLY.test(value) ? value : '');

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | '' {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : '';
}

export interface UseBookingsQueryResult {
  view: BookingView;
  status: string;
  expiring: string;
  branchId: string;
  from: string;
  to: string;
  search: string;
  setSearch: (value: string) => void;
  debouncedSearch: string;
  page: number;
  setPage: (page: number) => void;
  sort: TableSort | null;
  setSort: (sort: TableSort | null) => void;
  /** ตั้งหลายคีย์พร้อมกัน (การ์ด KPI / ดรอปดาวน์) — ค่าว่าง = ลบคีย์ */
  setFilters: (patch: Record<string, string>) => void;
  clearFilters: () => void;
  hasActiveFilters: boolean;
  activeKpiKey: BookingKpiKey;
  branches: BranchOption[];
  canFilterBranch: boolean;
  listResult?: BookingListResponse;
  summary?: BookingSummary;
  summaryLoading: boolean;
  /** true = summary เป็นค่าค้างของคีย์ก่อนหน้า (keepPreviousData) ยังไม่ใช่ของตัวกรองปัจจุบัน */
  summaryPlaceholder: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  buildParams: (targetPage?: number) => Record<string, string>;
}

export function useBookingsQuery(): UseBookingsQueryResult {
  const [searchParams, updateParams] = useLatestSearchParams();
  const { user } = useAuth();
  const canFilterBranch = BRANCH_FILTER_ROLES.includes(user?.role ?? '');

  const status = pick(searchParams.get('status'), STATUS_VALUES);
  const expiringRaw = searchParams.get('expiring') ?? '';
  const expiring = /^([1-9]|[12]\d|30)$/.test(expiringRaw) ? expiringRaw : '';
  const all = searchParams.get('all') === '1';
  const view: BookingView = status ? 'status' : expiring ? 'expiring' : all ? 'all' : 'open';
  const branchId = canFilterBranch ? (searchParams.get('branchId') ?? '') : '';
  const from = dateParam(searchParams.get('from'));
  const to = dateParam(searchParams.get('to'));
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const sortBy = pick(searchParams.get('sortBy'), SORT_KEYS);
  const sort: TableSort | null = sortBy
    ? { key: sortBy, direction: searchParams.get('sortDirection') === 'desc' ? 'desc' : 'asc' }
    : null;

  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(search);

  const write = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      updateParams((next) => {
        mutate(next);
        next.delete('page');
      });
    },
    [updateParams],
  );

  // ซิงก์คำค้นที่ debounce แล้วลง ?q= (ผ่าน write → ลบ page เหมือนตัวกรองอื่น)
  useEffect(() => {
    if ((searchParams.get('q') ?? '') === debouncedSearch) return;
    write((n) => (debouncedSearch ? n.set('q', debouncedSearch) : n.delete('q')));
  }, [debouncedSearch, searchParams, write]);

  const setFilters = useCallback(
    (patch: Record<string, string>) => {
      write((next) => {
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
      });
    },
    [write],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    write((next) => FILTER_KEYS.forEach((key) => next.delete(key)));
  }, [write]);

  const setSort = useCallback(
    (next: TableSort | null) => {
      write((params) => {
        if (next && (SORT_KEYS as readonly string[]).includes(next.key)) {
          params.set('sortBy', next.key);
          params.set('sortDirection', next.direction);
        } else {
          params.delete('sortBy');
          params.delete('sortDirection');
        }
      });
    },
    [write],
  );

  const setPage = useCallback(
    (next: number) => {
      updateParams((params) => {
        if (next > 1) params.set('page', String(next));
        else params.delete('page');
      });
    },
    [updateParams],
  );

  const activeKpiKey: BookingKpiKey =
    view === 'open'
      ? 'open'
      : view === 'expiring'
        ? 'expiring'
        : status === 'PENDING_DEPOSIT'
          ? 'pendingDeposit'
          : status === 'PAID'
            ? 'paid'
            : status === 'CLOSED'
              ? 'closed'
              : '';

  const buildParams = useCallback(
    (targetPage: number = page): Record<string, string> => {
      const params: Record<string, string> = {
        page: String(targetPage),
        limit: String(BOOKING_PAGE_LIMIT),
      };
      if (view === 'status') params.status = status;
      else if (view === 'expiring') params.expiring = expiring;
      else if (view === 'open') params.open = '1';
      if (branchId) params.branchId = branchId;
      if (from) params.from = from;
      if (to) params.to = to;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      const sortField =
        sort?.key ?? (view === 'open' || view === 'expiring' ? 'expireDate' : 'createdAt');
      params.sort = sortField;
      params.order = sort?.direction ?? (sortField === 'expireDate' ? 'asc' : 'desc');
      return params;
    },
    [view, status, expiring, branchId, from, to, debouncedSearch, sort, page],
  );

  const listParams = useMemo(() => buildParams(), [buildParams]);
  const listQuery = useQuery<BookingListResponse>({
    queryKey: ['bookings', listParams],
    queryFn: async () => (await api.get(`/bookings?${new URLSearchParams(listParams)}`)).data,
    // เปลี่ยนตัวกรอง/หน้า: คงแถวเดิมไว้จนชุดใหม่มา — ไม่กระพริบเป็นโครงรอ
    placeholderData: keepPreviousData,
  });

  const summaryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (branchId) params.branchId = branchId;
    if (from) params.from = from;
    if (to) params.to = to;
    return params;
  }, [branchId, from, to]);
  const summaryQuery = useQuery<BookingSummary>({
    queryKey: ['bookings-summary', summaryParams],
    queryFn: async () =>
      (await api.get(`/bookings/summary?${new URLSearchParams(summaryParams)}`)).data,
    placeholderData: keepPreviousData,
  });

  const branchesQuery = useQuery<BranchOption[]>({
    queryKey: ['booking-branches'],
    enabled: canFilterBranch,
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return (data.data ?? data ?? []) as BranchOption[];
    },
  });

  const hasActiveFilters =
    view !== 'open' || !!branchId || !!from || !!to || !!debouncedSearch.trim() || !!sort;

  return {
    view,
    status,
    expiring,
    branchId,
    from,
    to,
    search,
    setSearch,
    debouncedSearch,
    page,
    setPage,
    sort,
    setSort,
    setFilters,
    clearFilters,
    hasActiveFilters,
    activeKpiKey,
    branches: branchesQuery.data ?? [],
    canFilterBranch,
    listResult: listQuery.data,
    summary: summaryQuery.data,
    summaryLoading: summaryQuery.isLoading,
    summaryPlaceholder: summaryQuery.isPlaceholderData,
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: () => {
      void listQuery.refetch();
      void summaryQuery.refetch();
    },
    buildParams,
  };
}
