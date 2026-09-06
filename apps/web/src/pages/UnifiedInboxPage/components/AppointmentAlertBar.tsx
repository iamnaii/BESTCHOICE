import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowRight, Check, Clock } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { apptState } from './appointment';
import { NOTIFICATION_SOUND_URL } from './notification-sound';

/**
 * แถบเตือน "ถึงเวลานัด" เหนือทุกแผง (ชั้น 2 — ท่า OBI apptAlert P3-6)
 * - โผล่เมื่อนัดใกล้ถึง ≤15 นาที (เหลือง) หรือถึง/เลยเวลา (แดง)
 * - แสดงทีละนัดที่ใกล้สุด + "อีก n นัด" — ไม่ยิงพร้อมกันทั้งวัน (คนจะปิดเสียงแล้วกดข้าม)
 * - "เตือนอีก 10 นาที" = พักแถบเฉพาะเครื่องนี้ ไม่ใช่เลื่อนนัด (เวลานัดจริงไม่ขยับ)
 * - ชื่อแท็บกะพริบ + เสียง 1 ครั้งต่อนัด เมื่อถึง/เลยเวลา — เห็นได้แม้สลับไปแท็บอื่น
 * - ถึงคนที่ไม่ได้เปิดหน้าเว็บ (ชั้น 3) ยังไม่ทำ (เจ้าของเลือก 1+2 ก่อน 2026-09-06)
 */
export interface DueAppointment {
  id: string;
  title: string;
  dueDate: string;
  status: string;
  roomId: string;
  room?: { id: string; displayName?: string | null; customer?: { name?: string | null } | null } | null;
}

const SNOOZE_MIN = 10;
const BLINK_MS = 1400;
const TICK_MS = 30_000;

export default function AppointmentAlertBar({ onGoToRoom }: { onGoToRoom: (roomId: string) => void }) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});

  const dueQuery = useQuery({
    queryKey: ['appointments-due'],
    queryFn: () => api.get('/staff-chat/appointments/due').then((r) => (Array.isArray(r.data) ? r.data : (r.data?.data ?? [])) as DueAppointment[]),
    refetchInterval: 60_000,
  });

  const items = useMemo(() => {
    const at = new Date(now);
    return (dueQuery.data ?? [])
      .map((t) => ({ t, st: apptState(t.dueDate, at) }))
      .filter((x): x is { t: DueAppointment; st: NonNullable<ReturnType<typeof apptState>> } => !!x.st?.urgent)
      .filter((x) => !(snoozed[x.t.id] && snoozed[x.t.id] > now));
  }, [dueQuery.data, now, snoozed]);
  const head = items[0];

  const doneMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/todos/${id}`, { status: 'DONE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments-due'] });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
    },
  });

  // เสียงครั้งเดียวต่อนัด ตอนเข้าสถานะถึง/เลยเวลา
  const played = useRef(new Set<string>());
  useEffect(() => {
    for (const { t, st } of items) {
      if ((st.kind === 'due' || st.kind === 'overdue') && !played.current.has(t.id)) {
        played.current.add(t.id);
        try {
          const audio = new Audio(NOTIFICATION_SOUND_URL);
          audio.volume = 0.4;
          audio.play().catch(() => {});
        } catch {
          /* เบราว์เซอร์ไม่ให้เล่นเสียงก่อนผู้ใช้แตะหน้า — ยังมีแถบ+ชื่อแท็บกะพริบ */
        }
      }
    }
  }, [items]);

  // ชื่อแท็บกะพริบขณะมีนัดถึง/เลยเวลา
  const headId = head?.t.id;
  const headKind = head?.st.kind;
  useEffect(() => {
    if (!headId || (headKind !== 'due' && headKind !== 'overdue')) return;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? '🔔 ถึงเวลานัด' : original;
    }, BLINK_MS);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [headId, headKind]);

  if (!head) return null;
  const danger = head.st.kind !== 'soon';
  const who = head.t.room?.customer?.name || head.t.room?.displayName || 'ลูกค้า';
  const btn = cn(
    'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold transition-colors',
    danger ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-black/10 hover:bg-black/15 text-amber-950',
  );
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="appointment-alert"
      className={cn(
        'flex items-center gap-3 border-b px-4 py-1.5 text-[13px]',
        danger ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-warning bg-warning text-amber-950',
      )}
    >
      <AlarmClock className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{head.st.label}</span> · {head.t.title} · {who}
        {items.length > 1 && <span className="opacity-80"> · +อีก {items.length - 1} นัด</span>}
      </span>
      <button type="button" className={btn} onClick={() => setSnoozed((s) => ({ ...s, [head.t.id]: Date.now() + SNOOZE_MIN * 60_000 }))} title="พักแถบเตือนนี้ 10 นาที (เวลานัดไม่ขยับ)">
        <Clock className="size-3.5" /> เตือนอีก {SNOOZE_MIN} นาที
      </button>
      <button type="button" className={btn} onClick={() => onGoToRoom(head.t.roomId)}>
        ไปที่ห้อง <ArrowRight className="size-3.5" />
      </button>
      <button type="button" className={btn} disabled={doneMutation.isPending} onClick={() => doneMutation.mutate(head.t.id)} title="ทำเครื่องหมายว่านัดนี้เสร็จแล้ว">
        <Check className="size-3.5" /> เสร็จสิ้น
      </button>
    </div>
  );
}
