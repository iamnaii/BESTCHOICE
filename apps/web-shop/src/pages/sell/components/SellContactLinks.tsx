import { MapPin, MessageCircle, UserPlus } from 'lucide-react';
import { lineOaMessageUrl, shopInfo } from '@/lib/copy';

export type SellContactContext = {
  model?: string;
  storage?: string;
  flow?: 'BUYBACK' | 'EXCHANGE';
  amount?: string | number | null;
  reference?: string;
};

function prepareMessage({ model, storage, flow, amount, reference }: SellContactContext) {
  const price = Number(amount);
  const estimate = amount != null && Number.isFinite(price) && price > 0;
  const lines = [
    model
      ? `สวัสดีครับ/ค่ะ สนใจ${flow === 'EXCHANGE' ? 'เทิร์น' : flow === 'BUYBACK' ? 'ขาย' : 'ขายหรือเทิร์น'} ${[model, storage].filter(Boolean).join(' ')}`
      : 'สวัสดีครับ/ค่ะ ขอสอบถามเรื่องขายหรือเทิร์น iPhone',
  ];
  if (reference) lines.push(`เลขรายการ ${reference}`);
  if (estimate) {
    lines.push(
      `${flow === 'EXCHANGE' ? 'เครดิตเทิร์น' : 'ราคาขายสด'}โดยประมาณ ${price.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`,
    );
    if (flow === 'EXCHANGE') lines.push('เครดิตใช้ซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด');
    lines.push('รับทราบว่าราคายืนยันหลังตรวจเครื่องที่ร้าน');
  }
  lines.push('ขอสอบถามรายละเอียดและนัดเข้าร้านครับ/ค่ะ');
  return lines.join('\n');
}

export default function SellContactLinks({
  context = {},
  disabled = false,
}: {
  context?: SellContactContext;
  disabled?: boolean;
}) {
  const linkClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-semibold underline-offset-4 hover:bg-secondary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:cursor-default';
  return (
    <section aria-label="ติดต่อร้านเรื่องขายหรือเทิร์น" className="space-y-1">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
        <a
          className={`${linkClass} bg-primary text-primary-foreground hover:bg-ink`}
          href={disabled ? undefined : lineOaMessageUrl(prepareMessage(context))}
          aria-disabled={disabled || undefined}
          role="link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
          ทัก LINE
        </a>
        <a
          className={`${linkClass} text-secondary-foreground`}
          href={disabled ? undefined : shopInfo.lineUrl}
          aria-disabled={disabled || undefined}
          role="link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <UserPlus className="size-4 shrink-0" aria-hidden="true" />
          แอด LINE
        </a>
        {shopInfo.mapsUrl && (
          <a
            className={`${linkClass} text-secondary-foreground`}
            href={disabled ? undefined : shopInfo.mapsUrl}
            aria-disabled={disabled || undefined}
            role="link"
            target="_blank"
            rel="noopener noreferrer"
          >
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            Google Maps
          </a>
        )}
      </div>
      <p className="text-center text-xs leading-relaxed text-foreground">
        {disabled
          ? 'กำลังส่งข้อมูล กรุณารอสักครู่'
          : 'ทัก LINE จะเตรียมข้อความให้ คุณตรวจแล้วกดส่งได้เลย'}
      </p>
    </section>
  );
}
