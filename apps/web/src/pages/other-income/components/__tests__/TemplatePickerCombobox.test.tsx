import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const templatesApi = vi.hoisted(() => ({ list: vi.fn(), use: vi.fn() }));
vi.mock('@/lib/otherIncome', () => ({ otherIncomeApi: { templates: templatesApi } }));

import { TemplatePickerCombobox } from '../TemplatePickerCombobox';

const TEMPLATES = [
  { id: 'tpl-1', name: 'ค่าเช่าพื้นที่รายเดือน', itemsJson: [{}, {}], useCount: 3 },
  { id: 'tpl-2', name: 'ดอกเบี้ยเงินฝาก', itemsJson: [{}], useCount: 0 },
];
const ITEMS = [{ accountCode: '42-1102', description: 'ดอกเบี้ยเงินฝาก', quantity: 1, unitAmount: 100 }];

function renderPicker() {
  const onApply = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    // the section header that hosts the button clips nothing today, but an overflow-hidden host
    // proves the menu does not depend on its container
    <div data-testid="host" className="overflow-hidden">
      <TemplatePickerCombobox onApply={onApply} />
      <button type="button">ปุ่มอื่นบนหน้า</button>
    </div>,
    { wrapper },
  );
  return { onApply, trigger: screen.getByRole('button', { name: 'ใช้แม่แบบ' }) };
}

beforeEach(() => {
  templatesApi.list.mockReset().mockResolvedValue(TEMPLATES);
  templatesApi.use.mockReset().mockResolvedValue({ items: ITEMS, priceType: 'INCLUSIVE' });
});

// Characterization — passes on the inline panel before the switch and on the Popover after it.
describe('TemplatePickerCombobox — command behaviour', () => {
  it('loads the templates only when opened, then lists each name with its line and use counts', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    expect(templatesApi.list).not.toHaveBeenCalled();

    await user.click(trigger);

    expect(await screen.findByText('ค่าเช่าพื้นที่รายเดือน')).toBeInTheDocument();
    expect(screen.getByText('2 รายการ · ใช้ 3 ครั้ง')).toBeInTheDocument();
    expect(screen.getByText('ดอกเบี้ยเงินฝาก')).toBeInTheDocument();
    expect(screen.getByText('1 รายการ · ใช้ 0 ครั้ง')).toBeInTheDocument();
    expect(templatesApi.list).toHaveBeenCalledTimes(1);
  });

  it('a template applies its resolved lines and price type, then the menu closes', async () => {
    const user = userEvent.setup();
    const { trigger, onApply } = renderPicker();
    await user.click(trigger);

    await user.click(await screen.findByRole('button', { name: /^ดอกเบี้ยเงินฝาก/ }));

    await waitFor(() => expect(onApply).toHaveBeenCalledExactlyOnceWith(ITEMS, 'INCLUSIVE'));
    expect(templatesApi.use).toHaveBeenCalledExactlyOnceWith('tpl-2');
    await waitFor(() => expect(screen.queryByText('ค่าเช่าพื้นที่รายเดือน')).toBeNull());
  });

  it('says "ไม่มี แม่แบบ" when there are none', async () => {
    templatesApi.list.mockResolvedValue([]);
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);
    expect(await screen.findByText('ไม่มี แม่แบบ')).toBeInTheDocument();
  });

  it('says "กำลังโหลด..." while the list loads', async () => {
    templatesApi.list.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);
    expect(await screen.findByText('กำลังโหลด...')).toBeInTheDocument();
  });

  it('a click elsewhere on the page closes the menu without applying anything', async () => {
    const user = userEvent.setup();
    const { trigger, onApply } = renderPicker();
    await user.click(trigger);
    await screen.findByText('ค่าเช่าพื้นที่รายเดือน');

    await user.click(screen.getByRole('button', { name: 'ปุ่มอื่นบนหน้า' }));

    await waitFor(() => expect(screen.queryByText('ค่าเช่าพื้นที่รายเดือน')).toBeNull());
    expect(templatesApi.use).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

// Owner 2026-11-16: the panel ran past the right edge at 1024 (856→1144) and 390 (258→546).
describe('TemplatePickerCombobox — portalled menu inside the viewport', () => {
  it('renders the menu in document.body, outside its host, aligned to the button end and no wider than the screen', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();
    await user.click(trigger);

    const menu = await screen.findByRole('dialog', { name: 'แม่แบบรายได้' });
    expect(screen.getByTestId('host')).not.toContainElement(menu);
    expect(document.body).toContainElement(menu);
    expect(menu).toHaveAttribute('data-slot', 'popover-content');
    expect(menu).toHaveAttribute('data-align', 'end');
    expect(menu).toHaveClass('w-72', 'max-w-[calc(100vw-2rem)]', 'max-h-72', 'overflow-y-auto', 'p-0');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('ค่าเช่าพื้นที่รายเดือน')).toBeInTheDocument();
  });

  it('Escape closes the menu without applying and gives focus back to the button', async () => {
    const user = userEvent.setup();
    const { trigger, onApply } = renderPicker();
    await user.click(trigger);
    await screen.findByText('ค่าเช่าพื้นที่รายเดือน');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByText('ค่าเช่าพื้นที่รายเดือน')).toBeNull());
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
