import { Search } from 'lucide-react';
import { PROSPECT_SOURCES } from '@installment/shared';
import ResponsiveFilterPanel from '@/components/ui/ResponsiveFilterPanel';
import { TIER_LABELS } from '@/types/customer-tier';
import FilterSelect from './FilterSelect';
import { SOURCE_LABELS } from './sourceLabels';

/**
 * ตัวกรองแท็บ "ลูกค้า" — ค้นหา · การซื้อ 168 · ซื้อล่าสุด 168 · ระดับลูกค้า 168 · สาขา 140
 * **ไม่มีสถานะเครดิต** (mockup ที่เจ้าของเคาะถอดออก — ย้ายไปเป็นคอลัมน์ที่ซ่อนไว้)
 * และ **ไม่มีดรอปดาวน์ "เรียงโดย"** — การเรียงอยู่ที่หัวคอลัมน์
 */

export const CUSTOMER_SEARCH_PLACEHOLDER = 'ค้นหาชื่อ, เบอร์โทร, เลขบัตร, IMEI, เลขที่สัญญา/ใบขาย';

/** ค่าในดรอปดาวน์ "การซื้อ" = `<kind>` หรือ `INSTALLMENT:<state>` */
export function encodePurchase(purchase: string, state: string): string {
  if (!purchase) return '';
  return purchase === 'INSTALLMENT' && state ? `INSTALLMENT:${state}` : purchase;
}

export function decodePurchase(value: string): { purchase: string; state: string } {
  if (!value) return { purchase: '', state: '' };
  const [purchase, state = ''] = value.split(':');
  return { purchase, state };
}

export default function CustomerFilterBar({
  search,
  setSearch,
  source,
  purchase,
  state,
  bought,
  tier,
  branchId,
  branches,
  canFilterBranch,
  setFilters,
}: {
  search: string;
  setSearch: (value: string) => void;
  source: string;
  purchase: string;
  state: string;
  bought: string;
  tier: string;
  branchId: string;
  branches: { id: string; name: string }[];
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
            placeholder={CUSTOMER_SEARCH_PLACEHOLDER}
            aria-label="ค้นหาลูกค้า"
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
            { options: PROSPECT_SOURCES.map((key) => ({ value: key, label: SOURCE_LABELS[key] })) },
          ]}
        />
        <FilterSelect
          ariaLabel="การซื้อ"
          placeholder="ทุกแบบการซื้อ"
          width={168}
          value={encodePurchase(purchase, state)}
          onChange={(value) => {
            const decoded = decodePurchase(value);
            setFilters({ purchase: decoded.purchase, state: decoded.state });
          }}
          groups={[
            {
              options: [
                { value: 'CASH', label: 'เงินสด' },
                { value: 'INSTALLMENT', label: 'ผ่อนกับเรา' },
                { value: 'INSTALLMENT:ACTIVE', label: 'กำลังผ่อน', indent: true },
                { value: 'INSTALLMENT:OVERDUE', label: 'ค้างชำระ', indent: true },
                { value: 'INSTALLMENT:CLOSED', label: 'ปิดสัญญาแล้ว', indent: true },
                { value: 'INSTALLMENT:BAD_DEBT', label: 'หนี้สูญ/ยกเลิก', indent: true },
                { value: 'EXTERNAL_FINANCE', label: 'ไฟแนนซ์นอก' },
              ],
            },
          ]}
        />
        <FilterSelect
          ariaLabel="ซื้อล่าสุด"
          placeholder="ทุกช่วงเวลา"
          width={168}
          value={bought}
          onChange={(value) => setFilters({ bought: value })}
          groups={[
            {
              options: [
                { value: '30d', label: '30 วันที่ผ่านมา' },
                { value: '90d', label: '90 วันที่ผ่านมา' },
                { value: 'ytd', label: 'ปีนี้' },
                { value: 'over1y', label: 'เกิน 1 ปี (ลูกค้าเก่าที่หายไป)' },
              ],
            },
          ]}
        />
        <FilterSelect
          ariaLabel="ระดับลูกค้า"
          placeholder="ทุกระดับลูกค้า"
          width={168}
          value={tier}
          onChange={(value) => setFilters({ tier: value })}
          groups={[
            {
              options: (
                ['GOLD', 'GOOD', 'NEW', 'RISKY', 'BLACKLIST'] as const
              ).map((key) => ({ value: key, label: TIER_LABELS[key] })),
            },
          ]}
        />
        {canFilterBranch && (
          <FilterSelect
            ariaLabel="สาขา"
            placeholder="ทุกสาขา"
            width={140}
            value={branchId}
            onChange={(value) => setFilters({ branchId: value })}
            groups={[{ options: branches.map((b) => ({ value: b.id, label: b.name })) }]}
          />
        )}
      </div>
    </ResponsiveFilterPanel>
  );
}
