import { Pin, PinOff, StickyNote, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoomNote } from './timeline';

/**
 * ฟองโน้ตภายใน (ท่า OBI cn-bub-note): การ์ดเหลืองอ่อนกว้างเต็ม เห็นเฉพาะทีม ไม่มีสถานะส่ง/อ่าน
 * ปักหมุด = เป็น "โน้ตของห้อง" ขึ้นแถบใต้หัวห้อง · ลบได้เฉพาะคนเขียนหรือผู้จัดการ (canDelete มาจากผู้เรียก)
 */
export default function NoteBubble({
  note,
  isPinned,
  canDelete,
  onPin,
  onUnpin,
  onDelete,
}: {
  note: RoomNote;
  isPinned: boolean;
  canDelete: boolean;
  onPin?: (id: string) => void;
  onUnpin?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const time = new Date(note.createdAt).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="px-4 py-1" data-testid="note-bubble">
      <div className={cn('rounded-xl border bg-warning/10 px-3 py-2 text-sm dark:bg-amber-400/10', isPinned ? 'border-warning dark:border-amber-400/70' : 'border-warning/40 dark:border-amber-400/30')}>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StickyNote className="size-3 text-warning-strong" />
          <span className="font-semibold text-foreground/80">โน้ตภายใน</span>
          <span>· {note.staff?.name ?? 'พนักงาน'} · {time}</span>
          {isPinned && <span className="ml-1 rounded-full bg-warning/20 px-1.5 py-px text-[10px] font-semibold text-foreground/80">เป็นโน้ตของห้อง</span>}
          <span className="ml-auto flex items-center gap-0.5">
            {isPinned ? (
              <button type="button" onClick={() => onUnpin?.(note.id)} title="ปลดหมุด" aria-label="ปลดหมุดโน้ต" className="rounded p-1 hover:bg-warning/20"><PinOff className="size-3.5" /></button>
            ) : (
              <button type="button" onClick={() => onPin?.(note.id)} title="ปักเป็นโน้ตของห้อง" aria-label="ปักหมุดโน้ต" className="rounded p-1 hover:bg-warning/20"><Pin className="size-3.5" /></button>
            )}
            {canDelete && (
              <button type="button" onClick={() => onDelete?.(note.id)} title="ลบโน้ต" aria-label="ลบโน้ต" className="rounded p-1 hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            )}
          </span>
        </div>
        <p className="m-0 whitespace-pre-wrap break-words leading-relaxed text-foreground">{note.content}</p>
        <p className="m-0 mt-1 text-[10px] text-muted-foreground">เห็นเฉพาะทีมงาน ไม่ส่งถึงลูกค้า</p>
      </div>
    </div>
  );
}
