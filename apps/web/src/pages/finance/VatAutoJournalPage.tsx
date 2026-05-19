import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
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
import { formatNumberDecimal, formatDateMedium } from '@/utils/formatters';
import { Calculator } from 'lucide-react';

interface VatLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface VatJEEntry {
  id: string;
  documentNumber: string;
  postedAt: string;
  sourceType: string;
  description: string;
  vatLines: VatLine[];
}

interface VatAutoJournalData {
  period: { year: number; month: number };
  entries: VatJEEntry[];
}

export default function VatAutoJournalPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const query = useQuery({
    queryKey: ['vat-auto-journal', year, month],
    queryFn: () =>
      api
        .get<VatAutoJournalData>(
          `/finance-tax/vat-auto-journal?year=${year}&month=${month}`,
        )
        .then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="VAT Auto Journal — รายการอัตโนมัติประจำเดือน"
        icon={<Calculator className="size-5" />}
        subtitle="รายการสมุดรายวันที่มีบัญชี VAT (21-2101, 21-2102, 11-4101, 11-2104, 11-2105)"
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
              {query.data.entries.length} รายการ
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>วันที่</TableHead>
                    <TableHead>เลขเอกสาร</TableHead>
                    <TableHead>ที่มา (Source)</TableHead>
                    <TableHead>คำอธิบาย</TableHead>
                    <TableHead>บัญชี VAT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.entries.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground py-10"
                      >
                        ไม่มีรายการ VAT Journal ในงวดที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    query.data.entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDateMedium(entry.postedAt)}
                        </TableCell>
                        <TableCell>
                          <Link
                            to={`/finance/general-journal?je=${entry.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {entry.documentNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {entry.sourceType}
                        </TableCell>
                        <TableCell className="text-sm leading-snug max-w-[200px] truncate">
                          {entry.description}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            {entry.vatLines.map((l, i) => (
                              <div key={i} className="text-xs flex gap-2">
                                <span className="font-mono text-muted-foreground w-[52px] shrink-0">
                                  {l.accountCode}
                                </span>
                                {l.debit > 0 ? (
                                  <span>
                                    Dr{' '}
                                    <span className="font-mono tabular-nums">
                                      {formatNumberDecimal(l.debit, 2)}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Cr{' '}
                                    <span className="font-mono tabular-nums">
                                      {formatNumberDecimal(l.credit, 2)}
                                    </span>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
