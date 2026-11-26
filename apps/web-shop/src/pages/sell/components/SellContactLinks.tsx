import { MapPin, MessageCircle, UserPlus } from '@/lib/icons';
import { lineOaMessageUrl, shopInfo } from '@/lib/copy';
import { quoteDate } from '../quote-window';
import { formatNumber } from '@/lib/format';

export type SellContactContext = {
  model?: string;
  storage?: string;
  flow?: 'BUYBACK' | 'EXCHANGE';
  amount?: string | number | null;
  reference?: string;
  assessedAt?: string;
  expiresAt?: string;
  expired?: boolean;
};

function prepareMessage({
  model,
  storage,
  flow,
  amount,
  reference,
  assessedAt,
  expiresAt,
  expired,
}: SellContactContext) {
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
      `${flow === 'EXCHANGE' ? 'เครดิตเทิร์น' : 'ราคาขายสด'}โดยประมาณ ${formatNumber(price, { maximumFractionDigits: 2 })} บาท`,
    );
    if (flow === 'EXCHANGE') lines.push('เครดิตใช้ซื้อเครื่องในร้าน ไม่จ่ายเป็นเงินสด');
    if (assessedAt && expiresAt) {
      lines.push(`ประเมินเมื่อ ${quoteDate(assessedAt)} · เวลาไทย`);
      lines.push(`อ้างอิงถึง ${quoteDate(expiresAt)} · เวลาไทย`);
      if (expired) lines.push('ผลนี้พ้นช่วงอ้างอิงแล้ว ต้องประเมินใหม่');
      lines.push('ช่วงอ้างอิง 24 ชั่วโมงไม่ใช่การล็อคราคา');
    }
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
    'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold underline-offset-4 hover:bg-secondary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-disabled:cursor-default';
  return (
    <section aria-label="ติดต่อร้านเรื่องขายหรือเทิร์น" className="space-y-1">
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
        <a
          className={`${linkClass} text-secondary-foreground`}
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
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {disabled
          ? 'กำลังส่งข้อมูล กรุณารอสักครู่'
          : 'ทัก LINE จะเตรียมข้อความให้ คุณตรวจแล้วกดส่งได้เลย'}
      </p>
    </section>
  );
}
