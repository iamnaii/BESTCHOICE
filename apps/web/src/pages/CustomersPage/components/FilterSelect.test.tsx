import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import FilterSelect from './FilterSelect';

function Filter() {
  const [value, setValue] = useState('');
  return (
    <FilterSelect
      ariaLabel="กรองลูกค้า"
      placeholder="ทั้งหมด"
      value={value}
      onChange={setValue}
      width={200}
      groups={[{ options: [{ value: 'branch', label: 'สาขา', indent: true }] }]}
    />
  );
}

it('uses a decorative hierarchy icon while keeping the option label, typeahead and selected text', async () => {
  render(<Filter />);
  const trigger = screen.getByRole('combobox', { name: 'กรองลูกค้า' });
  expect(trigger).toHaveTextContent('ทั้งหมด');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: 'สาขา' });
  expect(option.querySelector('svg.app-icon-arrow-elbow-down-right')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ส' });
  await waitFor(() => expect(option).toHaveFocus());
  fireEvent.keyDown(option, { key: 'Enter' });
  expect(trigger).toHaveTextContent(/^สาขา$/);
  expect(trigger.querySelector('svg.app-icon-arrow-elbow-down-right')).toBeNull();
});
