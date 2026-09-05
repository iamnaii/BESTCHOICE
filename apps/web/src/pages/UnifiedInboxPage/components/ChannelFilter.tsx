import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** สามใบ ไม่ใช่สี่ และไม่มีไอคอน — วัดด้วย headless Chrome ที่คอลัมน์ 320px
 *
 *  แท็บ "ยังไม่อ่าน" ถูกตัดออก 2026-09-05: มันวัดว่ามีคนกดเปิดห้องหรือยัง ซึ่งเป็น
 *  ร่องรอยการใช้หน้าจอ ไม่ใช่ข้อเท็จจริงฝั่งลูกค้า — ห้องที่เปิดอ่านแล้วแต่ยังไม่ตอบ
 *  ก็ยังเป็นลูกค้าที่รออยู่ "รอตอบ" ตอบคำถามเดียวกันอย่างตรงไปตรงมา
 *
 *  ไอคอนถูกตัดออกด้วยเหตุผลเรื่องพื้นที่ล้วน ๆ: ที่ 320px มีที่ให้แถวแท็บ 287px
 *  สี่ใบพร้อมไอคอน = 342px (ล้น 55px) · สามใบพร้อมไอคอน = 310.5px เมื่อป้ายเป็น
 *  "99+" ทั้งสามใบ (ยังล้น 23.5px — ตัวเลข prod จริงคือ 8,320 / 231 ⇒ "99+" ทุกใบ)
 *  สามใบไม่มีไอคอน + ระยะขอบแคบลง (px-2.5) = 266.9px เหลือที่ 20.1px · คำไทย
 *  บอกอยู่แล้วว่าแต่ละใบคืออะไร
 *  ไอคอนจึงไม่ได้เพิ่มความหมาย มีแต่กินที่ */
const TABS = [
  { key: 'waiting', label: 'รอตอบ' },
  { key: 'mine', label: 'ของฉัน' },
  { key: 'all', label: 'ทั้งหมด' },
] as const;

const CHANNELS = [
  { key: 'LINE_FINANCE', label: 'LINE การเงิน', dot: 'bg-[#06C755]' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน', dot: 'bg-[#06C755]' },
  { key: 'FACEBOOK', label: 'Facebook', dot: 'bg-[#1877F2]' },
  { key: 'TIKTOK', label: 'TikTok', dot: 'bg-foreground' },
  { key: 'WEB', label: 'เว็บ', dot: 'bg-muted-foreground' },
] as const;

export type InboxTab = 'waiting' | 'mine' | 'all';
export type AiFilter = 'all' | 'ai' | 'human' | 'pending';

/** ป้ายกลุ่มนี้เคยชนกับชื่อแท็บสองใบ — 'ทั้งหมด' ซ้ำแท็บ "ทั้งหมด" และ 'รอตอบ'
 *  ซ้ำแท็บ "รอตอบ" ทั้งที่คนละความหมาย (แท็บ = ลูกค้ารอคน · ชิป = บอทส่งต่อให้คน)
 *  ตอนนี้ทุกใบบอกสิ่งที่ตัวเองกรองด้วยคำของตัวเอง */
const AI_FILTER_LABELS: Record<AiFilter, string> = {
  all: 'ทุกสถานะ',
  ai: 'บอทตอบ',
  human: 'คนตอบ',
  pending: 'บอทส่งต่อ',
};

interface ChannelFilterProps {
  activeTab: InboxTab;
  selectedChannels: string[];
  onTabChange: (tab: InboxTab) => void;
  onChannelToggle: (channel: string) => void;
  counts?: { mine: number; all: number; waiting: number };
  channelCounts?: Record<string, number>;
  aiFilter?: AiFilter;
  onAiFilterChange?: (filter: AiFilter) => void;
}

export default function ChannelFilter({
  activeTab,
  selectedChannels,
  onTabChange,
  onChannelToggle,
  counts,
  channelCounts,
  aiFilter,
  onAiFilterChange,
}: ChannelFilterProps) {
  // แสดงเฉพาะช่องทางที่มีห้องจริงในแท็บนี้ (บวกใบที่กำลังเลือกอยู่ กันตัวกรองค้างโดยไม่มีปุ่มปิด)
  // ห้าใบตายตัวกินสองบรรทัดครึ่งในคอลัมน์ 320px และสามในห้าใบไม่เคยมีห้องเลยบน prod
  // (วัด 2026-09-05: 8,320 ห้องเป็น FACEBOOK ทั้งหมด ไม่มี LINE/TikTok/เว็บ แม้ห้องเดียว)
  // ยังไม่รู้จำนวน (คำตอบจากเซิร์ฟเวอร์ยังไม่มา) = แสดงทุกใบไว้ก่อน ไม่ใช่ซ่อนทั้งแถว
  const visibleChannels = channelCounts
    ? CHANNELS.filter((ch) => (channelCounts[ch.key] ?? 0) > 0 || selectedChannels.includes(ch.key))
    : CHANNELS;

  return (
    <div>
      {/* Main tabs */}
      <div className="flex px-4 pt-1 gap-0.5">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              aria-pressed={isActive}
              className={cn(
                'flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {counts && counts[tab.key] > 0 && (
                <span className={cn(
                  'ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold leading-none',
                  tab.key === 'waiting' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
                )}>
                  {counts[tab.key] > 99 ? '99+' : counts[tab.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Channel + AI status chips — one wrapping row so nothing gets clipped */}
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2.5">
        {visibleChannels.map((ch) => {
          const isActive = selectedChannels.includes(ch.key);
          return (
            <button
              key={ch.key}
              onClick={() => onChannelToggle(ch.key)}
              aria-pressed={isActive}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 min-h-6 text-[11px] rounded-full font-medium transition-all duration-200 whitespace-nowrap',
                isActive
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full transition-colors',
                isActive ? 'bg-background/60' : ch.dot,
              )} />
              {ch.label}
              {channelCounts && channelCounts[ch.key] > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
                  {channelCounts[ch.key] > 99 ? '99+' : channelCounts[ch.key]}
                </span>
              )}
            </button>
          );
        })}

        {/* ตัวกรองสถานะบอทเป็นเมนูใบเดียว ไม่ใช่ชิปสี่ใบ — ชิปสี่ใบต่อท้ายชิปช่องทางห้าใบ
            ทำให้แถวตัดบรรทัดจนอ่านไม่ออกว่าใบไหนอยู่กลุ่มไหน ("ทุกสถานะ" ไปนั่งข้าง "เว็บ"
            เหมือนเป็นช่องทางที่หก) เมนูใบเดียวพกชื่อกลุ่มติดตัวไปด้วยเสมอ */}
        {aiFilter && onAiFilterChange && (
          <>
            <span className="mx-1 h-3.5 w-px bg-border/60" aria-hidden />
            <Select value={aiFilter} onValueChange={(v) => onAiFilterChange(v as AiFilter)}>
              <SelectTrigger
                aria-label="กรองตามสถานะบอท"
                className={cn(
                  'h-6 min-h-6 w-auto gap-1 rounded-full border px-2 py-1 text-[11px] font-medium whitespace-nowrap',
                  aiFilter === 'all'
                    ? 'bg-background text-muted-foreground border-border/60 hover:bg-muted'
                    : 'bg-primary text-primary-foreground border-primary',
                )}
              >
                <span className="opacity-70">บอท</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AI_FILTER_LABELS) as AiFilter[]).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {AI_FILTER_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    </div>
  );
}
