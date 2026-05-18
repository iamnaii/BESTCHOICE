import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

// --- mock api -------------------------------------------------------------
const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

// --- mock useDocumentTitle (side-effect only, not under test) -------------
vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

import DocumentConfigPage from './DocumentConfigPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(DocumentConfigPage),
      ),
    ),
  );
}

// Default mock: /settings returns an empty row set (so the page falls back to
// canonical defaults) and /settings/doc-config/preview returns a stub sample.
function setDefaultMocks() {
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/settings') return { data: [] };
    if (url.startsWith('/settings/doc-config/preview')) {
      const usp = new URLSearchParams(url.split('?')[1] ?? '');
      const prefix = usp.get('prefix') ?? 'XX';
      return {
        data: {
          sample: `${prefix}-2605-001`,
          format: 'PREFIX-YYMM-NNN',
          resetCycle: 'yearly',
          prefix,
        },
      };
    }
    return { data: null };
  });
}

describe('DocumentConfigPage (P2-SP2)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    setDefaultMocks();
  });

  it('renders the doc-type table with all 8 rows + the global format/cycle selectors', async () => {
    renderPage();

    // PageHeader title is rendered immediately.
    expect(
      screen.getByText('ตั้งค่าเลขที่/รูปแบบเอกสาร'),
    ).toBeInTheDocument();

    // Wait for the /settings GET to resolve + hydration to finish so the
    // per-row inputs render.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/settings');
    });

    // All 8 doc-type rows are present (canonical 5 + 3 extras).
    expect(await screen.findByText('รายจ่าย (Expense)')).toBeInTheDocument();
    expect(screen.getByText('ใบลดหนี้ (Credit Note)')).toBeInTheDocument();
    expect(screen.getByText('เงินเดือน (Payroll)')).toBeInTheDocument();
    expect(screen.getByText('จ่ายเจ้าหนี้ (Vendor Settlement)')).toBeInTheDocument();
    expect(screen.getByText('รายได้อื่น (Other Income)')).toBeInTheDocument();
    expect(screen.getByText('ใบเสร็จรับเงิน (Receipt)')).toBeInTheDocument();
    expect(screen.getByText('เงินสดย่อย (Petty Cash)')).toBeInTheDocument();
    expect(screen.getByText('สัญญาผ่อน (Contract)')).toBeInTheDocument();

    // Global selectors render with their accessible labels.
    expect(screen.getByLabelText('รูปแบบเลขที่')).toBeInTheDocument();
    expect(screen.getByLabelText('รอบการรีเซ็ต')).toBeInTheDocument();

    // Default prefix input for EXPENSE is "EX".
    const expenseInput = screen.getByLabelText(
      'prefix สำหรับ รายจ่าย (Expense)',
    ) as HTMLInputElement;
    expect(expenseInput.value).toBe('EX');
  });

  it('fires a preview fetch when a prefix is edited and shows the new sample', async () => {
    renderPage();

    // Wait for hydration so the row inputs exist + initial preview requests fire.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/settings');
    });
    const expenseInput = (await screen.findByLabelText(
      'prefix สำหรับ รายจ่าย (Expense)',
    )) as HTMLInputElement;

    // Change EX → EXP and confirm the preview hits the API with the new value.
    apiGet.mockClear();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/settings') return { data: [] };
      if (url.startsWith('/settings/doc-config/preview')) {
        const usp = new URLSearchParams(url.split('?')[1] ?? '');
        const prefix = usp.get('prefix') ?? 'XX';
        return {
          data: {
            sample: `${prefix}-2605-001`,
            format: 'PREFIX-YYMM-NNN',
            resetCycle: 'yearly',
            prefix,
          },
        };
      }
      return { data: null };
    });
    fireEvent.change(expenseInput, { target: { value: 'EXP' } });

    await waitFor(() => {
      const previewCalls = apiGet.mock.calls.filter((c) =>
        String(c[0]).startsWith('/settings/doc-config/preview'),
      );
      expect(
        previewCalls.some((c) => String(c[0]).includes('prefix=EXP')),
      ).toBe(true);
    });

    // And the rendered sample reflects the new prefix.
    await waitFor(() => {
      expect(screen.getByText('EXP-2605-001')).toBeInTheDocument();
    });
  });
});
