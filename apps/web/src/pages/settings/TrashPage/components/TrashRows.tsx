import { Link } from 'react-router';
import { CircleCheck, Info, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatThaiDateTime } from '@/lib/date';
import type { TrashRow } from '@/hooks/useTrash';
import { trashRowKey } from '@/hooks/useTrash';
import { deletedByLabel, relativeThai } from '../trash.util';

interface Props {
  rows: TrashRow[];
  selected: Set<string>;
  onToggle: (row: TrashRow, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onRestore: (row: TrashRow) => void;
}

const LINK_BUTTON = 'inline-flex min-h-11 lg:min-h-8 items-center whitespace-nowrap rounded-lg border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted';

/** ตารางของที่ถูกลบ — เลือกได้เฉพาะแถวที่กู้ได้ · สถานะมีไอคอน+คำ ไม่ใช้สีอย่างเดียว · ตารางอยู่ใน overflow-x-auto */
export default function TrashRows({ rows, selected, onToggle, onToggleAll, onRestore }: Props) {
  const restorable = rows.filter((r) => r.restorable);
  const allChecked = restorable.length > 0 && restorable.every((r) => selected.has(trashRowKey(r)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-10 px-3 py-2">
              <label className="inline-flex cursor-pointer items-center justify-center max-lg:min-h-11 max-lg:min-w-11">
                <input type="checkbox" className="size-4 accent-primary" checked={allChecked} disabled={restorable.length === 0} onChange={(e) => onToggleAll(e.target.checked)} aria-label="เลือกทั้งหน้า (เฉพาะที่กู้ได้)" />
              </label>
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">ประเภท</th>
            <th scope="col" className="min-w-[280px] px-3 py-2 text-left font-medium">รายการ</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">ลบเมื่อ</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">ลบโดย</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">สถานะการกู้</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">การกระทำ</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = trashRowKey(row);
            return (
              <tr key={key} className={`border-t border-border/60 ${row.restorable ? '' : 'bg-muted/20'}`}>
                <td className="px-3 py-2 align-top">
                  {row.restorable && (
                    <label className="inline-flex cursor-pointer items-center justify-center max-lg:min-h-11 max-lg:min-w-11">
                      <input type="checkbox" className="size-4 accent-primary" checked={selected.has(key)} onChange={(e) => onToggle(row, e.target.checked)} aria-label={`เลือก ${row.title}`} />
                    </label>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium">{row.typeLabel}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="font-semibold leading-snug">{row.title}</div>
                  {row.subtitle && <div className="text-xs text-muted-foreground leading-snug">{row.subtitle}</div>}
                </td>
                <td className="px-3 py-2 align-top whitespace-nowrap">
                  <div>{formatThaiDateTime(row.deletedAt)}</div>
                  <div className="text-xs text-muted-foreground">{relativeThai(row.deletedAt)}</div>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className={row.deletedBy && !row.deletedBy.system ? '' : 'text-muted-foreground'}>{deletedByLabel(row)}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  {row.restorable ? (
                    <span className="inline-flex items-center gap-1.5 text-primary"><CircleCheck className="size-4" aria-hidden="true" />กู้ได้</span>
                  ) : row.actionLabel ? (
                    <span className="inline-flex items-start gap-1.5 text-foreground"><Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{row.reason}</span>
                  ) : (
                    <span className="inline-flex items-start gap-1.5 text-muted-foreground"><XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{row.reason ?? 'กู้ไม่ได้'}</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {row.restorable ? (
                    <Button variant="outline" size="sm" className="max-lg:min-h-11" onClick={() => onRestore(row)}>กู้คืน</Button>
                  ) : row.actionLabel && row.link ? (
                    <Link to={row.link} className={LINK_BUTTON}>{row.actionLabel}</Link>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
