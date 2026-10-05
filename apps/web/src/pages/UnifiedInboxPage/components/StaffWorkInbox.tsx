import { Button } from '@/components/ui/button';
import type { WorkNotification } from '../hooks/useChatWork';
import { workDate } from './WorkQueue';
export default function StaffWorkInbox({ items, total, loading, error, onOpen, onRetry }: {
  items?: WorkNotification[]; total?: number; loading?: boolean; error?: boolean; onOpen: (item: WorkNotification) => void; onRetry: () => void;
}) {
  return <section className="min-h-0 flex-1 overflow-y-auto p-4" aria-label="แจ้งเตือนของฉัน" aria-busy={loading}>
    <p className="mb-4 text-xs leading-snug text-muted-foreground">เปิดอ่านการแจ้งเตือนแล้ว งานยังคงอยู่จนกว่าจะดำเนินการเสร็จ</p>
    {error ? <div role="alert">โหลดการแจ้งเตือนไม่ได้<Button variant="outline" className="ml-2" onClick={onRetry}>ลองใหม่</Button></div>
      : loading ? <p role="status">กำลังโหลด…</p> : !items?.length ? <p className="py-8 text-center text-muted-foreground">ยังไม่มีการแจ้งเตือน</p>
      : <ul className="divide-y">{items.map(item => <li key={item.id}><button type="button" className="w-full rounded-md py-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpen(item)}>
        <span className={`block break-words leading-snug ${!item.readAt ? 'font-semibold' : ''}`}>{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{workDate(item.createdAt)} · {item.readAt ? 'เปิดอ่านแล้ว' : 'ยังไม่อ่าน'}</span>
      </button></li>)}</ul>}
    {!!total && total > (items?.length ?? 0) && <p className="mt-4 text-xs text-muted-foreground">แสดง {items?.length} รายการล่าสุด จาก {total} รายการ</p>}
  </section>;
}
