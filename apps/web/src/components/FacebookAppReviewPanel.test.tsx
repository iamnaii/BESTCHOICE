import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FACEBOOK_PAGE_SUBSCRIBED_FIELDS } from '@installment/shared';
import api from '@/lib/api';
import { FacebookAppReviewPanel } from './FacebookAppReviewPanel';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: { success: true } })),
    patch: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FacebookAppReviewPanel />
    </QueryClientProvider>,
  );
}

/**
 * ช่องกรอกของปุ่ม Subscribe Page Webhooks ส่งค่าของตัวเองไป API — subscribed_apps ของ Meta
 * เขียนทับทั้งชุด ⇒ ค่าตั้งต้นที่ขาด `message_echoes` = กดครั้งเดียวข้อความที่พนักงานตอบจาก
 * กล่องข้อความของเพจหายจาก inbox ทั้งหมด (ห้องค้าง "รอตอบ" + บอทตอบแทรก)
 */
describe('FacebookAppReviewPanel — Subscribe Page Webhooks', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockClear();
  });

  it('ค่าตั้งต้นมี message_echoes และตรงกับชุดเดียวกับ API', async () => {
    const user = userEvent.setup();
    renderPanel();

    const title = screen.getByText(/Subscribe Page Webhooks/);
    const row = title.closest('div.border') as HTMLElement;
    await user.click(title);

    const input = within(row).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe(FACEBOOK_PAGE_SUBSCRIBED_FIELDS.join(','));
    expect(input.value.split(',')).toContain('message_echoes');
    expect(input.value.split(',')).toContain('messaging_referrals');
    expect(input.value.split(',')).not.toContain('feed');
    expect(title.textContent).not.toMatch(/feed/i);

    await user.click(within(row).getByRole('button', { name: /ยิง API/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.post).mock.calls[0] as unknown as [
      string,
      { fields: string },
    ];
    expect(url).toBe('/facebook/app-review/subscribe-webhooks');
    expect(payload.fields.split(',')).toContain('message_echoes');
  });
});
