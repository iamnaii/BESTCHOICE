import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OnlineListingPanel from '../OnlineListingPanel';
const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: mocks, getErrorMessage: () => 'ผิดพลาด' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const product = { id: 'p1', category: 'PHONE_USED', photos: [], gallery: [], isOnlineVisible: true, onlineDescription: '', conditionGrade: null, onlineCoverAngle: null, usesAutomaticPhotos: true };
const photo = 'data:image/png;base64,aGVsbG8=';
function mount(canEdit = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OnlineListingPanel product={product} canEdit={canEdit} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/readiness') ? { productId: 'p1', isReady: true, isOnlineVisible: true, checks: [] } : { photos: { front: photo, back: photo, left: photo, right: photo, top: photo, bottom: photo }, evidencePhotos: { imeiScreen: photo } } }));
  mocks.patch.mockResolvedValue({ data: {} });
});
describe('automatic listing photos', () => {
  it('combines product information, pricing and listing controls in one page', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnlineListingPanel product={product} canEdit productInfo={<h2>ข้อมูลเครื่องตัวอย่าง</h2>}
        pricing={<h2>ราคาขายตัวอย่าง</h2>} calculator={<h2>ค่างวดตัวอย่าง</h2>}
        additionalInfo={<h2>ข้อมูลสต็อกเพิ่มเติม</h2>} />
    </QueryClientProvider>);
    expect(screen.getByRole('heading', { name: 'ข้อมูลเครื่องตัวอย่าง' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ราคาขายตัวอย่าง' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ค่างวดตัวอย่าง' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ข้อมูลสต็อกเพิ่มเติม' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'เปิดแสดงบนเว็บ' })).toBeInTheDocument();
    expect(await screen.findAllByRole('img', { name: /รูปด้าน/ })).toHaveLength(6);
  });
  it('shows six recorded angles without promotion buttons and lets an editor select cover', async () => {
    mount();
    await screen.findByText('รูปสินค้า 6 ด้าน');
    expect(await screen.findAllByRole('img', { name: /รูปด้าน/ })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'ส่งขึ้นเว็บ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ใช้รูปด้านหลังเป็นปก' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/products/p1/online-listing', { onlineCoverAngle: 'back' }));
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('prevents read-only staff changing cover', async () => {
    mount(false);
    expect(await screen.findByRole('button', { name: 'ใช้รูปด้านหลังเป็นปก' })).toBeDisabled();
  });
  it('does not send accessory users to an unavailable six-angle photo tab', () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OnlineListingPanel product={{ ...product, category: 'ACCESSORY', usesAutomaticPhotos: false }} canEdit />
    </QueryClientProvider>);
    expect(screen.queryByRole('heading', { name: 'รูปสินค้า 6 ด้าน' })).not.toBeInTheDocument();
    expect(screen.queryByText(/เพิ่มได้ที่แท็บรูปถ่าย/)).not.toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalledWith('/products/p1/photos');
  });
});
