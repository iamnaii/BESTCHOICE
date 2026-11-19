import { useState } from 'react';
import { PencilLine, Plus, SkipForward, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type ImportReviewAction = 'ADD' | 'UPDATE' | 'SKIP';

export interface ImportReviewRow {
  /** เลขแถวใน Excel (แถว 1 = หัวคอลัมน์) */
  rowNumber: number;
  label: string;
  action: ImportReviewAction;
  /** แก้: ค่าเดิม → ค่าใหม่ · ข้าม: เหตุผล */
  detail?: string;
}

const ACTION = {
  ADD: { word: 'เพิ่ม', Icon: Plus, className: 'text-success' },
  UPDATE: { word: 'แก้', Icon: PencilLine, className: 'text-primary' },
  SKIP: { word: 'ข้าม', Icon: SkipForward, className: 'text-muted-foreground' },
} as const;

interface Props {
  title: string;
  rows: ImportReviewRow[];
  warning?: string | null;
  /** จำนวนแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ — 0 / ไม่ส่ง = ไม่มีตัวเลือกปิดแถว */
  deactivateCount?: number;
  /** รายชื่อแถวที่จะถูกปิด — แสดงใต้ตัวเลือกเพื่อให้ตรวจก่อนติ๊ก */
  deactivateRows?: { label: string }[];
  pending: boolean;
  progress?: string | null;
  onCancel: () => void;
  onConfirm: (options: { deactivateMissing: boolean }) => void;
}

/** หน้าตรวจไฟล์นำเข้าก่อนยืนยัน (สเปคข้อ 7.4 / 7.7) — ใช้ทั้งราคากลางและใบราคา GFIN */
export function ImportReviewDialog({
  title,
  rows,
  warning,
  deactivateCount = 0,
  deactivateRows,
  pending,
  progress,
  onCancel,
  onConfirm,
}: Props) {
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const count = (action: ImportReviewAction) => rows.filter((r) => r.action === action).length;
  const writes = count('ADD') + count('UPDATE');
  const deactivate = deactivateMissing && deactivateCount > 0;
  const canConfirm = !pending && (writes > 0 || deactivate);

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-snug">
            ตรวจรายการก่อนยืนยัน — เพิ่ม {count('ADD')} · แก้ {count('UPDATE')} · ข้าม {count('SKIP')} แถว
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {warning && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </p>
          )}
          <ul
            aria-label="รายการในไฟล์"
            className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border"
          >
            {rows.map((r) => {
              const a = ACTION[r.action];
              return (
                <li key={`${r.rowNumber}-${r.label}`} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className={`inline-flex w-14 shrink-0 items-center gap-1 font-medium ${a.className}`}>
                    <a.Icon className="size-4" aria-hidden="true" />
                    {a.word}
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="text-muted-foreground">แถว {r.rowNumber} · </span>
                    {r.label}
                    {r.detail && (
                      <span className="block text-xs text-muted-foreground leading-snug">{r.detail}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {deactivateCount > 0 && (
            <label className="flex items-center gap-2 text-sm leading-snug">
              <Checkbox
                checked={deactivateMissing}
                disabled={pending}
                onCheckedChange={(value) => setDeactivateMissing(value === true)}
              />
              ปิดแถวที่เปิดใช้อยู่แต่ไม่อยู่ในไฟล์ ({deactivateCount} แถว)
            </label>
          )}
          {deactivateCount > 0 && deactivateRows && deactivateRows.length > 0 && (
            <ul
              aria-label="แถวที่จะถูกปิด"
              tabIndex={0}
              className="max-h-[30vh] divide-y divide-border overflow-y-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {deactivateRows.map((r, i) => (
                <li key={`${i}-${r.label}`} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <span className="inline-flex w-14 shrink-0 items-center gap-1 font-medium text-destructive">
                    <Trash2 className="size-4" aria-hidden="true" />
                    ปิด
                  </span>
                  <span className="min-w-0 flex-1 leading-snug">{r.label}</span>
                </li>
              ))}
            </ul>
          )}
          {progress && (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground leading-snug">
              {progress}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={() => onConfirm({ deactivateMissing: deactivate })}
          >
            {pending ? 'กำลังนำเข้า...' : 'ยืนยันนำเข้า'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
