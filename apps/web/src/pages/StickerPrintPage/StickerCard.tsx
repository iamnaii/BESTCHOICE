import { cn } from '@/lib/utils';
import type { StickerView } from './stickerView';

/**
 * ดวงสติกเกอร์ 50×30 มม. (thermal ขาวดำ) — เลย์เอาต์ที่เจ้าของเคาะ 2026-09-11:
 * รุ่นอย่างเดียว · ราคาเงินสดของเครื่อง · สเปก + ประกันศูนย์ (ถ้ามี) · มือสองมีชิป %แบต + กล่อง ·
 * เรท 1/เรท 2 · ท้ายดวง IMEI อย่างเดียว (ไม่มีบาร์โค้ด/ชื่อร้าน)
 * สี #000/#fff ของกระดาษพิมพ์อยู่ใน STICKER_STYLES (print context — ไม่ใช้โทเคนธีมโดยตั้งใจ)
 */
export function StickerCard({ view }: { view: StickerView }) {
  const chips = view.used
    ? [
        view.used.battery != null ? `แบต ${view.used.battery}%` : null,
        view.used.box == null ? null : view.used.box ? 'มีกล่อง' : 'ไม่มีกล่อง',
      ].filter((chip): chip is string => chip !== null)
    : [];
  // มีแถวชิป → บีบช่องไฟแนวตั้งลง 0.3 มม. ให้ 2 เรท + IMEI ยังอยู่ใน 30 มม.
  const tight = chips.length > 0;

  return (
    <div className={cn('sticker', tight && 'sticker--tight')} data-testid="sticker">
      <div className="st-top">
        <span className="st-model">{view.model}</span>
        <div className="st-price tabular-nums">
          <span className="st-currency">฿</span>
          <span className="st-amount">{view.cash}</span>
        </div>
      </div>

      {(view.spec || view.warrantyLabel) && (
        <div className="st-spec">
          <span className="st-spec-text">{view.spec ?? ' '}</span>
          {view.warrantyLabel && <span className="st-warranty">{view.warrantyLabel}</span>}
        </div>
      )}

      {chips.length > 0 && (
        <div className="st-chips">
          {chips.map((chip) => (
            <span key={chip} className="st-chip">
              {chip}
            </span>
          ))}
        </div>
      )}

      <div className="st-rule" />

      {view.rates.length > 0 && (
        <div className="st-rates tabular-nums">
          {view.rates.map((rate) => (
            <div key={rate.no} className="st-rate">
              <span className="st-rate-tag">{rate.no}</span>
              <span className="st-rate-down">ดาวน์ {rate.down}</span>
              <span className="st-rate-monthly">
                {rate.monthly}
                <span className="st-x"> × </span>
                {rate.months} ด.
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="st-footer">
        <span className="st-imei">{view.imei ?? ' '}</span>
      </div>
    </div>
  );
}

/**
 * CSS ของดวงจริง (หน่วย mm/pt ตามกระดาษ) + กฎตอนพิมพ์ — render ครั้งเดียวในหน้า
 * ค่า mm/pt ชุดนี้ตรงกับ mockup ที่เจ้าของเคาะ (scratchpad sticker-mockup รอบ 5)
 */
export const STICKER_STYLES = `
  .sticker {
    width: 50mm;
    height: 30mm;
    padding: 1.6mm 1.8mm 1.2mm;
    font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    color: #000;
    background: #fff;
    line-height: 1.12;
    overflow: hidden;
  }
  .st-top { display: flex; justify-content: space-between; align-items: center; gap: 1.2mm; }
  .st-model {
    font-size: 11pt;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.01em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st-price {
    display: inline-flex;
    align-items: baseline;
    gap: 0.6mm;
    flex-shrink: 0;
    padding: 0.9mm 1.4mm;
    background: #000;
    color: #fff;
    border-radius: 0.8mm;
  }
  .st-currency { font-size: 7pt; font-weight: 600; line-height: 1; }
  .st-amount { font-size: 12pt; font-weight: 800; line-height: 1; letter-spacing: -0.015em; }
  .st-spec {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1.2mm;
    font-size: 7.5pt;
    margin-top: 1mm;
    font-weight: 500;
  }
  .sticker--tight .st-spec { margin-top: 0.7mm; }
  .st-spec-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st-warranty { font-size: 7pt; font-weight: 600; white-space: nowrap; }
  .st-chips { display: flex; gap: 0.8mm; margin-top: 0.6mm; }
  .st-chip {
    display: inline-flex;
    align-items: center;
    height: 3mm;
    padding: 0 0.9mm;
    box-sizing: border-box;
    border: 0.22mm solid #000;
    border-radius: 0.6mm;
    font-size: 6.8pt;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }
  .st-rule { margin: 1mm 0 0.8mm; height: 0; border-top: 0.22mm solid #000; }
  .sticker--tight .st-rule { margin: 0.7mm 0 0.6mm; }
  .st-rates { display: flex; flex-direction: column; gap: 0.6mm; }
  .st-rate {
    display: grid;
    grid-template-columns: 3.8mm 1fr auto;
    align-items: center;
    gap: 1.2mm;
    font-size: 8pt;
    line-height: 1.1;
  }
  .st-rate-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.4mm;
    height: 3.4mm;
    font-family: var(--font-mono);
    font-size: 7pt;
    font-weight: 700;
    color: #fff;
    background: #000;
    border-radius: 0.6mm;
    line-height: 1;
  }
  .st-rate-down { font-weight: 600; }
  .st-rate-monthly { font-weight: 700; white-space: nowrap; }
  .st-x { color: #555; font-weight: 400; }
  .st-footer {
    margin-top: auto;
    padding-top: 0.8mm;
    border-top: 0.22mm dotted #000;
    display: flex;
    align-items: center;
  }
  .sticker--tight .st-footer { padding-top: 0.6mm; }
  .st-imei {
    font-family: var(--font-mono);
    font-size: 6.6pt;
    letter-spacing: 0.02em;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media print {
    @page { size: 50mm 30mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body * { visibility: hidden !important; }
    .print-stickers, .print-stickers * { visibility: visible !important; }
    .print-stickers { position: absolute; top: 0; left: 0; width: 50mm; display: block !important; }
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
