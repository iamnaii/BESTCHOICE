import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  FINANCE_LINE_SUGGESTED_REPLY,
  FinanceLineComposerCaution,
  FinanceLineRoomHeaderBadge,
  FinanceLineRoomNote,
  financeLineRoomKind,
  isFinanceLineUnlinked,
} from './RoomFinanceLineStatus';

/**
 * Task 33 (mockup A2/A3 + A4 ที่เจ้าของอนุมัติ 1 พ.ย.) — ชิ้นส่วนของหัวห้อง/ช่องพิมพ์ในอินบ็อกซ์ที่แสดงสถานะ LINE การเงินจาก server (ไม่มี U-id)
 * ถ้อยคำตาม `A2Unlinked.dc.html` / `A3Verified.dc.html` / `A4NotVerified.dc.html` ทุกตัวอักษร · สถานะไม่บอกด้วยสีอย่างเดียว (ไอคอน + คำ)
 */
const unlinked = { verified: false, unlinkedAt: '2026-10-30T05:00:00.000Z' };
const verified = { verified: true, unlinkedAt: null };
/** A4 — พนักงานผูกห้องกับลูกค้าจริง แต่ LINE นี้ไม่เคยยืนยัน OTP (API ให้สถานะเฉพาะห้องที่มีลูกค้าจริง) */
const notVerified = { verified: false, unlinkedAt: null };

describe('financeLineRoomKind', () => {
  it('แยกสามสถานะจากข้อมูลของ server · ช่องอื่น/ไม่มีลูกค้า (null) = ไม่มีสถานะ', () => {
    expect(financeLineRoomKind(verified)).toBe('verified');
    expect(financeLineRoomKind(unlinked)).toBe('unlinked');
    expect(financeLineRoomKind(notVerified)).toBe('not_verified');
    expect(financeLineRoomKind(null)).toBeNull();
    expect(financeLineRoomKind(undefined)).toBeNull();
  });
});

describe('isFinanceLineUnlinked', () => {
  it('เฉพาะสถานะที่ไม่ verified และรู้วันที่ยกเลิก', () => {
    expect(isFinanceLineUnlinked(unlinked)).toBe(true);
    expect(isFinanceLineUnlinked(verified)).toBe(false);
    expect(isFinanceLineUnlinked(notVerified)).toBe(false);
    expect(isFinanceLineUnlinked(null)).toBe(false);
    expect(isFinanceLineUnlinked(undefined)).toBe(false);
  });
});

describe('FinanceLineRoomHeaderBadge', () => {
  it('A2 — ยกเลิกผูกแล้ว: ป้าย (ไอคอน + คำ) ไม่ตัดบรรทัด', () => {
    render(<FinanceLineRoomHeaderBadge status={unlinked} />);
    const badge = screen.getByText('ยกเลิกผูกแล้ว');
    expect(badge.className).toMatch(/whitespace-nowrap/);
    expect(badge.querySelector('svg')).not.toBeNull();
  });

  it('A3 — ยืนยันแล้ว: "ยืนยัน OTP แล้ว" (ไอคอน + คำ)', () => {
    render(<FinanceLineRoomHeaderBadge status={verified} />);
    const label = screen.getByText('ยืนยัน OTP แล้ว');
    expect(label.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
  });

  it('A4 — ยังไม่เคยยืนยัน: ป้าย "ยังไม่ยืนยันตัวตน" (ไอคอน + คำ) ไม่ตัดบรรทัด', () => {
    render(<FinanceLineRoomHeaderBadge status={notVerified} />);
    const badge = screen.getByText('ยังไม่ยืนยันตัวตน');
    expect(badge.className).toMatch(/whitespace-nowrap/);
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
  });

  it('ช่องอื่น / ไม่มีลูกค้าจริง (null) → ไม่แสดงอะไร', () => {
    const { container } = render(<FinanceLineRoomHeaderBadge status={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FinanceLineRoomNote', () => {
  it('A2 — คำอธิบายหนึ่งบรรทัดใต้หัวห้อง — ชื่อลูกค้า + วันที่ยกเลิก', () => {
    render(<FinanceLineRoomNote status={unlinked} customerName="สมชาย ใจดี" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(
      'LINE นี้ยกเลิกผูกกับ สมชาย ใจดี แล้วเมื่อ 30/10/2569 — คนที่คุยในห้องนี้อาจไม่ใช่ลูกค้าคนนี้',
    );
    expect(note.querySelector('svg')).not.toBeNull();
  });

  it('A4 — ห้องที่พนักงานผูกเอง: ชื่อลูกค้า + ยังไม่เคยยืนยันด้วยรหัส OTP', () => {
    render(<FinanceLineRoomNote status={notVerified} customerName="สมชาย ใจดี" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(
      'ห้องนี้ผูกกับ สมชาย ใจดี โดยพนักงาน แต่ LINE นี้ยังไม่เคยยืนยันตัวตนด้วยรหัส OTP — คนที่คุยในห้องนี้อาจไม่ใช่ลูกค้าคนนี้',
    );
    expect(note.querySelector('svg')).not.toBeNull();
  });

  it('ยืนยันแล้ว / ไม่มีสถานะ → ไม่แสดง', () => {
    const { container, rerender } = render(
      <FinanceLineRoomNote status={verified} customerName="x" />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<FinanceLineRoomNote status={null} customerName="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FinanceLineComposerCaution', () => {
  it('บรรทัดเตือนเหนือช่องพิมพ์ตามถ้อยคำ mockup (ไม่บล็อกการพิมพ์ — แค่ข้อความ + ปุ่มแทรก)', () => {
    render(<FinanceLineComposerCaution id="caution" status={unlinked} onInsert={vi.fn()} />);
    const note = screen.getByRole('note');
    expect(note).toHaveAttribute('id', 'caution');
    expect(note).toHaveTextContent(
      'ห้องนี้ยังไม่ยืนยันตัวตน ตอบได้ แต่อย่าพิมพ์ยอดค้าง เลขสัญญา หรือข้อมูลส่วนตัว · ขั้นต่อไป: ขอให้เขาส่งข้อความอะไรก็ได้ในแชท LINE น้องเบสนี้ แล้วกด “เริ่มยืนยันตัวตน” ในการ์ดที่บอทตอบกลับ',
    );
    expect(note.querySelector('svg')).not.toBeNull();
  });

  it('กด "แทรกข้อความแนะนำ" → ส่งข้อความแนะนำของ mockup ให้ช่องพิมพ์', () => {
    const onInsert = vi.fn();
    render(<FinanceLineComposerCaution id="c" status={unlinked} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'แทรกข้อความแนะนำ' }));
    expect(onInsert).toHaveBeenCalledWith(FINANCE_LINE_SUGGESTED_REPLY);
    expect(FINANCE_LINE_SUGGESTED_REPLY).toBe(
      'รบกวนพิมพ์ข้อความอะไรก็ได้ในแชทนี้ แล้วกดปุ่ม “เริ่มยืนยันตัวตน” ในการ์ดที่ระบบตอบกลับนะคะ',
    );
  });

  it('A4 — ห้องที่ยังไม่เคยยืนยันใช้บรรทัดเตือน + ข้อความแนะนำชุดเดิม', () => {
    render(<FinanceLineComposerCaution id="c" status={notVerified} onInsert={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent('ห้องนี้ยังไม่ยืนยันตัวตน ตอบได้');
    expect(screen.getByRole('button', { name: 'แทรกข้อความแนะนำ' })).toBeInTheDocument();
  });

  it('ยืนยันแล้ว / ไม่มีสถานะ → ไม่แสดง', () => {
    const { container, rerender } = render(
      <FinanceLineComposerCaution id="c" status={verified} onInsert={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<FinanceLineComposerCaution id="c" status={null} onInsert={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
