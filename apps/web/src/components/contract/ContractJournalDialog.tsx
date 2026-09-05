import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { formatNumberDecimal } from '@/utils/formatters';
import { JeBlock, type ContractJe } from '@/components/payment/JeBlock';

export type ContractJeBook = 'FINANCE' | 'SHOP' | null;

/** แถวจาก GET /contracts/:id/journal-entries — ContractJe + สมุดที่ใบนั้นอยู่ */
export interface ContractJournalEntry extends ContractJe {
  companyCode: ContractJeBook;
}

export interface BookGroup {
  book: ContractJeBook;
  label: string;
  items: ContractJournalEntry[];
  /** Σ totalDebit ของกลุ่ม (แสดงผลอย่างเดียว — ไม่ใช่ตัวเลขบัญชี) */
  totalDebit: number;
}

const BOOK_ORDER: ContractJeBook[] = ['FINANCE', 'SHOP', null];
const BOOK_LABEL: Record<'FINANCE' | 'SHOP' | 'none', string> = {
  FINANCE: 'สมุด FINANCE',
  SHOP: 'สมุด SHOP (หน้าร้าน)',
  none: 'ไม่ระบุสมุด',
};

/** จัดกลุ่มตามสมุด FINANCE → SHOP → ไม่ระบุ, ตัดกลุ่มว่างทิ้ง (server เรียงตามวันมาแล้ว) */
export function groupByBook(entries: ContractJournalEntry[]): BookGroup[] {
  return BOOK_ORDER.map((book) => {
    const items = entries.filter((e) => (e.companyCode ?? null) === book);
    // รวมเป็นสตางค์ (จำนวนเต็ม) ก่อนหาร — เลี่ยง float drift เมื่อบวกทศนิยมหลายสิบใบ (แสดงผลเท่านั้น)
    const totalDebit =
      items.reduce((sum, e) => sum + Math.round(Number(e.totalDebit) * 100), 0) / 100;
    return { book, label: BOOK_LABEL[book ?? 'none'], items, totalDebit };
  }).filter((g) => g.items.length > 0);
}

interface Props {
  /** null = ปิด dialog (ไม่ยิง query) */
  contractId: string | null;
  contractNumber?: string;
  onClose: () => void;
}

/**
 * "บันทึกบัญชีของสัญญา" — JE ทุกใบที่ผูกกับสัญญา ทั้งสมุด FINANCE และ SHOP
 * (spec 2026-09-05). ใช้จาก ContractDetailPage และ RepossessionsPage.
 */
export default function ContractJournalDialog({ contractId, contractNumber, onClose }: Props) {
  const {
    data = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ContractJournalEntry[]>({
    queryKey: ['contract-journal', contractId],
    queryFn: async () => (await api.get(`/contracts/${contractId}/journal-entries`)).data,
    enabled: !!contractId,
  });
  const groups = useMemo(() => groupByBook(data), [data]);

  return (
    <Dialog open={!!contractId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[min(96vw,80rem)] max-h-[94vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border mb-0 text-start">
          <DialogTitle className="leading-snug">
            บันทึกบัญชีของสัญญา{' '}
            {contractNumber && <span className="text-primary font-mono">— {contractNumber}</span>}
          </DialogTitle>
          <div className="text-xs text-muted-foreground leading-snug mt-0.5">
            JE ทุกใบที่ผูกกับสัญญานี้ ทั้งสมุด FINANCE และ SHOP · {data.length} ใบ
          </div>
        </DialogHeader>
        <DialogBody className="flex-1 overflow-auto px-5 py-4">
          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดบันทึกบัญชีได้"
          >
            {groups.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8 leading-snug">
                ยังไม่มีบันทึกบัญชีของสัญญานี้
              </div>
            ) : (
              <div className="space-y-5">
                {groups.map((g) => (
                  <section key={g.label}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-foreground leading-snug">
                        {g.label}
                      </h4>
                      <span className="text-xs text-muted-foreground leading-snug">
                        {g.items.length} ใบ · Dr รวม {formatNumberDecimal(g.totalDebit, 2)} ฿
                      </span>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {g.items.map((je) => (
                        <JeBlock key={je.id} je={je} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </QueryBoundary>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
