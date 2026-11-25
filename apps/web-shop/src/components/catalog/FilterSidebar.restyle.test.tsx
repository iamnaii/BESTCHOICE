import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterSidebar, type CatalogFilters, type PlanControls } from './FilterSidebar';

function plan(over: Partial<PlanControls> = {}): PlanControls {
  return {
    down: null,
    months: null,
    monthsOptions: [],
    onDown: vi.fn(),
    onMonths: vi.fn(),
    freeDown: false,
    freeDownCount: 0,
    onFreeDown: vi.fn(),
    ...over,
  };
}
function show(
  filters: CatalogFilters = {},
  extra: Partial<Parameters<typeof FilterSidebar>[0]> = {},
) {
  const onChange = vi.fn();
  const view = render(
    <FilterSidebar
      filters={filters}
      onChange={onChange}
      models={[{ model: 'iPhone 15', count: 3 }]}
      {...extra}
    />,
  );
  return { onChange, ...view };
}
const origin = () => screen.getByRole('group', { name: 'เครื่องไทย / เครื่องนอก' });
const price = () => screen.getByRole('group', { name: 'ช่วงราคา' });
const isPressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

describe('ตัวกรองโฉมใหม่', () => {
  it('เครื่องไทย / เครื่องนอก เป็นปุ่มกด 3 ตัว สูง 44px — กดแล้วแจ้งกลับ', () => {
    const { onChange } = show();
    const buttons = within(origin()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['ทั้งหมด', 'เครื่องไทย', 'เครื่องนอก']);
    expect(buttons.map(isPressed)).toEqual([true, false, false]);
    for (const b of buttons) expect(b.className).toContain('min-h-11');
    fireEvent.click(within(origin()).getByRole('button', { name: 'เครื่องนอก' }));
    expect(onChange.mock.calls[0][0].deviceOrigin).toBe('IMPORTED');
  });

  it('ตัวที่เลือกอยู่ถูกกดค้าง · กด "ทั้งหมด" ล้างเฉพาะตัวกรองนี้', () => {
    const { onChange } = show({ deviceOrigin: 'THAI', condition: 'USED' });
    expect(isPressed(within(origin()).getByRole('button', { name: 'เครื่องไทย' }))).toBe(true);
    expect(isPressed(within(origin()).getByRole('button', { name: 'ทั้งหมด' }))).toBe(false);
    fireEvent.click(within(origin()).getByRole('button', { name: 'ทั้งหมด' }));
    expect(onChange.mock.calls[0][0].deviceOrigin).toBeUndefined();
    expect(onChange.mock.calls[0][0].condition).toBe('USED');
  });

  it('ช่วงราคาเป็นปุ่มกด 6 ช่วงเดิม — กดแล้วได้ minPrice / maxPrice', () => {
    const { onChange } = show({ minPrice: 30000 });
    const buttons = within(price()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'ทุกช่วงราคา',
      'ไม่เกิน ฿10,000',
      '฿10,000 – ฿15,000',
      '฿15,000 – ฿20,000',
      '฿20,000 – ฿30,000',
      '฿30,000 ขึ้นไป',
    ]);
    expect(buttons.map(isPressed)).toEqual([false, false, false, false, false, true]);
    for (const b of buttons) expect(b.className).toContain('min-h-11');
    fireEvent.click(within(price()).getByRole('button', { name: '฿10,000 – ฿15,000' }));
    expect(onChange.mock.calls[0][0]).toMatchObject({ minPrice: 10000, maxPrice: 15000 });
    fireEvent.click(within(price()).getByRole('button', { name: 'ทุกช่วงราคา' }));
    expect(onChange.mock.calls[1][0].minPrice).toBeUndefined();
    expect(onChange.mock.calls[1][0].maxPrice).toBeUndefined();
  });

  it('ไม่มีตัวกรอง "สภาพเครื่อง" · ดรอปดาวน์เหลือ "รุ่น" ตัวเดียว', () => {
    show({ condition: 'USED' });
    expect(screen.queryByText('สภาพเครื่อง')).not.toBeInTheDocument();
    expect(screen.queryByText(/เกรด A/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox').map((el) => el.id)).toEqual(['filter-model']);
  });

  it('"ล้างตัวกรองทั้งหมด" ขึ้นเมื่อมีเงินดาวน์หรือติ๊กฟรีดาวน์ และเรียก onClearAll', () => {
    const onClearAll = vi.fn();
    const first = show({}, { plan: plan(), onClearAll });
    expect(screen.queryByRole('button', { name: 'ล้างตัวกรองทั้งหมด' })).not.toBeInTheDocument();
    first.unmount();

    const second = show({}, { plan: plan({ freeDown: true }), onClearAll });
    expect(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' })).toBeInTheDocument();
    second.unmount();

    const { onChange } = show({}, { plan: plan({ down: 5000 }), onClearAll });
    const button = screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' });
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(onClearAll).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ไม่ส่ง onClearAll → ล้างตัวกรองผ่าน onChange แบบเดิม (คำค้นหายังอยู่)', () => {
    const { onChange } = show({ condition: 'USED', search: 'โปร' });
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรองทั้งหมด' }));
    expect(onChange.mock.calls[0][0].condition).toBeUndefined();
    expect(onChange.mock.calls[0][0].search).toBe('โปร');
  });
});

describe('id ไม่ซ้ำระหว่างแถบข้าง (desktop) กับกล่องตัวกรองมือถือ', () => {
  it('สอง instance → ไม่มี id ซ้ำ · label "รุ่น" / "จำนวนงวด" ผูกกับช่องของ instance ตัวเอง', () => {
    const models = [{ model: 'iPhone 15', count: 3 }];
    const p = plan({ monthsOptions: [10, 12] });
    render(
      <>
        <div data-testid="a">
          <FilterSidebar filters={{}} onChange={vi.fn()} models={models} plan={p} />
        </div>
        <div data-testid="b">
          <FilterSidebar filters={{}} onChange={vi.fn()} models={models} plan={p} bare />
        </div>
      </>,
    );
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const [t, prefix] of [
      ['a', 'filter'],
      ['b', 'mobile-filter'],
    ]) {
      const scope = within(screen.getByTestId(t));
      expect(scope.getByLabelText('รุ่น').id).toBe(`${prefix}-model`);
      expect(scope.getByLabelText('จำนวนงวด').id).toBe(`${prefix}-months`);
    }
  });
});

