import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import CannedResponseAdminPage from './CannedResponseAdminPage';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: [
        { id: 't1', shortcut: '/iphone16', title: 'iPhone 16', content: 'hello {customerName}', category: 'เรทผ่อน iPhone', sortOrder: 1, isActive: true, createdAt: '' },
        { id: 't2', shortcut: '/iphone17', title: 'iPhone 17', content: 'wow', category: 'เรทผ่อน iPhone', sortOrder: 2, isActive: true, createdAt: '' },
        { id: 't3', shortcut: '/welcome', title: 'ทักทาย', content: 'hi', category: 'พูดคุย', sortOrder: 3, isActive: true, createdAt: '' },
      ],
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getErrorMessage: (e: any) => e?.message ?? 'error',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CannedResponseAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders categories from data', async () => {
    render(wrap(<CannedResponseAdminPage />));
    expect(await screen.findByText('เรทผ่อน iPhone')).toBeInTheDocument();
    expect(screen.getByText('พูดคุย')).toBeInTheDocument();
  });

  it('shows empty state when no template selected', async () => {
    render(wrap(<CannedResponseAdminPage />));
    await screen.findByText('เรทผ่อน iPhone');
    expect(screen.getByText('เลือก template เพื่อแก้ไข')).toBeInTheDocument();
  });

  it('expands category on click then selects template into editor', async () => {
    render(wrap(<CannedResponseAdminPage />));
    const header = await screen.findByText('เรทผ่อน iPhone');
    fireEvent.click(header);
    const item = await screen.findByText('iPhone 16');
    fireEvent.click(item);
    await waitFor(() => {
      const titleInput = Array.from(document.querySelectorAll('input')).find((i) => i.value === 'iPhone 16');
      expect(titleInput).toBeTruthy();
    });
  });
});
