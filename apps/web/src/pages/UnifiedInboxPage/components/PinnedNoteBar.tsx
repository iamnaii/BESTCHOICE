import { useState } from 'react';
import { StickyNote, X } from 'lucide-react';
import { formatChatTimestamp } from '@/lib/chat-time';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RoomNote } from './timeline';

/** แถบโน้ตของห้องใต้หัวห้อง (ท่า OBI cn-tnote) — ✕ = ปลดหมุด ไม่ลบโน้ต (ยืนยันก่อน เพราะหายสำหรับทุกคน) */
export default function PinnedNoteBar({ note, onUnpin }: { note: RoomNote; onUnpin: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div
      className="flex items-center gap-2 border-b border-l-[3px] border-b-warning/40 border-l-warning bg-warning/10 dark:border-b-amber-400/30 dark:border-l-amber-400 dark:bg-amber-400/10 py-1.5 pl-3 pr-1.5 text-[13px]"
      role="note"
      aria-label="โน้ตของห้อง"
    >
      <StickyNote className="size-3.5 shrink-0 text-warning dark:text-amber-300" />
      <span className="shrink-0 text-[10.5px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">โน้ตของห้อง</span>
      <span className="min-w-0 flex-1 truncate" title={note.content}>{note.content}</span>
      <span className="shrink-0 text-[11.5px] text-muted-foreground">
        {note.staff?.name ?? 'พนักงาน'} · {formatChatTimestamp(note.pinnedAt ?? note.createdAt)}
      </span>
      <button type="button" onClick={() => setConfirm(true)} aria-label="ปลดโน้ตของห้อง" title="ปลดโน้ตของห้อง" className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-warning/20 hover:text-foreground">
        <X className="size-3.5" />
      </button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ปลดโน้ตของห้อง</AlertDialogTitle>
            <AlertDialogDescription>โน้ตนี้จะหายจากหัวห้องสำหรับทุกคน (ตัวโน้ตยังอยู่ในกระทู้ ปักใหม่ได้)</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); onUnpin(note.id); }}>ปลดหมุด</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
