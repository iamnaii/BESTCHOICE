import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MdmDeviceWidget from './MdmDeviceWidget';

const apiGet = vi.fn();
const apiPost = vi.fn();
let role: string | undefined;
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: role ? { role } : null }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const imei = '350000000000001';
const status = {
  found: true,
  lockStatus: 'UNLOCKED',
  device: {
    id: 42,
    deviceName: 'Test phone',
    imei,
    productName: 'Test phone',
    osVersion: '',
    lastTime: '',
    lossStatus: 0,
    status: 1,
  },
};

function mount(cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(['mdm-device-status', imei], status);
  const view = render(
    <QueryClientProvider client={client}>
      <MdmDeviceWidget imei={imei} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  role = 'OWNER';
  apiGet.mockReset().mockImplementation((url: string) =>
    Promise.resolve({
      data: url.includes('/location')
        ? { data: { latitude: 13.75, longitude: 100.5, accuracy: 10, timestamp: '' } }
        : status,
    }),
  );
  apiPost.mockReset().mockResolvedValue({ data: {} });
});

describe('MdmDeviceWidget endpoint role boundaries', () => {
  it.each(['SALES', undefined])('does not query or render status for %s', async (currentRole) => {
    role = currentRole;
    const { container } = mount();
    await act(async () => {});
    expect(apiGet).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('does not expose cached status to SALES', async () => {
    role = 'SALES';
    const { container } = mount(true);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT'])(
    'preserves status read access for %s',
    async (currentRole) => {
      role = currentRole;
      mount();
      expect(await screen.findByText('อุปกรณ์ MDM')).toBeInTheDocument();
      expect(apiGet).toHaveBeenCalledWith(`/mdm/device-status?imei=${imei}`);
      if (currentRole === 'OWNER') {
        fireEvent.click(screen.getByRole('button', { name: 'ดูตำแหน่ง' }));
        await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/mdm/devices/42/location'));
      } else {
        expect(screen.queryByRole('button', { name: 'ดูตำแหน่ง' })).not.toBeInTheDocument();
        expect(apiGet.mock.calls.some(([url]) => String(url).includes('/location'))).toBe(false);
      }
      if (currentRole === 'OWNER' || currentRole === 'FINANCE_MANAGER') {
        // OWNER's GPS dialog is open; underlying buttons remain in the DOM.
        expect(screen.getByText('ล็อค Lost Mode', { selector: 'button' })).toBeInTheDocument();
        expect(screen.getByText('ปลดล็อค', { selector: 'button' })).toBeInTheDocument();
      } else {
        expect(screen.queryByText('ล็อค Lost Mode')).not.toBeInTheDocument();
        expect(screen.queryByText('ปลดล็อค')).not.toBeInTheDocument();
      }
    },
  );

  it.each(['OWNER', 'FINANCE_MANAGER'])(
    'preserves lock/unlock requests for %s',
    async (currentRole) => {
      role = currentRole;
      mount();
      fireEvent.click(await screen.findByRole('button', { name: 'ล็อค Lost Mode' }));
      fireEvent.change(screen.getByPlaceholderText(/เหตุผลการล็อค/), {
        target: { value: 'ค้างชำระ' },
      });
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'ยืนยันล็อค' }),
      );
      await waitFor(() =>
        expect(apiPost).toHaveBeenCalledWith('/mdm/lock', { imei, reason: 'ค้างชำระ' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'ปลดล็อค' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ปลดล็อค' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/mdm/unlock', { imei }));
    },
  );
});
