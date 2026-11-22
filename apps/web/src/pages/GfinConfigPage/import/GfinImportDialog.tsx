import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GFIN_SAME_PRICE_DETAIL, type GfinImportReview } from '../gfinPriceListImport';
import { HAND_LABEL } from '../terms/modelTerms';
import { MONTH_CHOICES } from '../terms/ruleChange';
import {
  closeIdsFor,
  isValidAllowance,
  missingLines,
  resolveTermsPlan,
  ruleChangeText,
  type ImportTermsReview,
  type MissingPrices,
  type RuleChange,
  type TermChoices,
  type TermField,
  type TermsPair,
} from './gfinImportTerms';

const fmt = (n: number) => n.toLocaleString('th-TH');

interface Props {
  fileName: string;
  prices: GfinImportReview;
  missing: MissingPrices;
  terms: ImportTermsReview;
  pending: boolean;
  progress: string | null;
  onCancel: () => void;
  onConfirm: (decision: { closeIds: string[]; changes: RuleChange[] }) => void;
}

function MissingGroup(props: {
  title: string;
  lines: string[];
  close: boolean;
  onChange: (close: boolean) => void;
  groupName: string;
}) {
  if (props.lines.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <p className="text-sm font-medium leading-snug">{props.title}</p>
      <ul className="text-sm text-muted-foreground leading-snug">
        {props.lines.map((l, i) => (
          <li key={`${i}|${l}`}>{l}</li>
        ))}
      </ul>
      <RadioGroup value={props.close ? 'close' : 'keep'} onValueChange={(v) => props.onChange(v === 'close')} className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="close" aria-label={`ปิดราคาพวกนี้ (${props.groupName})`} /> ปิดราคาพวกนี้ (GFIN ไม่รับแล้ว)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <RadioGroupItem value="keep" aria-label={`เปิดไว้เหมือนเดิม (${props.groupName})`} /> เปิดไว้เหมือนเดิม
        </label>
      </RadioGroup>
    </div>
  );
}

function ChooseField(props: {
  pair: TermsPair;
  field: 'allowance' | 'maxMonths';
  value: TermField;
  choice: number | undefined;
  onChoose: (v: number) => void;
}) {
  if (props.value.kind !== 'choose') return null;
  const label = props.field === 'allowance' ? 'OVER' : 'ผ่อนสูงสุด';
  const show = (v: number) => (props.field === 'allowance' ? `+${fmt(v)}` : `${v} งวด`);
  return (
    <div className="space-y-1">
      <p className="text-sm leading-snug">
        {props.pair.series} · {HAND_LABEL[props.pair.condition]} — {label} ไม่เท่ากันทุกความจุ
      </p>
      <RadioGroup
        value={String(props.choice ?? props.value.options[0].value)}
        onValueChange={(v) => props.onChoose(Number(v))}
      >
        {props.value.options.map((o, i) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={String(o.value)} /> ใช้ {show(o.value)}
            {i === 0 ? ' (ค่าที่ใช้มากสุด)' : ''} — {o.storages.join(' / ')}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

/** หน้าตรวจใบราคาก่อนนำเข้า (สเปก §6.3) */
export function GfinImportDialog(p: Props) {
  const [closePartial, setClosePartial] = useState(true);
  const [closeAbsent, setCloseAbsent] = useState(false);
  const [overText, setOverText] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<TermChoices>({});
  const plan = useMemo(() => resolveTermsPlan(p.terms, choices), [p.terms, choices]);
  const closeIds = closeIdsFor(p.missing, { closePartial, closeAbsent });
  const set = (key: string, field: 'allowance' | 'maxMonths', v: number | undefined) =>
    setChoices((c) => ({ ...c, [key]: { ...c[key], [field]: v } }));

  const count = (action: 'ADD' | 'UPDATE') => p.prices.rows.filter((r) => r.action === action).length;
  const same = p.prices.rows.filter((r) => r.action === 'SKIP' && r.detail === GFIN_SAME_PRICE_DETAIL).length;
  const skipped = p.prices.rows.filter((r) => r.action === 'SKIP' && r.detail !== GFIN_SAME_PRICE_DETAIL);
  const pairs = p.terms.pairs;
  const byStatus = (s: TermsPair['status']) => pairs.filter((x) => x.status === s);
  const pairOf = (c: RuleChange) => pairs.find((x) => x.series === c.series && x.condition === c.condition)!;
  const missingName = (k: string) => {
    const x = pairs.find((q) => q.key === k);
    return x ? `${x.series} ${HAND_LABEL[x.condition]}` : k;
  };
  const nothing = p.prices.toSend.length === 0 && closeIds.length === 0 && plan.changes.length === 0;
  const canConfirm = !p.pending && plan.missing.length === 0 && !nothing;

  return (
    <Dialog open onOpenChange={(o) => !o && !p.pending && p.onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ตรวจใบราคาก่อนนำเข้า</DialogTitle>
          <DialogDescription className="leading-snug">{p.fileName}</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="font-medium leading-snug">ราคา</h3>
          <p className="text-sm leading-snug">
            เพิ่มใหม่ {count('ADD')} · ราคาเปลี่ยน {count('UPDATE')} · เท่าเดิม {same} · มีในระบบ ไม่มีในไฟล์{' '}
            {p.missing.partial.length + p.missing.absent.length}
          </p>
          {skipped.length > 0 && (
            <ul className="text-sm text-warning-strong leading-snug">
              {skipped.map((r) => (
                <li key={r.rowNumber} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  แถว {r.rowNumber} {r.label}: {r.detail}
                </li>
              ))}
            </ul>
          )}
          <MissingGroup
            title="รุ่นที่มีในไฟล์ แต่ขาดบางความจุ/มือ"
            groupName="รุ่นที่มีในไฟล์"
            lines={missingLines(p.missing.partial)}
            close={closePartial}
            onChange={setClosePartial}
          />
          <MissingGroup
            title="รุ่นที่ไม่มีในไฟล์เลย"
            groupName="รุ่นที่ไม่มีในไฟล์"
            lines={missingLines(p.missing.absent)}
            close={closeAbsent}
            onChange={setCloseAbsent}
          />
          {(p.missing.partial.length > 0 || p.missing.absent.length > 0) && (
            <p className="text-xs text-muted-foreground leading-snug">ปิดแล้วไม่หาย กดเปิดคืนได้จากช่องราคา</p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium leading-snug">เงื่อนไขจากไฟล์ (OVER · ผ่อนสูงสุด)</h3>
          <p className="text-xs text-muted-foreground leading-snug">
            {p.terms.hasTermColumns
              ? 'ระบบเก็บได้ 1 ค่าต่อรุ่นต่อมือ · ดาวน์ไม่อยู่ในใบราคา ใช้ค่าเดิม (หรือค่ากลางถ้าเป็นรุ่นใหม่)'
              : 'ไฟล์ไม่มีคอลัมน์ OVER / ผ่อนสูงสุด — เงื่อนไขเดิมไม่เปลี่ยน กรอกเฉพาะรุ่นใหม่'}
          </p>
          <p className="text-sm leading-snug">
            ตรงกับระบบ {byStatus('MATCH').length} · จะเปลี่ยน {byStatus('CHANGE').length} · ต้องเลือก {byStatus('CHOOSE').length} ·
            รุ่นใหม่ {byStatus('NEW').length}
          </p>
          {p.terms.warnings.map((w, i) => (
            <p key={`${i}|${w}`} className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {w}
            </p>
          ))}
          {byStatus('CHOOSE').map((pair) => (
            <div key={pair.key} className="space-y-2 rounded-lg border border-border p-3">
              <ChooseField pair={pair} field="allowance" value={pair.allowance} choice={choices[pair.key]?.allowance} onChoose={(v) => set(pair.key, 'allowance', v)} />
              <ChooseField pair={pair} field="maxMonths" value={pair.maxMonths} choice={choices[pair.key]?.maxMonths} onChoose={(v) => set(pair.key, 'maxMonths', v)} />
              {pair.current && (
                <p className="text-xs text-muted-foreground leading-snug">
                  ระบบตอนนี้ +{fmt(pair.current.allowance)} · {pair.current.maxMonths ?? 'ไม่จำกัด'} งวด
                </p>
              )}
            </div>
          ))}
          {byStatus('NEW').map((pair) => {
            const name = `${pair.series} ${HAND_LABEL[pair.condition]}`;
            return (
              <div key={pair.key} className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-sm font-medium leading-snug">รุ่นใหม่ · {name}</p>
                {pair.allowance.kind === 'none' ? (
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 text-sm">
                      OVER
                      <NumberInput
                        aria-label={`OVER ของ ${name} (บาท)`}
                        className="w-32"
                        min="0"
                        step="0.01"
                        value={overText[pair.key] ?? ''}
                        onChange={(e) => {
                          const text = e.target.value;
                          setOverText((t) => ({ ...t, [pair.key]: text }));
                          const n = text.trim() === '' ? NaN : Number(text);
                          set(pair.key, 'allowance', isValidAllowance(n) ? n : undefined);
                        }}
                      />
                      บาท
                    </label>
                    {(overText[pair.key] ?? '').trim() !== '' && choices[pair.key]?.allowance === undefined && (
                      <p className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        OVER ต้องเป็นตัวเลข 0 ขึ้นไป ทศนิยมไม่เกิน 2 ตำแหน่ง
                      </p>
                    )}
                  </div>
                ) : pair.allowance.kind === 'value' ? (
                  <p className="text-sm leading-snug">OVER +{fmt(pair.allowance.value)} (จากไฟล์)</p>
                ) : (
                  <ChooseField pair={pair} field="allowance" value={pair.allowance} choice={choices[pair.key]?.allowance} onChoose={(v) => set(pair.key, 'allowance', v)} />
                )}
                {pair.maxMonths.kind === 'none' ? (
                  <RadioGroup
                    value={choices[pair.key]?.maxMonths === undefined ? '' : String(choices[pair.key]?.maxMonths)}
                    onValueChange={(v) => set(pair.key, 'maxMonths', Number(v))}
                    className="flex flex-wrap gap-4"
                  >
                    <span className="text-sm">ผ่อนสูงสุด</span>
                    {MONTH_CHOICES.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-sm">
                        <RadioGroupItem value={String(m)} aria-label={`${name} ผ่อนสูงสุด ${m} งวด`} /> {m} งวด
                      </label>
                    ))}
                  </RadioGroup>
                ) : pair.maxMonths.kind === 'value' ? (
                  <p className="text-sm leading-snug">ผ่อนสูงสุด {pair.maxMonths.value} งวด (จากไฟล์)</p>
                ) : (
                  <ChooseField pair={pair} field="maxMonths" value={pair.maxMonths} choice={choices[pair.key]?.maxMonths} onChoose={(v) => set(pair.key, 'maxMonths', v)} />
                )}
              </div>
            );
          })}
          {plan.changes.length > 0 && (
            <ul className="list-disc pl-5 text-sm leading-snug">
              {plan.changes.map((c) => (
                <li key={`${c.series}|${c.condition}`}>{ruleChangeText(c, pairOf(c))}</li>
              ))}
            </ul>
          )}
          {plan.missing.length > 0 && (
            <p className="flex items-start gap-1.5 text-sm text-warning-strong leading-snug">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                ต้องกรอก OVER และผ่อนสูงสุดในหน้านี้ก่อนกดยืนยัน — ระบบไม่เดาให้
                <span className="block">ยังไม่กรอก: {plan.missing.map((k) => missingName(k)).join(' · ')}</span>
              </span>
            </p>
          )}
        </section>

        <div className="rounded-lg bg-muted p-3 text-sm leading-snug">
          ราคา: เพิ่ม {count('ADD')} · แก้ {count('UPDATE')} · ปิด {closeIds.length} · เงื่อนไข: บันทึก {plan.changes.length} รุ่น
          {p.progress && <p className="mt-1 font-medium">{p.progress}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            ส่งทีละ 100 แถว · ถ้าพลาดกลางทาง จะบอกว่าบันทึกไปแล้วกี่ชุด · นำเข้าไฟล์เดิมซ้ำได้
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={p.onCancel} disabled={p.pending}>
            ยกเลิก
          </Button>
          <Button variant="primary" disabled={!canConfirm} onClick={() => p.onConfirm({ closeIds, changes: plan.changes })}>
            ยืนยันนำเข้า
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
