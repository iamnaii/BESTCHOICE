import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { openCombobox, pickComboOption } from '@/test/combobox';
import QuickReplyEditor from './QuickReplyEditor';
import type { CannedResponse, CannedResponseQuickReply } from './types';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const template = (id: string, title: string, category: string | null, isActive = true): CannedResponse => ({
  id, shortcut: `/${id}`, title, content: '', category, sortOrder: 0, isActive, createdAt: '2026-11-01T00:00:00Z',
});
const allTemplates = [
  template('self', 'ข้อความนี้เอง', null),
  template('tpl-greet', 'ทักทาย', 'ทั่วไป'),
  template('tpl-loan', 'สนใจผ่อน', 'การเงิน'),
  template('tpl-off', 'แม่แบบที่ปิดแล้ว', null, false),
];
const postback: CannedResponseQuickReply = {
  id: 'qr-1', cannedResponseId: 'self', label: 'สนใจ', type: 'POSTBACK', payload: 'TEMPLATE:tpl-greet',
  url: null, message: null, sortOrder: 0, createdAt: '2026-11-01T00:00:00Z',
};

function renderEditor() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuickReplyEditor cannedResponseId="self" allTemplates={allTemplates} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: [postback] });
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

describe('QuickReplyEditor — เมื่อกด (Combobox, saves on pick)', () => {
  it('lists active templates except itself under ส่ง แม่แบบตอบกลับ; open + search save nothing; a pick PATCHes TEMPLATE:<id>', async () => {
    const user = userEvent.setup();
    renderEditor();
    const trigger = await screen.findByRole('combobox', { name: 'เมื่อกด:' });
    expect(trigger).toHaveTextContent('ทักทาย · ทั่วไป');

    const listbox = await openCombobox(user, 'เมื่อกด:');
    expect(screen.getByText('ส่ง แม่แบบตอบกลับ')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— ตั้งเอง (custom payload) —' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ข้อความนี้เอง/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /แม่แบบที่ปิดแล้ว/ })).toBeNull();
    expect(within(listbox).getByText('ส่ง แม่แบบตอบกลับ')).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'ค้นหา' }), 'ผ่อน');
    expect(api.patch).not.toHaveBeenCalled();

    await user.click(screen.getByRole('option', { name: 'สนใจผ่อน · การเงิน' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/staff-chat/canned-responses/quick-replies/qr-1', {
        payload: 'TEMPLATE:tpl-loan',
      }),
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('re-picking the current template saves nothing; ตั้งเอง clears the payload', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('combobox', { name: 'เมื่อกด:' });
    await pickComboOption(user, 'เมื่อกด:', 'ทักทาย · ทั่วไป');
    expect(api.patch).not.toHaveBeenCalled();

    await pickComboOption(user, 'เมื่อกด:', '— ตั้งเอง (custom payload) —');
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/staff-chat/canned-responses/quick-replies/qr-1', { payload: '' }),
    );
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
