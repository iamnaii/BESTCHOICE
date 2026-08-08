import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImageOff, Search, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';

interface ChatProductHit {
  id: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  status: string;
  category: string;
  conditionGrade: string | null;
  batteryHealth: number | null;
  branchName: string | null;
  photoUrl: string | null;
  cashPrice: number | null;
  installmentPrice: number | null;
  months: number | null;
  monthlyPayment: number | null;
  downAmount: number | null;
  shareUrl: string | null;
}

interface ProductSummary {
  productId: string;
  title: string;
  text: string;
  photoUrl: string | null;
  shareUrl: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  roomId: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'พร้อมขาย',
  RESERVED: 'ติดจอง',
};

const baht = (n: number | null) => (n == null ? '-' : n.toLocaleString('th-TH', { maximumFractionDigits: 2 }));

export default function ProductPickerDialog({ isOpen, onClose, onInsert, roomId }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounced = useDebounce(search, 300);

  // clientMessageId ต่อ "การเลือกสินค้า 1 ครั้ง" — คงค่าเดิมไว้จนกว่าจะเลือกสินค้าใหม่/เปิด
  // dialog ใหม่ (idempotency contract จาก backend: unique [roomId, clientMessageId]).
  // ถ้า generate ใหม่ทุกครั้งที่กด "ส่ง" การ retry หลังพังบางส่วน (เช่น รูปส่งสำเร็จ
  // แต่ข้อความพัง) จะกลายเป็นส่งรูปซ้ำให้ลูกค้าแทนที่จะข้ามไปส่งเฉพาะส่วนที่ยังไม่สำเร็จ
  const clientMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    clientMessageIdRef.current = null;
  }, [selectedId]);

  const { data: hits = [], isFetching } = useQuery<ChatProductHit[]>({
    queryKey: ['chat-product-search', debounced],
    queryFn: () =>
      api.get('/staff-chat/products/search', { params: { q: debounced } }).then((r: any) => r.data),
    enabled: isOpen && debounced.trim().length >= 2,
    refetchOnWindowFocus: false,
  });

  const { data: summary } = useQuery<ProductSummary>({
    queryKey: ['chat-product-summary', selectedId],
    queryFn: () => api.get(`/staff-chat/products/${selectedId}/summary`).then((r: any) => r.data),
    enabled: !!selectedId,
    refetchOnWindowFocus: false,
  });

  const selected = hits.find((h) => h.id === selectedId) ?? null;

  const sendMut = useMutation({
    mutationFn: (parts: ('PHOTO' | 'TEXT')[]) => {
      if (!clientMessageIdRef.current) {
        clientMessageIdRef.current = crypto.randomUUID();
      }
      return api.post(`/staff-chat/rooms/${roomId}/product-card`, {
        productId: selectedId,
        clientMessageId: clientMessageIdRef.current,
        parts,
      });
    },
    onSuccess: (res: any) => {
      const data = res?.data ?? res;
      if (data?.errors?.length) {
        toast.error(`ส่งไม่ครบ — ${data.errors[0]}`);
      } else if (data?.photoSkipped) {
        toast.warning('ส่งข้อความแล้ว — เครื่องนี้ยังไม่มีรูปขึ้นเว็บ');
      } else {
        toast.success('ส่งให้ลูกค้าแล้ว');
      }
      // การ์ดถูกบันทึกเป็น ChatMessage ฝั่ง server → ดึงข้อความ/รายการห้องใหม่
      queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
      onClose();
    },
    onError: () => toast.error('ส่งข้อมูลสินค้าไม่สำเร็จ'),
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>ส่งข้อมูลสินค้าให้ลูกค้า</DialogTitle>
          <DialogDescription>
            ค้นเครื่องในสต็อก แล้วเลือกว่าจะแทรกสรุปในกล่องพิมพ์ หรือส่งให้ลูกค้าเลย
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {debounced.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา
            </p>
          )}
          {debounced.trim().length >= 2 && !isFetching && hits.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              ไม่พบเครื่องที่ตรงกับคำค้น
            </p>
          )}
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setSelectedId(h.id)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent',
                selectedId === h.id && 'bg-accent',
              )}
            >
              <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {h.photoUrl ? (
                  <img src={h.photoUrl} alt={h.name} className="size-full object-cover" />
                ) : (
                  <ImageOff className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-snug">
                  {[h.brand, h.model].filter(Boolean).join(' ')}
                </span>
                <span className="block truncate text-[11px] leading-snug text-muted-foreground">
                  {[h.storage, h.color, h.branchName ? `สาขา${h.branchName}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] font-bold leading-snug text-primary">
                  ฿{baht(h.cashPrice)}
                </span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {h.monthlyPayment != null && h.months != null
                    ? `ผ่อน ${h.months} งวด ฿${baht(h.monthlyPayment)}`
                    : STATUS_LABEL[h.status] ?? h.status}
                </span>
              </span>
            </button>
          ))}
        </div>

        {selected && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <Smartphone className="size-3.5 text-primary" />
              {[selected.brand, selected.model, selected.storage].filter(Boolean).join(' ')}
            </div>
            {!selected.photoUrl && (
              <p className="mt-1 text-[11px] leading-snug text-warning">ยังไม่มีรูปขึ้นเว็บ</p>
            )}
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
              {summary?.text ?? 'กำลังเตรียมข้อความ...'}
            </pre>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={!summary}
            onClick={() => {
              if (!summary) return;
              onInsert(summary.text);
              onClose();
            }}
          >
            แทรกสรุปในกล่องพิมพ์
          </Button>
          <Button
            variant="outline"
            disabled={!roomId || !selected?.photoUrl || sendMut.isPending}
            onClick={() => sendMut.mutate(['PHOTO'])}
          >
            ส่งรูป
          </Button>
          <Button
            disabled={!roomId || !selectedId || sendMut.isPending}
            onClick={() => sendMut.mutate(['PHOTO', 'TEXT'])}
          >
            ส่งการ์ด (รูป + ข้อความ)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
