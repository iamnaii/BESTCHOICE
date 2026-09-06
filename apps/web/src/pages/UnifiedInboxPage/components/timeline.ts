/**
 * รวมข้อความกับโน้ตภายในเป็นไทม์ไลน์เดียว เรียงตามเวลา (สเปกแผงกลาง 2026-09-06)
 *
 * ข้อความโหลดได้แค่ 100 ล่าสุด (ไม่มี cursor ย้อนหลัง) ⇒ โน้ตที่เก่ากว่าข้อความเก่าสุดที่โหลดมา
 * จะกองอยู่บนสุดผิดบริบท จึง**ตัดโน้ตให้อยู่ในหน้าต่างเดียวกับข้อความ** — โน้ตปักหมุดเห็นจากแถบใต้หัวอยู่แล้ว
 * ถ้าไม่มีข้อความเลย (ห้องใหม่/โหลดไม่ขึ้น) แสดงโน้ตทั้งหมด
 */
export interface RoomNote {
  id: string;
  content: string;
  createdAt: string;
  pinnedAt?: string | null;
  staff?: { id: string; name: string; avatarUrl?: string | null } | null;
  staffId?: string;
}

export type TimelineItem<M extends { id: string; createdAt: string }> =
  | { kind: 'message'; id: string; createdAt: string; data: M }
  | { kind: 'note'; id: string; createdAt: string; data: RoomNote };

export function mergeTimeline<M extends { id: string; createdAt: string }>(
  messages: M[],
  notes: RoomNote[],
): TimelineItem<M>[] {
  const oldest = messages.reduce<number | null>((min, m) => {
    const t = new Date(m.createdAt).getTime();
    if (Number.isNaN(t)) return min;
    return min === null || t < min ? t : min;
  }, null);
  const items: TimelineItem<M>[] = messages.map((m) => ({ kind: 'message', id: m.id, createdAt: m.createdAt, data: m }));
  for (const n of notes) {
    const t = new Date(n.createdAt).getTime();
    if (oldest !== null && !Number.isNaN(t) && t < oldest) continue;
    items.push({ kind: 'note', id: `note-${n.id}`, createdAt: n.createdAt, data: n });
  }
  // เวลาเท่ากัน: ข้อความก่อนโน้ต (โน้ตมักเขียน "หลัง" เห็นข้อความ) · เรียงคงที่
  return items.sort((a, b) => {
    const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (d !== 0 && !Number.isNaN(d)) return d;
    if (a.kind !== b.kind) return a.kind === 'message' ? -1 : 1;
    return 0;
  });
}
