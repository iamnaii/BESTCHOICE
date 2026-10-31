import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));

import IntegrationHubPage from '../IntegrationHubPage';

/** Shape of GET /integrations/registry for PEAK (see integration-registry.ts). */
const PEAK_DEF = {
  key: 'peak',
  name: 'PEAK บัญชี',
  description: 'ส่งรายการบัญชีเข้า PEAK',
  icon: 'peak',
  fields: [
    { key: 'userToken', label: 'User Token', sensitive: true, required: true },
    { key: 'connectId', label: 'Connect ID', sensitive: false, required: true },
    {
      key: 'baseUrl',
      label: 'Base URL',
      sensitive: false,
      required: false,
      defaultValue: 'https://api.peakaccount.com/api/v1',
    },
  ],
};

/** GET /integrations/:key/config — sensitive masked, non-sensitive plaintext (env/default fallback included). */
const MASKED_CONFIG = {
  userToken: '••••abcd',
  connectId: 'CONNECT-123',
  baseUrl: 'https://api.peakaccount.com/api/v1',
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/integrations') {
      return Promise.resolve({
        data: [
          { key: 'peak', name: PEAK_DEF.name, description: PEAK_DEF.description, configured: true },
        ],
      });
    }
    if (url === '/integrations/registry') return Promise.resolve({ data: [PEAK_DEF] });
    if (url === '/integrations/peak/config') {
      return Promise.resolve({ data: { integration: PEAK_DEF, config: MASKED_CONFIG } });
    }
    if (url === '/notifications/sms/credit')
      return Promise.resolve({ data: { configured: false } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  apiPut.mockResolvedValue({ data: {} });
});

async function openPeakDrawer() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <IntegrationHubPage />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('button', { name: /PEAK บัญชี/ }));
  const dialog = await screen.findByRole('dialog');
  // Form renders once the masked config has loaded.
  await within(dialog).findByLabelText(/Connect ID/);
  return { user, dialog };
}

describe('IntegrationHubPage — ทดสอบการเชื่อมต่อ', () => {
  it('shows a failure (icon + text) when the API answers 2xx with success:false', async () => {
    apiPost.mockResolvedValue({ data: { success: false, message: 'PEAK ตอบกลับ HTTP 401' } });
    const { user, dialog } = await openPeakDrawer();

    await user.click(within(dialog).getByRole('button', { name: /ทดสอบการเชื่อมต่อ/ }));

    const result = await within(dialog).findByRole('status');
    expect(result).toHaveTextContent('PEAK ตอบกลับ HTTP 401');
    expect(result.className).toMatch(/text-destructive/);
    expect(result.className).not.toMatch(/text-success/);
    expect(result.querySelector('svg.lucide-circle-x')).not.toBeNull();
    expect(result.querySelector('svg.lucide-circle-check')).toBeNull();
  });

  it('shows success only when the API says success:true', async () => {
    apiPost.mockResolvedValue({ data: { success: true, message: 'เชื่อมต่อ PEAK สำเร็จ' } });
    const { user, dialog } = await openPeakDrawer();

    await user.click(within(dialog).getByRole('button', { name: /ทดสอบการเชื่อมต่อ/ }));

    const result = await within(dialog).findByRole('status');
    expect(result).toHaveTextContent('เชื่อมต่อ PEAK สำเร็จ');
    expect(result.className).toMatch(/text-success/);
    expect(result.querySelector('svg.lucide-circle-check')).not.toBeNull();
    expect(result.querySelector('svg.lucide-circle-x')).toBeNull();
  });

  it('treats a 2xx body without success:true as a failure with the generic message', async () => {
    apiPost.mockResolvedValue({ data: {} });
    const { user, dialog } = await openPeakDrawer();

    await user.click(within(dialog).getByRole('button', { name: /ทดสอบการเชื่อมต่อ/ }));

    const result = await within(dialog).findByRole('status');
    expect(result).toHaveTextContent('เชื่อมต่อไม่ได้ — กรุณาตรวจสอบการตั้งค่า');
    expect(result.querySelector('svg.lucide-circle-x')).not.toBeNull();
  });
});

describe('IntegrationHubPage — ฟอร์มตั้งค่า', () => {
  it('prefills non-secret fields from the saved config and keeps secrets empty with a placeholder', async () => {
    const { dialog } = await openPeakDrawer();

    expect(within(dialog).getByLabelText(/Connect ID/)).toHaveValue('CONNECT-123');
    expect(within(dialog).getByLabelText(/Base URL/)).toHaveValue(
      'https://api.peakaccount.com/api/v1',
    );
    const token = within(dialog).getByLabelText(/User Token/);
    expect(token).toHaveValue('');
    expect(token).toHaveAttribute('placeholder', '●●●●●●●● (กรอกใหม่เพื่อเปลี่ยน)');
  });

  it('saves nothing it did not change — no masked secret, no env/default fallback pinned to the DB', async () => {
    const { user, dialog } = await openPeakDrawer();

    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/integrations/peak/config', {});
  });

  it('clears a prefilled non-secret field in one step and sends only what changed', async () => {
    const { user, dialog } = await openPeakDrawer();

    await user.clear(within(dialog).getByLabelText(/Connect ID/));
    await user.type(within(dialog).getByLabelText(/User Token/), 'new-token');
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/integrations/peak/config', {
      connectId: '',
      userToken: 'new-token',
    });
  });

  it('does not send a secret that was typed and then erased', async () => {
    const { user, dialog } = await openPeakDrawer();

    const token = within(dialog).getByLabelText(/User Token/);
    await user.type(token, 'x');
    await user.clear(token);
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/integrations/peak/config', {});
  });
});

describe('IntegrationHubPage — โหลดรายการ', () => {
  it.each([
    ['an object without a list', { unexpected: true }],
    ['an empty body', null],
  ])(
    'shows the page error state (not an empty grid) when GET /integrations returns %s',
    async (_label, body) => {
      const defaultGet = apiGet.getMockImplementation()!;
      apiGet.mockImplementation((url: string) =>
        url === '/integrations' ? Promise.resolve({ data: body }) : defaultGet(url),
      );
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <IntegrationHubPage />
        </QueryClientProvider>,
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('ไม่สามารถโหลดข้อมูลได้');
      expect(within(alert).getByRole('button', { name: /ลองใหม่/ })).toBeInTheDocument();
      expect(screen.queryByText('ไม่พบการเชื่อมต่อ')).not.toBeInTheDocument();
    },
  );
});
