import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { formatNumberDecimal, formatDateMedium } from '@/utils/formatters';
import { Calculator, Download } from 'lucide-react';

const MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

interface VatLine {
  accountCode: string;
  documentNumber: string;
  postedAt: string;
  description: string;
  debit: number;
  credit: number;
}

/** ที่มาของภาษีขายเดือนนี้ — ตัวคำนวณเดียวของ ภ.พ.30 ฝั่ง API (`apps/api/src/modules/tax/pp30-output-vat.ts`) */
interface OutputVatBreakdown {
  settledGross: string;
  reductionReversal: string;
  reductionCreditNote: string;
  reductionOther: string;
  reductionTotal: string;
  settledNet: string;
  mandatory60DayCredit: string;
  mandatory60DayDebit: string;
  mandatory60DayNet: string;
  /** false = ภาษีขาย 60 วันเป็นข้อมูลประกอบ ไม่รวมใน totalOutputVat (รอฝ่ายบัญชี) */
  mandatory60DayIncluded: boolean;
  totalOutputVat: string;
}

/** ยอดเงินเป็นสตริงทศนิยม 2 ตำแหน่ง (API คำนวณด้วย Decimal) — รายบรรทัดในตารางยังเป็นตัวเลข */
interface VatData {
  period: { year: number; month: number };
  vatOutput: string;
  vatDeferred: string;
  vatInput: string;
  netVat: string;
  /** ไม่มีเมื่อ API ยังเป็นรุ่นก่อน 2026-09-30 (เว็บอาจขึ้นก่อน API) — หน้าไม่แสดงกล่องที่มา */
  outputVat?: OutputVatBreakdown;
  lineCount: number;
  lines: VatLine[];
}

function SummaryCard({
  label,
  value,
  className,
  bold,
}: {
  label: string;
  value: string;
  className?: string;
  bold?: boolean;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-muted-foreground leading-snug">{label}</div>
        <div className={`text-xl mt-1 font-mono ${bold ? 'font-bold' : 'font-semibold'}`}>
          {formatNumberDecimal(value, 2)} ฿
        </div>
      </CardContent>
    </Card>
  );
}

type OutputVatAmountKey = Exclude<keyof OutputVatBreakdown, 'mandatory60DayIncluded'>;
type BreakdownRow = { key: OutputVatAmountKey; label: string; total?: boolean };

const OUTPUT_VAT_ROWS: BreakdownRow[] = [
  { key: 'settledGross', label: 'ภาษีขายที่ตั้งในเดือน (เครดิต 21-2101)' },
  { key: 'reductionReversal', label: 'หัก กลับรายการ' },
  { key: 'reductionCreditNote', label: 'หัก ใบลดหนี้ (ม.82/5)' },
  { key: 'reductionOther', label: 'หัก รายการอื่นที่ลดภาษีขาย' },
  { key: 'totalOutputVat', label: 'ภาษีขายเดือนนี้ (ภ.พ.30)', total: true },
];

/** ภาษีขาย 60 วัน (21-2103) — ข้อมูลประกอบ ไม่รวมในยอดข้างบนจนกว่าฝ่ายบัญชีจะตอบ (PP30_INCLUDES_MANDATORY_60DAY ฝั่ง API) */
const MANDATORY_60DAY_ROWS: BreakdownRow[] = [
  { key: 'mandatory60DayCredit', label: 'ตั้งในเดือน (เครดิต 21-2103)' },
  { key: 'mandatory60DayDebit', label: 'กลับรายการ (เดบิต 21-2103)' },
  { key: 'mandatory60DayNet', label: 'สุทธิ' },
];

function BreakdownRows({ data, rows }: { data: OutputVatBreakdown; rows: BreakdownRow[] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`flex items-baseline justify-between gap-4 text-sm leading-snug ${
            row.total
              ? 'border-t border-border pt-1.5 font-semibold text-foreground'
              : 'text-muted-foreground'
          }`}
        >
          <dt>{row.label}</dt>
          <dd className="font-mono tabular-nums text-foreground">
            {`${formatNumberDecimal(data[row.key], 2)} ฿`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OutputVatBreakdownCard({ data }: { data: OutputVatBreakdown }) {
  return (
    <section
      aria-labelledby="output-vat-breakdown-title"
      className="mb-6 rounded-lg border border-border bg-muted/30 p-4"
    >
      <h3
        id="output-vat-breakdown-title"
        className="text-sm font-semibold text-foreground leading-snug mb-3"
      >
        ที่มาของภาษีขายเดือนนี้
      </h3>
      <BreakdownRows data={data} rows={OUTPUT_VAT_ROWS} />
      <div className="mt-4 border-t border-dashed border-border pt-3">
        <h4 className="text-xs font-semibold text-muted-foreground leading-snug mb-2">
          ภาษีขาย 60 วัน (21-2103) — ข้อมูลประกอบ ยังไม่รวมในยอดข้างบน (รอฝ่ายบัญชีวินิจฉัย)
        </h4>
        <BreakdownRows data={data} rows={MANDATORY_60DAY_ROWS} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground leading-snug">
        รายการกลับรายการและใบลดหนี้ลดภาษีขายของเดือนที่ลงรายการ — ไม่แก้ตัวเลขของเดือนเดิม ·
        ดูรายการทีละบรรทัดได้ในตารางด้านล่าง
      </p>
    </section>
  );
}

export default function VatPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const query = useQuery({
    queryKey: ['vat-monthly', year, month],
    queryFn: () =>
      api
        .get<VatData>(`/finance-tax/vat-monthly?year=${year}&month=${month}`)
        .then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="VAT (ภ.พ.30) — รายเดือน"
        icon={<Calculator className="size-5" />}
      />
      <Card>
        <CardHeader className="flex flex-row gap-3 items-end flex-wrap pb-4">
          <div className="flex gap-3 items-center">
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[year - 2, year - 1, year, year + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y + 543}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={query.refetch}
          >
            {query.data && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <SummaryCard
                    label="ภาษีขายเดือนนี้ (ภ.พ.30)"
                    value={query.data.vatOutput}
                    className="border-success/30 bg-success/5"
                  />
                  <SummaryCard
                    label="ภาษีขายรอเรียกเก็บ 21-2102"
                    value={query.data.vatDeferred}
                    className="border-amber-500/30 bg-amber-500/5"
                  />
                  <SummaryCard
                    label="ภาษีซื้อ 11-4101"
                    value={query.data.vatInput}
                    className="border-blue-500/30 bg-blue-500/5"
                  />
                  <SummaryCard
                    label="VAT สุทธิ (ออก − ซื้อ)"
                    value={query.data.netVat}
                    className="border-primary/30 bg-primary/5"
                    bold
                  />
                </div>

                {query.data.outputVat && <OutputVatBreakdownCard data={query.data.outputVat} />}

                <div className="flex justify-end mb-4 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toast.info('Excel export — coming soon')}
                  >
                    <Download className="size-4 mr-1.5" />
                    Excel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => toast.info('XML e-filing — coming soon')}
                  >
                    <Download className="size-4 mr-1.5" />
                    XML (e-filing)
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>วันที่</TableHead>
                      <TableHead>เลขเอกสาร</TableHead>
                      <TableHead>คำอธิบาย</TableHead>
                      <TableHead>บัญชี</TableHead>
                      <TableHead className="text-right">เดบิต</TableHead>
                      <TableHead className="text-right">เครดิต</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {query.data.lines.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-muted-foreground py-10"
                        >
                          ไม่มีรายการในงวดที่เลือก
                        </TableCell>
                      </TableRow>
                    ) : (
                      query.data.lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell>{formatDateMedium(l.postedAt)}</TableCell>
                          <TableCell className="font-mono text-xs">{l.documentNumber}</TableCell>
                          <TableCell className="text-sm leading-snug">{l.description}</TableCell>
                          <TableCell className="font-mono text-xs">{l.accountCode}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {l.debit ? formatNumberDecimal(l.debit, 2) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {l.credit ? formatNumberDecimal(l.credit, 2) : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
