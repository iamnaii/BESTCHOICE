import { Search } from 'lucide-react';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import FilterSelect, { ALL } from '@/pages/CustomersPage/components/FilterSelect';
import type { BookingView } from '../hooks/useBookingsQuery';
import type { BookingStatus, BranchOption } from '../types';
import { STATUS_LABEL } from '../utils';

export const BOOKING_SEARCH_PLACEHOLDER = 'ค้นหา เลขที่ใบจอง · ชื่อลูกค้า · เบอร์โทร · IMEI';
const OPEN = 'OPEN';

/** ค่าในดรอปดาวน์ ↔ ตัวกรองใน URL (ดรอปดาวน์กับการ์ด KPI เขียนคีย์ชุดเดียวกัน) */
export function statusSelectValue(view: BookingView, status: string): string {
  if (view === 'status') return status;
  if (view === 'all') return ALL;
  return OPEN;
}

export function statusPatch(value: string): Record<string, string> {
  if (value === ALL) return { all: '1', status: '', expiring: '' };
  if (value === OPEN) return { all: '', status: '', expiring: '' };
  return { status: value, all: '', expiring: '' };
}

export default function BookingFilterBar({
  search,
  setSearch,
  view,
  status,
  branchId,
  from,
  to,
  branches,
  canFilterBranch,
  setFilters,
}: {
  search: string;
  setSearch: (value: string) => void;
  view: BookingView;
  status: string;
  branchId: string;
  from: string;
  to: string;
  branches: BranchOption[];
  canFilterBranch: boolean;
  setFilters: (patch: Record<string, string>) => void;
}) {
  return (
    <ResponsiveFilterPanel
      search={
        <div className="relative lg:col-span-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder={BOOKING_SEARCH_PLACEHOLDER}
            aria-label="ค้นหาใบจอง"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm leading-snug outline-hidden transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
      }
    >
      <FilterSelect
        ariaLabel="สถานะใบจอง"
        placeholder="ทั้งหมด"
        value={statusSelectValue(view, status)}
        onChange={(value) => setFilters(statusPatch(value))}
        width={180}
        groups={[
          { options: [{ value: OPEN, label: 'ที่ยังเปิดอยู่' }] },
          {
            label: 'สถานะ',
            options: (Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            })),
          },
          { options: [{ value: 'CLOSED', label: 'ปิดแล้ว (ขาย/ยกเลิก/หมดอายุ)' }] },
        ]}
      />
      {canFilterBranch && (
        <FilterSelect
          ariaLabel="สาขา"
          placeholder="ทุกสาขา"
          value={branchId}
          onChange={(value) => setFilters({ branchId: value })}
          width={150}
          groups={[{ options: branches.map((b) => ({ value: b.id, label: b.name })) }]}
        />
      )}
      <DateRangeChips
        startDate={from}
        endDate={to}
        onChange={({ startDate, endDate }) => setFilters({ from: startDate, to: endDate })}
      />
    </ResponsiveFilterPanel>
  );
}
