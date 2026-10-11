import { BadRequestException } from '@nestjs/common';

export const SLOT_MS = 45 * 60_000;
export const OPEN_STATUSES = ['BOOKED', 'CHECKED_IN', 'IN_SERVICE'] as const;
export const DAY_MS = 86_400_000;
export type AppointmentPeriod = { staffUserId: string; startsAt: Date; endsAt: Date };
export const bangkokDay = (date: Date) =>
  new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export function dayBounds(day: string): [Date, Date] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException('วันที่ไม่ถูกต้อง');
  const start = new Date(`${day}T00:00:00+07:00`);
  if (!Number.isFinite(start.getTime()) || bangkokDay(start) !== day)
    throw new BadRequestException('วันที่ไม่ถูกต้อง');
  return [start, new Date(start.getTime() + DAY_MS)];
}

export const finalAppointmentStart = (day: string) => new Date(`${day}T18:30:00+07:00`).getTime();

export function assertBookableStart(start: Date, now = new Date()) {
  if (
    !Number.isFinite(start.getTime()) ||
    start.getTime() < now.getTime() + 30 * 60_000 ||
    start.getTime() >= dayBounds(bangkokDay(now))[0].getTime() + 14 * DAY_MS
  ) {
    throw new BadRequestException('กรุณาเลือกเวลาอย่างน้อย 30 นาทีล่วงหน้า ภายใน 14 วันรวมวันนี้');
  }
  if (start.getTime() > finalAppointmentStart(bangkokDay(start)))
    throw new BadRequestException('คิวสุดท้ายเริ่มเวลา 18:30 น.');
}

export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

export function availableSlots(
  windows: AppointmentPeriod[],
  busy: AppointmentPeriod[],
  day: string,
  now = new Date(),
) {
  const [from, to] = dayBounds(day);
  const horizon = dayBounds(bangkokDay(now))[0].getTime() + 14 * DAY_MS;
  const slots = new Map<number, Set<string>>();
  const lastStart = finalAppointmentStart(day);
  for (const window of windows) {
    const candidates = new Set<number>();
    for (
      let t = window.startsAt.getTime();
      t + SLOT_MS <= window.endsAt.getTime() && t <= lastStart;
      t += SLOT_MS
    )
      candidates.add(t);
    // Include the final start even when the employee's 45-minute grid does not land on it.
    if (window.startsAt.getTime() <= lastStart && lastStart + SLOT_MS <= window.endsAt.getTime())
      candidates.add(lastStart);
    for (const t of candidates) {
      if (
        t < from.getTime() ||
        t >= to.getTime() ||
        t < now.getTime() + 30 * 60_000 ||
        t >= horizon
      )
        continue;
      const period = { startsAt: new Date(t), endsAt: new Date(t + SLOT_MS) };
      if (busy.some((b) => b.staffUserId === window.staffUserId && overlaps(period, b))) continue;
      const staff = slots.get(t) ?? new Set<string>();
      staff.add(window.staffUserId);
      slots.set(t, staff);
    }
  }
  return [...slots]
    .sort(([a], [b]) => a - b)
    .map(([t, staff]) => ({
      startsAt: new Date(t).toISOString(),
      endsAt: new Date(t + SLOT_MS).toISOString(),
      available: staff.size,
    }));
}

export function decisionForAppointments(decisions: (string | null)[]) {
  return decisions.find((d) => d !== 'NONE') ?? 'UNKNOWN';
}

export function assertTransition(from: string, to: string, startsAt: Date, now = new Date()) {
  const allowed: Record<string, string[]> = {
    BOOKED: ['CHECKED_IN', 'CANCELED', 'NO_SHOW'],
    CHECKED_IN: ['IN_SERVICE', 'CANCELED'],
    IN_SERVICE: ['COMPLETED', 'CANCELED'],
  };
  if (!allowed[from]?.includes(to) || (to === 'NO_SHOW' && now < startsAt))
    throw new BadRequestException('ไม่สามารถเปลี่ยนสถานะนัดนี้ได้');
}
