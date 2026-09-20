import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContractBundlesCard, { type ContractBundleRow } from './ContractBundlesCard';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api, getErrorMessage: (e: Error) => e.message }));
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: (v: unknown) => v }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const row = (over: Partial<ContractBundleRow>): ContractBundleRow => ({
  id: 'a1', name: 'เคสใส iPhone 15', brand: 'B', model: 'Case', category: 'ACCESSORY', status: 'RESERVED', imeiSerial: null, deletedAt: null, ...over,
});

function mount(props: Partial<Parameters<typeof ContractBundlesCard>[0]>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContractBundlesCard contractId="ct-1" contractStatus="DRAFT" branchId="br-1" mainProductId="main-1"
        bundleProducts={[]} canEdit={false} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { api.get.mockReset(); api.patch.mockReset(); });

describe('ContractBundlesCard — การ์ดของแถมหน้ารายละเอียดสัญญา', () => {
  it('ร่าง: ป้าย "จองไว้" + แก้ไขได้จนกว่าจะเปิดใช้', () => {
    mount({ bundleProducts: [row({})], canEdit: true });
    expect(screen.getByText('จองไว้')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แก้ไข' })).toBeInTheDocument();
    expect(screen.getByText('เพิ่ม/นำออกได้จนกว่าจะเปิดใช้สัญญา')).toBeInTheDocument();
  });

  it('เปิดใช้แล้ว: ป้าย "ตัดสต๊อกแล้ว" และไม่มีปุ่มแก้ไข แม้ผู้ใช้มีสิทธิ์', () => {
    mount({ contractStatus: 'ACTIVE', bundleProducts: [row({ status: 'SOLD_CASH' })], canEdit: true });
    expect(screen.getByText('ตัดสต๊อกแล้ว')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ไข' })).not.toBeInTheDocument();
    expect(screen.getByText('ต้นทุนของแถมลงบัญชีหน้าร้านแล้ว · แก้ไขไม่ได้')).toBeInTheDocument();
  });

  it('ยกเลิกสัญญา: ป้าย "คืนเข้าคลังแล้ว"', () => {
    mount({ contractStatus: 'CANCELED', bundleProducts: [row({ status: 'IN_STOCK' })] });
    expect(screen.getByText('คืนเข้าคลังแล้ว')).toBeInTheDocument();
  });

  it('ไม่มีของแถม + ไม่ใช่ร่าง → ไม่แสดงการ์ด', () => {
    const { container } = mount({ contractStatus: 'ACTIVE' });
    expect(container).toBeEmptyDOMElement();
  });

  it('ร่างที่ยังไม่มีของแถม + มีสิทธิ์ → มีปุ่มเพิ่ม (เคสพนักงานลืมใส่ตอนสร้างสัญญา)', () => {
    mount({ canEdit: true });
    expect(screen.getByRole('button', { name: 'เพิ่มของแถม' })).toBeInTheDocument();
  });

  it('บันทึก = PATCH /contracts/:id/bundles ด้วยรายการทั้งชุด', async () => {
    api.get.mockResolvedValue({ data: { data: [{ id: 'a2', name: 'ฟิล์มกระจก', brand: 'B', model: 'Film', category: 'ACCESSORY' }] } });
    api.patch.mockResolvedValue({ data: {} });
    const onSaved = vi.fn();
    mount({ bundleProducts: [row({})], canEdit: true, onSaved });
    fireEvent.click(screen.getByRole('button', { name: 'แก้ไข' }));
    fireEvent.change(screen.getByPlaceholderText(/ค้นหาของแถม/), { target: { value: 'ฟิล์ม' } });
    fireEvent.click(await screen.findByRole('button', { name: /ฟิล์มกระจก/ }));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกของแถม' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/contracts/ct-1/bundles', { bundleProductIds: ['a1', 'a2'] }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // ค้นเฉพาะอุปกรณ์เสริมของสาขาสัญญา
    expect(api.get).toHaveBeenCalledWith('/products', { params: expect.objectContaining({ category: 'ACCESSORY', branchId: 'br-1' }) });
  });
});
