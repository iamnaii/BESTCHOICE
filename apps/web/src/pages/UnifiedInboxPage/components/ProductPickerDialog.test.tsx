import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductPickerDialog from './ProductPickerDialog';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const HIT = {
  id: 'p1',
  name: 'iPhone 13 128GB',
  brand: 'Apple',
  model: 'iPhone 13',
  color: 'สีชมพู',
  storage: '128GB',
  status: 'IN_STOCK',
  category: 'PHONE_USED',
  conditionGrade: 'A',
  batteryHealth: 92,
  branchName: 'ลาดพร้าว',
  photoUrl: 'https://cdn.example/p1.jpg',
  cashPrice: 19500,
  installmentPrice: 20000,
  months: 12,
  monthlyPayment: 1926,
  downAmount: 4000,
  shareUrl: 'https://www.bestchoicephone.com/products/p1',
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ProductPickerDialog', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: { sent: 2, photoSkipped: false, errors: [] } });
  });

  it('ค้นแล้วโชว์ราคาเงินสด + ค่างวดจริง', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [HIT] });
    render(wrap(<ProductPickerDialog isOpen onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });

    expect(await screen.findByText('Apple iPhone 13')).toBeInTheDocument();
    expect(screen.getByText(/19,500/)).toBeInTheDocument();
    expect(screen.getByText(/1,926/)).toBeInTheDocument();
  });

  it('เครื่องที่ไม่มีรูปขึ้นเว็บ → ขึ้นคำเตือน และปุ่มส่งรูปถูกปิด', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ ...HIT, photoUrl: null }] });
    render(wrap(<ProductPickerDialog isOpen onClose={vi.fn()} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));

    expect(await screen.findByText('ยังไม่มีรูปขึ้นเว็บ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่งรูป' })).toBeDisabled();
  });

  it('กดส่งการ์ด → POST พร้อม clientMessageId แล้วปิด dialog', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('/summary')
        ? Promise.resolve({ data: { productId: 'p1', title: 'Apple iPhone 13', text: 'สรุป', photoUrl: HIT.photoUrl, shareUrl: HIT.shareUrl } })
        : Promise.resolve({ data: [HIT] }),
    );
    const onClose = vi.fn();
    render(wrap(<ProductPickerDialog isOpen onClose={onClose} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งการ์ด (รูป + ข้อความ)' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/staff-chat/rooms/r1/product-card');
    expect(body).toMatchObject({ productId: 'p1', parts: ['PHOTO', 'TEXT'] });
    expect(typeof (body as any).clientMessageId).toBe('string');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('กดแทรกสรุป → ส่งข้อความจาก summary เข้ากล่องพิมพ์', async () => {
    vi.mocked(api.get).mockImplementation((url: string) =>
      url.includes('/summary')
        ? Promise.resolve({ data: { productId: 'p1', title: 'Apple iPhone 13', text: 'สรุปสินค้า', photoUrl: null, shareUrl: null } })
        : Promise.resolve({ data: [HIT] }),
    );
    const onInsert = vi.fn();
    render(wrap(<ProductPickerDialog isOpen onClose={vi.fn()} onInsert={onInsert} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));
    // ต้องรอ summary โหลดก่อน — ปุ่ม disabled อยู่จนกว่า summary จะมา
    // (กดตอน disabled = ไม่มี event, test จะ timeout แบบงงๆ)
    expect(await screen.findByText('สรุปสินค้า')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'แทรกสรุปในกล่องพิมพ์' }));

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith('สรุปสินค้า'));
  });

  it('ส่งแล้วพัง (มี errors) → dialog ไม่ปิด + กดส่งซ้ำใช้ clientMessageId เดิม', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [HIT] });
    vi.mocked(api.post)
      .mockReset()
      .mockResolvedValueOnce({ data: { sent: 1, photoSkipped: false, errors: ['LINE 500'] } })
      .mockResolvedValueOnce({ data: { sent: 2, photoSkipped: false, errors: [] } });
    const onClose = vi.fn();
    render(wrap(<ProductPickerDialog isOpen onClose={onClose} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งการ์ด (รูป + ข้อความ)' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    // ส่งไม่ครบ — ต้องไม่ปิด dialog ไม่งั้นกดส่งซ้ำแล้วได้ clientMessageId ใหม่
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ส่งการ์ด (รูป + ข้อความ)' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const [, firstBody] = vi.mocked(api.post).mock.calls[0];
    const [, secondBody] = vi.mocked(api.post).mock.calls[1];
    expect((firstBody as any).clientMessageId).toBe((secondBody as any).clientMessageId);
  });

  it('สำเร็จเต็ม → ปิด dialog; เลือกสินค้าอื่นได้ clientMessageId ใหม่ (ไม่ใช่ retry)', async () => {
    const HIT2 = { ...HIT, id: 'p2', model: 'iPhone 14' };
    vi.mocked(api.get).mockResolvedValue({ data: [HIT, HIT2] });
    vi.mocked(api.post).mockReset().mockResolvedValue({ data: { sent: 2, photoSkipped: false, errors: [] } });
    const onClose = vi.fn();
    render(wrap(<ProductPickerDialog isOpen onClose={onClose} onInsert={vi.fn()} roomId="r1" />));

    fireEvent.change(screen.getByPlaceholderText('ค้นหาชื่อรุ่น / ยี่ห้อ / IMEI'), {
      target: { value: 'iphone' },
    });
    fireEvent.click(await screen.findByText('Apple iPhone 13'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งการ์ด (รูป + ข้อความ)' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Apple iPhone 14'));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งการ์ด (รูป + ข้อความ)' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));

    const [, firstBody] = vi.mocked(api.post).mock.calls[0];
    const [, secondBody] = vi.mocked(api.post).mock.calls[1];
    expect((secondBody as any).productId).toBe('p2');
    expect((firstBody as any).clientMessageId).not.toBe((secondBody as any).clientMessageId);
  });
});
