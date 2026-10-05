import { Search } from 'lucide-react';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import FilterSelect from '@/pages/CustomersPage/components/FilterSelect';
import type { BookingView } from '../hooks/useBookingsQuery';
import type { BranchOption } from '../types';
import { STATUS_LABEL } from '../utils';

export const BOOKING_SEARCH_PLACEHOLDER = 'ค้นหา เลขที่ใบจอง · ชื่อลูกค้า · เบอร์โทร · IMEI';
const ALL_STATUSES = 'ALL_STATUSES';
const EXPIRING = 'EXPIRING';
const CLOSED = 'CLOSED';
/** ใกล้หมดอายุ = 3 วัน เท่ากับการ์ด KPI */
const EXPIRING_DAYS = '3';

/** ค่าในดรอปดาวน์ ↔ ตัวกรองใน URL (ดรอปดาวน์กับการ์ด KPI เขียนคีย์ชุดเดียวกัน) · '' = มุมมองเริ่มต้น (ที่ยังเปิดอยู่) */
export function statusSelectValue(view: BookingView, status: string): string {
  if (view === 'status') return status;
  if (view === 'all') return ALL_STATUSES;
  if (view === 'expiring') return EXPIRING;
  return '';
}

export function statusPatch(value: string): Record<string, string> {
  if (value === ALL_STATUSES) return { all: '1', status: '', expiring: '' };
  if (value === EXPIRING) return { expiring: EXPIRING_DAYS, status: '', all: '' };
  if (value === '') return { all: '', status: '', expiring: '' };
  return { status: value, all: '', expiring: '' };
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_STATUSES, label: 'ทั้งหมด' },
  { value: EXPIRING, label: 'ใกล้หมดอายุ (≤3 วัน)' },
  { value: 'PENDING_DEPOSIT', label: STATUS_LABEL.PENDING_DEPOSIT },
  { value: 'PAID', label: STATUS_LABEL.PAID },
  { value: CLOSED, label: 'ปิดแล้ว (ขาย/ยกเลิก/หมดอายุ)' },
];

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
        placeholder="ที่ยังเปิดอยู่"
        value={statusSelectValue(view, status)}
        onChange={(value) => setFilters(statusPatch(value))}
        width={180}
        groups={[{ options: STATUS_OPTIONS }]}
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
