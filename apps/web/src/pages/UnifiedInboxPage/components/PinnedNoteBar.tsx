import { useState } from 'react';
import { Pin, X } from 'lucide-react';
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
    <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs" role="note" aria-label="โน้ตของห้อง">
      <Pin className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 leading-relaxed">
        <span className="font-semibold">โน้ต:</span> {note.content}
        <span className="text-muted-foreground"> · {note.staff?.name ?? 'พนักงาน'}</span>
      </div>
      <button type="button" onClick={() => setConfirm(true)} aria-label="ปลดโน้ตของห้อง" title="ปลดโน้ตของห้อง" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-warning/20 hover:text-foreground">
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
