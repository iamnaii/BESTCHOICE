import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Inbox } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type DraftType = 'QUOTE' | 'CONTRACT' | 'EXPENSE' | 'OTHER_INCOME';

export interface DraftRow {
  type: DraftType;
  id: string;
  number: string;
  customerName: string | null;
  branchName: string | null;
  amount: number;
  createdBy: string | null;
  createdAt: string;
  link: string;
}

interface DraftListResponse {
  data: DraftRow[];
  total: number;
}

const TYPE_LABEL: Record<DraftType, string> = {
  QUOTE: 'ใบเสนอราคา',
  CONTRACT: 'สัญญา',
  EXPENSE: 'รายจ่าย',
  OTHER_INCOME: 'รายได้อื่น',
};

const TYPE_VARIANT: Record<DraftType, 'primary' | 'secondary' | 'outline' | 'info'> = {
  QUOTE: 'primary',
  CONTRACT: 'secondary',
  EXPENSE: 'outline',
  OTHER_INCOME: 'info',
};

function fmtMoney(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

const TABS: { value: 'ALL' | DraftType; label: string }[] = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'QUOTE', label: 'ใบเสนอราคา' },
  { value: 'CONTRACT', label: 'สัญญา' },
  { value: 'EXPENSE', label: 'รายจ่าย' },
  { value: 'OTHER_INCOME', label: 'รายได้อื่น' },
];

export default function DraftsPage() {
  useDocumentTitle('เอกสารร่าง');
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'ALL' | DraftType>('ALL');

  const { data, isLoading, isError, error, refetch } = useQuery<DraftListResponse>({
    queryKey: ['drafts', activeTab],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeTab !== 'ALL') params.set('type', activeTab);
      const { data } = await api.get(`/drafts?${params}`);
      return data;
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="เอกสารร่าง"
        subtitle="รวมเอกสารสถานะ DRAFT ทุกประเภท — คลิกแถวเพื่อเปิดเอกสารต้นทาง"
      />

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <Button
                key={tab.value}
                size="sm"
                variant={activeTab === tab.value ? 'primary' : 'outline'}
                onClick={() => setActiveTab(tab.value)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            errorTitle="โหลดรายการเอกสารร่างไม่สำเร็จ"
            onRetry={refetch}
          >
            <DraftTable rows={data?.data ?? []} onOpen={(link) => navigate(link)} />
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// DraftTable
// ──────────────────────────────────────────────────────────────────────────

export function DraftTable({
  rows,
  onOpen,
}: {
  rows: DraftRow[];
  onOpen: (link: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
        <Inbox className="h-10 w-10 opacity-30" />
        <p>ยังไม่มีเอกสารร่าง</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">ประเภท</th>
            <th className="px-3 py-2">เลขที่</th>
            <th className="px-3 py-2">ลูกค้า / คู่ค้า</th>
            <th className="px-3 py-2">สาขา</th>
            <th className="px-3 py-2 text-right">ยอด</th>
            <th className="px-3 py-2">ผู้สร้าง</th>
            <th className="px-3 py-2">วันที่สร้าง</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.type}-${row.id}`}
              className="cursor-pointer border-b border-border/60 hover:bg-accent/40"
              onClick={() => onOpen(row.link)}
            >
              <td className="px-3 py-2">
                <Badge variant={TYPE_VARIANT[row.type]}>{TYPE_LABEL[row.type]}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.number}</td>
              <td className="px-3 py-2">{row.customerName ?? '-'}</td>
              <td className="px-3 py-2">{row.branchName ?? '-'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(row.amount)}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.createdBy ?? '-'}</td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(row.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <FileText className="ml-auto h-4 w-4 text-muted-foreground" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
