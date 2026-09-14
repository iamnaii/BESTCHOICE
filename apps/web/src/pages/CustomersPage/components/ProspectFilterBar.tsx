import { Search } from 'lucide-react';
import { PROSPECT_SOURCES } from '@installment/shared';
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import { customerCreditStatusMap } from '@/lib/status-badges';
import FilterSelect, { type FilterOption } from './FilterSelect';
import { SOURCE_LABELS } from './sourceLabels';

/**
 * ตัวกรองแท็บ "ผู้สนใจ" — ค้นหา · ที่มา 148 · ผล pre-check 148 · แท็ก 148 ·
 * ติดต่อล่าสุด 156 · ผู้ดูแล 130
 */

export const PROSPECT_SEARCH_PLACEHOLDER = 'ค้นหาชื่อ, ชื่อเล่น, เบอร์โทร, ชื่อในแชท';

/** sentinel ของ "ยังไม่มีผู้ดูแล" — ใช้ได้ทุกบทบาทเพราะไม่ต้องมีรายชื่อพนักงาน */
export const UNASSIGNED = 'unassigned';

/**
 * `PRE_CHECK_PASSED` **ถอดจากดรอปดาวน์** (ยังอยู่ใน badge map เพื่ออ่านข้อมูลเก่า):
 * ไม่มีโค้ด production ที่ไหนเขียน `checkType: 'PRE'` เลย ⇒ ไม่มีแถวไหนในฐานข้อมูล
 * เป็นค่านี้ เลือกแล้วได้ 0 รายการทุกครั้ง — และการ์ด KPI "ผ่าน pre-check" ก็ยิง
 * `FULL_CHECK_PASSED` อยู่แล้ว (ดู `CustomerKpiCards.tsx`) ⇒ ดรอปดาวน์ต้องตรงกับการ์ด
 */
const UNREACHABLE_PRECHECK = 'PRE_CHECK_PASSED';

export const PROSPECT_PRECHECK_OPTIONS: FilterOption[] = Object.entries(customerCreditStatusMap)
  .filter(([value]) => value !== UNREACHABLE_PRECHECK)
  .map(([value, cfg]) => ({ value, label: cfg.label }));

const TAG_LABELS: Record<string, string> = {
  VIP: 'VIP',
  HIGH_RISK: 'เสี่ยงสูง',
  NEW: 'ลูกค้าใหม่',
  LOYAL: 'ลูกค้าประจำ',
  BLACKLIST: 'BLACKLIST',
};

export default function ProspectFilterBar({
  search,
  setSearch,
  source,
  precheck,
  tag,
  contacted,
  owner,
  staff,
  setFilters,
}: {
  search: string;
  setSearch: (value: string) => void;
  source: string;
  precheck: string;
  tag: string;
  contacted: string;
  owner: string;
  staff: { id: string; name: string }[];
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
            placeholder={PROSPECT_SEARCH_PLACEHOLDER}
            aria-label="ค้นหาผู้สนใจ"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-hidden transition-colors focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FilterSelect
          ariaLabel="ที่มา"
          placeholder="ทุกที่มา"
          width={148}
          value={source}
          onChange={(value) => setFilters({ source: value })}
          groups={[
            {
              options: PROSPECT_SOURCES.map((key) => ({ value: key, label: SOURCE_LABELS[key] })),
            },
          ]}
        />
        <FilterSelect
          ariaLabel="ผล pre-check"
          placeholder="ทุกผล pre-check"
          width={148}
          value={precheck}
          onChange={(value) => setFilters({ precheck: value })}
          groups={[{ options: PROSPECT_PRECHECK_OPTIONS }]}
        />
        <FilterSelect
          ariaLabel="แท็ก"
          placeholder="ทุกแท็ก"
          width={148}
          value={tag}
          onChange={(value) => setFilters({ tag: value })}
          groups={[
            {
              options: Object.entries(TAG_LABELS).map(([value, label]) => ({ value, label })),
            },
          ]}
        />
        <FilterSelect
          ariaLabel="ติดต่อล่าสุด"
          placeholder="ทั้งหมด"
          width={156}
          value={contacted}
          onChange={(value) => setFilters({ contacted: value })}
          groups={[
            {
              options: [
                { value: 'today', label: 'วันนี้' },
                { value: '7d', label: '7 วันที่ผ่านมา' },
                { value: '30d', label: '30 วันที่ผ่านมา' },
                { value: 'silent30', label: 'เงียบเกิน 30 วัน' },
                { value: 'none', label: 'ไม่มีแชทผูกอยู่' },
              ],
            },
          ]}
        />
        <FilterSelect
          ariaLabel="ผู้ดูแล"
          placeholder="ทุกคน"
          width={130}
          value={owner}
          onChange={(value) => setFilters({ owner: value })}
          groups={[
            { options: [{ value: UNASSIGNED, label: 'ยังไม่มีผู้ดูแล' }] },
            ...(staff.length > 0
              ? [{ label: 'พนักงาน', options: staff.map((s) => ({ value: s.id, label: s.name })) }]
              : []),
          ]}
        />
      </div>
    </ResponsiveFilterPanel>
  );
}
