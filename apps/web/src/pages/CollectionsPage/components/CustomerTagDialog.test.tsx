/**
 * CustomerTagDialog กับ tag AUTO-only `RETURNED_DEVICE` (ใบรับเครื่องคืน 2026-09-20):
 * ไม่อยู่ในรายการติดมือ และปุ่มถอดปิด (recompute รายคืนจะติดกลับเมื่อยังมีใบรับคืน/รายการยึด)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const mutations = vi.hoisted(() => ({ apply: vi.fn(), remove: vi.fn() }));
let returnedSource = 'AUTO';
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterAll(() => {
  if (originalScroll)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
beforeEach(() => {
  returnedSource = 'AUTO';
  mutations.apply.mockReset().mockResolvedValue({});
  mutations.remove.mockReset();
});

vi.mock('../hooks/useCustomerTags', () => ({
  useCustomerTags: () => ({
    data: [
      {
        id: 't-ret',
        customerId: 'cu1',
        tag: 'RETURNED_DEVICE',
        source: returnedSource,
        reason: 'AUTO: เคยคืน/ถูกยึดเครื่อง',
        appliedByUserId: null,
        createdAt: '2026-09-20T03:00:00.000Z',
      },
      {
        id: 't-vip',
        customerId: 'cu1',
        tag: 'VIP',
        source: 'MANUAL',
        reason: null,
        appliedByUserId: 'u1',
        createdAt: '2026-09-01T03:00:00.000Z',
      },
    ],
    isLoading: false,
  }),
  useApplyCustomerTag: () => ({ mutateAsync: mutations.apply, isPending: false }),
  useRemoveCustomerTag: () => ({ mutate: mutations.remove, isPending: false }),
}));

import CustomerTagDialog, { AUTO_ONLY_TAGS, MANUAL_TAG_OPTIONS } from './CustomerTagDialog';
import ProspectFilterBar from '@/pages/CustomersPage/components/ProspectFilterBar';

describe('CustomerTagDialog — RETURNED_DEVICE เป็น AUTO-only', () => {
  it('ไม่อยู่ในตัวเลือกติดมือ แต่ยังอยู่ในกลุ่ม AUTO-only', () => {
    expect(MANUAL_TAG_OPTIONS).toBeDefined();
    expect(MANUAL_TAG_OPTIONS.map((t) => t.value)).not.toContain('RETURNED_DEVICE');
    expect(MANUAL_TAG_OPTIONS.map((t) => t.value)).toEqual([
      'VIP',
      'HIGH_RISK',
      'NEW',
      'LOYAL',
      'BLACKLIST',
    ]);
    expect(AUTO_ONLY_TAGS).toEqual(['RETURNED_DEVICE']);
  });

  it.each(['AUTO', 'MANUAL'])(
    'blocks returned-device removal for %s rows while VIP remains removable',
    (source) => {
      returnedSource = source;
      render(<CustomerTagDialog open onClose={() => {}} customerId="cu1" />);
      expect(screen.getByText('เคยคืนเครื่อง')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ลบ RETURNED_DEVICE' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'ลบ VIP' })).toBeEnabled();
      expect(screen.getByText(/ติดอัตโนมัติจากใบรับเครื่องคืน\/รายการยึด/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'ลบ RETURNED_DEVICE' }));
      expect(mutations.remove).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'ลบ VIP' }));
      expect(mutations.remove).toHaveBeenCalledWith({ id: 't-vip', customerId: 'cu1' });
    },
  );

  it('offers only the five manual tags in the actual selector and still applies VIP', async () => {
    render(<CustomerTagDialog open onClose={() => {}} customerId="cu1" />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'tag' }), { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'VIP',
      'เสี่ยงสูง',
      'ลูกค้าใหม่',
      'ลูกค้าประจำ',
      'BLACKLIST',
    ]);
    expect(screen.queryByRole('option', { name: 'เคยคืนเครื่อง' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'VIP' }));
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่ม tag' }));
    await waitFor(() =>
      expect(mutations.apply).toHaveBeenCalledWith({
        customerId: 'cu1',
        tag: 'VIP',
        reason: undefined,
      }),
    );
  });

  it('allows the automatic tag as a prospect filter without making it manually attachable', async () => {
    const setFilters = vi.fn();
    render(
      <ProspectFilterBar
        search=""
        setSearch={() => {}}
        source=""
        precheck=""
        tag=""
        contacted=""
        owner=""
        staff={[]}
        setFilters={setFilters}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'แท็ก' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'เคยคืนเครื่อง' }));
    expect(setFilters).toHaveBeenCalledWith({ tag: 'RETURNED_DEVICE' });
    expect(mutations.apply).not.toHaveBeenCalled();
  });
});
