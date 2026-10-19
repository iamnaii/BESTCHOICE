import { useId, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

const TABS = [
  { key: 'waiting', label: 'รอตอบ' },
  { key: 'mine', label: 'ของฉัน' },
  { key: 'all', label: 'ทั้งหมด' },
] as const;

export const CHANNELS = [
  { key: 'FACEBOOK', label: 'Facebook' },
  { key: 'LINE_FINANCE', label: 'LINE การเงิน' },
  { key: 'LINE_SHOP', label: 'LINE ร้าน' },
  { key: 'TIKTOK', label: 'TikTok' },
  { key: 'WEB', label: 'เว็บ' },
] as const;

export type InboxTab = 'waiting' | 'mine' | 'all';
export type WhoFilter = 'all' | 'free' | (string & {});
export interface StaffOption {
  id: string;
  name: string;
}

const ALL = '__all__';
const FREE = '__free__';

interface FilterValues {
  channel: string | null;
  who: WhoFilter;
}
interface ChannelFilterProps extends FilterValues {
  activeTab: InboxTab;
  onApply: (values: FilterValues) => void;
  staff: StaffOption[];
  currentUserId?: string;
  channelCounts?: Record<string, number>;
}

export function InboxTabs({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  counts: { mine: number; waiting: number };
}) {
  return (
    <div className="inbox-queue-tabs" role="group" aria-label="มุมมองแชท">
      {TABS.map((tab) => {
        const count = tab.key === 'all' ? undefined : counts[tab.key];
        return (
          <button
            type="button"
            data-ui-control="button"
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            aria-pressed={activeTab === tab.key}
          >
            {tab.label}
            {count !== undefined && count > 0 && (
              <span
                className="inbox-tab-count"
                aria-label={`${count.toLocaleString('th-TH')} ห้อง`}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ownerLabel(who: WhoFilter, staff: StaffOption[], currentUserId?: string) {
  if (who === 'all') return 'ทุกคน';
  if (who === 'free') return 'ยังไม่มีผู้ดูแล';
  if (who === currentUserId) return 'คุณ';
  return staff.find((person) => person.id === who)?.name ?? 'ผู้ดูแลที่เลือก';
}

export function ActiveInboxFilters({
  activeTab,
  channel,
  who,
  staff,
  currentUserId,
  onApply,
}: ChannelFilterProps) {
  const chips = [
    ...(channel
      ? [{ key: 'channel', label: CHANNELS.find((item) => item.key === channel)?.label ?? channel }]
      : []),
    ...(activeTab !== 'mine' && who !== 'all'
      ? [{ key: 'who', label: ownerLabel(who, staff, currentUserId) }]
      : []),
  ];
  if (!chips.length) return null;
  return (
    <div className="inbox-active-filters" aria-label="ตัวกรองที่ใช้">
      {chips.map((chip) => (
        <button
          type="button"
          data-ui-control="button"
          key={chip.key}
          aria-label={`ล้างตัวกรอง ${chip.label}`}
          onClick={() =>
            onApply({
              channel: chip.key === 'channel' ? null : channel,
              who: chip.key === 'who' ? 'all' : who,
            })
          }
        >
          <span>{chip.label}</span>
          <X className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export default function ChannelFilter({
  activeTab,
  channel,
  who,
  onApply,
  staff,
  currentUserId,
  channelCounts,
}: ChannelFilterProps) {
  const [open, setOpen] = useState(false);
  const [draftChannel, setDraftChannel] = useState(channel);
  const [draftWho, setDraftWho] = useState(who);
  const id = useId();
  const mineTab = activeTab === 'mine';
  const activeCount = Number(channel !== null) + Number(!mineTab && who !== 'all');
  // Keep the selected channel available when a live refresh changes the counts.
  const visibleChannels = CHANNELS.filter(
    (item) =>
      !channelCounts ||
      (channelCounts[item.key] ?? 0) > 0 ||
      item.key === channel ||
      item.key === draftChannel,
  );
  const totalInTab = channelCounts
    ? Object.values(channelCounts).reduce((a, b) => a + b, 0)
    : undefined;
  const channelOptions = [
    { key: ALL, label: 'ทั้งหมด', count: totalInTab },
    ...visibleChannels.map((item) => ({ ...item, count: channelCounts?.[item.key] })),
  ];
  const unknownOwner =
    draftWho !== 'all' && draftWho !== 'free' && !staff.some((person) => person.id === draftWho);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setDraftChannel(channel);
          setDraftWho(who);
        }
        setOpen(value);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          data-ui-control="button"
          data-ui-icon="true"
          className={cn(
            'inbox-queue-icon inbox-filter-trigger',
            activeCount > 0 && 'inbox-filter-active',
          )}
          aria-label="ตัวกรองแชท"
          aria-describedby={activeCount > 0 ? `${id}-active-count` : undefined}
          title="ตัวกรองแชท"
        >
          <SlidersHorizontal className="size-5" aria-hidden="true" />
          {activeCount > 0 && (
            <span className="inbox-filter-count" id={`${id}-active-count`}>
              <span className="sr-only">ใช้ </span>
              {activeCount}
              <span className="sr-only"> ตัวกรอง</span>
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="inbox-filter-dialog">
        <div className="inbox-filter-handle" aria-hidden="true" />
        <DialogHeader className="text-start">
          <DialogTitle>ตัวกรองแชท</DialogTitle>
          <DialogDescription>เลือกช่องทางและผู้ดูแลที่ต้องการดู</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onApply({ channel: draftChannel, who: mineTab ? 'all' : draftWho });
            setOpen(false);
          }}
        >
          <fieldset className="min-w-0">
            <legend className="mb-3 text-sm font-medium">ช่องทาง</legend>
            <div className="inbox-channel-options">
              {channelOptions.map((item) => (
                <label key={item.key} className="inbox-channel-option">
                  <input
                    type="radio"
                    name={`${id}-channel`}
                    value={item.key}
                    checked={(draftChannel ?? ALL) === item.key}
                    onChange={() => setDraftChannel(item.key === ALL ? null : item.key)}
                  />
                  <span>
                    <span>{item.label}</span>
                    {item.count !== undefined && (
                      <small>{item.count.toLocaleString('th-TH')}</small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-6">
            <label
              id={`${id}-owner-label`}
              htmlFor={`${id}-owner`}
              className="mb-3 block text-sm font-medium"
            >
              ผู้ดูแล
            </label>
            <Select
              value={
                mineTab ? ALL : draftWho === 'all' ? ALL : draftWho === 'free' ? FREE : draftWho
              }
              onValueChange={(value) =>
                setDraftWho(value === ALL ? 'all' : value === FREE ? 'free' : value)
              }
              disabled={mineTab}
            >
              <SelectTrigger
                id={`${id}-owner`}
                aria-labelledby={`${id}-owner-label`}
                className="w-full min-w-0"
              >
                <span className="truncate">
                  {mineTab ? 'คุณ · มุมมองของฉัน' : ownerLabel(draftWho, staff, currentUserId)}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{mineTab ? 'คุณ · มุมมองของฉัน' : 'ทุกคน'}</SelectItem>
                <SelectItem value={FREE}>ยังไม่มีผู้ดูแล</SelectItem>
                {unknownOwner && <SelectItem value={draftWho}>ผู้ดูแลที่เลือก</SelectItem>}
                {staff.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                    {person.id === currentUserId ? ' (คุณ)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="inbox-filter-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftChannel(null);
                setDraftWho('all');
              }}
            >
              ล้างตัวกรอง
            </Button>
            <Button type="submit">แสดงแชท</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
