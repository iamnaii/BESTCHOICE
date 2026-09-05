import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

/** สามใบ ไม่มีไอคอน ไม่มีเลขบน "ทั้งหมด" — วัดด้วย headless Chrome ที่คอลัมน์ 320px (ที่ว่าง 287px)
 *  สี่ใบ+ไอคอน = 342px ล้น · สามใบ+ไอคอน ป้าย "99+" ทั้งสามใบ = 310.5px ยังล้น · สามใบไม่มีไอคอน = 266.9px
 *  "ยังไม่อ่าน" ถูกตัด: วัดว่ามีคนกดเปิดหรือยัง ไม่ใช่ข้อเท็จจริงฝั่งลูกค้า · เลขบน "ทั้งหมด" ถูกตัด: 99+ ตลอดกาล */
const TABS = [
  { key: 'waiting', label: 'รอตอบ' },
  { key: 'mine', label: 'ของฉัน' },
  { key: 'all', label: 'ทั้งหมด' },
] as const;

export const CHANNELS = [
  { key: 'FACEBOOK', label: 'Facebook', dot: 'bg-[#1877F2]' },
  { key: 'LINE_FINANCE', label: 'LINE การเงิน', dot: 'bg-[#06C755]' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน', dot: 'bg-[#06C755]' },
  { key: 'TIKTOK', label: 'TikTok', dot: 'bg-foreground' },
  { key: 'WEB', label: 'เว็บ', dot: 'bg-muted-foreground' },
] as const;

export type InboxTab = 'waiting' | 'mine' | 'all';
/** ตัวกรองผู้ดูแล: ทุกคน · ยังไม่มีคนดูแล · หรือ id พนักงาน */
export type WhoFilter = 'all' | 'free' | (string & {});

/** Radix Select ห้าม value="" ⇒ ใช้ sentinel แทน "ทุกอย่าง" */
const ALL = '__all__';
const FREE = '__free__';

export interface StaffOption { id: string; name: string }

interface ChannelFilterProps {
  activeTab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  /** เลือกได้ทีละช่องทาง (เจ้าของเคาะ 2026-09-05) · null = ทุกช่องทาง */
  channel: string | null;
  onChannelChange: (channel: string | null) => void;
  who: WhoFilter;
  onWhoChange: (who: WhoFilter) => void;
  /** พนักงานที่ปรากฏในเมนูผู้ดูแล (คนที่ถือห้องอยู่ + ตัวเอง) */
  staff: StaffOption[];
  currentUserId?: string;
  counts?: { mine: number; waiting: number };
  /** จำนวนห้องต่อช่องทางในกองที่เปิดอยู่ — จากเซิร์ฟเวอร์ (นับในจักรวาลของแท็บ) */
  channelCounts?: Record<string, number>;
}

export default function ChannelFilter({
  activeTab,
  onTabChange,
  channel,
  onChannelChange,
  who,
  onWhoChange,
  staff,
  currentUserId,
  counts,
  channelCounts,
}: ChannelFilterProps) {
  // เมนูช่องทางคงรูปทุกแท็บ: แสดงช่องทางที่มีห้องในกองนี้ + ใบที่เลือกอยู่ (กันติดตัวกรองแล้วหาปุ่มปลดไม่เจอ)
  // ลำดับคงที่ตาม enum ไม่เรียงตามจำนวน — ปุ่มที่กดวันละหลายสิบครั้งต้องอยู่ที่เดิม
  const visibleChannels = channelCounts
    ? CHANNELS.filter((c) => (channelCounts[c.key] ?? 0) > 0 || channel === c.key)
    : CHANNELS;
  const selected = channel ? CHANNELS.find((c) => c.key === channel) : undefined;
  const totalInTab = channelCounts ? Object.values(channelCounts).reduce((a, b) => a + b, 0) : undefined;
  // ชื่อแรกพอ — "เอกนรินทร์ คงเดช (คุณ)" บนปุ่มทำสองเมนูตกบรรทัดที่ 320px
  const whoStaff = staff.find((s) => s.id === who);
  const whoLabel = whoStaff ? (whoStaff.id === currentUserId ? 'คุณ' : whoStaff.name.split(' ')[0]) : '…';

  return (
    <div>
      {/* แท็บกองงาน */}
      <div className="flex px-4 pt-1 gap-0.5">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const n = tab.key === 'waiting' ? counts?.waiting : tab.key === 'mine' ? counts?.mine : undefined;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              aria-pressed={isActive}
              className={cn(
                'flex items-center justify-center gap-1 px-2.5 py-2 text-xs font-medium rounded-md transition-colors',
                isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {n !== undefined && n > 0 && (
                <span
                  className={cn(
                    'ml-0.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold leading-none',
                    tab.key === 'waiting' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground',
                  )}
                >
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* เมนูช่องทาง + เมนูผู้ดูแล — รูปเดียวกัน กรองเฉพาะรายการ ไม่แตะเลขบนแท็บ */}
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2.5">
        <Select value={channel ?? ALL} onValueChange={(v) => onChannelChange(v === ALL ? null : v)}>
          <SelectTrigger
            aria-label="กรองตามช่องทาง"
            className={cn(
              'h-6 min-h-6 w-auto gap-1 rounded-full border px-2 py-1 text-[11px] font-medium whitespace-nowrap',
              selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border/60 hover:bg-muted',
            )}
          >
            {selected ? (
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('size-1.5 rounded-full', 'bg-primary-foreground/70')} />
                {selected.label}
              </span>
            ) : (
              <>
                <span className="opacity-70">ช่องทาง</span>
                ทุกช่องทาง
              </>
            )}
          </SelectTrigger>
          <SelectContent className="min-w-[186px]">
            <SelectItem value={ALL} className="text-xs">
              <span className="flex w-full items-center gap-2">ทุกช่องทาง
                {totalInTab !== undefined && <span className="ml-auto pl-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">{totalInTab}</span>}
              </span>
            </SelectItem>
            {visibleChannels.map((c) => (
              <SelectItem key={c.key} value={c.key} className="text-xs">
                <span className="flex w-full items-center gap-2">
                  <span className={cn('size-1.5 rounded-full', c.dot)} />
                  {c.label}
                  {/* ตัวเลขในเมนูเขียนเต็ม ไม่ตัดที่ 99+ — ในเมนูมีที่พอ */}
                  <span className="ml-auto pl-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">{channelCounts?.[c.key] ?? 0}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={who === 'all' ? ALL : who === 'free' ? FREE : who} onValueChange={(v) => onWhoChange(v === ALL ? 'all' : v === FREE ? 'free' : v)}>
          <SelectTrigger
            aria-label="กรองตามผู้ดูแล"
            className={cn(
              'h-6 min-h-6 w-auto gap-1 rounded-full border px-2 py-1 text-[11px] font-medium whitespace-nowrap',
              who !== 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border/60 hover:bg-muted',
            )}
          >
            <span className="opacity-70">ผู้ดูแล</span>
            {who === 'all' ? 'ทุกคน' : who === 'free' ? 'ยังไม่มีคนดูแล' : whoLabel}
          </SelectTrigger>
          <SelectContent className="min-w-[186px]">
            <SelectItem value={ALL} className="text-xs">ทุกคน</SelectItem>
            {/* "ยังไม่มีคนดูแล" = กองที่ใครก็หยิบได้ (สเปก §5 ใครตอบก่อนได้เป็นเจ้าของ) */}
            <SelectItem value={FREE} className="text-xs">ยังไม่มีคนดูแล</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id} className="text-xs">
                {s.name}{s.id === currentUserId ? ' (คุณ)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
