import { CircleCheck, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { TrashBulkResultItem, TrashRow } from '@/hooks/useTrash';
import { trashRowKey } from '@/hooks/useTrash';

interface Props {
  results: TrashBulkResultItem[] | null;
  rowsByKey: Map<string, TrashRow>;
  onClose: () => void;
}

/** สรุปผลกู้หลายรายการ — รายตัว พร้อมเหตุผลที่กู้ไม่ได้ */
export default function BulkResultDialog({ results, rowsByKey, onClose }: Props) {
  const ok = results?.filter((r) => r.ok).length ?? 0;
  const failed = (results?.length ?? 0) - ok;
  return (
    <Dialog open={!!results} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{`กู้คืน ${results?.length ?? 0} รายการ — สำเร็จ ${ok} · ไม่สำเร็จ ${failed}`}</DialogTitle>
          <DialogDescription>รายการที่ไม่สำเร็จไม่ถูกเปลี่ยนแปลง — แก้ตามเหตุผลแล้วกู้ใหม่ได้</DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {(results ?? []).map((r) => {
            const row = rowsByKey.get(trashRowKey(r));
            return (
              <li key={trashRowKey(r)} className="flex items-start gap-2 px-3 py-2">
                {r.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-label="สำเร็จ" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="ไม่สำเร็จ" />}
                <div className="min-w-0">
                  <div className="leading-snug">{row ? `${row.typeLabel} · ${row.title}` : `${r.type} · ${r.id}`}</div>
                  {!r.ok && r.error && <div className="text-xs text-muted-foreground leading-snug">{r.error}</div>}
                  {r.ok && r.warnings && r.warnings.length > 0 && <div className="text-xs text-muted-foreground leading-snug">{r.warnings.join(' · ')}</div>}
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
