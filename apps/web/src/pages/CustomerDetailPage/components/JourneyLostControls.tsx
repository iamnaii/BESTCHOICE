import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, UserX } from 'lucide-react';
import { toast } from 'sonner';
import {
  JOURNEY_LOST_REASONS,
  JOURNEY_LOST_REASON_LABELS,
  type JourneyLostReason,
  type JourneySummary,
} from '@installment/shared';
import { ChoiceChip, ChoiceChipRow } from '@/components/customer/journey/ChoiceChip';
import { ResponsiveChooser } from '@/components/customer/journey/ResponsiveChooser';
import { Button } from '@/components/ui/button';
import { undoToastOptions, useRecordJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';

const LOST_CHOOSER_TITLE = 'ติดป้ายหลุด — เพราะอะไร';

export interface JourneyLostControlsProps {
  customerId: string;
  summary: JourneySummary;
}

/**
 * ปุ่มท้ายแถบขั้น (คำตัดสินเจ้าของ 2026-09-15 ข้อ 4 · Q2 Q4 Q17) — ระบบปลดป้ายหลุดเองเป็นหลัก ปุ่มนี้ไม่บังคับ
 * - ยังไม่หลุด: ghost "ติดป้ายหลุด" → เลือกเหตุผล 1 ใน 5 = บันทึกทันที (ไม่มีช่องโน้ต)
 * - หลุดแล้ว: outline "เปิดใหม่" แตะเดียว ไม่มีกล่องยืนยัน — ป้าย "หลุด · เหตุผล" วาดที่แถบ (ACCOUNTANT ยังเห็น)
 * - ซื้อแล้ว: ไม่มีปุ่ม
 * clientRequestId = UUID ใหม่ทุกครั้งที่แตะ (D8) · ใช้ mutateAsync จึงไม่พึ่ง callback ต่อ mutate() ที่ถูกข้ามหลัง unmount
 */
export default function JourneyLostControls({ customerId, summary }: JourneyLostControlsProps) {
  const queryClient = useQueryClient();
  const record = useRecordJourneyEntry(customerId);
  const [open, setOpen] = useState(false);
  const [pendingReason, setPendingReason] = useState<JourneyLostReason | null>(null);
  const [reopening, setReopening] = useState(false);

  if (summary.stage === 'PURCHASED') return null;

  const markLost = async (lostReason: JourneyLostReason) => {
    if (pendingReason !== null) return;
    setPendingReason(lostReason);
    try {
      const res = await record.mutateAsync({ kind: 'MARKED_LOST', lostReason, clientRequestId: uid() });
      setOpen(false);
      // toast สำเร็จชุดกลาง (Task 10): 10 วินาที + "เลิกทำ" ที่ลบผ่าน deleteJourneyEntry ด้วย queryClient ที่จับไว้ (D12)
      toast.success('ติดป้ายหลุดแล้ว', undoToastOptions(queryClient, customerId, res.entryId));
    } catch (err) {
      // ป๊อปโอเวอร์ยังเปิดอยู่ — แตะใหม่ได้ด้วย UUID ใหม่
      toast.error(getErrorMessage(err));
    } finally {
      setPendingReason(null);
    }
  };

  const reopen = async () => {
    if (reopening) return;
    setReopening(true);
    try {
      const res = await record.mutateAsync({ kind: 'REOPENED', clientRequestId: uid() });
      // Q4 / D9: ระบบปลดป้ายไปก่อนแล้ว เซิร์ฟเวอร์ไม่เขียนแถว ⇒ ไม่มีอะไรให้เลิกทำ
      if (res.entryId) toast.success('เปิดใหม่แล้ว', undoToastOptions(queryClient, customerId, res.entryId));
      else toast.info('เปิดอยู่แล้ว');
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setReopening(false);
    }
  };

  if (summary.lost) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="max-lg:h-11"
        disabled={reopening}
        onClick={() => {
          void reopen();
        }}
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        เปิดใหม่
      </Button>
    );
  }

  return (
    <ResponsiveChooser
      open={open}
      onOpenChange={setOpen}
      title={LOST_CHOOSER_TITLE}
      trigger={
        <Button variant="ghost" size="sm" className="max-lg:h-11">
          <UserX className="size-3.5" aria-hidden="true" />
          ติดป้ายหลุด
        </Button>
      }
    >
      <ChoiceChipRow>
        {JOURNEY_LOST_REASONS.map((code) => (
          <ChoiceChip
            key={code}
            active={pendingReason === code}
            busy={pendingReason === code}
            disabled={pendingReason !== null}
            onClick={() => {
              void markLost(code);
            }}
          >
            {JOURNEY_LOST_REASON_LABELS[code]}
          </ChoiceChip>
        ))}
      </ChoiceChipRow>
    </ResponsiveChooser>
  );
}
