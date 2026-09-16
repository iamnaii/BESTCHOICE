import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { JOURNEY_HEARD_FROM_LABELS, type JourneyHeardFrom } from '@installment/shared';
import { deleteJourneyEntry, undoToastOptions, useRecordJourneyEntry } from '@/hooks/customer-journey/journeyEntries';
import { isJourneyRedirect, useJourneySummary } from '@/hooks/customer-journey/useCustomerJourney';
import { getErrorMessage } from '@/lib/api';
import { uid } from '@/utils/uid';
import { HeardFromChips } from './HeardFromChips';

const BOX_CLASS = {
  banner: 'rounded-lg border border-primary/20 bg-primary/5 p-3',
  card: 'mt-4 rounded-xl border border-border bg-card p-4',
} as const;

const LINE_CLASS = {
  banner: 'flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-snug',
  card: 'mt-4 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-snug',
} as const;

interface Answered {
  entryId: string;
  code: JourneyHeardFrom;
  /** ลิงก์ "เลิกทำ" ใช้ได้ตราบที่ toast "บันทึกแล้ว" ยังอยู่ */
  linkLive: boolean;
}

export interface HeardFromAskProps {
  customerId: string;
  /** banner = บนสุดของแท็บการเดินทาง · card = ขั้นเลือกลูกค้าของสร้างสัญญา */
  variant: 'banner' | 'card';
  onSkip: () => void;
}

/**
 * ถาม "ลูกค้ารู้จักร้านจากไหน" — แตะชิป = บันทึก HEARD_FROM ทันที (คำตัดสินเจ้าของ 2026-09-15 ข้อ 3, 12)
 * - แสดงเฉพาะเมื่อ API ตั้งธง askHeardFrom (ลูกค้าหน้าร้านที่ยังไม่ตอบ) — เว็บไม่คิดกติกาเอง ระบบไม่เดาคำตอบให้
 * - อ่านธงที่นี่ ไม่ใช่ที่ผู้วาง: onSuccess ของ POST เขียน askHeardFrom=false ลงแคชก่อนบรรทัดยุบจะได้วาด
 *   ถ้าผู้วางตัดสินจากธงเอง คอมโพเนนต์จะถูกถอดทิ้งก่อนแสดง "ลูกค้าบอกว่ารู้จักร้านจาก… · เลิกทำ"
 * - callback ของ toast ใช้แค่ ref + deleteJourneyEntry ⇒ กดเลิกทำหลังแท็บถูก unmount ก็ยังลบได้ (outline D12)
 */
export default function HeardFromAsk({ customerId, variant, onSkip }: HeardFromAskProps) {
  const queryClient = useQueryClient();
  const { data } = useJourneySummary(customerId);
  const record = useRecordJourneyEntry(customerId);
  const [pendingCode, setPendingCode] = useState<JourneyHeardFrom | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [undoing, setUndoing] = useState(false);
  const pendingRef = useRef(false);
  const undoingRef = useRef(false);
  const toastIdRef = useRef<string | number | undefined>(undefined);

  const asking = !!data && !isJourneyRedirect(data) && data.askHeardFrom;

  /** toast ปิด (หมดเวลา / กดปิด / ปัดทิ้ง): แบนเนอร์หาย · การ์ดคงบรรทัดแต่ถอดลิงก์ — ข้ามระหว่างกำลังเลิกทำ กันกระพริบ */
  function closeLink(entryId: string) {
    if (undoingRef.current) return;
    setAnswered((current) => {
      if (!current || current.entryId !== entryId) return current;
      return variant === 'banner' ? null : { ...current, linkLive: false };
    });
  }

  async function undo(entryId: string, fromToast: boolean) {
    if (undoingRef.current) return;
    undoingRef.current = true;
    setUndoing(true);
    // จากลิงก์ในการ์ด/แบนเนอร์: ปิด toast ด้วย ไม่ให้เหลือปุ่มเลิกทำที่ไม่มีอะไรให้ลบ · จาก toast: sonner ปิดเองแล้ว
    // mock ของเทสคืน undefined — ห้ามเรียก dismiss(undefined) เพราะ sonner จะปิด toast ทุกใบ
    if (!fromToast && toastIdRef.current !== undefined) toast.dismiss(toastIdRef.current);
    try {
      await deleteJourneyEntry(queryClient, customerId, entryId);
      // summary จาก DELETE ตั้ง askHeardFrom กลับเป็นจริง ⇒ ชิปกลับมา
      setAnswered((current) => (current?.entryId === entryId ? null : current));
    } catch {
      // deleteJourneyEntry แจ้ง toast.error เองแล้ว · คำตอบยังอยู่ ⇒ ถอดลิงก์ (แบนเนอร์หาย การ์ดคงบรรทัด)
      setAnswered((current) => {
        if (!current || current.entryId !== entryId) return current;
        return variant === 'banner' ? null : { ...current, linkLive: false };
      });
    } finally {
      undoingRef.current = false;
      setUndoing(false);
    }
  }

  async function save(code: JourneyHeardFrom) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPendingCode(code);
    try {
      // UUID ต่อการแตะหนึ่งครั้ง — กดซ้ำจากเครือข่ายช้า server dedupe ให้ (outline D8)
      const res = await record.mutateAsync({ kind: 'HEARD_FROM', heardFrom: code, clientRequestId: uid() });
      const entryId = res.entryId;
      if (entryId) {
        setAnswered({ entryId, code, linkLive: true });
        // toast ชุดกลาง (Task 10) — ลิงก์ "เลิกทำ" มีอายุเท่า toast (JOURNEY_UNDO_TOAST_MS) · onUndo ให้ undo() ถอดบรรทัดยุบด้วย
        toastIdRef.current = toast.success('บันทึกแล้ว', {
          ...undoToastOptions(queryClient, customerId, entryId, () => void undo(entryId, true)),
          onAutoClose: () => closeLink(entryId),
          onDismiss: () => closeLink(entryId),
        });
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      pendingRef.current = false;
      setPendingCode(null);
    }
  }

  if (answered) {
    return (
      <div data-testid="heard-from-ask" className={LINE_CLASS[variant]}>
        <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>
          ลูกค้าบอกว่ารู้จักร้านจาก<span className="font-medium">{JOURNEY_HEARD_FROM_LABELS[answered.code]}</span>
        </span>
        {answered.linkLive && (
          <>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              disabled={undoing}
              onClick={() => void undo(answered.entryId, false)}
              className="text-xs leading-snug text-primary hover:underline disabled:opacity-60"
            >
              เลิกทำ
            </button>
          </>
        )}
      </div>
    );
  }

  // ระหว่างรอผลคงชิปไว้ แม้แคชจะพลิก askHeardFrom เป็น false ไปก่อนแล้ว (กันกระพริบ)
  if (!asking && pendingCode === null) return null;

  return (
    <div data-testid="heard-from-ask" className={BOX_CLASS[variant]}>
      <HeardFromChips
        value={null}
        onSelect={(code) => {
          if (code) void save(code);
        }}
        pendingCode={pendingCode ?? undefined}
        disabled={pendingCode !== null}
        onSkip={onSkip}
        skipStyle={variant === 'banner' ? 'ghost-button' : 'text'}
      />
    </div>
  );
}
