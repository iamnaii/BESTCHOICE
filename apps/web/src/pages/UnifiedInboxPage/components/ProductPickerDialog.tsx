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
import { ImageOff, Loader2, Search, Smartphone } from 'lucide-react';
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

  const { data: hits = [], isFetching, isError: searchFailed, refetch: retrySearch } = useQuery<ChatProductHit[]>({
    queryKey: ['chat-product-search', debounced],
    queryFn: () =>
      api.get('/staff-chat/products/search', { params: { q: debounced } }).then((r: any) => r.data),
    enabled: isOpen && debounced.trim().length >= 2,
    refetchOnWindowFocus: false,
  });

  const { data: summary, isError: summaryFailed, refetch: retrySummary } = useQuery<ProductSummary>({
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
      const errors: string[] = data?.errors ?? [];
      // การ์ดถูกบันทึกเป็น ChatMessage ฝั่ง server (บาง bubble อาจสำเร็จแล้วแม้ผลรวม
      // จะ error) → ดึงข้อความ/รายการห้องใหม่เสมอ ไม่ว่าจะสำเร็จเต็มหรือบางส่วน
      queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });

      if (errors.length > 0) {
        // ส่งไม่ครบ (HTTP 200 แต่มี errors) — ห้ามปิด dialog: ปิดแล้วเปิดใหม่จะ reset
        // selectedId → เข้า effect ที่ล้าง clientMessageIdRef ทำให้กด "ส่งซ้ำ" ครั้ง
        // ถัดไปได้ id ใหม่ และ bubble ที่ลูกค้าได้รับไปแล้ว (เช่นรูป) จะถูกส่งซ้ำ เพราะ
        // server dedupe ด้วย `${clientMessageId}-img`/`-txt` ตาม id ที่ส่งมา ไม่ใช่ตาม
        // productId — ปล่อยให้ผู้ใช้กดปุ่มเดิมซ้ำ (ref ยังไม่ถูกล้างเพราะ selectedId ไม่เปลี่ยน)
        toast.error(`ส่งไม่ครบ — ${errors[0]} · กดปุ่มเดิมอีกครั้งเพื่อส่งซ้ำเฉพาะส่วนที่ยังไม่สำเร็จ`);
        return;
      }
      if (data?.photoSkipped) {
        toast.warning('ส่งข้อความแล้ว — เครื่องนี้ยังไม่มีรูปขึ้นเว็บ');
      } else {
        toast.success('ส่งให้ลูกค้าแล้ว');
      }
      onClose();
    },
    onError: () => toast.error('ส่งข้อมูลสินค้าไม่สำเร็จ'),
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl gap-4 overflow-y-auto rounded-2xl p-4 sm:rounded-2xl sm:p-6">
        <DialogHeader className="mb-0 text-left">
          <DialogTitle>ส่งข้อมูลสินค้าให้ลูกค้า</DialogTitle>
          <DialogDescription>
            ค้นสินค้า เลือกเครื่อง แล้วตรวจข้อมูลก่อนส่ง
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI"
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
          {isFetching && <p role="status" className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />กำลังค้นสินค้า…</p>}
          {searchFailed && <div role="alert" className="px-3 py-4 text-center text-sm"><p>ค้นสินค้าไม่สำเร็จ</p><Button type="button" variant="ghost" className="mt-2 min-h-11" onClick={() => void retrySearch()}>ลองใหม่</Button></div>}
          {debounced.trim().length >= 2 && !isFetching && !searchFailed && hits.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              ไม่พบเครื่องที่ตรงกับคำค้น
            </p>
          )}
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setSelectedId(h.id)}
              aria-pressed={selectedId === h.id}
              className={cn(
                'grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-3 text-left transition-colors hover:bg-accent sm:grid-cols-[44px_minmax(0,1fr)_auto]',
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
              <span className="col-start-2 text-left sm:col-start-auto sm:text-right">
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
              <p className="mt-1 text-[11px] leading-snug text-warning-strong">ยังไม่มีรูปขึ้นเว็บ</p>
            )}
            {summaryFailed ? <div role="alert" className="mt-2 text-sm"><p>โหลดสรุปสินค้าไม่สำเร็จ</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void retrySummary()}>ลองโหลดสรุปอีกครั้ง</Button></div> : <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {summary?.text ?? 'กำลังเตรียมข้อความ...'}
            </p>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 sm:flex sm:flex-wrap sm:justify-end [&>button]:min-h-11">
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
