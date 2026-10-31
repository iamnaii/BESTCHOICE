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
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

describe('ChatPanel — สถานะ LINE การเงินของห้อง (Task 33 A2/A3)', () => {
  it('A2 — หัวห้องมีป้าย "ยกเลิกผูกแล้ว" + คำอธิบายหนึ่งบรรทัดที่บอกชื่อลูกค้าและวันที่ยกเลิก', () => {
    mount(unlinkedRoom);
    const header = screen.getByRole('heading', { name: 'สมชาย ใจดี' }).parentElement!.parentElement!;
    expect(within(header).getByText('ยกเลิกผูกแล้ว')).toBeInTheDocument();
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

  it('A3 — ห้องที่ LINE ยืนยันแล้ว: "ยืนยัน OTP แล้ว" ที่หัวห้อง · ไม่มีป้าย/คำเตือนของ A2', () => {
    mount({ ...unlinkedRoom, financeLineStatus: { verified: true, unlinkedAt: null } });
    expect(screen.getByText('ยืนยัน OTP แล้ว')).toBeInTheDocument();
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
    expect(screen.queryByText(/ห้องนี้ยังไม่ยืนยันตัวตน/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'พิมพ์ข้อความ' }).getAttribute('aria-describedby')).toBeNull();
  });

  it('ห้องที่ไม่เคยผูก LINE นี้ (ไม่อยู่ใน mockup) → หน้าตาเดิม ไม่มีป้ายใด ๆ', () => {
    mount({ ...unlinkedRoom, financeLineStatus: { verified: false, unlinkedAt: null } });
    expect(screen.queryByText('ยกเลิกผูกแล้ว')).toBeNull();
    expect(screen.queryByText('ยืนยัน OTP แล้ว')).toBeNull();
    expect(screen.queryByText(/ห้องนี้ยังไม่ยืนยันตัวตน/)).toBeNull();
  });
});
