import type { GfinTables, ResolvedGfin } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { HAND_LABEL, buildModelTermsView, rowKeyOf, type Hand } from '../terms/modelTerms';

const fmt = (n: number) => n.toLocaleString('th-TH');

export interface CalcSeriesOption {
  series: string;
  hands: Partial<Record<Hand, string[]>>;
}

/** รุ่นที่เลือกได้ = รุ่นที่มีราคาเปิดอยู่อย่างน้อย 1 ช่อง · ความจุตามช่องที่มีราคาเปิด */
export function calcSeriesOptions(tables: GfinTables): CalcSeriesOption[] {
  const out = new Map<string, CalcSeriesOption>();
  for (const row of buildModelTermsView(tables).rows) {
    const storages = row.cells.filter((c) => c.price !== null).map((c) => c.storage);
    if (storages.length === 0) continue;
    const opt = out.get(row.series) ?? { series: row.series, hands: {} };
    opt.hands[row.condition] = storages;
    out.set(row.series, opt);
  }
  return [...out.values()].sort((a, b) => a.series.localeCompare(b.series, 'en', { numeric: true }));
}

export interface CalcInput {
  series: string;
  storage: string;
  condition: Hand;
  deviceOrigin: 'THAI' | 'IMPORTED';
}

export interface CalcLine {
  label: string;
  amount: number;
  source?: string;
  /** แถวในแท็บเงื่อนไขที่บรรทัดนี้มาจาก — ใช้ทำลิงก์ "แก้รุ่นนี้" */
  editKey?: string;
}

/** บรรทัดคำนวณพร้อมที่มา (สเปก §6.4) — null เมื่อคิดไม่ได้ */
export function buildCalcLines(input: CalcInput, resolved: ResolvedGfin, defaultDownPct: number): CalcLine[] {
  const q = resolved.quote;
  if (!q.available) return [];
  const r = q.result;
  const hand = HAND_LABEL[input.condition];
  const key = rowKeyOf(input.series, input.condition);
  const modelDown = q.rule?.minDownPct ?? null;
  const lines: CalcLine[] = [
    {
      label: 'ราคาสูงสุดในใบราคา',
      amount: Number(q.mapping.maxPrice),
      source: `ใบราคา · ${input.series} · ${input.storage} · ${hand}`,
    },
    {
      label: '+ OVER',
      amount: r.allowanceApplied.toNumber(),
      source: `ข้อ 7 · ${input.series} · ${hand} · ${
        input.deviceOrigin === 'THAI' ? 'เครื่องไทยได้ OVER เต็ม (เครื่องนอกได้ครึ่ง)' : 'เครื่องนอกได้ OVER ครึ่งเดียว'
      }`,
      editKey: key,
    },
    { label: '= ราคาส่ง GFIN', amount: r.gfinSubmitPrice.toNumber() },
    {
      label: `ดาวน์ขั้นต่ำ ${resolved.downPct}% ของราคาส่ง`,
      amount: r.downAmountByFormula.toNumber(),
      source:
        modelDown !== null
          ? `ข้อ 2 · ${modelDown}% ตั้งเฉพาะรุ่น ${input.series} · ${hand} · ค่ากลางคือ ${defaultDownPct}%`
          : `ข้อ 2 · ค่ากลาง ${resolved.downPct}%`,
      editKey: key,
    },
  ];
  if (r.downDiscount.gt(0))
    lines.push({
      label: `− ส่วนต่างที่ร้านช่วยออก (${fmt(r.gfinSubmitPrice.toNumber())} − ${fmt(r.gfinSubmitPrice.sub(r.downDiscount).toNumber())})`,
      amount: r.downDiscount.toNumber(),
    });
  lines.push(
    { label: '= ดาวน์ลูกค้า (ปัดขึ้นเป็นหลักร้อย)', amount: r.downAmountActual.toNumber() },
    { label: 'ยอดจัด (ราคาส่ง − ดาวน์ขั้นต่ำ)', amount: r.financedAmount.toNumber() },
  );
  return lines;
}

export function unavailableText(resolved: ResolvedGfin): string | null {
  const q = resolved.quote;
  if (q.available) return null;
  switch (q.reason) {
    case 'no_mapping':
      return 'ไม่มีราคาของรุ่น ความจุ และมือนี้ในใบราคา';
    case 'no_rule':
      return 'ยังไม่ตั้งเงื่อนไข GFIN ของรุ่นนี้ — ตั้งในแท็บ เงื่อนไข & ราคา';
    case 'no_factor':
      return `ไม่มีตารางค่างวดของคอม ${resolved.commissionPct}% — แก้ตารางค่างวดในแท็บ เงื่อนไข & ราคา`;
    default:
      return 'หมวดสินค้านี้ GFIN ไม่รับ';
  }
}
