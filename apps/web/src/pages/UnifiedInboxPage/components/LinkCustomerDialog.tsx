import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useLinkRoomCustomer } from '../hooks/useLinkRoomCustomer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ProspectPhoneLine from '@/components/customer/ProspectPhoneLine';

/** แถวผลค้นหาของ `GET /customers/search` — `chatPlaceholder` เป็นธงจาก API (เว็บห้าม derive เอง) */
interface CustomerSearchRow {
  id: string;
  name: string;
  phone?: string | null;
  chatPlaceholder?: boolean;
}

/**
 * ผูกลูกค้าที่มีอยู่กับห้องแชท — แยกออกมาจาก Customer360Panel เพื่อให้ RoomDossier เปิดได้จากหลายจุด
 * (กล่อง "ยังไม่ผูก" · ช่องทางแชท) โดยไม่ต้องวาดแผงเดิมซ้อน
 * ค้นหาด้วยชื่อ / เบอร์ / เลขบัตร (`GET /customers/search`) → `PATCH /staff-chat/rooms/:id/customer`
 */
export default function LinkCustomerDialog({
  open,
  onOpenChange,
  roomId,
  mergesProspect = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
  /** true = ห้องนี้ถือผู้สนใจอัตโนมัติอยู่แล้ว — ผูกกับคนที่เลือกคือ "รวม" ไม่ใช่ "ผูกครั้งแรก" (สเปค 3.6) */
  mergesProspect?: boolean;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 400);
  const searchQuery = useQuery({
    queryKey: ['customer-search', debounced],
    queryFn: () => api.get(`/customers/search?q=${encodeURIComponent(debounced)}`).then((r) => r.data?.data ?? r.data),
    enabled: open && debounced.trim().length >= 2,
  });
  const link = useLinkRoomCustomer(roomId, {
    onSuccess: () => {
      toast.success(mergesProspect ? 'ผูกกับลูกค้าเดิมและรวมข้อมูลแชทแล้ว' : 'ผูกลูกค้ากับแชทนี้แล้ว');
      onOpenChange(false);
      setSearch('');
    },
    onError: () => toast.error('ผูกลูกค้าไม่สำเร็จ'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSearch('');
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> {mergesProspect ? 'ผูกกับลูกค้าเดิม' : 'ผูกลูกค้าที่มีอยู่'}
          </DialogTitle>
          {mergesProspect ? (
            <DialogDescription className="text-xs leading-snug text-muted-foreground">แชทและผลเช็คเครดิตของผู้สนใจคนนี้จะย้ายไปรวมกับลูกค้าที่เลือก — แถวผู้สนใจอัตโนมัติจะถูกเก็บ</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">ค้นหาและผูกลูกค้าที่มีอยู่กับห้องแชทนี้</DialogDescription>
          )}
        </DialogHeader>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ / เบอร์ / เลขบัตร (อย่างน้อย 2 ตัวอักษร)"
          aria-label="ค้นหาลูกค้า"
          className="w-full rounded-md border-0 bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {searchQuery.isFetching && <p className="py-3 text-center text-xs leading-snug text-muted-foreground">กำลังค้นหา...</p>}
          {!searchQuery.isFetching && debounced.trim().length >= 2 && (searchQuery.data?.length ?? 0) === 0 && (
            <p className="py-3 text-center text-xs leading-snug text-muted-foreground">ไม่พบลูกค้า</p>
          )}
          {(searchQuery.data ?? []).map((c: CustomerSearchRow) => (
            <button
              key={c.id}
              type="button"
              disabled={link.isPending}
              onClick={() => link.mutate(c.id)}
              className="w-full rounded-lg border border-border p-2.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
            >
              <span className="font-medium text-foreground">{c.name}</span>
              {/* ห่อด้วย span — ส่ง className เข้า ProspectPhoneLine ตรง ๆ จะทับสีชิปผู้สนใจ (tailwind-merge) */}
              <span className="ml-2 text-xs text-muted-foreground">
                <ProspectPhoneLine phone={c.phone} chatPlaceholder={c.chatPlaceholder} />
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
