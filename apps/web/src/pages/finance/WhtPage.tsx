import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { formatNumberDecimal, formatDateMedium } from '@/utils/formatters';
import { Calculator } from 'lucide-react';

interface WhtLine {
  documentNumber: string;
  postedAt: string;
  description: string;
  amount: number;
}

interface WhtBucket {
  lines: WhtLine[];
  total: number;
}

interface WhtData {
  period: { year: number; month: number };
  PND1: WhtBucket;
  PND3: WhtBucket;
  PND53: WhtBucket;
  grandTotal: number;
}

const FORM_LABELS: Record<string, string> = {
  PND1: 'ภ.ง.ด. 1 — เงินเดือน',
  PND3: 'ภ.ง.ด. 3 — บุคคลธรรมดา',
  PND53: 'ภ.ง.ด. 53 — นิติบุคคล',
};

function WhtTable({ bucket, formKey }: { bucket: WhtBucket; formKey: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>วันที่</TableHead>
          <TableHead>เลขเอกสาร</TableHead>
          <TableHead>คำอธิบาย</TableHead>
          <TableHead className="text-right">จำนวน (฿)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bucket.lines.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
              ไม่มีรายการ {formKey} ในงวดที่เลือก
            </TableCell>
          </TableRow>
        ) : (
          <>
            {bucket.lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>{formatDateMedium(l.postedAt)}</TableCell>
                <TableCell className="font-mono text-xs">{l.documentNumber}</TableCell>
                <TableCell className="text-sm leading-snug">{l.description}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatNumberDecimal(l.amount, 2)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold border-t-2 border-border">
              <TableCell colSpan={3} className="text-sm">
                รวม {formKey}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatNumberDecimal(bucket.total, 2)} ฿
              </TableCell>
            </TableRow>
          </>
        )}
      </TableBody>
    </Table>
  );
}

export default function WhtPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const query = useQuery({
    queryKey: ['wht-monthly', year, month],
    queryFn: () =>
      api
        .get<WhtData>(`/finance-tax/wht-monthly?year=${year}&month=${month}`)
        .then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="WHT (ภ.ง.ด. 1/3/53) — รายเดือน"
        icon={<Calculator className="size-5" />}
      />
      <Card>
        <CardHeader className="flex flex-row gap-3 items-center flex-wrap pb-4">
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
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  เดือน {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {query.data && (
            <span className="text-sm text-muted-foreground ml-auto">
              รวมทุกแบบ:{' '}
              <span className="font-mono font-semibold">
                {formatNumberDecimal(query.data.grandTotal, 2)} ฿
              </span>
            </span>
          )}
        </CardHeader>
        <CardContent>
          <QueryBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={query.refetch}
          >
            {query.data && (
              <Tabs defaultValue="PND3">
                <TabsList className="mb-4">
                  {(['PND1', 'PND3', 'PND53'] as const).map((form) => (
                    <TabsTrigger key={form} value={form}>
                      {FORM_LABELS[form]}{' '}
                      <span className="ml-1.5 font-mono text-xs">
                        {formatNumberDecimal(query.data![form].total, 2)} ฿
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {(['PND1', 'PND3', 'PND53'] as const).map((form) => (
                  <TabsContent key={form} value={form}>
                    <WhtTable bucket={query.data![form]} formKey={form} />
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
