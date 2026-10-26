import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EditCustomerDialog from '../components/EditCustomerDialog';
import { detail } from './fixtures';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>แก้ไขข้อมูล</button>
      <button>ดำเนินการด้านหลัง</button>
      <EditCustomerDialog customer={detail()} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe('customer edit keyboard navigation', () => {
  it('moves focus inside, traps both ends, then restores the opener on Escape', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    const opener = screen.getByRole('button', { name: 'แก้ไขข้อมูล' });
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'แก้ไขข้อมูลลูกค้า' });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    const first = within(dialog).getByRole('button', { name: 'กลับ' });
    first.focus();
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    within(dialog).getByRole('button', { name: 'บันทึก' }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

it('labels each reference separately so editing the second cannot target the first', async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'แก้ไขข้อมูล' }));
  const names = screen.getAllByRole('textbox', { name: /^ชื่อ$/ });
  expect(names).toHaveLength(4);
  await user.type(names[1], 'บุคคลอ้างอิงสอง');
  expect(names[0]).toHaveValue('');
  expect(names[1]).toHaveValue('บุคคลอ้างอิงสอง');
});
