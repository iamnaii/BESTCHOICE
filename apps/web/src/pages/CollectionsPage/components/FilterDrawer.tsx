import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider, SliderThumb } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import type {
  LastContactedOption,
  LineResponseOption,
  MdmStateOption,
  OverdueBucketOption,
  QueueFilterState,
} from '../hooks/useQueueFilter';

interface FilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filter: QueueFilterState;
  onApply: (next: QueueFilterState) => void;
  onReset: () => void;
  liveCount?: number;
}

const BUCKETS: OverdueBucketOption[] = ['1-7', '8-30', '31-60', '61-90', '90+'];
const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'OVERDUE', label: 'OVERDUE' },
  { value: 'DEFAULT', label: 'DEFAULT' },
  { value: 'TERMINATED', label: 'TERMINATED' },
];
const PRODUCTS: Array<{ value: string; label: string }> = [
  { value: 'PHONE_NEW', label: 'มือถือใหม่' },
  { value: 'PHONE_USED', label: 'มือถือมือสอง' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

const LAST_CONTACTED: Array<{ value: LastContactedOption | 'any'; label: string }> = [
  { value: 'any', label: 'ทั้งหมด' },
  { value: 'today', label: 'วันนี้' },
  { value: 'this_week', label: 'ภายใน 7 วัน' },
  { value: 'never', label: 'ไม่เคยแตะ' },
  { value: 'over_7_days', label: 'ไม่แตะ >7 วัน' },
];

const LINE_RESPONSE: Array<{ value: LineResponseOption | 'any'; label: string }> = [
  { value: 'any', label: 'ทั้งหมด' },
  { value: 'no_line', label: 'ไม่มี LINE' },
  { value: 'responded', label: 'ตอบ' },
  { value: 'ignored', label: 'เพิกเฉย' },
  { value: 'blocked', label: 'ถูกบล็อก' },
];

const MDM_OPTIONS: Array<{ value: MdmStateOption | 'any'; label: string }> = [
  { value: 'any', label: 'ทั้งหมด' },
  { value: 'not_locked', label: 'ยังไม่ล็อค' },
  { value: 'pending', label: 'รออนุมัติ' },
  { value: 'locked', label: 'ล็อคแล้ว' },
];

const OUTSTANDING_MIN = 0;
const OUTSTANDING_MAX = 100000;
const OUTSTANDING_STEP = 500;

export default function FilterDrawer({
  open,
  onOpenChange,
  filter,
  onApply,
  onReset,
  liveCount,
}: FilterDrawerProps) {
  const { user } = useAuth();
  const canPickBranch = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const [draft, setDraft] = useState<QueueFilterState>(filter);

  // Reset draft whenever the drawer is (re)opened or external filter changes
  useEffect(() => {
    if (open) setDraft(filter);
  }, [open, filter]);

  const toggleArrayValue = <K extends keyof QueueFilterState>(key: K, value: string) => {
    const current = (draft[key] as unknown as string[] | undefined) ?? [];
    const next = current.includes(value)
      ? current.filter((x) => x !== value)
      : [...current, value];
    // `key` constrains the value type, but TS can't narrow `string[]` back to
    // the specific union (e.g. OverdueBucket[]) without per-key branching. Cast
    // through `unknown` is intentional — the source values come from typed
    // option lists upstream so the runtime shape matches the field union.
    setDraft({
      ...draft,
      [key]: next.length ? (next as unknown as QueueFilterState[K]) : undefined,
    });
  };

  const minOut = draft.minOutstanding ?? OUTSTANDING_MIN;
  const maxOut = draft.maxOutstanding ?? OUTSTANDING_MAX;

  const handleApply = () => {
    onApply(draft);
    onOpenChange(false);
  };

  const handleLocalReset = () => {
    setDraft({});
    onReset();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0"
        aria-describedby={undefined}
      >
        <SheetHeader>
          <SheetTitle>ตัวกรอง</SheetTitle>
        </SheetHeader>

        <SheetBody className="flex-1 overflow-y-auto px-6">
          <Accordion type="multiple" defaultValue={['who', 'state', 'activity']}>
            {/* Section 1: WHO */}
            <AccordionItem value="who">
              <AccordionTrigger>ผู้ดูแล</AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <RadioGroup
                  value={draft.assigned ?? 'any'}
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      assigned: v === 'any' ? undefined : (v as 'self' | 'unassigned'),
                    })
                  }
                  className="space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="any" id="assigned-any" />
                    <Label htmlFor="assigned-any" className="cursor-pointer">
                      ทั้งหมด
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="self" id="assigned-self" />
                    <Label htmlFor="assigned-self" className="cursor-pointer">
                      ของฉัน
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="unassigned" id="assigned-unassigned" />
                    <Label htmlFor="assigned-unassigned" className="cursor-pointer">
                      ยังไม่ assign
                    </Label>
                  </div>
                </RadioGroup>

                {canPickBranch && (
                  <div className="space-y-1.5">
                    <Label htmlFor="branchId">สาขา (ID)</Label>
                    <input
                      id="branchId"
                      type="text"
                      value={draft.branchId ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, branchId: e.target.value || undefined })
                      }
                      placeholder="ว่าง = ทุกสาขา"
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                    />
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Section 2: CONTRACT STATE */}
            <AccordionItem value="state">
              <AccordionTrigger>สถานะสัญญา</AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div>
                  <Label>ช่วงวันค้างชำระ</Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {BUCKETS.map((b) => {
                      const active = draft.overdueBuckets?.includes(b) ?? false;
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => toggleArrayValue('overdueBuckets', b)}
                          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-muted text-muted-foreground hover:bg-accent'
                          }`}
                        >
                          {b} วัน
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label>ยอดค้าง (฿)</Label>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {minOut.toLocaleString()} – {maxOut === OUTSTANDING_MAX ? '100,000+' : maxOut.toLocaleString()}
                    </span>
                  </div>
                  <Slider
                    className="mt-3"
                    min={OUTSTANDING_MIN}
                    max={OUTSTANDING_MAX}
                    step={OUTSTANDING_STEP}
                    value={[minOut, maxOut]}
                    onValueChange={(v) => {
                      const [lo, hi] = v;
                      setDraft({
                        ...draft,
                        minOutstanding: lo === OUTSTANDING_MIN ? undefined : lo,
                        maxOutstanding: hi === OUTSTANDING_MAX ? undefined : hi,
                      });
                    }}
                  >
                    <SliderThumb aria-label="ยอดค้างต่ำสุด" />
                    <SliderThumb aria-label="ยอดค้างสูงสุด" />
                  </Slider>
                </div>

                <div>
                  <Label>สถานะ</Label>
                  <div className="mt-2 space-y-1.5">
                    {STATUSES.map((s) => {
                      const active = draft.contractStatuses?.includes(s.value) ?? false;
                      return (
                        <div key={s.value} className="flex items-center gap-2">
                          <Checkbox
                            id={`status-${s.value}`}
                            checked={active}
                            onCheckedChange={() => toggleArrayValue('contractStatuses', s.value)}
                          />
                          <Label htmlFor={`status-${s.value}`} className="cursor-pointer">
                            {s.label}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label>ประเภทสินค้า</Label>
                  <div className="mt-2 space-y-1.5">
                    {PRODUCTS.map((p) => {
                      const active = draft.productTypes?.includes(p.value) ?? false;
                      return (
                        <div key={p.value} className="flex items-center gap-2">
                          <Checkbox
                            id={`product-${p.value}`}
                            checked={active}
                            onCheckedChange={() => toggleArrayValue('productTypes', p.value)}
                          />
                          <Label htmlFor={`product-${p.value}`} className="cursor-pointer">
                            {p.label}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="minLetterCount">จดหมายที่ส่งขั้นต่ำ</Label>
                  <input
                    id="minLetterCount"
                    type="number"
                    min={0}
                    value={draft.minLetterCount ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        minLetterCount: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="ว่าง = ไม่กรอง"
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Section 3: ACTIVITY & RISK */}
            <AccordionItem value="activity">
              <AccordionTrigger>กิจกรรม & ความเสี่ยง</AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div>
                  <Label>ติดต่อล่าสุด</Label>
                  <RadioGroup
                    className="mt-2 space-y-1.5"
                    value={draft.lastContacted ?? 'any'}
                    onValueChange={(v) =>
                      setDraft({
                        ...draft,
                        lastContacted:
                          v === 'any' ? undefined : (v as LastContactedOption),
                      })
                    }
                  >
                    {LAST_CONTACTED.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <RadioGroupItem value={opt.value} id={`lc-${opt.value}`} />
                        <Label htmlFor={`lc-${opt.value}`} className="cursor-pointer">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div>
                  <Label>การตอบรับ LINE</Label>
                  <RadioGroup
                    className="mt-2 space-y-1.5"
                    value={draft.lineResponse ?? 'any'}
                    onValueChange={(v) =>
                      setDraft({
                        ...draft,
                        lineResponse:
                          v === 'any' ? undefined : (v as LineResponseOption),
                      })
                    }
                  >
                    {LINE_RESPONSE.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <RadioGroupItem value={opt.value} id={`lr-${opt.value}`} />
                        <Label htmlFor={`lr-${opt.value}`} className="cursor-pointer">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="minBrokenPromise">นัดผิดขั้นต่ำ</Label>
                  <input
                    id="minBrokenPromise"
                    type="number"
                    min={0}
                    value={draft.minBrokenPromise ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        minBrokenPromise:
                          e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                    placeholder="ว่าง = ไม่กรอง"
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <Label>สถานะ MDM</Label>
                  <RadioGroup
                    className="mt-2 space-y-1.5"
                    value={draft.mdmState ?? 'any'}
                    onValueChange={(v) =>
                      setDraft({
                        ...draft,
                        mdmState: v === 'any' ? undefined : (v as MdmStateOption),
                      })
                    }
                  >
                    {MDM_OPTIONS.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <RadioGroupItem value={opt.value} id={`mdm-${opt.value}`} />
                        <Label htmlFor={`mdm-${opt.value}`} className="cursor-pointer">
                          {opt.label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="hasActivePromise"
                      checked={draft.hasActivePromise === true}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          hasActivePromise: checked ? true : undefined,
                        })
                      }
                    />
                    <Label htmlFor="hasActivePromise" className="cursor-pointer">
                      มีนัดชำระที่ยังไม่หมดอายุ
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="showSkipTracing"
                      checked={!!draft.showSkipTracing}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          showSkipTracing: checked ? true : undefined,
                        })
                      }
                    />
                    <Label htmlFor="showSkipTracing" className="cursor-pointer">
                      ต้องหาเบอร์ใหม่เท่านั้น
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="slipReviewPending"
                      checked={!!draft.slipReviewPending}
                      onCheckedChange={(checked) =>
                        setDraft({
                          ...draft,
                          slipReviewPending: checked ? true : undefined,
                        })
                      }
                    />
                    <Label htmlFor="slipReviewPending" className="cursor-pointer">
                      รอยืนยันสลิป
                    </Label>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Section 4: CUSTOMER TAGS (P3 Task 8 — C1 frontend) */}
            <AccordionItem value="tags">
              <AccordionTrigger>tags ลูกค้า</AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                <div>
                  <Label>เลือก tags</Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(['VIP', 'HIGH_RISK', 'NEW', 'LOYAL', 'BLACKLIST'] as const).map(
                      (t) => {
                        const active = draft.customerTags?.includes(t) ?? false;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => toggleArrayValue('customerTags', t)}
                            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-muted text-muted-foreground hover:bg-accent'
                            }`}
                          >
                            {t === 'HIGH_RISK'
                              ? 'เสี่ยงสูง'
                              : t === 'NEW'
                              ? 'ลูกค้าใหม่'
                              : t === 'LOYAL'
                              ? 'ลูกค้าประจำ'
                              : t}
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>

                {draft.customerTags?.length ? (
                  <div>
                    <Label>โหมดการกรอง</Label>
                    <RadioGroup
                      className="mt-2 space-y-1.5"
                      value={draft.tagFilterMode ?? 'include'}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          tagFilterMode: v as 'include' | 'exclude',
                        })
                      }
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="include" id="tag-mode-include" />
                        <Label htmlFor="tag-mode-include" className="cursor-pointer">
                          เฉพาะลูกค้าที่มี tags ที่เลือก
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="exclude" id="tag-mode-exclude" />
                        <Label htmlFor="tag-mode-exclude" className="cursor-pointer">
                          ซ่อนลูกค้าที่มี tags ที่เลือก
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </SheetBody>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={handleLocalReset} className="flex-1 sm:flex-none">
            ล้าง
          </Button>
          <div className="flex-1 text-center text-xs text-muted-foreground leading-snug">
            {liveCount !== undefined ? `ปัจจุบันแสดง ${liveCount.toLocaleString()} แถว` : ''}
          </div>
          <Button onClick={handleApply} className="flex-1 sm:flex-none">
            ใช้ตัวกรอง
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
