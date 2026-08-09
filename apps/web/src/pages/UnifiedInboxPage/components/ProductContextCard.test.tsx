import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const navigateMock = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// IMPORTANT: import after mocks.
import ProductContextCard from './ProductContextCard';

const PRODUCT = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  price: 19500,
  stock: 3,
  imageUrl: 'https://cdn.example/p1.jpg',
  installmentPrice: 20000,
  conditionGrade: 'A',
  pricingOptions: [{ downPaymentMin: 4000, monthlyPayment: 1926, installments: 12 }],
  activePromotions: [],
};

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ProductContextCard', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post)
      .mockReset()
      .mockResolvedValue({ data: { sent: 2, photoSkipped: false, errors: [] } });
    navigateMock.mockReset();
  });

  it('โหลดสินค้าแล้วโชว์รูปจาก gallery + จำนวนสต็อกจริง + ราคาเงินสด', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [PRODUCT] });
    wrap(<ProductContextCard roomId="r1" />);

    expect(await screen.findByText('iPhone 13 128GB')).toBeInTheDocument();
    expect(screen.getByText('3 เครื่อง')).toBeInTheDocument();
    expect(screen.getByText(/19,500/)).toBeInTheDocument();
    expect(screen.getByAltText('iPhone 13 128GB')).toHaveAttribute(
      'src',
      'https://cdn.example/p1.jpg',
    );
  });

  it('ส่งแล้วพัง (มี errors) → toast แจ้งส่งไม่ครบ และกดส่งซ้ำใช้ clientMessageId เดิม', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [PRODUCT] });
    vi.mocked(api.post)
      .mockReset()
      .mockResolvedValueOnce({ data: { sent: 1, photoSkipped: false, errors: ['LINE 500'] } })
      .mockResolvedValueOnce({ data: { sent: 2, photoSkipped: false, errors: [] } });

    wrap(<ProductContextCard roomId="r1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'ส่งให้ลูกค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'ส่งให้ลูกค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    const [, firstBody] = vi.mocked(api.post).mock.calls[0];
    const [, secondBody] = vi.mocked(api.post).mock.calls[1];
    expect((firstBody as any).clientMessageId).toBe((secondBody as any).clientMessageId);
  });

  it('สำเร็จเต็ม → กดส่งอีกครั้งหลังสำเร็จได้ clientMessageId ใหม่ (ไม่ใช่ retry)', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [PRODUCT] });
    vi.mocked(api.post)
      .mockReset()
      .mockResolvedValue({ data: { sent: 2, photoSkipped: false, errors: [] } });

    wrap(<ProductContextCard roomId="r1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'ส่งให้ลูกค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'ส่งให้ลูกค้า' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    const [, firstBody] = vi.mocked(api.post).mock.calls[0];
    const [, secondBody] = vi.mocked(api.post).mock.calls[1];
    expect((firstBody as any).clientMessageId).not.toBe((secondBody as any).clientMessageId);
  });
});
