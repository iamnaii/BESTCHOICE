import { ChevronDown, ChevronRight, Pencil, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PriceCellPopover } from './PriceCellPopover';
import {
  HANDS,
  HAND_LABEL,
  allowanceText,
  downText,
  monthsText,
  type Hand,
  type ModelTermsFamily,
  type ModelTermsRow,
} from './modelTerms';

export interface TermsListProps {
  families: ModelTermsFamily[];
  storageColumns: string[];
  selected: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  canEdit: boolean;
  onToggleRow: (key: string) => void;
  onSelectFamilyHand: (family: ModelTermsFamily, hand: Hand) => void;
  onToggleFamily: (family: string) => void;
  onEdit: (keys: string[]) => void;
}

const Tag = ({ children }: { children: string }) => (
  <span className="ml-1 rounded bg-muted px-1 text-[0.7rem] font-normal text-muted-foreground">{children}</span>
);

export function TermsCells({ row, canEdit, onEdit }: { row: ModelTermsRow; canEdit: boolean; onEdit: (keys: string[]) => void }) {
  if (row.rule === null) {
    return row.needsRule ? (
      <td colSpan={3} className="bg-warning/10 px-3 py-2 text-sm text-warning-strong">
        <span className="inline-flex items-center gap-1.5 leading-snug">
          <TriangleAlert className="size-4" aria-hidden="true" />
          ยังไม่ตั้งเงื่อนไข · ยังคิดผ่อนไม่ได้
        </span>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            aria-label={`ตั้งเงื่อนไข ${row.series} ${HAND_LABEL[row.condition]}`}
            onClick={() => onEdit([row.key])}
          >
            ตั้งเงื่อนไข
          </Button>
        )}
      </td>
    ) : (
      <td colSpan={3} className="px-3 py-2 text-sm text-muted-foreground leading-snug">
        ยังไม่ตั้งเงื่อนไข
      </td>
    );
  }
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{allowanceText(row)}</td>
      <td className="px-3 py-2 text-right">{monthsText(row)}</td>
      <td className="px-3 py-2 text-right">
        <span className={row.downSource === 'MODEL' ? 'font-semibold' : 'text-muted-foreground'}>{downText(row)}</span>
      </td>
    </>
  );
}

export function ModelTermsTable(p: TermsListProps) {
  const colCount = 3 + p.storageColumns.length + 3 + 1;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            <th rowSpan={2} className="px-3 py-2 font-medium">
              <span className="sr-only">เลือก</span>
            </th>
            <th rowSpan={2} className="px-3 py-2 font-medium">รุ่น</th>
            <th rowSpan={2} className="px-3 py-2 font-medium">สภาพ</th>
            <th colSpan={p.storageColumns.length} className="px-3 py-1 text-center font-medium">
              ราคาสูงสุดที่ GFIN รับ (บาท)
            </th>
            <th colSpan={3} className="px-3 py-1 text-center font-medium">เงื่อนไข</th>
            <th rowSpan={2} className="px-3 py-2 font-medium">
              <span className="sr-only">แก้ไข</span>
            </th>
          </tr>
          <tr>
            {p.storageColumns.map((s) => (
              <th key={s} className="px-3 py-1 text-right font-medium">{s}</th>
            ))}
            <th className="px-3 py-1 text-right font-medium">OVER<Tag>ข้อ 7</Tag></th>
            <th className="px-3 py-1 text-right font-medium">ผ่อนสูงสุด<Tag>ข้อ 4</Tag></th>
            <th className="px-3 py-1 text-right font-medium">ดาวน์<Tag>ข้อ 2</Tag></th>
          </tr>
        </thead>
        {p.families.map((fam) => {
          const isCollapsed = p.collapsed.has(fam.family);
          const hands = HANDS.filter((h) => fam.rows.some((r) => r.condition === h));
          return (
            <tbody key={fam.family} className="border-t border-border">
              <tr className="bg-card">
                <td colSpan={colCount} className="px-3 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-semibold hover:underline"
                      aria-label={`${isCollapsed ? 'เปิด' : 'พับ'} ${fam.label}`}
                      aria-expanded={!isCollapsed}
                      onClick={() => p.onToggleFamily(fam.family)}
                    >
                      {isCollapsed ? <ChevronRight className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                      {fam.label}
                    </button>
                    {p.canEdit &&
                      hands.map((h) => (
                        <Button
                          key={h}
                          variant="ghost"
                          size="sm"
                          aria-label={`เลือก${HAND_LABEL[h]} ทั้งตระกูล ${fam.label}`}
                          onClick={() => p.onSelectFamilyHand(fam, h)}
                        >
                          {`เลือก${HAND_LABEL[h]} ทั้งตระกูล`}
                        </Button>
                      ))}
                  </div>
                </td>
              </tr>
              {!isCollapsed &&
                fam.rows.map((row) => (
                  <tr key={row.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      {p.canEdit && (
                        <Checkbox
                          aria-label={`เลือก ${row.series} ${HAND_LABEL[row.condition]}`}
                          checked={p.selected.has(row.key)}
                          onCheckedChange={() => p.onToggleRow(row.key)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium leading-snug">{row.series}</td>
                    <td className="px-3 py-2">{HAND_LABEL[row.condition]}</td>
                    {row.cells.map((cell) => (
                      <td key={cell.storage} className="px-3 py-2 text-right">
                        <PriceCellPopover row={row} cell={cell} canEdit={p.canEdit} />
                      </td>
                    ))}
                    <TermsCells row={row} canEdit={p.canEdit} onEdit={p.onEdit} />
                    <td className="px-3 py-2">
                      {p.canEdit && row.rule !== null && (
                        <Button
                          variant="ghost"
                          size="sm"
                          mode="icon"
                          aria-label={`แก้ไข ${row.series} ${HAND_LABEL[row.condition]}`}
                          onClick={() => p.onEdit([row.key])}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
