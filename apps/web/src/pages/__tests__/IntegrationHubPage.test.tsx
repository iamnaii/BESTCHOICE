import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  getErrorMessage: (err: unknown) =>
    (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
    'เกิดข้อผิดพลาด',
}));

import { toast } from 'sonner';
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

/** LINE FINANCE as the registry serves it (mockup row B uses this card). */
const FINANCE_DEF = {
  key: 'line-finance',
  name: 'LINE FINANCE (น้องเบส)',
  description: 'ไลน์การเงิน — แจ้งค่างวด, รับชำระ',
  icon: 'line',
  webhookUrl: 'https://api.example.test/api/chatbot/finance/webhook',
  fields: [
    { key: 'channelToken', label: 'Channel Access Token', sensitive: true, required: true },
    { key: 'channelSecret', label: 'Channel Secret', sensitive: true, required: true },
    { key: 'liffId', label: 'LIFF ID', sensitive: false, required: false },
  ],
};

/** Mutable: `DELETE …/config/:field` empties the masked value the next GET returns. */
let financeConfig: Record<string, string>;

beforeEach(() => {
  role = 'OWNER';
  financeConfig = { channelToken: '••••wxyz', channelSecret: '••••9876', liffId: 'test-liff-id' };
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiDelete.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/integrations') {
      return Promise.resolve({
        data: [
          { key: 'peak', name: PEAK_DEF.name, description: PEAK_DEF.description, configured: true },
          {
            key: 'line-finance',
            name: FINANCE_DEF.name,
            description: FINANCE_DEF.description,
            configured: Boolean(financeConfig.channelToken && financeConfig.channelSecret),
          },
        ],
      });
    }
    if (url === '/integrations/registry') return Promise.resolve({ data: [PEAK_DEF, FINANCE_DEF] });
    if (url === '/integrations/peak/config') {
      return Promise.resolve({ data: { integration: PEAK_DEF, config: MASKED_CONFIG } });
    }
    if (url === '/integrations/line-finance/config') {
      return Promise.resolve({ data: { integration: FINANCE_DEF, config: { ...financeConfig } } });
    }
    if (url === '/notifications/sms/credit')
      return Promise.resolve({ data: { configured: false } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  apiPut.mockResolvedValue({ data: {} });
  apiDelete.mockImplementation((url: string) => {
    const field = url.split('/').pop()!;
    financeConfig = { ...financeConfig, [field]: '' };
    return Promise.resolve({ data: { cleared: true } });
  });
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
    const token = within(dialog).getByLabelText(/^User Token/);
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
    await user.type(within(dialog).getByLabelText(/^User Token/), 'new-token');
    await user.click(within(dialog).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/integrations/peak/config', {
      connectId: '',
      userToken: 'new-token',
    });
  });

  it('does not send a secret that was typed and then erased', async () => {
    const { user, dialog } = await openPeakDrawer();

    const token = within(dialog).getByLabelText(/^User Token/);
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

async function openFinanceDrawer() {
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
  await user.click(await screen.findByRole('button', { name: /LINE FINANCE \(น้องเบส\)/ }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByLabelText(/LIFF ID/);
  return { user, dialog };
}

describe('IntegrationHubPage — ล้างค่าช่องลับ (mockup B1–B4)', () => {
  it('B1: a stored secret shows "ตั้งค่าแล้ว", a "ล้างค่า" button and what an empty input means', async () => {
    const { dialog } = await openFinanceDrawer();

    const token = within(dialog).getByLabelText(/^Channel Access Token/);
    expect(token).toHaveValue('');
    expect(token).toHaveAttribute('placeholder', '●●●●●●●● (กรอกใหม่เพื่อเปลี่ยน)');
    expect(token).toHaveAccessibleDescription(
      'ตั้งค่าแล้ว ค่าที่ใช้อยู่ลงท้าย ••••wxyz · เว้นว่างไว้ = ใช้ค่าเดิม',
    );
    expect(
      within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'ล้างค่า Channel Secret' }),
    ).toBeInTheDocument();
    // Not a secret → no state chip, no clear button (emptying it and saving still works as before).
    expect(within(dialog).queryByRole('button', { name: /ล้างค่า LIFF ID/ })).toBeNull();
    expect(within(dialog).getAllByText('ตั้งค่าแล้ว')).toHaveLength(2);
  });

  it('hides "ล้างค่า" for a secret that is not set, and says it is not set', async () => {
    financeConfig.channelSecret = '';
    const { dialog } = await openFinanceDrawer();

    expect(within(dialog).queryByRole('button', { name: 'ล้างค่า Channel Secret' })).toBeNull();
    const secret = within(dialog).getByLabelText(/^Channel Secret/);
    expect(secret).toHaveAttribute('placeholder', 'วาง Channel Secret ใหม่');
    // Re-review N2: a missing Channel Secret only stops inbound webhooks (sending still works),
    // so the helper must not say the whole connection is down — same source as the dialog copy.
    expect(secret).toHaveAccessibleDescription(
      'ยังไม่ตั้งค่า ช่องนี้จำเป็น — บันทึกค่าใหม่เพื่อให้ใช้งานได้ครบ',
    );
  });

  it('ACCOUNTANT (read-only on this page) sees the state but no "ล้างค่า"', async () => {
    role = 'ACCOUNTANT';
    const { dialog } = await openFinanceDrawer();

    expect(within(dialog).getAllByText('ตั้งค่าแล้ว')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: /^ล้างค่า/ })).toBeNull();
  });

  it('B2: asks first — focus starts on "ไม่ล้าง", copy says immediate + no undo, Esc = ไม่ล้าง', async () => {
    const { user, dialog } = await openFinanceDrawer();

    await user.click(within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }));

    const confirm = await screen.findByRole('alertdialog', {
      name: 'ล้างค่า Channel Access Token?',
    });
    await waitFor(() =>
      expect(within(confirm).getByRole('button', { name: 'ไม่ล้าง' })).toHaveFocus(),
    );
    expect(confirm).toHaveTextContent(
      'LINE FINANCE (น้องเบส) จะใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่ — น้องเบสส่งข้อความหาลูกค้าไม่ได้ ทั้งบอทและพนักงานที่ตอบจากอินบ็อกซ์',
    );
    expect(confirm).toHaveTextContent(
      'ล้างทันทีที่กด และย้อนกลับไม่ได้ — ถ้าล้างผิด ต้องคัดลอกค่าใหม่จาก LINE Developers Console มากรอกเอง',
    );
    expect(confirm).toHaveTextContent(
      'ถ้าแค่จะเปลี่ยนเป็นค่าใหม่ ไม่ต้องล้าง — กรอกค่าใหม่ทับในช่องแล้วกดบันทึกได้เลย',
    );

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(apiDelete).not.toHaveBeenCalled();
    // Only the confirmation closed — the edit dialog is still there.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('"ไม่ล้าง" closes without clearing', async () => {
    const { user, dialog } = await openFinanceDrawer();

    await user.click(within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'ไม่ล้าง' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('B3: "ล้างค่า" clears immediately (no form save), toasts, and the field turns "ยังไม่ตั้งค่า"', async () => {
    const { user, dialog } = await openFinanceDrawer();

    await user.click(within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'ล้างค่า' }));

    await waitFor(() =>
      expect(apiDelete).toHaveBeenCalledWith('/integrations/line-finance/config/channelToken'),
    );
    expect(apiPut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('ล้างค่า Channel Access Token แล้ว', {
      duration: 4000,
    });

    const edit = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(edit).getByLabelText(/^Channel Access Token/)).toHaveAttribute(
        'placeholder',
        'วาง Channel Access Token ใหม่',
      ),
    );
    const token = within(edit).getByLabelText(/^Channel Access Token/);
    expect(token).toHaveAttribute('aria-required', 'true');
    expect(token).toHaveAccessibleDescription(
      'ยังไม่ตั้งค่า ช่องนี้จำเป็น — การเชื่อมต่อใช้งานไม่ได้จนกว่าจะบันทึกค่าใหม่',
    );
    expect(within(edit).queryByRole('button', { name: 'ล้างค่า Channel Access Token' })).toBeNull();
    // The other secret is untouched.
    expect(
      within(edit).getByRole('button', { name: 'ล้างค่า Channel Secret' }),
    ).toBeInTheDocument();
  });

  it('B4: the card badge turns "ยังไม่ตั้งค่า" after the clear', async () => {
    const { user, dialog } = await openFinanceDrawer();
    const card = () =>
      screen.getByRole('button', { name: /LINE FINANCE \(น้องเบส\)/, hidden: true });
    expect(card()).toHaveTextContent('เชื่อมแล้ว');

    await user.click(within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'ล้างค่า' }),
    );

    await waitFor(() => expect(card()).toHaveTextContent('ยังไม่ตั้งค่า'));
  });

  it('drops a value typed into that field, and a later save never posts a masked value', async () => {
    const { user, dialog } = await openFinanceDrawer();
    await user.type(within(dialog).getByLabelText(/^Channel Access Token/), 'typed-but-cleared');

    await user.click(within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'ล้างค่า' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    const edit = await screen.findByRole('dialog');
    expect(within(edit).getByLabelText(/^Channel Access Token/)).toHaveValue('');
    await user.click(within(edit).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith('/integrations/line-finance/config', {});
    expect(JSON.stringify(apiPut.mock.calls)).not.toContain('•');
  });

  it('a failed clear keeps the confirmation open and shows the API error', async () => {
    apiDelete.mockRejectedValue({ response: { data: { message: 'ไม่มีสิทธิ์' } } });
    const { user, dialog } = await openFinanceDrawer();

    await user.click(within(dialog).getByRole('button', { name: 'ล้างค่า Channel Access Token' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'ล้างค่า' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ไม่มีสิทธิ์'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
