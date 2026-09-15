import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PhoneCall } from 'lucide-react';
import { JOURNEY_EVENT_GROUPS } from '@installment/shared';
import { formatThaiDateShort } from '@/lib/date';
import { EventTimeline, type EventTimelineItem } from '../EventTimeline';
import { GROUP_EVENT_STYLES } from '../eventTimelineStyles';

const NOW = new Date('2026-09-15T05:00:00.000Z');
const SALE_AT = '2026-09-12T09:15:00.000Z';

const events: EventTimelineItem[] = [
  {
    id: 'chat-r1',
    type: 'CHAT_DAY',
    group: 'chat',
    timestamp: '2026-09-15T04:30:00.000Z',
    title: 'คุยแชท: ลูกค้า 4 ข้อความ · ร้านตอบ 2',
    reliability: 'approximate',
    href: '/inbox/r1',
  },
  {
    id: 'sale-s1',
    type: 'SALE_CASH',
    group: 'sale',
    timestamp: SALE_AT,
    title: 'ซื้อเงินสด iPhone 15',
    subtitle: 'สาขาสำนักงานใหญ่',
    reliability: 'exact',
  },
  { id: 'misc-1', type: 'UNKNOWN_KIND', timestamp: '2026-09-12T08:00:00.000Z', title: 'เหตุการณ์ที่ไม่มีกลุ่ม' },
];

const wrap = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('EventTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('จัดกลุ่มตามวัน หัวกลุ่ม วันนี้ / วันที่ และคงลำดับรายการ', () => {
    wrap(<EventTimeline events={events} />);
    const groups = screen.getAllByTestId('event-timeline-group');
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText('วันนี้')).toBeInTheDocument();
    expect(within(groups[0]).getAllByTestId('event-timeline-item')).toHaveLength(1);
    expect(within(groups[1]).getByText(formatThaiDateShort(SALE_AT))).toBeInTheDocument();
    const olderItems = within(groups[1]).getAllByTestId('event-timeline-item');
    expect(olderItems.map((el) => within(el).getByText(/ซื้อเงินสด|ไม่มีกลุ่ม/).textContent)).toEqual([
      'ซื้อเงินสด iPhone 15',
      'เหตุการณ์ที่ไม่มีกลุ่ม',
    ]);
    expect(screen.getByText('30 นาทีที่แล้ว')).toBeInTheDocument();
    expect(screen.getByText('สาขาสำนักงานใหญ่')).toBeInTheDocument();
  });

  it('ป้ายชนิดตามกลุ่ม · ไม่มีกลุ่มใช้ชื่อ type', () => {
    wrap(<EventTimeline events={events} />);
    const items = screen.getAllByTestId('event-timeline-item');
    expect(within(items[0]).getByText('แชท/ติดต่อ')).toBeInTheDocument();
    expect(within(items[1]).getByText('ขาย/สัญญา')).toBeInTheDocument();
    expect(within(items[2]).getByText('UNKNOWN_KIND')).toBeInTheDocument();
  });

  it('GROUP_EVENT_STYLES มีครบทุกกลุ่มของ shared และป้ายตรง eventCatalog ของแบบ', () => {
    expect(Object.keys(GROUP_EVENT_STYLES)).toEqual([...JOURNEY_EVENT_GROUPS]);
    expect(JOURNEY_EVENT_GROUPS.map((group) => GROUP_EVENT_STYLES[group].typeLabel)).toEqual([
      'แชท/ติดต่อ',
      'เครดิต',
      'ขาย/สัญญา',
      'ชำระเงิน',
      'ติดตามหนี้',
      'บริการ/ประกัน',
      'แต้ม',
      'ระบบ',
    ]);
  });

  it('เวลาโดยประมาณ → ป้าย "ประมาณ" เฉพาะแถวนั้น', () => {
    wrap(<EventTimeline events={events} />);
    const items = screen.getAllByTestId('event-timeline-item');
    expect(within(items[0]).getByText('ประมาณ')).toBeInTheDocument();
    expect(within(items[1]).queryByText('ประมาณ')).toBeNull();
    expect(screen.getAllByText('ประมาณ')).toHaveLength(1);
  });

  it('มี href → หัวข้อเป็นลิงก์ในแอป · ไม่มี href → ข้อความธรรมดา', () => {
    wrap(<EventTimeline events={events} />);
    expect(screen.getByRole('link', { name: 'คุยแชท: ลูกค้า 4 ข้อความ · ร้านตอบ 2' })).toHaveAttribute('href', '/inbox/r1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('getStyle และ renderExtra จากผู้เรียกมาก่อนค่าตั้งต้น', () => {
    wrap(
      <EventTimeline
        events={events}
        getStyle={() => ({ Icon: PhoneCall, iconBg: 'bg-primary/10', iconText: 'text-primary', typeLabel: 'โทร' })}
        renderExtra={(event) => (event.id === 'sale-s1' ? <span>ไฟล์แนบ</span> : null)}
      />,
    );
    expect(screen.getAllByText('โทร')).toHaveLength(3);
    const items = screen.getAllByTestId('event-timeline-item');
    expect(within(items[1]).getByText('ไฟล์แนบ')).toBeInTheDocument();
    expect(screen.getAllByText('ไฟล์แนบ')).toHaveLength(1);
  });

  it('ว่าง → emptyText (ค่าตั้งต้น ยังไม่มีกิจกรรม) และไม่แสดง footer · มีรายการ → แสดง footer', () => {
    const { rerender } = wrap(<EventTimeline events={[]} footer={<span>โหลดเพิ่ม</span>} />);
    expect(screen.getByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
    expect(screen.queryByText('โหลดเพิ่ม')).toBeNull();
    rerender(
      <MemoryRouter>
        <EventTimeline events={[]} emptyText="ไม่พบกิจกรรมตามตัวกรอง" />
      </MemoryRouter>,
    );
    expect(screen.getByText('ไม่พบกิจกรรมตามตัวกรอง')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <EventTimeline events={events} footer={<span>โหลดเพิ่ม</span>} />
      </MemoryRouter>,
    );
    expect(screen.getByText('โหลดเพิ่ม')).toBeInTheDocument();
  });
});
