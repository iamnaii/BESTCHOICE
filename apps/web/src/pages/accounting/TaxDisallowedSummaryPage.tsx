import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ban, FileText, Layers, TrendingDown } from 'lucide-react';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { formatNumberDecimal } from '@/utils/formatters';

/**
 * Phase A.5 — Tax-disallowed expense summary for ภ.ง.ด.50/51 prep.
 *
 * Year-end view that totals expense documents flagged as non-deductible
 * (ม.65 ตรี ป.รัษฎากร). Accountant uses this to subtract from the
 * deductible-expense total on the corporate income-tax filing.
 *
 * Two roll-ups (no double-count):
 *   - Doc-level total — sum(totalAmount) of POSTED docs with doc-level flag
 *   - Line-level total — sum(amountBeforeVat) of line overrides on
 *     docs that are NOT already doc-level disallowed
 */

interface TaxDisallowedSummary {
  docLevelCount: number;
  docLevelTotal: string;
  lineLevelCount: number;
  lineLevelTotal: string;
  grandTotal: string;
  filters: { from: string | null; to: string | null };
}

const bkkYear = (): number => {
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  return Number(ymd.slice(0, 4));
};

export default function TaxDisallowedSummaryPage() {
  const [year, setYear] = useState<number>(bkkYear());
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const query = useQuery({
    queryKey: ['tax-disallowed', year],
    queryFn: async () => {
      const { data } = await api.get<TaxDisallowedSummary>('/expense-documents/tax-disallowed', {
        params: { from, to },
      });
      return data;
    },
  });

  const yearOptions: number[] = [];
  const current = bkkYear();
  for (let y = current; y >= current - 4; y--) yearOptions.push(y);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Ban className="size-6 text-warning" />
        <div>
          <h1 className="text-2xl font-semibold leading-snug">
            ค่าใช้จ่ายต้องห้าม (ภ.ง.ด.50/51)
          </h1>
          <p className="text-sm text-muted-foreground leading-snug mt-0.5">
            สรุปยอดค่าใช้จ่ายที่หักลดหย่อนภาษีนิติบุคคลไม่ได้ (ม.65 ตรี ป.รัษฎากร) — ใช้ประกอบการยื่นแบบ ภ.ง.ด.50/51 ปลายปี
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <label className="block text-xs font-medium mb-2 leading-snug">รอบปีภาษี</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-48 rounded-lg border border-input bg-background px-3 py-2 text-sm"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y} (พ.ศ. {y + 543})
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-2 leading-snug">
          ช่วง {from} ถึง {to} — เฉพาะเอกสาร POSTED (ที่ลงบัญชีแล้ว)
        </p>
      </div>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        {query.data && (
          <div className="grid gap-4 md:grid-cols-3">
            <Card
              icon={FileText}
              label="ระดับเอกสาร"
              sub={`${query.data.docLevelCount.toLocaleString('th-TH')} เอกสาร`}
              value={query.data.docLevelTotal}
            />
            <Card
              icon={Layers}
              label="ระดับบรรทัด (override)"
              sub={`${query.data.lineLevelCount.toLocaleString('th-TH')} บรรทัด`}
              value={query.data.lineLevelTotal}
            />
            <Card
              icon={TrendingDown}
              label="รวมยอดต้องห้าม (สุทธิ)"
              sub="ใช้บวกกลับใน ภ.ง.ด.50/51"
              value={query.data.grandTotal}
              highlight
            />
          </div>
        )}
      </QueryBoundary>

      <div className="rounded-xl border border-border bg-muted/30 p-5">
        <h2 className="text-sm font-semibold mb-2 leading-snug">หมายเหตุทางบัญชี (TFRS for NPAEs)</h2>
        <ul className="text-xs leading-snug text-muted-foreground space-y-1.5 list-disc pl-5">
          <li>
            ค่าใช้จ่ายต้องห้ามยัง <span className="font-medium text-foreground">บันทึกบัญชีตามปกติ</span> — Dr 5x-xxxx / Cr 21-xxxx เหมือนค่าใช้จ่ายทั่วไป.
          </li>
          <li>
            Flag นี้ใช้สำหรับ <span className="font-medium text-foreground">รายงานภาษีเงินได้นิติบุคคล</span> เท่านั้น — ไม่กระทบ JE/งบกำไรขาดทุน.
          </li>
          <li>
            ตัวอย่าง: ค่ารับรองเกิน 2,000 บาท/คน/ครั้ง, ค่าปรับสรรพากร, รายจ่ายส่วนตัวของผู้ถือหุ้น, บริจาคเกินเพดาน 2% / 10%.
          </li>
          <li>
            ระดับเอกสาร = ทั้งใบ; ระดับบรรทัด = เฉพาะรายการที่ติ๊กไว้ในใบที่ไม่ได้ติ๊กทั้งใบ. ระบบรวมยอดแบบไม่ซ้ำซ้อนให้แล้ว.
          </li>
        </ul>
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  label,
  sub,
  value,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sub: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? 'rounded-xl border-2 border-warning/60 bg-warning/5 p-5'
          : 'rounded-xl border border-border bg-card p-5'
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className={highlight ? 'size-4 text-warning' : 'size-4 text-muted-foreground'} />
        <span className="text-xs font-medium leading-snug">{label}</span>
      </div>
      <div className={`font-mono ${highlight ? 'text-2xl font-bold text-warning' : 'text-xl font-semibold'}`}>
        {formatNumberDecimal(value)}
        <span className="text-xs font-normal text-muted-foreground ml-1.5">บาท</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1 leading-snug">{sub}</div>
    </div>
  );
}
