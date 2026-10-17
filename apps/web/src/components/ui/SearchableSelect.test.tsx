import { Dialog, DialogContent, DialogTitle } from './dialog';
import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchableSelect from './SearchableSelect';

const OPTIONS = ['ลำปาง', 'เชียงใหม่', 'ขอนแก่น'];
const noop = () => {};

// The options menu is the element carrying `max-h-60` (the scrollable results list).
const getMenu = (container: HTMLElement) =>
  container.querySelector('.max-h-60') as HTMLElement | null;

describe('SearchableSelect — openDirection', () => {
  it('opens the menu downward by default', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SearchableSelect value="" onChange={noop} options={OPTIONS} placeholder="-- เลือก --" />,
    );
    await user.click(screen.getByPlaceholderText('-- เลือก --'));

    const menu = getMenu(container);
    expect(menu).toBeTruthy();
    expect(menu!.className).toContain('mt-1');
    expect(menu!.className).not.toContain('bottom-full');
  });

  it('opens the menu upward when openDirection="up" (so it is not clipped at the bottom of a modal)', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SearchableSelect
        value=""
        onChange={noop}
        options={OPTIONS}
        placeholder="-- เลือก --"
        openDirection="up"
      />,
    );
    await user.click(screen.getByPlaceholderText('-- เลือก --'));

    const menu = getMenu(container);
    expect(menu).toBeTruthy();
    expect(menu!.className).toContain('bottom-full');
    expect(menu!.className).not.toContain('mt-1');
  });
});

function KeyboardExample() {
  const [value, setValue] = useState('ลำปาง');
  return <><label htmlFor="province">จังหวัด</label>
    <SearchableSelect id="province" value={value} onChange={setValue} options={OPTIONS} />
    <button>ถัดไป</button></>;
}
it('selects by keyboard and restores the saved value on Escape or blur', async () => {
  const user = userEvent.setup();
  render(<KeyboardExample />);
  const input = screen.getByRole('combobox', { name: 'จังหวัด' });
  await user.click(screen.getByText('จังหวัด', { selector: 'label' }));
  expect(input).toHaveFocus();
  await user.type(input, 'เชียง');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(input).toHaveValue('เชียงใหม่');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  await user.type(input, 'ไม่ใช่');
  await user.keyboard('{Escape}');
  expect(input).toHaveValue('เชียงใหม่');
  await user.type(input, 'ขอน');
  await user.tab();
  expect(input).toHaveValue('เชียงใหม่');
  expect(screen.getByRole('button', { name: 'ถัดไป' })).toHaveFocus();
});
it('reopens after selecting with a pointer while focus remains in the field', async () => {
  const user = userEvent.setup();
  render(<KeyboardExample />);
  const input = screen.getByRole('combobox', { name: 'จังหวัด' });
  await user.click(input);
  await user.click(screen.getByRole('option', { name: 'ขอนแก่น' }));
  expect(input).toHaveValue('ขอนแก่น');
  expect(input).toHaveFocus();
  await user.click(input);
  expect(screen.getByRole('option', { name: 'เชียงใหม่' })).toBeVisible();
  await user.click(screen.getByRole('option', { name: 'เชียงใหม่' }));
  expect(input).toHaveValue('เชียงใหม่');
});

it('closes only the options on first Escape inside a dialog, then closes the dialog on second Escape', async () => {
  const user = userEvent.setup();
  function Example() {
    const [open, setOpen] = useState(true);
    return <Dialog open={open} onOpenChange={setOpen}><DialogContent aria-describedby={undefined}>
      <DialogTitle>ที่อยู่ลูกค้า</DialogTitle><KeyboardExample />
    </DialogContent></Dialog>;
  }
  render(<Example />);
  const input = screen.getByRole('combobox', { name: 'จังหวัด' });
  await user.click(input);
  await user.keyboard('{Escape}');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('dialog')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
