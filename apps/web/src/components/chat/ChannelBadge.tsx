import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * ป้ายช่องทางแชทตัวเดียวของระบบ — ถอดมาจากสำเนาใน
 * `UnifiedInboxPage/components/Customer360Panel.tsx` (ทั้งฟังก์ชัน `ChannelBadge` เดิม
 * และ `channelLabel`/`channelColor` ที่อยู่หัวไฟล์)
 *
 * 🔴 กติกา: **ห้ามสร้างแผนที่สี/ตัวอักษรของช่องทางชุดที่หก** — ในโค้ดยังมีสำเนาค้างอยู่สามที่
 * (`ChannelFilter.tsx` = รายการคีย์ที่ถือเป็นต้นฉบับ, `ConversationItem.tsx`,
 * `CollectionsPage/components/SmartCustomerPanel.tsx`) ให้ย้ายมาใช้ไฟล์นี้ทีละตัว
 *
 * ไม่มีไฟล์ SVG โลโก้ Facebook/LINE/TikTok ในรีโปเลย (`public/` มีแต่โลโก้ BESTCHOICE และ
 * ไม่มี `src/assets`) ⇒ "โลโก้" = พื้นสีแบรนด์ + ตัวอักษร. สีแบรนด์ `bg-[#06C755]` /
 * `bg-[#1877F2]` เป็นข้อยกเว้นที่อนุมัติแล้วของกฎห้าม hex (`.claude/rules/frontend.md`)
 * — ใช้ได้เฉพาะเพื่อบอกตัวตนช่องทาง ห้ามเอาไปใช้ที่อื่น
 */

export const CHANNEL_KEYS = ['LINE_FINANCE', 'LINE_SHOP', 'FACEBOOK', 'TIKTOK', 'WEB'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export interface ChannelMeta {
  /** ชื่อเต็ม — ใช้เป็น tooltip และข้อความกำกับ */
  label: string;
  /** ชื่อย่อสำหรับที่แคบ */
  short: string;
  /** ตัวอักษรบนโลโก้ */
  letter: string;
  /** พื้นทึบสีแบรนด์ (คู่กับตัวอักษรสีขาว) */
  solid: string;
  /** พื้นอ่อน + ตัวอักษรสีเดียวกัน สำหรับชิปในแผงข้อมูล */
  tint: string;
}

export const CHANNEL_META: Record<ChannelKey, ChannelMeta> = {
  LINE_FINANCE: {
    label: 'LINE Finance',
    short: 'LINE',
    letter: 'L',
    solid: 'bg-[#06C755]',
    tint: 'bg-success/10 text-success',
  },
  LINE_SHOP: {
    label: 'LINE Shop',
    short: 'LINE Shop',
    letter: 'L',
    solid: 'bg-[#06C755]',
    tint: 'bg-success/10 text-success',
  },
  FACEBOOK: {
    label: 'Facebook',
    short: 'FB',
    letter: 'f',
    solid: 'bg-[#1877F2]',
    tint: 'bg-info/10 text-info',
  },
  TIKTOK: {
    label: 'TikTok',
    short: 'TikTok',
    letter: '♪',
    solid: 'bg-foreground',
    tint: 'bg-primary/10 text-primary',
  },
  WEB: {
    label: 'เว็บ',
    short: 'Web',
    letter: 'W',
    solid: 'bg-muted-foreground',
    tint: 'bg-muted text-muted-foreground',
  },
};

const FALLBACK_META: ChannelMeta = {
  label: 'ไม่ทราบช่องทาง',
  short: '?',
  letter: '?',
  solid: 'bg-muted-foreground/40',
  tint: 'bg-muted text-muted-foreground',
};

export function channelMeta(channel: string): ChannelMeta {
  return CHANNEL_META[channel as ChannelKey] ?? FALLBACK_META;
}

export interface ChannelBadgeProps {
  channel: string;
  /**
   * `'logo'` = สี่เหลี่ยมมน 20px ตัวอักษรเดียว — ขนาดที่คอลัมน์ "แชท" ของหน้ารายชื่อต้องการ
   * `'text'` = ป้ายเล็กมีชื่อย่อ (รูปเดิมของแผงขวาห้องแชท)
   */
  variant?: 'logo' | 'text';
  /**
   * ถ้ามี = ห่อด้วย `<Link to={`/inbox/${roomId}`}>` ให้เลย พร้อม `stopPropagation`
   * เพราะแถวตารางคลิกได้ (precedent: `CreditChecksPage.tsx:192`)
   * ⚠️ ผู้เรียกที่ห่อ `<Link>` เองอยู่แล้ว **ห้ามส่ง** prop นี้ — จะได้ `<a>` ซ้อน `<a>`
   */
  roomId?: string | null;
  /** ทับ tooltip (ค่าเริ่มต้น = ชื่อเต็มของช่องทาง) */
  title?: string;
  className?: string;
}

export default function ChannelBadge({
  channel,
  variant = 'text',
  roomId,
  title,
  className,
}: ChannelBadgeProps) {
  const meta = channelMeta(channel);
  const tooltip = title ?? meta.label;

  const body =
    variant === 'logo' ? (
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold leading-none text-white',
          meta.solid,
          className,
        )}
      >
        {meta.letter}
      </span>
    ) : (
      <span
        className={cn(
          'rounded px-1.5 py-0.5 text-[9px] font-bold leading-snug text-white',
          meta.solid,
          className,
        )}
      >
        {meta.short}
      </span>
    );

  if (!roomId) {
    // variant 'logo' ซ่อนตัวอักษรจาก screen reader ⇒ ต้องมีข้อความแทนเสมอ
    return variant === 'logo' ? (
      <span title={tooltip} className="inline-flex">
        {body}
        <span className="sr-only">{meta.label}</span>
      </span>
    ) : (
      <span title={tooltip}>{body}</span>
    );
  }

  return (
    <Link
      to={`/inbox/${roomId}`}
      title={`เปิดแชท${meta.label}`}
      aria-label={`เปิดแชท${meta.label}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  );
}
