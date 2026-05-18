import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ETaxConfigPage from './ETaxConfigPage';

vi.mock('@/lib/api', () => {
  return {
    default: {
      get: vi.fn().mockResolvedValue({
        data: {
          config: {
            submitMode: 'disabled',
            certPath: '',
            certPassword: '',
            rdEndpoint: 'https://etax.rd.go.th/etax_staging/etaxws',
            rdUsername: '',
            rdPassword: '',
          },
        },
      }),
      post: vi.fn().mockResolvedValue({
        data: {
          submitMode: 'disabled',
          certConfigured: false,
          certError: 'certPath หรือ certPassword ไม่ได้ตั้งค่า',
          rdReachable: false,
          rdDetail: 'username/password ไม่ได้ตั้งค่า',
        },
      }),
      put: vi.fn().mockResolvedValue({ data: { ok: true } }),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ETaxConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ETaxConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header + warning banner explaining disabled-mode semantics', () => {
    renderPage();
    expect(screen.getByText(/ตั้งค่า e-Tax Invoice/)).toBeInTheDocument();
    const banner = screen.getByTestId('etax-config-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toMatch(/โหมด disabled/);
    expect(banner.textContent).toMatch(/ทดสอบการเชื่อมต่อ/);
  });

  it('shows Save + Test Connection buttons', async () => {
    renderPage();
    // Form renders after the query resolves
    expect(await screen.findByTestId('etax-config-form')).toBeInTheDocument();
    expect(screen.getByTestId('etax-test-btn')).toBeInTheDocument();
    expect(screen.getByTestId('etax-save-btn')).toBeInTheDocument();
    // Default mode is "disabled" — the dropdown should be present
    expect(screen.getByTestId('etax-mode-select')).toBeInTheDocument();
  });
});
