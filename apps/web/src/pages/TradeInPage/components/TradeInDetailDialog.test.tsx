import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TradeInDetailDialog from './TradeInDetailDialog';
import api from '@/lib/api';
vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }));
const auth = vi.hoisted(() => ({ user: { role: 'OWNER' } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
const record = {
  id: 'trade-1',
  productId: 'product-1',
  status: 'ACCEPTED',
  flow: 'BUYBACK',
  deviceBrand: 'Apple',
  deviceModel: 'iPhone 15',
  deviceStorage: '256GB',
  deviceColor: 'ดำ',
  deviceCondition: 'B',
  imei: '359000000000081',
  serialNumber: 'ORIGINAL-SN',
  sellerName: 'ผู้ขายตามใบรับเครื่อง',
  sellerPhone: '0000000000',
  sellerAddress: 'ที่อยู่ในใบรับเครื่อง',
  agreedPrice: '5000.50',
  voucherNumber: 'EXP-20260900034',
  paymentMethod: 'TRANSFER',
  transferBankName: 'ธนาคารตัวอย่าง',
  transferAccountNumber: '1234567890',
  transferAccountName: 'ผู้ขายตามใบรับเครื่อง',
  createdAt: '2026-09-08T09:47:00Z',
  idCardVerifiedAt: '2026-09-08T09:48:00Z',
  sellerConsentSigned: true,
  branch: { name: 'สาขาตัวอย่าง' },
  idCardVerifiedBy: { name: 'ผู้รับซื้อทดสอบ' },
  product: { id: 'product-1', status: 'PHOTO_PENDING' },
};
let detail: Record<string, unknown>;
let product: Record<string, unknown>;
function setup(onVoucher?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TradeInDetailDialog id="trade-1" onClose={vi.fn()} onVoucher={onVoucher} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.user.role = 'OWNER';
  detail = { ...record };
  product = {
    id: 'product-1',
    status: 'IN_STOCK',
    cashPrice: '6000',
    installmentPrice: '6500',
    prices: [],
    imeiSerial: 'MUTATED-IMEI',
    serialNumber: 'MUTATED-SN',
  };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/trade-ins/trade-1') return { data: detail };
    if (url === '/products/product-1') return { data: product };
    if (url === '/products/product-1/photos')
      return { data: { completedCount: 6, totalCount: 6, isCompleted: true } };
    throw new Error(`Unexpected URL: ${url}`);
  });
});
describe('Trade-in details needed to continue work', () => {
  it('shows receipt details with current inventory status, photos and both prices', async () => {
    setup();
    expect(await screen.findByText('EXP-20260900034')).toBeVisible();
    for (const text of [
      'สาขาตัวอย่าง',
      'ผู้รับซื้อทดสอบ',
      'ที่อยู่ในใบรับเครื่อง',
      'ORIGINAL-SN',
      '359000000000081',
      '฿5,000.50',
    ])
      expect(screen.getByText(text, { exact: true })).toBeVisible();
    const stock = await screen.findByRole('region', { name: 'สถานะเครื่องปัจจุบัน' });
    expect(await within(stock).findByText('พร้อมขาย', { exact: true })).toBeVisible();
    for (const text of ['6/6 มุม', '฿6,000', '฿6,500'])
      expect(within(stock).getByText(text)).toBeVisible();
    expect(screen.queryByText(/MUTATED/)).not.toBeInTheDocument();
    expect(screen.queryByText('1234567890')).not.toBeInTheDocument();
    expect(screen.getByText('xxxxx67890')).toBeVisible();
  });
  it('retries failed detail requests instead of leaving a blank modal', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ไม่สามารถโหลดรายละเอียดรายการรับซื้อได้',
    );
    await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(await screen.findByText('EXP-20260900034')).toBeVisible();
  });
  it('keeps partial historical quote and answer JSON readable', async () => {
    detail = {
      ...record,
      productId: null,
      quoteBreakdown: { cashPrice: '5000', chosenFlow: 'BUYBACK' },
      conditionAnswers: [{ questionKey: 'screen', title: 'หน้าจอ', selectType: 'MULTI' }],
    };
    setup();
    expect(await screen.findByText('EXP-20260900034')).toBeVisible();
    expect(screen.getByText('หน้าจอ', { exact: true })).toBeVisible();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
  it('lets sales print an existing document but directs missing-document creation to a manager', async () => {
    auth.user.role = 'SALES';
    detail = { ...record, voucherNumber: null };
    const onVoucher = vi.fn();
    setup(onVoucher);
    expect(await screen.findByText(/ให้ผู้จัดการออกเอกสารรับเครื่องก่อน/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'ออกเอกสารรับเครื่อง' })).not.toBeInTheDocument();
    expect(onVoucher).not.toHaveBeenCalled();
  });
  it('keeps existing-document printing available to sales', async () => {
    auth.user.role = 'SALES';
    const onVoucher = vi.fn();
    setup(onVoucher);
    await userEvent.click(await screen.findByRole('button', { name: 'พิมพ์เอกสารรับเครื่อง' }));
    expect(onVoucher).toHaveBeenCalledWith(expect.objectContaining({ id: record.id }));
  });
  it('honors the paid method on legacy EXCHANGE records', async () => {
    detail = { ...record, flow: 'EXCHANGE', paymentMethod: 'CASH' };
    setup();
    expect(await screen.findByText('รับซื้อเงินสด / โอน')).toBeVisible();
  });
  it('keeps an offered price separate from a still-unagreed purchase', async () => {
    detail = {
      ...record,
      status: 'APPRAISED',
      productId: null,
      agreedPrice: null,
      offeredPrice: '4500',
      estimatedValue: '5000',
    };
    setup();
    await screen.findByText('EXP-20260900034');
    expect(screen.getByText('ราคาตกลงรับเครื่อง').parentElement).toHaveTextContent('ยังไม่ระบุ');
    expect(screen.getByText('ราคาที่เสนอ').parentElement).toHaveTextContent('฿4,500');
    expect(screen.getByText('ราคาประเมิน').parentElement).toHaveTextContent('฿5,000');
  });
  it('does not treat a historical cash quote as the maximum price', async () => {
    detail = {
      ...record,
      productId: null,
      quoteBreakdown: { cashPrice: '4000', chosenFlow: 'BUYBACK' },
    };
    setup();
    expect((await screen.findByText('ราคาสูงสุด')).parentElement).toHaveTextContent('ยังไม่ระบุ');
    expect(screen.getByText('ราคารับซื้อเงินสด').parentElement).toHaveTextContent('฿4,000');
  });
  it('does not report zero photos when loading the photo record fails', async () => {
    const implementation = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (String(url).endsWith('/photos')) throw new Error('photos offline');
      return implementation(url, config);
    });
    setup();
    expect(await screen.findByText('ไม่สามารถโหลดข้อมูลรูปถ่ายได้')).toBeVisible();
    expect(screen.queryByText('0/6 มุม')).not.toBeInTheDocument();
    expect(await screen.findByText('฿6,000')).toBeVisible();
    expect(screen.getByRole('link', { name: 'เปิดเครื่อง ดูรูปและราคา' })).toHaveAttribute(
      'href',
      '/products/product-1?zone=shop',
    );
  });
  it('distinguishes sold stock from ready-to-sell stock', async () => {
    product = { ...product, status: 'SOLD_CASH' };
    setup();
    expect(await screen.findByText('ขายสด', { exact: true })).toBeVisible();
    expect(screen.queryByText('พร้อมขาย', { exact: true })).not.toBeInTheDocument();
  });
  it('directs sales staff to a manager when prices are missing', async () => {
    auth.user.role = 'SALES';
    product = { ...product, status: 'PHOTO_PENDING', cashPrice: null, installmentPrice: null };
    setup();
    expect(await screen.findByText(/ให้ผู้จัดการตั้งราคาขาย/)).toBeVisible();
    const stock = screen.getByRole('region', { name: 'สถานะเครื่องปัจจุบัน' });
    expect(within(stock).getAllByText('ยังไม่ตั้งราคา')).toHaveLength(2);
    expect(within(stock).queryByText('฿0')).not.toBeInTheDocument();
  });
});
