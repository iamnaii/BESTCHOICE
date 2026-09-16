import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  JOURNEY_LOST_PROMPT_OUTCOMES,
  JOURNEY_RECORDABLE_TOUCH_CHANNELS,
  JOURNEY_TOUCH_CHANNEL_LABELS,
  JOURNEY_TOUCH_OUTCOMES,
  JOURNEY_TOUCH_OUTCOME_LABELS,
  type JourneyLostReason,
  type JourneyRecordableTouchChannel,
  type JourneySummary,
  type JourneyTouchOutcome,
} from '@installment/shared';
import { ChoiceChip, ChoiceChipRow } from '@/components/customer/journey/ChoiceChip';
import { readLastChannel, writeLastChannel } from '@/components/customer/journey/journeyStorage';
import { ResponsiveChooser } from '@/components/customer/journey/ResponsiveChooser';
import { Button } from '@/components/ui/button';
import { undoToastOptions, useRecordJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';

interface RecordContactChooserProps {
  customerId: string;
  /** null = summary ยังโหลด/ผิดพลาด → ปุ่มกดไม่ได้ */
  summary: JourneySummary | null;
}

/**
 * ปุ่ม "บันทึกการติดต่อ" ของแท็บการเดินทาง (ขอบเขตรอบ 2 ข้อ 4 — ไม่บังคับ)
 * ช่องทาง + ผลเท่านั้น · แตะผล = บันทึกทันที (เวลาเซิร์ฟเวอร์) · ไม่มีโน้ต/เวลา/ปุ่มบันทึก
 * clientRequestId ใหม่ทุกการแตะ (D8) — คำขอ MARKED_LOST ของ prompt ต้องไม่ถูก dedupe เข้ากับ TOUCHPOINT
 * ปุ่ม "เลิกทำ" ใน toast มาจาก undoToastOptions (เรียก deleteJourneyEntry ตรง — D12) — แท็บอาจ unmount ไปแล้วตอนกด
 */
export default function RecordContactChooser({ customerId, summary }: RecordContactChooserProps) {
  const queryClient = useQueryClient();
  const record = useRecordJourneyEntry(customerId);
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<JourneyRecordableTouchChannel | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<JourneyTouchOutcome | null>(null);
  const [lostReason, setLostReason] = useState<JourneyLostReason | null>(null);
  const [markingLost, setMarkingLost] = useState(false);
  const busy = pendingOutcome !== null || markingLost;

  function handleOpenChange(next: boolean) {
    if (next) {
      setChannel(readLastChannel() ?? null);
      setLostReason(null);
    }
    setOpen(next);
  }

  async function recordOutcome(outcome: JourneyTouchOutcome) {
    if (!channel || busy) return;
    setPendingOutcome(outcome);
    try {
      const res = await record.mutateAsync({ kind: 'TOUCHPOINT', channel, outcome, clientRequestId: uid() });
      writeLastChannel(channel);
      toast.success('บันทึกแล้ว', undoToastOptions(queryClient, customerId, res.entryId));
      const reason = JOURNEY_LOST_PROMPT_OUTCOMES[outcome];
      // ตัดสินจาก summary ของคำตอบ ไม่ใช่ prop ที่อาจค้าง — ลูกค้าที่ซื้อแล้วติดป้ายหลุดไม่ได้ (API 409)
      if (reason && res.summary.stage !== 'PURCHASED') setLostReason(reason);
      else setOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setPendingOutcome(null);
    }
  }

  async function confirmLost() {
    if (!lostReason || busy) return;
    setMarkingLost(true);
    try {
      const res = await record.mutateAsync({ kind: 'MARKED_LOST', lostReason, clientRequestId: uid() });
      setOpen(false);
      toast.success('ติดป้ายหลุดแล้ว', undoToastOptions(queryClient, customerId, res.entryId));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setMarkingLost(false);
    }
  }

  return (
    <ResponsiveChooser
      open={open}
      onOpenChange={handleOpenChange}
      title="บันทึกการติดต่อ"
      trigger={
        <Button variant="outline" size="sm" className="max-lg:h-11 max-lg:w-full" disabled={summary === null}>
          <Plus aria-hidden="true" />
          บันทึกการติดต่อ
        </Button>
      }
    >
      {lostReason ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-sm leading-snug">ติดป้ายหลุดไหม</span>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 text-destructive max-lg:h-11"
            disabled={markingLost}
            onClick={() => void confirmLost()}
          >
            ใช่ ติดป้ายหลุด
          </Button>
          <Button variant="ghost" size="sm" className="max-lg:h-11" disabled={markingLost} onClick={() => setOpen(false)}>
            ไม่ต้อง
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-lg:gap-4">
          <ChoiceChipRow label="ช่องทาง">
            {JOURNEY_RECORDABLE_TOUCH_CHANNELS.map((code) => (
              <ChoiceChip key={code} active={channel === code} disabled={busy} onClick={() => setChannel(code)}>
                {JOURNEY_TOUCH_CHANNEL_LABELS[code]}
              </ChoiceChip>
            ))}
          </ChoiceChipRow>
          <ChoiceChipRow label="ผล" hint={channel ? undefined : 'เลือกช่องทางก่อน'}>
            {JOURNEY_TOUCH_OUTCOMES.map((code) => (
              <ChoiceChip
                key={code}
                active={pendingOutcome === code}
                busy={pendingOutcome === code}
                disabled={!channel || busy}
                onClick={() => void recordOutcome(code)}
              >
                {JOURNEY_TOUCH_OUTCOME_LABELS[code]}
              </ChoiceChip>
            ))}
          </ChoiceChipRow>
        </div>
      )}
    </ResponsiveChooser>
  );
}
