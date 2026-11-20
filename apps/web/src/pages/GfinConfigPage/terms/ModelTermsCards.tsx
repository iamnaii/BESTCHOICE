import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PriceCellPopover } from './PriceCellPopover';
import { HAND_LABEL, allowanceText, downText, monthsText, type ModelTermsRow } from './modelTerms';
import type { TermsListProps } from './ModelTermsTable';

function bySeries(rows: ModelTermsRow[]): ModelTermsRow[][] {
  const out: ModelTermsRow[][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last[0].series === r.series) last.push(r);
    else out.push([r]);
  }
  return out;
}

/** มือถือ (< 768px): การ์ดทีละรุ่น · บล็อกมือ 1/มือ 2 (สเปก §6.2 ข้อ 6) */
export function ModelTermsCards(p: TermsListProps) {
  return (
    <div className="space-y-4">
      {p.families.map((fam) => (
        <section key={fam.family} aria-label={fam.label} className="space-y-2">
          <h3 className="font-semibold leading-snug">{fam.label}</h3>
          {bySeries(fam.rows).map((rows) => (
            <article
              key={rows[0].series}
              aria-label={rows[0].series}
              className="space-y-2 rounded-lg border border-border bg-card p-3"
            >
              <h4 className="font-medium leading-snug">{rows[0].series}</h4>
              {rows.map((row) => (
                <div key={row.key} className="space-y-1.5 border-t border-border pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      {p.canEdit && (
                        <Checkbox
                          aria-label={`เลือก ${row.series} ${HAND_LABEL[row.condition]}`}
                          checked={p.selected.has(row.key)}
                          onCheckedChange={() => p.onToggleRow(row.key)}
                        />
                      )}
                      {HAND_LABEL[row.condition]}
                    </label>
                    {p.canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`แก้ ${row.series} ${HAND_LABEL[row.condition]}`}
                        onClick={() => p.onEdit([row.key])}
                      >
                        แก้
                      </Button>
                    )}
                  </div>
                  <ul className="flex flex-wrap gap-1.5 text-sm">
                    {row.cells
                      .filter((c) => c.mappingId !== null)
                      .map((c) => (
                        <li key={c.storage} className="rounded border border-border px-2 py-0.5">
                          <span className="text-muted-foreground">{c.storage} </span>
                          <PriceCellPopover row={row} cell={c} canEdit={p.canEdit} />
                        </li>
                      ))}
                  </ul>
                  {row.rule === null ? (
                    <p
                      className={`flex items-center gap-1.5 text-sm leading-snug ${row.needsRule ? 'text-warning-strong' : 'text-muted-foreground'}`}
                    >
                      {row.needsRule && <TriangleAlert className="size-4" aria-hidden="true" />}
                      {row.needsRule
                        ? 'ยังไม่ตั้งเงื่อนไข · ยังคิดผ่อนไม่ได้'
                        : 'ยังไม่ตั้งเงื่อนไข'}
                    </p>
                  ) : (
                    <p className="text-sm leading-snug">
                      <span>{`OVER ${allowanceText(row)} · ผ่อน ${monthsText(row)} · ดาวน์`}</span>{' '}
                      <span
                        className={
                          row.downSource === 'MODEL' ? 'font-semibold' : 'text-muted-foreground'
                        }
                      >
                        {downText(row)}
                      </span>
                      <span className="sr-only">
                        {row.downSource === 'MODEL' ? '(ตั้งเฉพาะรุ่น)' : '(ค่ากลาง)'}
                      </span>
                    </p>
                  )}
                </div>
              ))}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
