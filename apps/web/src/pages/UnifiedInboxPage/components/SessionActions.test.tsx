import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

// --- mock api -----------------------------------------------------
const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
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
import SessionActions from './SessionActions';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseSession = {
  id: 'room1',
  customerId: 'c1',
  aiPaused: false,
  handoffMode: false,
};

const noop = () => {};

function renderActions(overrides: Partial<Parameters<typeof SessionActions>[0]> = {}) {
  return wrap(
    <SessionActions
      session={baseSession}
      onAssign={noop}
      onTransfer={noop}
      onResolve={noop}
      onReturnToAI={noop}
      onClose={noop}
      currentUserId="u1"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  navigateMock.mockReset();
});

describe('SessionActions — สร้างสัญญาจากแชท', () => {
  it('session ไม่มี customerId → ปุ่มสร้างสัญญาไม่ render', () => {
    renderActions({ session: { ...baseSession, customerId: null } });
    expect(screen.queryByRole('button', { name: /สร้างสัญญา/ })).not.toBeInTheDocument();
  });

  it('เปิดเมนู → กำลังรอ fetch → แสดง state โหลด', async () => {
    apiGet.mockImplementation(() => new Promise(() => {})); // ค้างไม่ resolve
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: /สร้างสัญญา/ }));

    expect(await screen.findByText('กำลังโหลด...')).toBeInTheDocument();
  });

  it('มีรายการเครื่อง → คลิกเครื่อง → navigate ด้วย URL จาก buildContractCreateUrl', async () => {
    apiGet.mockResolvedValue({
      data: { suggestedProducts: [{ id: 'p9', name: 'iPhone 13', brand: 'Apple' }] },
    });
    const onClose = vi.fn();
    renderActions({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /สร้างสัญญา/ }));
    fireEvent.click(await screen.findByText('iPhone 13'));

    expect(navigateMock).toHaveBeenCalledWith('/contracts/create?customerId=c1&productId=p9');
    expect(onClose).toHaveBeenCalled();
  });

  it('fetch ล้มเหลว (isError) → โชว์ copy error คนละอันกับ empty-state [I1]', async () => {
    apiGet.mockRejectedValue(new Error('network down'));
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: /สร้างสัญญา/ }));

    expect(await screen.findByText('โหลดรายการเครื่องไม่สำเร็จ')).toBeInTheDocument();
    expect(
      screen.queryByText('ไม่พบเครื่องที่พูดถึงในแชท — เลือกเครื่องในขั้นตอนถัดไป'),
    ).not.toBeInTheDocument();
    // ปุ่ม "ไม่ระบุเครื่อง" ยังใช้ได้เหมือนเดิมแม้ fetch พัง
    expect(screen.getByText('ไม่ระบุเครื่อง — ไปเลือกในหน้าสร้างสัญญา')).toBeInTheDocument();
  });

  it('ไม่พบเครื่องที่พูดถึง (list ว่าง ไม่ใช่ error) → กด "ไม่ระบุเครื่อง" → navigate แค่ customerId', async () => {
    apiGet.mockResolvedValue({ data: { suggestedProducts: [] } });
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: /สร้างสัญญา/ }));
    fireEvent.click(await screen.findByText('ไม่ระบุเครื่อง — ไปเลือกในหน้าสร้างสัญญา'));

    expect(navigateMock).toHaveBeenCalledWith('/contracts/create?customerId=c1');
  });
});
