/**
 * PO status timeline (spec: Draft → อนุมัติ → สั่งแล้ว → รับ → ครบ).
 * Maps the PO status to a per-step state so the detail view can render a
 * progress timeline. PARTIALLY_RECEIVED and APPROVED back-compat both handled.
 */

export type TimelineState = 'done' | 'current' | 'upcoming' | 'cancelled';

export interface TimelineStep {
  key: 'draft' | 'approved' | 'ordered' | 'received' | 'completed';
  label: string;
  state: TimelineState;
}

const ORDER: TimelineStep['key'][] = ['draft', 'approved', 'ordered', 'received', 'completed'];
const LABELS: Record<TimelineStep['key'], string> = {
  draft: 'รออนุมัติ',
  approved: 'อนุมัติ',
  ordered: 'สั่งแล้ว',
  received: 'รับเข้า',
  completed: 'รับครบ',
};

// Which step index is "current" for each status.
const CURRENT_INDEX: Record<string, number> = {
  DRAFT: 0,
  APPROVED: 1,
  ORDERED: 2,
  PARTIALLY_RECEIVED: 3,
  FULLY_RECEIVED: 4,
};

export function timelineSteps(po: { status: string }): TimelineStep[] {
  if (po.status === 'CANCELLED') {
    return ORDER.map((key) => ({ key, label: LABELS[key], state: 'cancelled' as TimelineState }));
  }
  const current = CURRENT_INDEX[po.status] ?? 0;
  return ORDER.map((key, idx) => {
    let state: TimelineState;
    if (idx < current) state = 'done';
    else if (idx === current) state = 'current';
    else state = 'upcoming';
    return { key, label: LABELS[key], state };
  });
}
