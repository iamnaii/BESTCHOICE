import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatThaiDateShort, formatThaiTime } from '@/lib/date';
import type { TimelineEvent } from '../hooks/useCustomer360';

vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (url: string) => {
      throw new Error(`unexpected api.get ${url}`);
    },
    post: (url: string) => {
      throw new Error(`unexpected api.post ${url}`);
    },
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));

import Customer360Timeline from './Customer360Timeline';

// เทสล็อกพฤติกรรมเดิมก่อนย้ายไปใช้ EventTimeline กลาง — ต้องเขียวทั้งก่อนและหลังแตะโค้ด
const NOW = new Date('2026-09-15T05:00:00.000Z');
const OLD_CALL_AT = '2026-09-10T07:32:00.000Z';

const events: TimelineEvent[] = [
  { id: 'payment-p1', type: 'PAYMENT', timestamp: '2026-09-15T04:55:00.000Z', title: 'รับชำระงวด 6', subtitle: '4,200 บาท' },
  { id: 'dunning-d1', type: 'DUNNING_ACTION', timestamp: '2026-09-14T10:00:00.000Z', title: 'ส่ง LINE เตือนค้างชำระ' },
  {
    id: 'call-c1',
    type: 'CALL',
    timestamp: OLD_CALL_AT,
    title: 'โทรติดตาม',
    metadata: { result: 'PROMISED', voiceMemoUrl: 'https://files.example/voice-c1.webm', voiceMemoTier: 'HOT', callLogId: 'c1' },
  },
];

/** หัวกลุ่มวันที่ — ตัดปุ่มลัด "วันนี้" ของ DateRangePicker ออก */
function dateHeaders(text: string) {
  return screen.getAllByText(text).filter((el) => el.tagName !== 'BUTTON');
}

describe('Customer360Timeline (พฤติกรรมเดิม)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ไม่มีกิจกรรม → ยังไม่มีกิจกรรม', () => {
    render(<Customer360Timeline events={[]} />);
    expect(screen.getByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
  });

  it('จัดกลุ่ม วันนี้ / เมื่อวาน / วันที่ พร้อมป้ายเวลา ป้ายชนิด คำอธิบาย และจำนวนบนชิป', () => {
    render(<Customer360Timeline events={events} />);
    expect(dateHeaders('วันนี้')).toHaveLength(1);
    expect(dateHeaders('เมื่อวาน')).toHaveLength(1);
    expect(dateHeaders(formatThaiDateShort(OLD_CALL_AT))).toHaveLength(1);
    expect(screen.getByText('5 นาทีที่แล้ว')).toBeInTheDocument();
    expect(screen.getByText('19 ชม.ที่แล้ว')).toBeInTheDocument();
    expect(screen.getByText(formatThaiTime(OLD_CALL_AT))).toBeInTheDocument();
    expect(screen.getByText('รับชำระงวด 6')).toBeInTheDocument();
    expect(screen.getByText('4,200 บาท')).toBeInTheDocument();
    // ป้ายชนิดอยู่ทั้งบนชิปและในแถว
    expect(screen.getAllByText('ชำระ')).toHaveLength(2);
    expect(screen.getAllByText('แจ้งเตือน')).toHaveLength(2);
    expect(screen.getAllByText('โทร')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^ทั้งหมด/ })).toHaveTextContent('ทั้งหมด3');
    expect(screen.getByRole('button', { name: /^ชำระ/ })).toHaveTextContent('ชำระ1');
  });

  it('สีไอคอนโทรตามผล: นัดจ่าย = success · ปฏิเสธ = destructive · อื่น ๆ = primary', () => {
    const { container, rerender } = render(<Customer360Timeline events={[{ ...events[2], metadata: { result: 'PROMISED' } }]} />);
    expect(container.querySelector('svg.text-success')).not.toBeNull();
    rerender(<Customer360Timeline events={[{ ...events[2], metadata: { result: 'REFUSED' } }]} />);
    expect(container.querySelector('svg.text-destructive')).not.toBeNull();
    rerender(<Customer360Timeline events={[{ ...events[2], metadata: { result: 'NO_ANSWER' } }]} />);
    expect(container.querySelector('svg.text-primary')).not.toBeNull();
  });

  it('กดชิปโทร → เหลือเฉพาะโทร · ชิปหนังสือ → ไม่พบกิจกรรมตามตัวกรอง', async () => {
    const user = userEvent.setup();
    render(<Customer360Timeline events={events} />);
    await user.click(screen.getByRole('button', { name: /^โทร/ }));
    expect(screen.queryByText('รับชำระงวด 6')).toBeNull();
    expect(screen.getByText('โทรติดตาม')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^หนังสือ/ }));
    expect(screen.getByText('ไม่พบกิจกรรมตามตัวกรอง')).toBeInTheDocument();
  });

  it('โทรที่มีไฟล์เสียง HOT → มีตัวเล่นเสียงในแถว', () => {
    const { container } = render(<Customer360Timeline events={events} />);
    expect(container.querySelector('audio')?.getAttribute('src')).toBe('https://files.example/voice-c1.webm');
  });

  it('ครบ 100 รายการและไม่กรอง → แสดง 100 รายการล่าสุด · กรองแล้วป้ายหาย', async () => {
    const user = userEvent.setup();
    const hundred: TimelineEvent[] = Array.from({ length: 100 }, (_, i) => ({
      id: `payment-p${i}`,
      type: 'PAYMENT',
      timestamp: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
      title: `รับชำระ ${i}`,
    }));
    render(<Customer360Timeline events={hundred} />);
    expect(screen.getByText('แสดง 100 รายการล่าสุด')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^ชำระ/ }));
    expect(screen.queryByText('แสดง 100 รายการล่าสุด')).toBeNull();
  });
});
