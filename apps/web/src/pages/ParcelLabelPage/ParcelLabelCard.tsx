import { QRCodeSVG } from 'qrcode.react';
import { formatDateMedium } from '@/utils/formatters';
import { CARRIERS, type ParcelLabelDraft } from './parcelLabel';

/**
 * กระดาษใบปะหน้าพัสดุ 100×150 มม. ตาม mockup `Label.dc.html` — ขาวดำ โซนคั่นเส้นดำหนา ไม่มีมุมโค้ง
 * สีเป็นค่าตายตัวโดยตั้งใจ (กระดาษ ไม่ใช่ UI — ข้อยกเว้นเดียวกับ `StickerCard`) · สไตล์อยู่ที่ `labelStyles()` ใน parcelLabel.ts
 */
export default function ParcelLabelCard({ draft, printedAt = new Date() }: { draft: ParcelLabelDraft; printedAt?: Date }) {
  const senderLine = [draft.sender.address, draft.sender.phone ? `โทร ${draft.sender.phone}` : '']
    .filter((part) => part.length > 0)
    .join(' · ');

  return (
    <article className="parcel-label" data-testid="parcel-label" aria-label={`ใบปะหน้าพัสดุ ${draft.saleNumber}`}>
      <header className="pl-head">
        <div className="pl-brand">BESTCHOICE</div>
        <div className="pl-head-right">
          <div className="pl-k">ใบปะหน้าพัสดุ</div>
          <div className="pl-sale-no pl-mono">{draft.saleNumber}</div>
        </div>
      </header>

      <div className="pl-zone pl-carriers">
        <span className="pl-k">ขนส่ง</span>
        {CARRIERS.map((carrier) => {
          const on = draft.carrier === carrier.code;
          return (
            <span key={carrier.code} className="pl-carrier">
              <span
                role="img"
                aria-label={`${carrier.label} ${on ? 'เลือกแล้ว' : 'ยังไม่เลือก'}`}
                className={on ? 'pl-cb on' : 'pl-cb'}
              />
              {carrier.label}
            </span>
          );
        })}
        <span className="pl-date">{formatDateMedium(printedAt)}</span>
      </div>

      <div className="pl-zone pl-recipient">
        <span className="pl-k">ผู้รับ</span>
        <div className="pl-name">{draft.recipientName || '—'}</div>
        <div className="pl-phone pl-mono">{draft.phone || '—'}</div>
        <div className="pl-address">{draft.addressLines}</div>
        <div className="pl-province-row">
          <span className="pl-province">{draft.province}</span>
          <span className="pl-zip pl-mono">{draft.postalCode}</span>
        </div>
        <div className="pl-note">หมายเหตุถึงขนส่ง: {draft.note.trim() || '—'}</div>
      </div>

      <div className="pl-zone pl-items">
        <div className="pl-items-text">
          <span className="pl-k">ของในกล่อง</span>
          <div className="pl-item-title">{draft.item.title}</div>
          {draft.item.imei && <div className="pl-item-imei pl-mono">IMEI {draft.item.imei}</div>}
          {draft.item.extras.length > 0 && <div className="pl-item-extras">+ {draft.item.extras.join(' · ')}</div>}
          <div className="pl-cod">
            <span className="pl-k">เก็บเงินปลายทาง</span>
            <span className="pl-cod-value pl-mono">{draft.cod.trim() || 'ไม่มี'}</span>
          </div>
        </div>
        <div className="pl-qr">
          <QRCodeSVG value={draft.qrValue} level="M" marginSize={0} role="img" aria-label={`QR เปิดใบขาย ${draft.saleNumber}`} />
          <span className="pl-qr-no pl-mono">{draft.saleNumber}</span>
        </div>
      </div>

      <footer className="pl-sender">
        <div>
          <span className="pl-k">ผู้ส่ง</span>
          <div className="pl-sender-name">{draft.sender.name}</div>
          {senderLine && <div>{senderLine}</div>}
        </div>
        <div className="pl-sender-hint">
          {'ยิง QR ตอนส่ง/รับคืน '}
          <br />
          เพื่อเปิดใบขาย
        </div>
      </footer>
    </article>
  );
}
