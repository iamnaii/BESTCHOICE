import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DocumentConfigPage from './DocumentConfigPage';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  getErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : 'เกิดข้อผิดพลาด',
}));

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const sampleRows = [
  {
    id: 'cfg-EX',
    docType: 'EX',
    description: 'ใบสำคัญจ่าย (Expense)',
    prefix: 'EX',
    format: '{prefix}-{YYYYMMDD}-{NNNN}',
    resetCadence: 'DAILY',
    digitCount: 4,
    active: true,
    notes: null,
    updatedAt: '2026-05-17T00:00:00.000Z',
    updatedBy: null,
  },
  {
    id: 'cfg-RT',
    docType: 'RT',
    description: 'ใบเสร็จรับเงิน (Receipt)',
    prefix: 'RT',
    format: '{prefix}-{YYYYMM}-{NNNNN}',
    resetCadence: 'MONTHLY',
    digitCount: 5,
    active: true,
    notes: null,
    updatedAt: '2026-05-17T00:00:00.000Z',
    updatedBy: null,
  },
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DocumentConfigPage />
    </QueryClientProvider>,
  );
}

describe('<DocumentConfigPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: sampleRows });
  });

  it('renders the doc-type table with prefix + format columns', async () => {
    renderPage();
    expect(await screen.findByText('EX')).toBeInTheDocument();
    expect(screen.getByText('RT')).toBeInTheDocument();
    expect(screen.getByText('ใบสำคัญจ่าย (Expense)')).toBeInTheDocument();
    expect(screen.getByText('{prefix}-{YYYYMMDD}-{NNNN}')).toBeInTheDocument();
    expect(screen.getByText('รายวัน')).toBeInTheDocument();
    expect(screen.getByText('รายเดือน')).toBeInTheDocument();
  });

  it('opens the edit dialog with the row data prefilled when clicking the pencil button', async () => {
    const user = userEvent.setup();
    renderPage();
    const editButton = await screen.findByRole('button', {
      name: /แก้ไข ใบสำคัญจ่าย/,
    });
    await user.click(editButton);
    expect(
      await screen.findByText(/แก้ไขรูปแบบเลขที่ — ใบสำคัญจ่าย/),
    ).toBeInTheDocument();
    const prefixInput = screen.getByLabelText('Prefix') as HTMLInputElement;
    expect(prefixInput.value).toBe('EX');
    const formatInput = screen.getByLabelText('รูปแบบ (format)') as HTMLInputElement;
    expect(formatInput.value).toBe('{prefix}-{YYYYMMDD}-{NNNN}');
  });

  it('calls the preview endpoint and shows the returned sample number', async () => {
    const user = userEvent.setup();
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        sample: 'EX-20260517-0001',
        nextSeq: 1,
        format: '{prefix}-{YYYYMMDD}-{NNNN}',
        prefix: 'EX',
        resetCadence: 'DAILY',
        digitCount: 4,
      },
    });

    renderPage();
    const editButton = await screen.findByRole('button', {
      name: /แก้ไข ใบสำคัญจ่าย/,
    });
    await user.click(editButton);

    const previewButton = await screen.findByRole('button', { name: 'สร้างตัวอย่าง' });
    await user.click(previewButton);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/settings/doc-config/EX/preview',
        expect.objectContaining({
          prefix: 'EX',
          format: '{prefix}-{YYYYMMDD}-{NNNN}',
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('doc-config-preview')).toHaveTextContent('EX-20260517-0001');
    });
  });
});
