import { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SellerPaymentFields, { type SellerPayment } from './SellerPaymentFields';

function Example({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<SellerPayment>({ paymentMethod: 'TRANSFER', transferBankName: '', transferAccountNumber: '', transferAccountName: '' });
  return <SellerPaymentFields value={value} disabled={disabled} onChange={patch => setValue(current => ({ ...current, ...patch }))} />;
}

describe('seller bank suggestions', () => {
  it('keeps keyboard selection and arbitrary bank names without changing the destination account', () => {
    render(<Example />);
    const bank = screen.getByRole('combobox', { name: 'ธนาคารผู้ขาย *' });
    const account = screen.getByLabelText('เลขบัญชีผู้ขาย *');
    fireEvent.change(account, { target: { value: '123-456789' } });
    fireEvent.focus(bank);
    const first = screen.getAllByRole('option')[0].textContent;
    fireEvent.keyDown(bank, { key: 'ArrowDown' });
    fireEvent.keyDown(bank, { key: 'Enter' });
    expect(bank).toHaveValue(first);
    fireEvent.change(bank, { target: { value: 'ธนาคารที่พิมพ์เอง' } });
    expect(bank).toHaveValue('ธนาคารที่พิมพ์เอง');
    expect(account).toHaveValue('123-456789');
  });

  it('keeps the whole seller destination disabled while a submission is pending', () => {
    render(<Example disabled />);
    expect(screen.getByRole('combobox', { name: 'ธนาคารผู้ขาย *' })).toBeDisabled();
    expect(screen.getByLabelText('เลขบัญชีผู้ขาย *')).toBeDisabled();
    expect(screen.getByLabelText('ชื่อบัญชีผู้ขาย *')).toBeDisabled();
  });
});
