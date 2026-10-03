import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { toast } from 'sonner';
import GeneralSettingsPage from './GeneralSettingsPage';
import StickersPage from './StickersPage';
import { CompanyTab } from './tabs/CompanyTab';

const auth = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn(), patch: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const settings = {
  pdpa_privacy_notice_version: 'v1',
  customer_access_token_hours: '24',
  'sticker.rate1.defaultDown': '1000',
  'sticker.rate1.defaultTerm': '12',
  'sticker.rate2.defaultDown': '2000',
  'sticker.rate2.defaultTerm': '18',
  company_name_th: 'บริษัททดสอบ',
  lessor_signature_image: '/synthetic-signature.png',
  lessor_signer_name: 'ผู้ลงนามทดสอบ',
};
const configs = (values: Record<string, string>) =>
  Object.entries(values).map(([key, value]) => ({ id: key, key, value, label: null }));

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = 'OWNER';
  vi.mocked(api.get).mockResolvedValue({ data: configs(settings) });
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

describe.each([
  {
    name: 'general',
    Page: GeneralSettingsPage,
    key: 'pdpa_privacy_notice_version',
    old: 'v1',
    next: 'v2',
  },
  {
    name: 'stickers',
    Page: StickersPage,
    key: 'sticker.rate1.defaultDown',
    old: '1000',
    next: '1500',
  },
  {
    name: 'company',
    Page: CompanyTab,
    key: 'company_name_th',
    old: 'บริษัททดสอบ',
    next: 'บริษัทแก้ไข',
  },
])('$name settings', ({ Page, key, old, next, name }) => {
  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>,
    );
    return client;
  }

  async function edit() {
    await screen.findByText((text) => text === old || text.startsWith(`${old} `));
    expect(api.get).toHaveBeenCalledWith('/settings');
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[0]);
    return screen.findByDisplayValue(old);
  }

  it('keeps the local draft across refetch and restores server values on cancel', async () => {
    const client = setup();
    fireEvent.change(await edit(), { target: { value: next } });
    act(() => client.setQueryData(['settings'], configs({ ...settings, [key]: '9999' })));
    expect(screen.getByDisplayValue(next)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'แก้ไข' })[0]);
    expect(await screen.findByDisplayValue('9999')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves only the edited section, refreshes settings and leaves edit mode', async () => {
    const client = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.change(await edit(), { target: { value: next } });
    vi.mocked(api.get).mockResolvedValue({ data: configs({ ...settings, [key]: next }) });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('บันทึกสำเร็จ'));
    const [path, data] = vi.mocked(api.patch).mock.calls[0];
    const payload = data as { items: { key: string; value: string }[] };
    expect(path).toBe('/settings');
    expect(payload.items).toContainEqual({ key, value: next });
    if (name === 'company') {
      expect(payload.items).toContainEqual({
        key: 'lessor_signature_image',
        value: settings.lessor_signature_image,
      });
      expect(payload.items).toContainEqual({
        key: 'lessor_signer_name',
        value: settings.lessor_signer_name,
      });
      expect(payload.items).not.toContainEqual(
        expect.objectContaining({ key: 'sticker.rate1.defaultDown' }),
      );
    } else {
      expect(payload.items).not.toContainEqual(
        expect.objectContaining({ key: 'lessor_signer_name' }),
      );
      expect(payload.items).toHaveLength(name === 'general' ? 2 : 4);
    }
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'บันทึก' })).toBeNull(),
    );
  });

  it('retains the draft on failed save so it can be retried', async () => {
    setup();
    fireEvent.change(await edit(), { target: { value: next } });
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('บันทึกไม่สำเร็จ'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByDisplayValue(next)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledTimes(2);
  });
});

it('keeps sticker editing owner-only', async () => {
  auth.role = 'ACCOUNTANT';
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <StickersPage />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'แก้ไข' })).toBeNull();
});
