import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import type { StickerView } from './stickerView';

/** ขนาดม้วนสติกเกอร์ที่รองรับ — ค่าจาก SystemConfig `sticker_size` ผ่าน ui-flags (ก้อน 3 A5) */
export type StickerSize = '60x40' | '50x40' | '50x30';

export const STICKER_SIZES: Record<StickerSize, { w: number; h: number; label: string; hint: string }> = {
  '60x40': {
    w: 60,
    h: 40,
    label: '60 × 40 มม.',
    hint: 'แนะนำ — ต้องเป็น Xprinter 3 นิ้วขึ้นไป (XP-365B / 420B / 470B) ถึงพิมพ์กว้าง 60 มม. ได้',
  },
  '50x40': {
    w: 50,
    h: 40,
    label: '50 × 40 มม.',
    hint: 'สำหรับ Xprinter 2 นิ้ว (XP-233B / 237B) ที่หัวพิมพ์กว้างแค่ 48–56 มม.',
  },
  '50x30': {
    w: 50,
    h: 30,
    label: '50 × 30 มม.',
    hint: 'ม้วนเดิม — ตัวหนังสือและ QR เล็กลง ใช้จนกว่าม้วนจะหมด',
  },
};

export const DEFAULT_STICKER_SIZE: StickerSize = '60x40';

/**
 * จำนวนตัวอักษรของบรรทัดสเปกที่พอดีความกว้างดวง — `normal` ที่ขนาดปกติ · `long` เมื่อย่อลงขั้นหนึ่ง
 * (วัดจาก PDF ตัวอย่าง 60×40: 43 ตัวอักษรพอดีที่ 8pt · ม้วน 50 มม. แคบกว่า ~20%)
 */
const SPEC_BUDGET: Record<StickerSize, { normal: number; long: number }> = {
  '60x40': { normal: 44, long: 48 },
  '50x40': { normal: 36, long: 40 },
  '50x30': { normal: 34, long: 38 },
};

interface FittedSpec {
  spec: string | null;
  origin: string | null;
  warranty: string | null;
  /** ใช้ตัวอักษรขั้นย่อ (.st-spec--long) */
  long: boolean;
}

const specLength = (parts: (string | null)[]) => parts.filter((p): p is string => !!p).join(' · ').length;

/**
 * บรรทัดสเปกต้องไม่ถูกตัดด้วย … จนวันหมดประกันหาย — ลดทีละขั้นจนพอดีความกว้าง:
 * 1) ขนาดปกติ → 2) ย่อตัวอักษร → 3) ตัดที่มาเครื่อง → 4) "ประกันศูนย์" เหลือ "ศูนย์" → สุดท้ายค่อยปล่อยให้ … ตัด
 */
export function fitSpec(
  view: Pick<StickerView, 'spec' | 'origin' | 'warrantyLabel'>,
  size: StickerSize,
): FittedSpec {
  const budget = SPEC_BUDGET[size];
  const shortWarranty = view.warrantyLabel ? view.warrantyLabel.replace(/^ประกันศูนย์ /, 'ศูนย์ ') : null;
  const candidates: Omit<FittedSpec, 'long'>[] = [
    { spec: view.spec, origin: view.origin, warranty: view.warrantyLabel },
    { spec: view.spec, origin: null, warranty: view.warrantyLabel },
    { spec: view.spec, origin: null, warranty: shortWarranty },
  ];
  for (const candidate of candidates) {
    const length = specLength([candidate.spec, candidate.origin, candidate.warranty]);
    if (length <= budget.normal) return { ...candidate, long: false };
    if (length <= budget.long) return { ...candidate, long: true };
  }
  return { ...candidates[candidates.length - 1], long: true };
}

/**
 * ค่าตัวอักษร/ระยะต่อขนาด (หน่วย pt และ mm) — ตามตารางใน spec
 * `docs/superpowers/specs/2026-10-22-sticker-60x40-qr-design.md` ที่เจ้าของดูจาก mockup + PDF ตัวอย่างแล้ว
 * ความสูงบรรทัดไทยทุกบรรทัด ≥ 1.25 (ฟอนต์ IBM Plex Sans Thai สูงกว่า 1.2 — ต่ำกว่านี้สระบนถูกตัด/ทับ)
 * ทุกค่าออกเป็น CSS variable บน `.sticker--<size>` จึงวางดวงหลายขนาดบนหน้าเดียวกันได้โดยไม่ตีกัน
 */
const METRICS: Record<StickerSize, Record<string, string>> = {
  '60x40': {
    pad: '1.6mm',
    model: '11.5pt',
    'model-lh': '1.35',
    spec: '8pt',
    'spec-long': '7.5pt',
    'spec-lh': '1.4',
    baht: '9pt',
    price: '20pt',
    'chip-h': '3.4mm',
    chip: '7pt',
    'chip-border': '0.25mm',
    qr: '12mm',
    'qr-pad': '0.8mm',
    rule: '0.2mm',
    rate: '8pt',
    'rate-lh': '1.4',
    'rate-col': '6.4mm',
    id: '7pt',
    brand: '6pt',
    'simple-price': '26pt',
    'simple-qr': '16mm',
    'row-gap': '0.6mm',
    'rule-gap': '1mm',
  },
  '50x40': {
    pad: '1.5mm',
    model: '11pt',
    'model-lh': '1.35',
    spec: '7.5pt',
    'spec-long': '7pt',
    'spec-lh': '1.35',
    baht: '8.5pt',
    price: '18pt',
    'chip-h': '3.2mm',
    chip: '7pt',
    'chip-border': '0.25mm',
    qr: '11mm',
    'qr-pad': '0.8mm',
    rule: '0.2mm',
    rate: '8pt',
    'rate-lh': '1.35',
    'rate-col': '6.2mm',
    id: '6.5pt',
    brand: '5.5pt',
    'simple-price': '24pt',
    'simple-qr': '15mm',
    'row-gap': '0.6mm',
    'rule-gap': '0.9mm',
  },
  '50x30': {
    pad: '1.2mm',
    model: '10pt',
    'model-lh': '1.3',
    spec: '7pt',
    'spec-long': '6.5pt',
    'spec-lh': '1.3',
    baht: '8pt',
    price: '16pt',
    'chip-h': '2.8mm',
    chip: '6.5pt',
    'chip-border': '0.22mm',
    qr: '8mm',
    'qr-pad': '0.6mm',
    rule: '0.2mm',
    rate: '7.5pt',
    'rate-lh': '1.25',
    'rate-col': '5.8mm',
    id: '6pt',
    brand: '5pt',
    'simple-price': '20pt',
    'simple-qr': '12mm',
    'row-gap': '0.4mm',
    'rule-gap': '0.5mm',
  },
};

/**
 * ดวงสติกเกอร์ติดเครื่อง "แบบ ค" (เจ้าของเคาะ 2026-10-22 บน canvas TAzRReVG6MaHZZ7tfiUZZB):
 * รุ่น → สเปก · ประกันศูนย์ → [ราคาใหญ่ + ชิป | QR] → เส้นคั่น → เรท 1 / เรท 2 → IMEI … BESTCHOICE
 * ขาวดำตัวหนังสือล้วน ไม่มีพื้นดำ · ทุกบรรทัดเป็น flow ปกติ (ไม่มี absolute) จึงทับกันไม่ได้
 * สี #000/#fff ของกระดาษพิมพ์อยู่ใน CSS ของดวง (print context — ไม่ใช้โทเคนธีมโดยตั้งใจ)
 */
export function StickerCard({
  view,
  size = DEFAULT_STICKER_SIZE,
  showQr = true,
}: {
  view: StickerView;
  size?: StickerSize;
  showQr?: boolean;
}) {
  const chips = view.used
    ? [
        view.used.battery != null ? `แบต ${view.used.battery}%` : null,
        view.used.box == null ? null : view.used.box ? 'มีกล่อง' : 'ไม่มีกล่อง',
      ].filter((chip): chip is string => chip !== null)
    : [];
  const simple = view.rates.length === 0;
  const fitted = fitSpec(view, size);
  const specText = [fitted.spec, fitted.origin].filter((p): p is string => !!p).join(' · ');
  const rate1 = view.rates.find((rate) => rate.no === 1) ?? null;
  const rate2 = view.rates.find((rate) => rate.no === 2) ?? null;

  return (
    <div className={cn('sticker', `sticker--${size}`, simple && 'sticker--simple')} data-testid="sticker">
      <div className="st-model">{view.model}</div>

      {(specText || fitted.warranty) && (
        <div className={cn('st-spec', fitted.long && 'st-spec--long')}>
          {specText && <span className="st-spec-text">{specText}</span>}
          {specText && fitted.warranty && <span className="st-dot"> · </span>}
          {fitted.warranty && <b className="st-warranty">{fitted.warranty}</b>}
        </div>
      )}

      <div className="st-row">
        <div className="st-left">
          <div className="st-price tabular-nums">
            <span className="st-currency">฿</span>
            <span className="st-amount">{view.cash}</span>
          </div>
          {chips.length > 0 && (
            <div className="st-chips">
              {chips.map((chip) => (
                <span key={chip} className="st-chip">
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
        {showQr && (
          <div className="st-qr" data-testid="sticker-qr">
            <QRCodeSVG value={view.qrValue} level="M" marginSize={0} size={128} />
          </div>
        )}
      </div>

      {!simple && (
        <>
          <div className="st-rule" />
          <div className="st-rates tabular-nums">
            {rate1 && (
              <div className="st-rate">
                <span className="st-rate-no">เรท 1</span>
                <span className="st-rate-down">ดาวน์ {rate1.down}</span>
                <span className="st-rate-monthly">
                  {rate1.monthly}
                  <span className="st-x"> × </span>
                  {rate1.months} ด.
                </span>
              </div>
            )}
            {rate2 ? (
              <div className="st-rate">
                <span className="st-rate-no">เรท 2</span>
                <span className="st-rate-down">ดาวน์ {rate2.down}</span>
                <span className="st-rate-monthly">
                  {rate2.monthly}
                  <span className="st-x"> × </span>
                  {rate2.months} ด.
                </span>
              </div>
            ) : (
              rate1 && (
                <div className="st-rate st-rate--none">
                  <span className="st-rate-no">เรท 2</span>
                  <span className="st-rate-none">ไม่มีในตาราง GFIN</span>
                  <span />
                </div>
              )
            )}
          </div>
        </>
      )}

      <div className="st-footer">
        <span className="st-id">
          <span className="st-id-label">{view.idLabel}</span>
          <span className="st-id-text">{view.idText}</span>
        </span>
        <span className="st-brand">BESTCHOICE</span>
      </div>
    </div>
  );
}

function sizeVariables(size: StickerSize): string {
  const { w, h } = STICKER_SIZES[size];
  const vars = Object.entries(METRICS[size])
    .map(([key, value]) => `--st-${key}: ${value};`)
    .join(' ');
  return `.sticker--${size} { --st-w: ${w}mm; --st-h: ${h}mm; ${vars} }`;
}

/** กฎร่วมของดวงทุกขนาด — อ่านค่าจาก CSS variable ที่ `.sticker--<size>` ตั้งไว้ */
const BASE_STYLES = `
  .sticker {
    width: var(--st-w);
    height: var(--st-h);
    padding: var(--st-pad);
    font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    color: #000;
    background: #fff;
    overflow: hidden;
  }
  .sticker > * { flex-shrink: 0; }
  .st-model {
    font-size: var(--st-model);
    font-weight: 700;
    line-height: var(--st-model-lh);
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .st-spec {
    font-size: var(--st-spec);
    font-weight: 500;
    line-height: var(--st-spec-lh);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .st-spec--long { font-size: var(--st-spec-long); }
  .st-warranty { font-weight: 700; }
  .st-row { display: flex; gap: 1.4mm; align-items: flex-start; margin-top: var(--st-row-gap); }
  .st-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1mm; }
  .st-price { display: flex; align-items: baseline; gap: 0.6mm; line-height: 1; }
  .st-currency { font-size: var(--st-baht); font-weight: 600; }
  .st-amount { font-size: var(--st-price); font-weight: 800; letter-spacing: -0.025em; }
  .st-chips { display: flex; gap: 0.8mm; }
  .st-chip {
    display: inline-flex;
    align-items: center;
    height: var(--st-chip-h);
    padding: 0 1mm;
    box-sizing: border-box;
    border: var(--st-chip-border) solid #000;
    border-radius: 0.5mm;
    font-size: var(--st-chip);
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  .st-qr { flex-shrink: 0; padding: var(--st-qr-pad); background: #fff; box-sizing: content-box; }
  .st-qr svg { display: block; width: var(--st-qr); height: var(--st-qr); }
  .st-rule { border-top: var(--st-rule) solid #000; margin-top: var(--st-rule-gap); }
  .st-rates { display: flex; flex-direction: column; margin-top: 0.4mm; }
  .st-rate {
    display: grid;
    grid-template-columns: var(--st-rate-col) 1fr auto;
    align-items: baseline;
    gap: 1mm;
    font-size: var(--st-rate);
    line-height: var(--st-rate-lh);
    white-space: nowrap;
  }
  .st-rate-no { font-weight: 600; color: #333; }
  .st-rate-monthly { font-weight: 700; }
  .st-rate-none { color: #555; }
  .st-x { color: #555; font-weight: 400; }
  .st-footer {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1mm;
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
    line-height: 1.2;
    white-space: nowrap;
  }
  .st-id { font-size: var(--st-id); font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .st-id-label { margin-right: 0.8mm; }
  .st-brand { font-size: var(--st-brand); font-weight: 700; letter-spacing: 0.06em; flex-shrink: 0; }
  /* ไม่มีเรท (อุปกรณ์เสริม / ไม่มีตาราง): แถวราคา+QR ยืดเต็มดวง ราคาและ QR ใหญ่ขึ้น */
  .sticker--simple .st-row { flex: 1; align-items: center; margin-top: 1.5mm; }
  .sticker--simple .st-left { gap: 1.6mm; }
  .sticker--simple .st-amount { font-size: var(--st-simple-price); }
  .sticker--simple .st-qr svg { width: var(--st-simple-qr); height: var(--st-simple-qr); }
`;

const ALL_SIZE_VARIABLES = (Object.keys(STICKER_SIZES) as StickerSize[]).map(sizeVariables).join('\n  ');

/**
 * CSS ของดวงจริง (หน่วย mm/pt ตามกระดาษ) + กฎตอนพิมพ์ — render ครั้งเดียวในหน้า
 * `@page` ต้องเท่าขนาดม้วนที่เลือก เพราะเครื่องพิมพ์ฉลากพิมพ์หน้าละดวง
 */
export function stickerStyles(size: StickerSize): string {
  const { w, h } = STICKER_SIZES[size];
  return `${BASE_STYLES}
  ${ALL_SIZE_VARIABLES}

  @media print {
    @page { size: ${w}mm ${h}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body * { visibility: hidden !important; }
    .print-stickers, .print-stickers * { visibility: visible !important; }
    .print-stickers { position: absolute; top: 0; left: 0; width: ${w}mm; display: block !important; }
    .sticker {
      page-break-after: always;
      page-break-inside: avoid;
      break-after: page;
      break-inside: avoid;
      margin: 0;
    }
    .sticker:last-child { page-break-after: auto; break-after: auto; }
  }
`;
}

/** @deprecated ใช้ `stickerStyles(size)` — คงไว้ให้โค้ดเดิมคอมไพล์จนกว่าหน้าพิมพ์จะอ่านขนาดจากตั้งค่า */
export const STICKER_STYLES = stickerStyles(DEFAULT_STICKER_SIZE);
