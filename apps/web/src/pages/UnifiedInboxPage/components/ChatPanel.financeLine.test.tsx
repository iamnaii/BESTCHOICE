import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ChatPanel from './ChatPanel';

/**
 * Task 33 (mockup A2/A3) — หัวห้องและช่องพิมพ์ของห้อง LINE การเงินตาม `financeLineStatus` จาก server:
 * A2 ยกเลิกผูกแล้ว = ป้ายที่หัวห้อง + คำอธิบายหนึ่งบรรทัด + บรรทัดเตือนเหนือกรอบพิมพ์ (ไม่บล็อกการพิมพ์ · แทรกข้อความแนะนำได้) ·
 * A3 ยืนยันแล้ว = "ยืนยัน OTP แล้ว" ที่บรรทัดสถานะหัวห้อง
 */
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'staff-1', role: 'OWNER', name: 'พนักงาน' } }),
}));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({
    company: 'FINANCE',
    scope: { company: 'FINANCE' },
    key: ['chat-work', 'u', 'FINANCE'],
    settings: { data: { flags: {} }, isError: false },
  }),
}));
vi.mock('./AiSuggestPanel', () => ({ default: () => null }));
vi.mock('./RoomMessageSearch', () => ({ default: () => null }));
vi.mock('./ChatHandoffDialog', () => ({ default: () => null }));
vi.mock('./NoteMentionInput', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./NoteMentionInput')>()),
  default: () => <div data-testid="note-input" />,
}));

const unlinkedRoom = {
  id: 'room-1',
  channel: 'LINE_FINANCE',
  status: 'ACTIVE',
  customer: { id: 'c1', name: 'สมชาย ใจดี' },
  waitingSince: null,
  resolvedAt: null,
  financeLineStatus: { verified: false, unlinkedAt: '2026-10-30T05:00:00.000Z' },
};

function mount(session: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatPanel
          session={session}
          messages={[]}
          isLoadingMessages={false}
          onSendMessage={vi.fn()}
          onBack={vi.fn()}
          onAssign={vi.fn()}
          onTransfer={vi.fn()}
          onResolve={vi.fn()}
          onReturnToAI={vi.fn()}
          onAddNote={vi.fn()}
          currentUserId="staff-1"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** หัวห้องจอใหญ่ (`inbox-chat-header`) และหัวห้องมือถือ (`inbox-mobile-room-header` — ซ่อนด้วย CSS ตามจอ จึงอยู่ใน DOM ทั้งคู่) */
const desktopHeader = (c: HTMLElement) => c.querySelector<HTMLElement>('.inbox-chat-header')!;
const mobileHeader = (c: HTMLElement) => c.querySelector<HTMLElement>('.inbox-mobile-room-header')!;

describe('ChatPanel — สถานะ LINE การเงินของห้อง (Task 33 A2/A3 + fix round 1 A4)', () => {
  it('A2 — หัวห้อง (จอใหญ่ + มือถือ) มีป้าย "ยกเลิกผูกแล้ว" + คำอธิบายหนึ่งบรรทัดที่บอกชื่อลูกค้าและวันที่ยกเลิก', () => {
    const { container } = mount(unlinkedRoom);
    expect(within(desktopHeader(container)).getByText('ยกเลิกผูกแล้ว')).toBeInTheDocument();
    expect(within(mobileHeader(container)).getByText('ยกเลิกผูกแล้ว')).toBeInTheDocument();
    expect(
      screen.getByText(/LINE นี้ยกเลิกผูกกับ สมชาย ใจดี แล้วเมื่อ 30\/10\/2569/),
    ).toBeInTheDocument();
  });

  it('A2 — บรรทัดเตือนเหนือกรอบพิมพ์ ผูกกับช่องพิมพ์ (aria-describedby) · ช่องพิมพ์ยังพิมพ์ได้ · กดแทรกข้อความแนะนำ', () => {
    mount(unlinkedRoom);
    const input = screen.getByRole('textbox', { name: 'พิมพ์ข้อความ' });
    const caution = screen.getByText(/ห้องนี้ยังไม่ยืนยันตัวตน/).closest('[role="note"]')!;
    expect(input.getAttribute('aria-describedby')).toContain(caution.id);
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: 'สวัสดีค่ะ' } });
    expect(input).toHaveValue('สวัสดีค่ะ');
    fireEvent.click(screen.getByRole('button', { name: 'แทรกข้อความแนะนำ' }));
    expect(input).toHaveValue(
      'สวัสดีค่ะ\nรบกวนพิมพ์ข้อความอะไรก็ได้ในแชทนี้ แล้วกดปุ่ม “เริ่มยืนยันตัวตน” ในการ์ดที่ระบบตอบกลับนะคะ',
    );
  });

  it('A2 — โหมดโน้ตภายใน (ลูกค้าไม่เห็น) ไม่ต้องเตือน', () => {
    mount(unlinkedRoom);
    fireEvent.click(screen.getAllByRole('radio', { name: 'โน้ตภายใน' })[0]);
    expect(screen.queryByText(/ห้องนี้ยังไม่ยืนยันตัวตน/)).toBeNull();
  });

  it('A3 — ห้องที่ LINE ยืนยันแล้ว: "ยืนยัน OTP แล้ว" ที่หัวห้องทั้งจอใหญ่และมือถือ · ไม่มีป้าย/คำเตือน', () => {
    const { container } = mount({
      ...unlinkedRoom,
      financeLineStatus: { verified: true, unlinkedAt: null },
    });
    expect(within(desktopHeader(container)).getByText('ยืนยัน OTP แล้ว')).toBeInTheDocument();
    expect(within(mobileHeader(container)).getByText('ยืนยัน OTP แล้ว')).toBeInTheDocument();
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
    expect(screen.queryByText('ยังไม่ยืนยันตัวตน')).toBeNull();
    expect(screen.queryByText(/ห้องนี้ยังไม่ยืนยันตัวตน/)).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'พิมพ์ข้อความ' }).getAttribute('aria-describedby'),
    ).toBeNull();
  });

  it('A4 — ห้องที่พนักงานผูกเองแต่ LINE ไม่เคยยืนยัน: ป้าย "ยังไม่ยืนยันตัวตน" (จอใหญ่ + มือถือ) + คำอธิบาย + บรรทัดเตือนชุดเดิม', () => {
    const { container } = mount({
      ...unlinkedRoom,
      financeLineStatus: { verified: false, unlinkedAt: null },
    });
    expect(within(desktopHeader(container)).getByText('ยังไม่ยืนยันตัวตน')).toBeInTheDocument();
    expect(within(mobileHeader(container)).getByText('ยังไม่ยืนยันตัวตน')).toBeInTheDocument();
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
    expect(
      screen.getByText(
        /ห้องนี้ผูกกับ สมชาย ใจดี โดยพนักงาน แต่ LINE นี้ยังไม่เคยยืนยันตัวตนด้วยรหัส OTP/,
      ),
    ).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'พิมพ์ข้อความ' });
    const caution = screen.getByText(/ห้องนี้ยังไม่ยืนยันตัวตน/).closest('[role="note"]')!;
    expect(input.getAttribute('aria-describedby')).toContain(caution.id);
    expect(screen.getByRole('button', { name: 'แทรกข้อความแนะนำ' })).toBeInTheDocument();
  });

  it('ห้องช่องอื่น / ไม่มีลูกค้าจริง (financeLineStatus = null) → ไม่มีป้ายใด ๆ', () => {
    mount({ ...unlinkedRoom, financeLineStatus: null });
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
    expect(screen.queryByText('ยืนยัน OTP แล้ว')).toBeNull();
    expect(screen.queryByText('ยังไม่ยืนยันตัวตน')).toBeNull();
    expect(screen.queryByText(/ห้องนี้ยังไม่ยืนยันตัวตน/)).toBeNull();
  });

  // fix round 2 R2-M1 — ปุ่มตัวตนบนหัวห้องมือถือ: ชื่อปุ่มบอกชื่อลูกค้า + สถานะ LINE (เดิม aria-label "ข้อมูลลูกค้า" ทับทั้งชื่อและป้าย)
  it.each([
    [
      'A2',
      { verified: false, unlinkedAt: '2026-10-30T05:00:00.000Z' },
      'ข้อมูลลูกค้า สมชาย ใจดี · ยกเลิกผูกแล้ว',
    ],
    ['A3', { verified: true, unlinkedAt: null }, 'ข้อมูลลูกค้า สมชาย ใจดี · ยืนยัน OTP แล้ว'],
    ['A4', { verified: false, unlinkedAt: null }, 'ข้อมูลลูกค้า สมชาย ใจดี · ยังไม่ยืนยันตัวตน'],
    ['ไม่มีสถานะ', null, 'ข้อมูลลูกค้า สมชาย ใจดี'],
  ])(
    'R2-M1 %s — หัวห้องมือถือ: โปรแกรมอ่านจอได้ชื่อลูกค้า + สถานะ',
    (_label, financeLineStatus, name) => {
      const { container } = mount({ ...unlinkedRoom, financeLineStatus });
      expect(within(mobileHeader(container)).getByRole('button', { name })).toBeInTheDocument();
    },
  );

  // fix round 2 R2-M2 — จอแคบ (คอนเทนเนอร์ห้องแชท < 28rem): ป้ายบนหัวห้องมือถือเหลือไอคอน (คำยังอยู่สำหรับโปรแกรมอ่านจอ) ให้ชื่อลูกค้ายังเห็น ·
  // จอกว้างคืนคำเต็ม · หัวห้องจอใหญ่คงคำเต็มเสมอ (ยังไม่ได้ดูบนเครื่องจริง — ตรวจจากโครง/คลาส เพราะ jsdom ไม่คำนวณ container query)
  it.each([
    ['ยกเลิกผูกแล้ว', { verified: false, unlinkedAt: '2026-10-30T05:00:00.000Z' }],
    ['ยืนยัน OTP แล้ว', { verified: true, unlinkedAt: null }],
    ['ยังไม่ยืนยันตัวตน', { verified: false, unlinkedAt: null }],
  ])(
    'R2-M2 "%s" — หัวห้องมือถือย่อเป็นไอคอนเมื่อแคบ · ชื่อลูกค้าตัดท้ายได้แต่ไม่ถูกดันหาย',
    (label, financeLineStatus) => {
      const { container } = mount({ ...unlinkedRoom, financeLineStatus });
      const mobileLabel = within(mobileHeader(container)).getByText(label);
      expect(mobileLabel.className).toMatch(/(^|\s)sr-only(\s|$)/);
      expect(mobileLabel.className).toContain('@md:not-sr-only');
      expect(mobileLabel.parentElement!.querySelector('svg')).not.toBeNull();
      const name = within(mobileHeader(container)).getByText('สมชาย ใจดี');
      expect(name.className).toContain('truncate');
      expect(name.className).toMatch(/min-w-\[/);
      // หัวห้องจอใหญ่ไม่ย่อ
      const desktopLabel = within(desktopHeader(container)).getByText(label);
      expect(desktopLabel.className).not.toMatch(/(^|\s)sr-only(\s|$)/);
    },
  );
});
