import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Customer } from '../types';
import CustomerSearch from './CustomerSearch';

/**
 * POS "เพิ่มลูกค้าใหม่" (dialog 2 ช่อง) + ชิปรู้จักร้านจากไหน — POSPage.test mock คอมโพเนนต์นี้ทั้งตัว ไฟล์นี้จึงเป็นเทสแรกของมัน
 * 🔴 hook ของ vitest ห้าม return ค่า (mockReset คืนฟังก์ชัน = teardown ลอย) ⇒ คร่อมปีกกาเสมอ
 * reject ด้วย mockImplementation ตอนถูกเรียกเท่านั้น (mockRejectedValue = unhandled rejection ตั้งแต่ตั้งค่า)
 */

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const GROUP_NAME = 'ลูกค้ารู้จักร้านจากไหน';
const WARNING = 'บันทึกลูกค้าแล้ว แต่บันทึกช่องทางที่รู้จักไม่สำเร็จ';
const CREATED = { id: 'c-new', name: 'ทดสอบ หน้าร้าน', phone: '0800000000', nationalId: null };
const SELECTED_NEW: Customer = { id: 'c-new', name: 'ทดสอบ หน้าร้าน', phone: '0800000000', nationalId: '', _count: { contracts: 0 } };
const EXISTING: Customer = { id: 'c-old', name: 'ลูกค้าเดิม ทดสอบ', phone: '0800000001', nationalId: '', _count: { contracts: 1 } };

function Harness({ onSelectCustomer }: { onSelectCustomer: (customer: Customer) => void }) {
  const [search, setSearch] = useState('');
  return (
    <CustomerSearch
      customerSearch={search}
      setCustomerSearch={setSearch}
      selectedCustomer={null}
      onSelectCustomer={onSelectCustomer}
      onClearCustomer={() => undefined}
    />
  );
}

function renderSearch() {
  const onSelectCustomer = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness onSelectCustomer={onSelectCustomer} />
    </QueryClientProvider>,
  );
  return onSelectCustomer;
}

async function openCreateDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มลูกค้าใหม่' }));
  return screen.findByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
}

function fillNameAndPhone(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByLabelText('ชื่อลูกค้า *'), { target: { value: 'ทดสอบ หน้าร้าน' } });
  fireEvent.change(within(dialog).getByLabelText('เบอร์โทร *'), { target: { value: '0800000000' } });
}

const heardFromGroup = (dialog: HTMLElement) => within(dialog).getByRole('group', { name: GROUP_NAME });
const chip = (dialog: HTMLElement, label: string) => within(heardFromGroup(dialog)).getByRole('button', { name: label });

beforeEach(() => {
  mocks.get.mockReset();
  mocks.post.mockReset();
  mocks.toast.success.mockReset();
  mocks.toast.warning.mockReset();
  mocks.toast.error.mockReset();
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/customers/search') return { data: [EXISTING] };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe('POS CustomerSearch — เพิ่มลูกค้าใหม่ + ชิปรู้จักร้านจากไหน', () => {
  it('เลือกชิปแล้วบันทึก → POST /customers ด้วยชื่อ+เบอร์เท่านั้น แล้ว POST journey/entries ไปที่ id ใหม่ · เลือกลูกค้าใหม่ให้ POS', async () => {
    mocks.post.mockImplementation(async (url: string) =>
      url === '/customers' ? { data: CREATED } : { data: { entryId: 'e-1', event: null, summary: null } },
    );
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(chip(dialog, 'ผ่านหน้าร้าน'));
    expect(chip(dialog, 'ผ่านหน้าร้าน')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith(SELECTED_NEW));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[0]).toEqual(['/customers', { name: 'ทดสอบ หน้าร้าน', phone: '0800000000' }]);
    const [entryUrl, entryBody] = mocks.post.mock.calls[1] as [string, Record<string, unknown>];
    expect(entryUrl).toBe('/customers/c-new/journey/entries');
    expect(entryBody).toEqual({ kind: 'HEARD_FROM', heardFrom: 'WALK_BY', clientRequestId: expect.any(String) });
    expect(mocks.post.mock.invocationCallOrder[1]).toBeLessThan(onSelectCustomer.mock.invocationCallOrder[0]);
    expect(mocks.toast.success).toHaveBeenCalledWith('เพิ่มลูกค้าใหม่สำเร็จ');
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('บันทึกชิปไม่สำเร็จ → ยังเลือกลูกค้าใหม่ให้ POS · toast สำเร็จก่อนแล้วตามด้วย toast เตือน · ไม่มี toast error', async () => {
    mocks.post.mockImplementation((url: string) =>
      url === '/customers' ? Promise.resolve({ data: CREATED }) : Promise.reject(new Error('journey entries unavailable')),
    );
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(chip(dialog, 'เพื่อนแนะนำ'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith(SELECTED_NEW));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.toast.success).toHaveBeenCalledWith('เพิ่มลูกค้าใหม่สำเร็จ');
    expect(mocks.toast.warning).toHaveBeenCalledWith(WARNING);
    expect(mocks.toast.success.mock.invocationCallOrder[0]).toBeLessThan(mocks.toast.warning.mock.invocationCallOrder[0]);
    expect(mocks.toast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('ไม่เลือกชิป → ยิงแค่ POST /customers ครั้งเดียว ไม่มี toast เตือน', async () => {
    mocks.post.mockResolvedValue({ data: CREATED });
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(onSelectCustomer).toHaveBeenCalledWith(SELECTED_NEW));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0]).toEqual(['/customers', { name: 'ทดสอบ หน้าร้าน', phone: '0800000000' }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('เพิ่มลูกค้าใหม่สำเร็จ');
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it('สร้างลูกค้าไม่สำเร็จ → dialog ยังเปิด ชิปที่เลือกยังค้าง ไม่ยิง journey/entries · ปิดแล้วเปิดใหม่ = ชิปว่าง', async () => {
    mocks.post.mockImplementation(() => Promise.reject(new Error('เบอร์โทรนี้มีลูกค้าอยู่แล้ว')));
    const onSelectCustomer = renderSearch();
    const dialog = await openCreateDialog();
    fillNameAndPhone(dialog);
    fireEvent.click(chip(dialog, 'TikTok'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึกลูกค้า' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('เบอร์โทรนี้มีลูกค้าอยู่แล้ว'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(onSelectCustomer).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' })).toBeInTheDocument();
    expect(chip(dialog, 'TikTok')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const reopened = await openCreateDialog();
    expect(within(heardFromGroup(reopened)).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('เลือกลูกค้าเดิมจากผลค้นหา → ไม่ถามรู้จักร้านจากไหน ไม่ยิง POST ใด ๆ', async () => {
    const onSelectCustomer = renderSearch();
    fireEvent.change(screen.getByPlaceholderText(/พิมพ์อย่างน้อย 2 ตัวอักษร/), { target: { value: 'ทดสอบ' } });
    fireEvent.click(await screen.findByRole('button', { name: /ลูกค้าเดิม ทดสอบ/ }));

    expect(onSelectCustomer).toHaveBeenCalledWith(EXISTING);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('group', { name: GROUP_NAME })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
