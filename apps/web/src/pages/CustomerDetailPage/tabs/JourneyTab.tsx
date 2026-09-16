import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { JourneyEvent, JourneyListResponse, JourneySummary } from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import { EventTimeline, type EventTimelineItem } from '@/components/timeline/EventTimeline';
import { Button } from '@/components/ui/button';
import HeardFromAsk from '@/components/customer/journey/HeardFromAsk';
import { isHeardFromSkipped, markHeardFromSkipped } from '@/components/customer/journey/journeyStorage';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useDeleteJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { isJourneyRedirect, useCustomerJourney } from '@/hooks/customer-journey/useCustomerJourney';
import { cn } from '@/lib/utils';
import TimelineFilterChips, { type TimelineChip } from '@/pages/CollectionsPage/components/TimelineFilterChips';
import RecordContactChooser from '../components/RecordContactChooser';
import { allChipNote, journeyEventSubtitle, journeyGroupLabel, journeyGroupsForRole } from '../utils/journeyGroups';

const ALL_CHIP = 'ALL';

/** แถวไทม์ไลน์ + ข้อมูลเลิกทำของแถวบันทึกมือ (Task 8: entryId/canDelete มาจากเซิร์ฟเวอร์ — เว็บคำนวณช่วง 24 ชม. เองไม่ได้) */
type JourneyTimelineItem = EventTimelineItem & { entryId?: string; canDelete?: boolean };

/** ส่งเข้าไทม์ไลน์กลางเฉพาะฟิลด์ที่แสดง — ตัด metadata ทิ้ง (PDPA) · ผู้ทำต่อท้าย subtitle · ป้าย "ประมาณ" มาจาก reliability */
function toTimelineItem(event: JourneyEvent): JourneyTimelineItem {
  return {
    id: event.id,
    type: event.type,
    group: event.group,
    timestamp: event.timestamp,
    title: event.title,
    subtitle: journeyEventSubtitle(event) || undefined,
    reliability: event.reliability,
    href: event.href,
    entryId: event.entryId,
    canDelete: event.canDelete,
  };
}

function NotRecordedList({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium leading-snug text-muted-foreground hover:text-foreground"
        >
          <span>ระบบยังไม่เก็บ ({items.length})</span>
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="border-t border-border px-3 pt-2 text-xs leading-snug text-muted-foreground">
          เรื่องเหล่านี้ระบบยังไม่ได้บันทึก จึงไม่ปรากฏในการเดินทางด้านบน
        </p>
        <ul className="list-disc space-y-1 py-2 pl-7 pr-3 text-xs leading-snug text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface JourneyTabProps {
  customerId: string;
  role: string;
  /** summary ของหน้า (key เดียวกับแถบขั้น) — null = ยังโหลด/ผิดพลาด */
  summary: JourneySummary | null;
  /** บทบาทที่ POST/DELETE บันทึกมือได้ (canRecordJourney) — ฝ่ายบัญชีไม่เห็นปุ่มใด ๆ */
  canRecord: boolean;
}

export default function JourneyTab({ customerId, role, summary, canRecord }: JourneyTabProps) {
  const visibleGroups = useMemo(() => journeyGroupsForRole(role), [role]);
  const [filter, setFilter] = useState<string>(ALL_CHIP);
  // แถบถามรู้จักร้านจากไหน: "ข้าม" = ซ่อนทั้ง session ต่อลูกค้า (sessionStorage)
  // ถือชุด id ในหน่วยความจำด้วย — storage เขียนไม่ได้ (โหมดส่วนตัว) แถบก็ยังหายทันที · ธง askHeardFrom อ่านใน HeardFromAsk
  const [heardFromSkippedIds, setHeardFromSkippedIds] = useState<ReadonlySet<string>>(() => new Set());
  const heardFromSkipped = heardFromSkippedIds.has(customerId) || isHeardFromSkipped(customerId);
  const groups = useMemo(() => {
    const picked = visibleGroups.find((group) => group === filter);
    return picked ? [picked] : null;
  }, [filter, visibleGroups]);
  // ตัวเลขบนชิปต้องใช้ counts ของหน้าแรก — การ์ดภาพรวมไม่ขอ จึงไม่จ่ายค่าสแกน
  const query = useCustomerJourney(customerId, groups, { include: 'counts' });
  const deleteEntry = useDeleteJourneyEntry(customerId);

  const chips = useMemo<TimelineChip[]>(
    () => [
      { value: ALL_CHIP, label: 'ทั้งหมด' },
      ...visibleGroups.map((group) => ({ value: group, label: journeyGroupLabel(group) })),
    ],
    [visibleGroups],
  );

  const pages = (query.data?.pages ?? []).filter((page): page is JourneyListResponse => !isJourneyRedirect(page));
  const first: JourneyListResponse | undefined = pages[0];
  const items = pages.flatMap((page) => page.events.map(toTimelineItem));
  const note = filter === ALL_CHIP ? allChipNote(role) : null;

  // API ตอบหน้าว่างที่ยังมี nextCursor ได้ — EventTimeline วาด footer (ปุ่มโหลดเพิ่ม) เฉพาะเมื่อมีรายการ
  // จึงดึงหน้าถัดไปเองจนเจอรายการหรือหมด cursor · ตัดสินจาก cursor (hasNextPage) เท่านั้น ไม่ถือว่าหน้าว่าง = จบ
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  const emptyWithCursor = items.length === 0 && hasNextPage && !isError;
  useEffect(() => {
    if (emptyWithCursor && !isFetchingNextPage) void fetchNextPage();
  }, [emptyWithCursor, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex flex-col gap-3">
      {canRecord && !heardFromSkipped && (
        <HeardFromAsk
          key={customerId}
          customerId={customerId}
          variant="banner"
          onSkip={() => {
            markHeardFromSkipped(customerId);
            setHeardFromSkippedIds((ids) => new Set(ids).add(customerId));
          }}
        />
      )}
      <div className="flex flex-col gap-1">
        {/* Q16: ปุ่มอยู่แถวของตัวเองชิดขวาเหนือชิปกรอง — ชิปกรองทั้งแถวอยู่บรรทัดเดียวที่ 1440 */}
        {canRecord && (
          <div className="flex justify-end">
            <RecordContactChooser customerId={customerId} summary={summary} />
          </div>
        )}
        <TimelineFilterChips chips={chips} value={filter} onChange={setFilter} counts={first?.counts} />
        {note && <p className="text-xs leading-snug text-muted-foreground">{note}</p>}
      </div>

      <QueryBoundary
        isLoading={query.isLoading || emptyWithCursor}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        errorTitle="โหลดการเดินทางของลูกค้าไม่สำเร็จ"
      >
        <EventTimeline
          events={items}
          emptyText={filter === ALL_CHIP ? 'ยังไม่มีกิจกรรม' : 'ยังไม่มีกิจกรรมในกลุ่มนี้'}
          renderExtra={(event) => {
            // Q18: ลิงก์ตาม canDelete — OWNER/ผจก.สาขา ทุกเวลา · ผจก.การเงิน/พนง.ขาย ของตัวเองภายใน 24 ชม.
            const entryId = event.entryId;
            if (!canRecord || !event.canDelete || !entryId) return null;
            return (
              <button
                type="button"
                className="text-xs leading-snug text-primary hover:underline"
                disabled={deleteEntry.isPending}
                onClick={() => deleteEntry.mutate(entryId)}
              >
                เลิกทำ
              </button>
            );
          }}
          footer={
            query.hasNextPage ? (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="leading-snug"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
                </Button>
              </div>
            ) : null
          }
        />
      </QueryBoundary>

      {first && first.notRecorded.length > 0 && <NotRecordedList items={first.notRecorded} />}
    </div>
  );
}
