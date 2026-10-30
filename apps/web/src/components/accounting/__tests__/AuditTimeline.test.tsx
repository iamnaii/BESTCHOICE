import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuditTimeline } from '../AuditTimeline';
import type { IcabAuditEvent } from '../types';

/**
 * The action bar renders a *compact* inline preview of the timeline
 * (`<AuditTimeline ... compact />`). For a standard 3-event document
 * (Created → Posted → Reversed) that compact preview is the ONLY place the
 * timeline is shown — the "ดูทั้งหมด" popover only mounts when there are
 * more than 3 events. So the reverse reason MUST survive compact mode,
 * otherwise a reversed document never shows why it was reversed.
 */
const threeEventReversed: IcabAuditEvent[] = [
  { event: 'CREATED', userId: 'u1', userName: 'เอกนรินทร์ คงเดช', timestamp: '2026-05-12T07:25:10.000Z' },
  { event: 'POSTED', userId: 'u2', userName: 'สุทธินีย์ คงเดช', timestamp: '2026-05-12T07:30:25.000Z' },
  {
    event: 'REVERSED',
    userId: 'u2',
    userName: 'สุทธินีย์ คงเดช',
    timestamp: '2026-05-13T02:15:00.000Z',
    reason: 'บันทึกผิดบัญชี — ควรเป็น 42-1105 ไม่ใช่ 42-1102',
    detail: 'รายละเอียดภายในที่ไม่ควรโชว์ใน compact',
  },
];

describe('AuditTimeline', () => {
  it('shows the reverse reason on the REVERSED event even in compact mode', () => {
    render(<AuditTimeline events={threeEventReversed} compact />);
    expect(
      screen.getByText(/บันทึกผิดบัญชี — ควรเป็น 42-1105 ไม่ใช่ 42-1102/),
    ).toBeInTheDocument();
  });

  it('still suppresses free-form detail in compact mode', () => {
    render(<AuditTimeline events={threeEventReversed} compact />);
    expect(
      screen.queryByText(/รายละเอียดภายในที่ไม่ควรโชว์/),
    ).not.toBeInTheDocument();
  });

  it('shows the reason in full (non-compact) mode too', () => {
    render(<AuditTimeline events={threeEventReversed} />);
    expect(
      screen.getByText(/บันทึกผิดบัญชี — ควรเป็น 42-1105 ไม่ใช่ 42-1102/),
    ).toBeInTheDocument();
  });
});

describe('AuditTimeline — expense lifecycle codes read in Thai', () => {
  it('APPROVAL_REQUESTED / AUTO_POSTED / SENT_BACK_TO_DRAFT / DELETED show Thai labels, not the raw codes', () => {
    const at = (event: string, i: number): IcabAuditEvent => ({ event, userId: 'u1', userName: 'ผู้ใช้', timestamp: `2026-10-28T0${i}:00:00.000Z` });
    render(<AuditTimeline events={['APPROVAL_REQUESTED', 'AUTO_POSTED', 'SENT_BACK_TO_DRAFT', 'DELETED'].map(at)} />);
    for (const label of ['ส่งให้อนุมัติ', 'ลงบัญชี (อัตโนมัติหลังอนุมัติ)', 'ส่งกลับเป็นร่างเพื่อแก้ไข', 'ลบเอกสาร']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const code of ['APPROVAL_REQUESTED', 'AUTO_POSTED', 'SENT_BACK_TO_DRAFT', 'DELETED']) {
      expect(screen.queryByText(code)).not.toBeInTheDocument();
    }
  });
});
