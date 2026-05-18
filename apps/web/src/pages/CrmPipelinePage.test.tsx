import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

// --- mock api -----------------------------------------------------
const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}));

// --- mock useNavigate ---------------------------------------------
const navigateMock = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// IMPORTANT: import after mocks.
import CrmPipelinePage, { STAGES, stageEnumToKey } from './CrmPipelinePage';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPatch.mockReset();
  navigateMock.mockReset();
});

describe('CrmPipelinePage — Kanban with Thai labels', () => {
  it('renders the 4 active Thai-labeled columns (LOST collapsed by default)', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/crm/leads') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'l1',
                stage: 'NEW_LEAD',
                customer: { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' },
              },
              {
                id: 'l2',
                stage: 'QUALIFIED',
                customer: { id: 'c2', name: 'สมหญิง รักดี' },
              },
              {
                id: 'l3',
                stage: 'PROPOSAL',
                customer: { id: 'c3', name: 'อนันต์ มั่งมี' },
              },
              {
                id: 'l4',
                stage: 'WON',
                customer: { id: 'c4', name: 'ปิยะ สำเร็จ' },
              },
              {
                id: 'l5',
                stage: 'LOST',
                customer: { id: 'c5', name: 'ขจร เลิกซื้อ' },
              },
            ],
            total: 5,
            page: 1,
            limit: 200,
          },
        });
      }
      if (url === '/crm/dashboard') {
        return Promise.resolve({
          data: {
            total: 5,
            conversionRate: 20,
            stages: { NEW_LEAD: 1, QUALIFIED: 1, PROPOSAL: 1, WON: 1, LOST: 1 },
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    wrap(<CrmPipelinePage />);

    // Wait for data, then assert the 4 active column titles appear in the
    // Kanban board. Each label appears in both the filter chip row AND the
    // column header — so we expect getAllByText length >= 1.
    await waitFor(() => {
      expect(screen.getAllByText('เสนอ').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('ติดต่อ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('เสนอราคา').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ปิดการขาย').length).toBeGreaterThanOrEqual(1);

    // LOST column is hidden by default — only the filter chip should match.
    // The Kanban column header has class size-2.5 + rounded-full; we sanity
    // check by counting the "ยกเลิก" occurrences: should equal 1 (filter chip
    // only, no column header).
    expect(screen.getAllByText('ยกเลิก').length).toBe(1);
  });

  it('shows LOST column when "แสดงยกเลิก" toggle clicked', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/crm/leads') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'l5',
                stage: 'LOST',
                customer: { id: 'c5', name: 'ขจร เลิกซื้อ' },
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    wrap(<CrmPipelinePage />);

    await waitFor(() => expect(screen.getByText('แสดงยกเลิก')).toBeInTheDocument());

    fireEvent.click(screen.getByText('แสดงยกเลิก'));

    // Now "ยกเลิก" should appear twice (filter chip + column header).
    await waitFor(() => {
      expect(screen.getAllByText('ยกเลิก').length).toBe(2);
    });
    expect(screen.getByText('ขจร เลิกซื้อ')).toBeInTheDocument();
  });

  it('navigates to /quotes?customerId=<id> when "สร้างใบเสนอราคา" is clicked', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/crm/leads') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'lead-q',
                stage: 'PROPOSAL',
                customer: { id: 'cust-99', name: 'ลูกค้าเสนอราคา' },
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    wrap(<CrmPipelinePage />);

    const btn = await screen.findByRole('button', { name: 'สร้างใบเสนอราคา' });
    fireEvent.click(btn);

    expect(navigateMock).toHaveBeenCalledWith('/quotes?customerId=cust-99');
  });

  it('navigates to /pos?customerId=<id> when "เปิด POS" is clicked on WON card', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/crm/leads') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'lead-w',
                stage: 'WON',
                customer: { id: 'cust-77', name: 'ลูกค้าปิดการขาย' },
              },
            ],
            total: 1,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    wrap(<CrmPipelinePage />);

    const btn = await screen.findByRole('button', { name: 'เปิด POS' });
    fireEvent.click(btn);

    expect(navigateMock).toHaveBeenCalledWith('/pos?customerId=cust-77');
  });

  it('filter chips switch the active stage view', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/crm/leads') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'l1', stage: 'NEW_LEAD', customer: { id: 'c1', name: 'A' } },
              { id: 'l2', stage: 'WON', customer: { id: 'c2', name: 'B' } },
            ],
            total: 2,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    wrap(<CrmPipelinePage />);

    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    expect(screen.getByText('B')).toBeInTheDocument();

    // Click the "ปิดการขาย" filter chip — only WON card visible.
    const wonChip = screen
      .getAllByRole('tab')
      .find((el) => el.textContent === 'ปิดการขาย');
    expect(wonChip).toBeTruthy();
    fireEvent.click(wonChip!);

    await waitFor(() => {
      expect(screen.queryByText('A')).not.toBeInTheDocument();
    });
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});

describe('stageEnumToKey', () => {
  it('maps NEW_LEAD → LEAD', () => {
    expect(stageEnumToKey('NEW_LEAD')).toBe('LEAD');
  });

  it('maps QUALIFIED → CONTACTED', () => {
    expect(stageEnumToKey('QUALIFIED')).toBe('CONTACTED');
  });

  it('collapses PROPOSAL and NEGOTIATION → QUOTED', () => {
    expect(stageEnumToKey('PROPOSAL')).toBe('QUOTED');
    expect(stageEnumToKey('NEGOTIATION')).toBe('QUOTED');
  });

  it('maps WON → WON, LOST → LOST', () => {
    expect(stageEnumToKey('WON')).toBe('WON');
    expect(stageEnumToKey('LOST')).toBe('LOST');
  });

  it('falls back to LEAD for unknown / null input', () => {
    expect(stageEnumToKey(null)).toBe('LEAD');
    expect(stageEnumToKey('UNKNOWN_STAGE')).toBe('LEAD');
  });
});

describe('STAGES write values', () => {
  it('QUOTED column writes PROPOSAL (canonical "quote sent" value)', () => {
    const quoted = STAGES.find((s) => s.key === 'QUOTED');
    expect(quoted?.writeValue).toBe('PROPOSAL');
  });

  it('all 5 stages exposed in order LEAD → CONTACTED → QUOTED → WON → LOST', () => {
    expect(STAGES.map((s) => s.key)).toEqual([
      'LEAD',
      'CONTACTED',
      'QUOTED',
      'WON',
      'LOST',
    ]);
  });
});
