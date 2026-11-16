import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { openCombobox, pickComboOption } from '@/test/combobox';
import AddressForm, {
  composeAddress,
  deserializeAddress,
  emptyAddress,
  type AddressData,
} from './AddressForm';

// Characterization of the address flow (spec 2026-11-14 §6.4 row ที่อยู่, R2-2).
// Written against the SearchableSelect version and kept unchanged when AddressForm moves to
// Combobox: every query goes through roles and the labels' names, never widget internals.
// Data = the real lazy-loaded chunk (@/data/thai-address-data); beforeAll fills AddressForm's
// module cache so every test starts with the full lists and no async gap.

const PROVINCE = 'จังหวัด *';
const DISTRICT = 'อำเภอ/เขต *';
const SUBDISTRICT = 'ตำบล/แขวง *';
const POSTAL = 'รหัสไปรษณีย์';
const PLACEHOLDERS = ['-- เลือกจังหวัด --', '-- เลือกอำเภอ/เขต --', '-- เลือกตำบล/แขวง --'];

const BANGKOK: AddressData = {
  ...emptyAddress,
  houseNo: '12',
  road: 'ราชดำเนินใน',
  province: 'กรุงเทพมหานคร',
  district: 'เขตพระนคร',
  subdistrict: 'แขวงพระบรมมหาราชวัง',
  postalCode: '10200',
};
const CHIANG_MAI: AddressData = {
  ...emptyAddress,
  houseNo: '99/1',
  moo: '3',
  village: 'หมู่บ้านทดสอบ',
  province: 'เชียงใหม่',
  district: 'อำเภอเมืองเชียงใหม่',
  subdistrict: 'ตำบลศรีภูมิ',
  postalCode: '50200',
};

const field = (name: string) => screen.getByRole('combobox', { name });

/** The value a picker shows: the text field's value today, the trigger's text after R2-2.
 *  A placeholder counts as "shows nothing". */
function shown(el: HTMLElement): string {
  const text = el instanceof HTMLInputElement ? el.value : (el.textContent ?? '').trim();
  return PLACEHOLDERS.includes(text) ? '' : text;
}

/** Open a picker with the pointer, optionally type a search, click an option by its name. */
async function pick(user: UserEvent, name: string, option: string, search?: string) {
  await user.click(field(name));
  if (search) await user.keyboard(search);
  await user.click(await screen.findByRole('option', { name: option }));
}

const optionNames = () => screen.getAllByRole('option').map((o) => (o.textContent ?? '').trim());

/** A host like the 9 real ones: a useState object passed straight back into AddressForm. */
function Host({ initial, onChange }: { initial: AddressData; onChange: (a: AddressData) => void }) {
  const [address, setAddress] = useState(initial);
  return (
    <>
      <AddressForm
        value={address}
        onChange={(next) => {
          onChange(next);
          setAddress(next);
        }}
      />
      <button type="button">ถัดไป</button>
    </>
  );
}

beforeAll(async () => {
  await import('@/data/thai-address-data');
  const user = userEvent.setup();
  const { unmount } = render(<AddressForm value={emptyAddress} onChange={() => {}} />);
  await user.click(field(PROVINCE));
  // the province list fills once AddressForm's own import() has put the data in its cache
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(77), { timeout: 20_000 });
  unmount();
}, 30_000);

describe('AddressForm — cascade จังหวัด → อำเภอ → ตำบล → รหัสไปรษณีย์', () => {
  it('starts with only the province open; each pick enables the next and the subdistrict fills the postal code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={emptyAddress} onChange={onChange} />);

    expect(field(PROVINCE)).toBeEnabled();
    expect(field(DISTRICT)).toBeDisabled();
    expect(field(SUBDISTRICT)).toBeDisabled();
    expect(screen.getByLabelText(POSTAL)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');

    await pick(user, PROVINCE, 'กรุงเทพมหานคร', 'กรุงเทพ');
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyAddress, province: 'กรุงเทพมหานคร' });
    expect(shown(field(PROVINCE))).toBe('กรุงเทพมหานคร');
    expect(field(DISTRICT)).toBeEnabled();
    expect(field(SUBDISTRICT)).toBeDisabled();

    await pick(user, DISTRICT, 'เขตพระนคร', 'พระนคร');
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAddress,
      province: 'กรุงเทพมหานคร',
      district: 'เขตพระนคร',
    });
    expect(shown(field(DISTRICT))).toBe('เขตพระนคร');
    expect(field(SUBDISTRICT)).toBeEnabled();

    await pick(user, SUBDISTRICT, 'แขวงพระบรมมหาราชวัง');
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAddress,
      province: 'กรุงเทพมหานคร',
      district: 'เขตพระนคร',
      subdistrict: 'แขวงพระบรมมหาราชวัง',
      postalCode: '10200',
    });
    expect(shown(field(SUBDISTRICT))).toBe('แขวงพระบรมมหาราชวัง');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('10200');
  });

  it('a new province clears district, subdistrict and postal code; the other fields stay', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await pick(user, PROVINCE, 'เชียงใหม่', 'เชียงใ');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      province: 'เชียงใหม่',
      district: '',
      subdistrict: '',
      postalCode: '',
    });
    expect(shown(field(DISTRICT))).toBe('');
    expect(field(SUBDISTRICT)).toBeDisabled();
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');
  });

  it('a new district clears subdistrict and postal code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await pick(user, DISTRICT, 'เขตดุสิต', 'ดุสิต');

    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      district: 'เขตดุสิต',
      subdistrict: '',
      postalCode: '',
    });
    expect(shown(field(SUBDISTRICT))).toBe('');
    await pick(user, SUBDISTRICT, 'แขวงดุสิต');
    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      district: 'เขตดุสิต',
      subdistrict: 'แขวงดุสิต',
      postalCode: '10300',
    });
  });

  it('re-picking the current province or district keeps what is below it; a different one still resets', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    // owner 2026-11-16: same province again is a no-op
    await pick(user, PROVINCE, 'กรุงเทพมหานคร', 'กรุงเทพ');
    expect(onChange).not.toHaveBeenCalled();
    expect(shown(field(DISTRICT))).toBe('เขตพระนคร');
    expect(shown(field(SUBDISTRICT))).toBe('แขวงพระบรมมหาราชวัง');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('10200');

    // same district again: same
    await pick(user, DISTRICT, 'เขตพระนคร', 'พระนคร');
    expect(onChange).not.toHaveBeenCalled();
    expect(shown(field(SUBDISTRICT))).toBe('แขวงพระบรมมหาราชวัง');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('10200');

    // a different province still resets everything below it
    await pick(user, PROVINCE, 'เชียงใหม่');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...BANGKOK,
      province: 'เชียงใหม่',
      district: '',
      subdistrict: '',
      postalCode: '',
    });
    expect(shown(field(DISTRICT))).toBe('');
    expect(shown(field(SUBDISTRICT))).toBe('');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');
  });

  it('lists every province, only the chosen province’s districts and the chosen district’s subdistricts, in the same order', async () => {
    const user = userEvent.setup();
    render(<Host initial={BANGKOK} onChange={vi.fn()} />);

    await user.click(field(PROVINCE));
    expect(optionNames()).toHaveLength(77);
    expect(optionNames().slice(0, 3)).toEqual(['กระบี่', 'กรุงเทพมหานคร', 'กาญจนบุรี']);
    await user.keyboard('{Escape}');

    await user.click(field(DISTRICT));
    expect(optionNames()).toHaveLength(50);
    expect(optionNames().slice(0, 3)).toEqual(['เขตคลองสาน', 'เขตคลองสามวา', 'เขตคลองเตย']);
    expect(optionNames()).not.toContain('อำเภอเมืองเชียงใหม่');
    await user.keyboard('{Escape}');

    await user.click(field(SUBDISTRICT));
    expect(optionNames()).toHaveLength(12);
    expect(optionNames().slice(0, 3)).toEqual(['แขวงชนะสงคราม', 'แขวงตลาดยอด', 'แขวงบวรนิเวศ']);
  });
});

describe('AddressForm — edit mode with stored values', () => {
  it('mounted with stored values (CustomerEditModal / SupplierForm): shows them, fills the lists, saves nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={CHIANG_MAI} onChange={onChange} />);

    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
    expect(shown(field(DISTRICT))).toBe('อำเภอเมืองเชียงใหม่');
    expect(shown(field(SUBDISTRICT))).toBe('ตำบลศรีภูมิ');
    expect(screen.getByLabelText(POSTAL)).toHaveValue('50200');
    expect(field(DISTRICT)).toBeEnabled();
    expect(field(SUBDISTRICT)).toBeEnabled();

    await user.click(field(SUBDISTRICT));
    expect(optionNames()).toHaveLength(16);
    await user.click(screen.getByRole('option', { name: 'ตำบลหายยา' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      ...CHIANG_MAI,
      subdistrict: 'ตำบลหายยา',
      postalCode: '50100',
    });
  });

  it('values that arrive after mount (EditCustomerDialog effect) fill the lists too', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<AddressForm value={emptyAddress} onChange={onChange} />);
    expect(field(DISTRICT)).toBeDisabled();

    rerender(<AddressForm value={CHIANG_MAI} onChange={onChange} />);

    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
    expect(field(DISTRICT)).toBeEnabled();
    await user.click(field(DISTRICT));
    expect(optionNames()).toHaveLength(25);
    expect(optionNames()).toContain('อำเภอเมืองเชียงใหม่');
    expect(optionNames()).not.toContain('เขตพระนคร');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a stored address without a postal code gets it on load, once', async () => {
    const onChange = vi.fn();
    render(<Host initial={{ ...CHIANG_MAI, postalCode: '' }} onChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(CHIANG_MAI));
    expect(screen.getByLabelText(POSTAL)).toHaveValue('50200');
    await act(async () => {});
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('AddressForm — values that are not in the lists', () => {
  it('names without the ตำบล/อำเภอ prefix (QuickBuyModal card reader) keep showing and get no postal code', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const stripped = {
      ...emptyAddress,
      houseNo: '5',
      province: 'เชียงใหม่',
      district: 'เมืองเชียงใหม่',
      subdistrict: 'ศรีภูมิ',
    };
    render(<Host initial={stripped} onChange={onChange} />);

    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
    expect(shown(field(DISTRICT))).toBe('เมืองเชียงใหม่');
    expect(shown(field(SUBDISTRICT))).toBe('ศรีภูมิ');
    expect(field(SUBDISTRICT)).toBeEnabled();
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');

    // the province is real, so its districts are listed; picking one replaces the stripped name
    await pick(user, DISTRICT, 'อำเภอเมืองเชียงใหม่', 'เมืองเชียงใหม่');
    expect(onChange).toHaveBeenLastCalledWith({
      ...stripped,
      district: 'อำเภอเมืองเชียงใหม่',
      subdistrict: '',
      postalCode: '',
    });
  });

  it('a province that is not in the data keeps showing; its district list is empty', async () => {
    const user = userEvent.setup();
    render(<Host initial={{ ...emptyAddress, province: 'กรุงเทพฯ' }} onChange={vi.fn()} />);

    expect(shown(field(PROVINCE))).toBe('กรุงเทพฯ');
    expect(field(DISTRICT)).toBeEnabled();
    await user.click(field(DISTRICT));
    expect(field(DISTRICT)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('a branch location saved as composed text never pre-fills the form (BranchesPage edit)', () => {
    const location = composeAddress(BANGKOK);
    expect(location).toBe('12 ถ.ราชดำเนินใน แขวงพระบรมมหาราชวัง เขตพระนคร กรุงเทพมหานคร 10200');
    const loaded = deserializeAddress(location);
    expect(loaded).toEqual(emptyAddress);

    render(<Host initial={loaded} onChange={vi.fn()} />);
    expect(shown(field(PROVINCE))).toBe('');
    expect(field(DISTRICT)).toBeDisabled();
    expect(screen.getByLabelText(POSTAL)).toHaveValue('');
  });
});

describe('AddressForm — keyboard, Escape and pointer (SearchableSelect behaviour kept by Combobox)', () => {
  it('keyboard only: ArrowDown opens, typing filters, ArrowDown + Enter picks the only match and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={emptyAddress} onChange={onChange} />);

    act(() => field(PROVINCE).focus());
    await user.keyboard('{ArrowDown}');
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('เชียงใ');
    expect(optionNames()).toEqual(['เชียงใหม่']);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenLastCalledWith({ ...emptyAddress, province: 'เชียงใหม่' });
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
  });

  it('Escape closes the list and keeps the saved value — typed text is never saved', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await user.click(field(PROVINCE));
    await user.keyboard('ขอน');
    expect(optionNames()).toEqual(['ขอนแก่น']);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'false');
    expect(shown(field(PROVINCE))).toBe('กรุงเทพมหานคร');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a click outside closes the list without saving the typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={BANGKOK} onChange={onChange} />);

    await user.click(field(PROVINCE));
    await user.keyboard('ขอน');
    await user.click(screen.getByLabelText('บ้านเลขที่'));

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(shown(field(PROVINCE))).toBe('กรุงเทพมหานคร');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('inside a dialog the first Escape closes only the list, the second closes the dialog', async () => {
    const user = userEvent.setup();
    function InDialog() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>ที่อยู่ลูกค้า</DialogTitle>
            <Host initial={BANGKOK} onChange={vi.fn()} />
          </DialogContent>
        </Dialog>
      );
    }
    render(<InDialog />);

    await user.click(field(PROVINCE));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field(PROVINCE)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'ที่อยู่ลูกค้า' })).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'ที่อยู่ลูกค้า' })).toBeNull());
  });

  it('after a pointer pick, clicking the field again reopens the list', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={emptyAddress} onChange={onChange} />);

    await pick(user, PROVINCE, 'ขอนแก่น');
    expect(shown(field(PROVINCE))).toBe('ขอนแก่น');
    expect(screen.queryByRole('listbox')).toBeNull();

    await user.click(field(PROVINCE));
    const listbox = screen.getByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'เชียงใหม่' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyAddress, province: 'เชียงใหม่' });
    expect(shown(field(PROVINCE))).toBe('เชียงใหม่');
  });
});

describe('AddressForm on Combobox (R2-2)', () => {
  it('strict: pickComboOption through province → district → subdistrict saves the whole address', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial={{ ...emptyAddress, houseNo: '7' }} onChange={onChange} />);

    await pickComboOption(user, PROVINCE, 'เชียงใหม่', { search: 'เชียงใ' });
    await pickComboOption(user, DISTRICT, 'อำเภอเมืองเชียงใหม่', { search: 'เมือง' });
    await pickComboOption(user, SUBDISTRICT, 'ตำบลหายยา', { search: 'หาย' });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyAddress,
      houseNo: '7',
      province: 'เชียงใหม่',
      district: 'อำเภอเมืองเชียงใหม่',
      subdistrict: 'ตำบลหายยา',
      postalCode: '50100',
    });
    expect(field(SUBDISTRICT)).toHaveTextContent('ตำบลหายยา');
  });

  it('search ranks districts and subdistricts by the name after the เขต/แขวง prefix; the full name still finds them', async () => {
    const user = userEvent.setup();
    render(<Host initial={BANGKOK} onChange={vi.fn()} />);

    await openCombobox(user, DISTRICT);
    const districtSearch = screen.getByRole('combobox', { name: 'ค้นหาอำเภอ/เขต' });
    await user.type(districtSearch, 'วัฒนา');
    expect(optionNames()).toEqual(['เขตวัฒนา', 'เขตทวีวัฒนา']);
    await user.clear(districtSearch);
    await user.type(districtSearch, 'เขตวัฒ');
    expect(optionNames()).toEqual(['เขตวัฒนา']);
    await user.keyboard('{Escape}');

    await openCombobox(user, SUBDISTRICT);
    await user.keyboard('วัง');
    expect(optionNames()).toEqual(['แขวงวังบูรพาภิรมย์', 'แขวงพระบรมมหาราชวัง']);
  });

  it('opens a portalled list named per field, focuses its search box, and the trigger is a 44px form-control button', async () => {
    const user = userEvent.setup();
    const { container } = render(<Host initial={emptyAddress} onChange={vi.fn()} />);
    const trigger = field(PROVINCE);

    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveClass('h-11', 'rounded-lg', 'border-input', 'bg-background');
    expect(trigger).toHaveTextContent('-- เลือกจังหวัด --');
    expect(container.querySelector('[data-inline-combobox]')).toBeNull();

    const listbox = await openCombobox(user, PROVINCE);
    expect(listbox).toHaveAccessibleName('รายชื่อจังหวัด');
    expect(container).not.toContainElement(listbox);
    expect(document.body).toContainElement(listbox);
    expect(screen.getByRole('combobox', { name: 'ค้นหาจังหวัด' })).toHaveFocus();
  });
});
