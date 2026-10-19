import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/hooks/useDebounce';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { formatThaiDateTime } from '@/lib/date';
import api from '@/lib/api';
import SearchExcerpt from './SearchExcerpt';

interface Hit { id: string; text: string; role: string; createdAt: string }
export default function RoomMessageSearch({ roomId, open, onClose, onSelect }: {
  roomId: string;
  open: boolean;
  onClose: () => void;
  onSelect: (messageId: string) => void;
}) {
  const work = useChatWorkSettings();
  const [input, setInput] = useState('');
  const [page, setPage] = useState(1);
  const query = useDebounce(input.trim(), 300);
  const ready = open && query.length >= 2 && query === input.trim();
  const result = useQuery({
    queryKey: ['room-message-search', ...work.key, roomId, query, page],
    queryFn: ({ signal }) => api.get<{ data: Hit[]; total: number; limit: number }>(`/staff-chat/rooms/${roomId}/messages/search`, { params: { ...work.scope, q: query, page }, signal }).then(r => r.data),
    enabled: ready,
    retry: false,
  });
  return <Dialog open={open} onOpenChange={open => !open && onClose()}>
    <DialogContent className="flex max-h-[85dvh] flex-col gap-4 sm:max-w-xl">
      <DialogTitle>ค้นหาในแชท</DialogTitle>
      <DialogDescription>ค้นหาข้อความทั้งหมดในห้องนี้ แล้วเปิดดูบทสนทนาที่เกี่ยวข้อง</DialogDescription>
      <label className="space-y-2 text-sm font-medium">
        <span>ข้อความที่ต้องการค้นหา</span>
        <Input autoFocus value={input} maxLength={200} placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร" onChange={event => { setInput(event.target.value); setPage(1); }} />
      </label>
      <div className="min-h-0 overflow-y-auto" aria-live="polite">
        {!ready ? <p className="py-6 text-center text-sm text-muted-foreground">{input.trim().length < 2 ? 'พิมพ์คำค้นเพื่อเริ่มค้นหา' : 'กำลังค้นหา…'}</p>
          : result.isPending ? <p role="status" className="py-6 text-center text-sm">กำลังค้นหา…</p>
          : result.isError ? <div role="alert" className="py-6 text-center text-sm"><p>ค้นหาไม่สำเร็จ กรุณาลองใหม่</p><Button variant="outline" className="mt-3" onClick={() => void result.refetch()}>ลองใหม่</Button></div>
          : <><p className="mb-2 text-xs text-muted-foreground">พบ {result.data?.total ?? 0} ข้อความ</p>
            <ul className="divide-y divide-border">{result.data?.data.map(hit => <li key={hit.id}>
              <button type="button" className="flex min-h-11 w-full gap-3 rounded-md p-3 text-left hover:bg-muted" onClick={() => { onSelect(hit.id); onClose(); }}>
                <Search className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0"><span className="block break-words text-sm leading-relaxed"><SearchExcerpt text={hit.text} search={query} /></span><span className="mt-1 block text-xs text-muted-foreground">{hit.role === 'CUSTOMER' ? 'ลูกค้า' : hit.role === 'BOT' ? 'บอท' : 'พนักงาน'} · {formatThaiDateTime(hit.createdAt, 'Asia/Bangkok')}</span></span>
              </button>
            </li>)}</ul>
            {!result.data?.total && <p className="py-6 text-center text-sm text-muted-foreground">ไม่พบข้อความ ลองใช้คำอื่น</p>}
          </>}
      </div>
      {ready && result.data && result.data.total > result.data.limit && <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-3">
        <Button variant="outline" disabled={page === 1 || result.isFetching} onClick={() => setPage(p => p - 1)}>ก่อนหน้า</Button>
        <span className="text-sm">หน้า {page}</span>
        <Button variant="outline" disabled={page * result.data.limit >= result.data.total || result.isFetching} onClick={() => setPage(p => p + 1)}>ถัดไป</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
