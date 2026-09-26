import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CaseTimeline from './CaseTimeline';
import type { TimelineItem } from './after-sales';

/** Task 8 — label ของแถวไทม์ไลน์ LINE: LINE_SENT/LINE_SKIPPED_NO_LINK เป็นแถวจริงจาก
 * AfterSalesEvent (Task 2/3); NOTE ที่ note ขึ้นต้น [AFTER_SALES_ คือ event DISABLED/FAILED/
 * BLOCKED (ก็เขียนเป็น kind NOTE เหมือนกัน — ดู after-sales-line.service.ts) ต้องได้ label
 * "LINE" เหมือนกัน (กิ่ง startsWith('LINE_') เดิมถูกลบไปแล้ว) */
describe('CaseTimeline — label ของเหตุการณ์ LINE (Task 8)', () => {
  it('LINE_SENT → ป้าย "ส่ง LINE"', () => {
    const timeline: TimelineItem[] = [
      {
        at: '2026-09-01T00:00:00.000Z',
        kind: 'LINE_SENT',
        note: '[AFTER_SALES_READY] มารับได้แล้ว · ส่งแล้ว',
      },
    ];
    render(<CaseTimeline timeline={timeline} stale={false} daysInStage={0} />);
    expect(screen.getByText('ส่ง LINE')).toBeInTheDocument();
    // note แสดงแบบตัด tag ออกแล้ว
    expect(screen.getByText('มารับได้แล้ว · ส่งแล้ว')).toBeInTheDocument();
    expect(screen.queryByText(/\[AFTER_SALES_READY\]/)).not.toBeInTheDocument();
  });

  it('LINE_SKIPPED_NO_LINK → ป้าย "ไม่ได้ส่ง LINE (ไม่ผูก)"', () => {
    const timeline: TimelineItem[] = [
      {
        at: '2026-09-01T00:00:00.000Z',
        kind: 'LINE_SKIPPED_NO_LINK',
        note: '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ไม่ได้ส่ง — ลูกค้ายังไม่ผูก LINE',
      },
    ];
    render(<CaseTimeline timeline={timeline} stale={false} daysInStage={0} />);
    expect(screen.getByText('ไม่ได้ส่ง LINE (ไม่ผูก)')).toBeInTheDocument();
  });

  it('NOTE ที่ note ขึ้นต้น [AFTER_SALES_ (เช่น ปิดการส่ง/ส่งไม่สำเร็จ) → ป้าย "LINE" เหมือนกัน', () => {
    const timeline: TimelineItem[] = [
      {
        at: '2026-09-01T00:00:00.000Z',
        kind: 'NOTE',
        note: '[AFTER_SALES_CLOSED] ปิดเคส · ส่งไม่สำเร็จ (429)',
      },
    ];
    render(<CaseTimeline timeline={timeline} stale={false} daysInStage={0} />);
    expect(screen.getByText('LINE')).toBeInTheDocument();
    expect(screen.getByText('ปิดเคส · ส่งไม่สำเร็จ (429)')).toBeInTheDocument();
  });

  it('NOTE ธรรมดา (ไม่มี tag) ไม่ถูกจัดเป็น LINE — คงป้ายเดิม (fallback เป็น kind ดิบ)', () => {
    const timeline: TimelineItem[] = [
      { at: '2026-09-01T00:00:00.000Z', kind: 'NOTE', note: 'บันทึกทั่วไป' },
    ];
    render(<CaseTimeline timeline={timeline} stale={false} daysInStage={0} />);
    expect(screen.queryByText('LINE')).not.toBeInTheDocument();
    expect(screen.getByText('NOTE')).toBeInTheDocument();
    expect(screen.getByText('บันทึกทั่วไป')).toBeInTheDocument();
  });

  it('PRINTED → ป้าย "พิมพ์เอกสาร" + ชื่อเอกสาร', () => {
    const timeline: TimelineItem[] = [
      {
        at: '2026-09-07T03:14:00.000Z',
        kind: 'PRINTED',
        note: 'ใบรับฝากเครื่อง',
        actorName: 'สุดา',
      },
    ];
    render(<CaseTimeline timeline={timeline} stale={false} daysInStage={0} />);
    expect(screen.getByText('พิมพ์เอกสาร')).toBeInTheDocument();
    expect(screen.getByText('ใบรับฝากเครื่อง')).toBeInTheDocument();
  });
});
