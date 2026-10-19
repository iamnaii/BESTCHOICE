import { useState, createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { NumberInput, type NumberInputProps } from './NumberInput';
import { FormNumberInput } from './FormNumberInput';

function Controlled(props: NumberInputProps) {
  const [value, setValue] = useState(props.value ?? '');
  return <><NumberInput aria-label="ยอดเงิน" {...props} value={value} onChange={(event) => {
    setValue(event.target.value); props.onChange?.(event);
  }} /><output data-testid="raw">{value}</output></>;
}

describe('NumberInput', () => {
  it('groups as you type, keeps decimals and minus, and emits raw numbers', async () => {
    const user = userEvent.setup();
    render(<Controlled step="0.01" />);
    const input = screen.getByRole('spinbutton', { name: 'ยอดเงิน' });
    await user.type(input, '-12345.50');
    expect(input).toHaveValue('-12,345.50');
    expect(screen.getByTestId('raw')).toHaveTextContent('-12345.50');
    await user.tab();
    expect(input).toHaveValue('-12,345.50');
    expect(input).toBeValid();
  });

  it('accepts grouped paste and a unicode minus without turning a negative positive', async () => {
    const user = userEvent.setup();
    render(<Controlled step="any" />);
    const input = screen.getByRole('spinbutton');
    await user.click(input);
    await user.paste('-1,234,567.8900');
    expect(input).toHaveValue('-1,234,567.8900');
    expect(screen.getByTestId('raw')).toHaveTextContent('-1234567.8900');
    await user.clear(input);
    await user.paste('−9,876.50');
    expect(input).toHaveValue('-9,876.50');
    expect(screen.getByTestId('raw')).toHaveTextContent('-9876.50');
  });

  it('rejects ambiguous pasted values without silently removing text or changing decimal comma', async () => {
    const user = userEvent.setup();
    render(<Controlled value="1200" />);
    const input = screen.getByRole('spinbutton');
    await user.click(input);
    for (const text of ['1,25', 'THB 123', '1.234,50', '12x34']) {
      await user.paste(text);
      expect(input).toHaveValue('1,200');
    }
  });

  it('supports deleting to empty, intermediate negative/decimal states and editing in the middle', async () => {
    const user = userEvent.setup();
    render(<Controlled value="12345" step="any" />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(2, 2);
    await user.keyboard('9');
    expect(input).toHaveValue('129,345');
    expect(input.selectionStart).toBe(3);
    await user.clear(input);
    await user.type(input, '-');
    expect(input).toHaveValue('-');
    expect(input).toBeInvalid();
    await user.type(input, '0.5');
    expect(input).toHaveValue('-0.5');
    expect(input).toBeValid();
    await user.clear(input);
    expect(input).toHaveValue('');
    expect(screen.getByTestId('raw').textContent).toBe('');
  });

  it('retains required, min, max and decimal step validation; never strips forbidden negatives', () => {
    render(<Controlled required min={0} max={10000} step="0.01" />);
    const input = screen.getByRole('spinbutton');
    expect(input).toBeInvalid();
    for (const value of ['-1234.50', '10000.01', '0.001']) {
      fireEvent.change(input, { target: { value } });
      expect(input).toBeInvalid();
    }
    fireEvent.change(input, { target: { value: '1234.50' } });
    expect(input).toBeValid();
  });

  it('supports refs and keyboard steps with exact decimals and bounds', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLInputElement>();
    render(<Controlled ref={ref} value="999.99" min={0} max={1000} step="0.01" />);
    ref.current?.focus();
    await user.keyboard('{ArrowUp}');
    expect(ref.current).toHaveValue('1,000');
    await user.keyboard('{ArrowUp}');
    expect(ref.current).toHaveValue('1,000');
    await user.keyboard('{ArrowDown}');
    expect(ref.current).toHaveValue('999.99');
  });

  it('serializes an unformatted value once in native FormData and updates from outside', () => {
    const { container, rerender } = render(<form><NumberInput name="amount" value="-12345.67" readOnly step="any" /></form>);
    expect(new FormData(container.querySelector('form')!).getAll('amount')).toEqual(['-12345.67']);
    rerender(<form><NumberInput name="amount" value="45678.90" readOnly step="any" /></form>);
    expect(screen.getByRole('spinbutton')).toHaveValue('45,678.90');
    expect(new FormData(container.querySelector('form')!).get('amount')).toBe('45678.90');
  });

  it('passes raw values to RHF, supports numeric conversion, reset and submission', async () => {
    const user = userEvent.setup(); const submit = vi.fn();
    function Form() {
      const methods = useForm({ defaultValues: { amount: '1234.50', numeric: 2000 } });
      return <FormProvider {...methods}><form onSubmit={methods.handleSubmit(submit)}>
        <FormNumberInput name="amount" aria-label="ยอดเงิน" step="any" />
        <FormNumberInput name="numeric" aria-label="จำนวน" valueAsNumber step="any" />
        <button type="submit">บันทึก</button>
        <button type="button" onClick={() => methods.reset({ amount: '9876.50', numeric: 3000 })}>รีเซ็ต</button>
      </form></FormProvider>;
    }
    render(<Form />);
    const amount = screen.getByRole('spinbutton', { name: 'ยอดเงิน' });
    await user.clear(amount); await user.type(amount, '-12345.75');
    const numeric = screen.getByRole('spinbutton', { name: 'จำนวน' });
    await user.clear(numeric); await user.type(numeric, '4567');
    await user.click(screen.getByText('บันทึก'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0]).toEqual({ amount: '-12345.75', numeric: 4567 });
    await user.click(screen.getByText('รีเซ็ต'));
    expect(amount).toHaveValue('9,876.50');
    expect(numeric).toHaveValue('3,000');
  });
});

it('allows clearing an optional RHF numeric field and submitting the empty value', async () => {
  const user = userEvent.setup(); const submit = vi.fn();
  function Form() {
    const methods = useForm({ defaultValues: { amount: 1234.50 } });
    return <form onSubmit={methods.handleSubmit(submit)}>
      <FormNumberInput control={methods.control} name="amount" aria-label="ยอดจ่าย" valueAsNumber step="0.01" />
      <button type="submit">บันทึก</button>
    </form>;
  }
  render(<Form />);
  const input = screen.getByRole('spinbutton');
  await user.clear(input); await user.tab();
  expect(input).toHaveValue('');
  expect(input).toBeValid();
  await user.click(screen.getByText('บันทึก'));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  expect(submit.mock.calls[0][0].amount).toBeNaN();
});

it('supports parent forms that store numbers, including a leading minus and decimals', async () => {
  const user = userEvent.setup();
  function NumericParent() {
    const [amount, setAmount] = useState(0);
    return <><NumberInput value={amount} step="any" onChange={(e) => setAmount(Number(e.target.value) || 0)} /><output>{amount}</output></>;
  }
  render(<NumericParent />);
  const input = screen.getByRole('spinbutton');
  await user.clear(input); await user.type(input, '-1234.50');
  expect(input).toHaveValue('-1,234.50');
  expect(screen.getByRole('status')).toHaveTextContent('-1234.5');
});

it('does not emit NaN-producing partial strings to Number(raw) parent handlers', async () => {
  const user = userEvent.setup(); const changes = vi.fn();
  function NumericParent() {
    const [value, setValue] = useState(0);
    return <NumberInput value={value} step="any" onChange={(e) => { const n = Number(e.target.value); changes(n); setValue(n); }} />;
  }
  render(<NumericParent />);
  const input = screen.getByRole('spinbutton');
  await user.clear(input); await user.type(input, '-');
  expect(input).toHaveValue('-');
  await user.type(input, '1234.50');
  expect(input).toHaveValue('-1,234.50');
  expect(changes.mock.calls.every(([value]) => Number.isFinite(value))).toBe(true);
  expect(changes).toHaveBeenLastCalledWith(-1234.5);
});

it('preserves native validity for existing fractional values without a min or step', () => {
  render(<><input type="number" aria-label="native" value={1234.50} onChange={() => {}} />
    <NumberInput aria-label="formatted" value={1234.50} /></>);
  expect((screen.getByRole('spinbutton', { name: 'formatted' }) as HTMLInputElement).checkValidity())
    .toBe((screen.getByRole('spinbutton', { name: 'native' }) as HTMLInputElement).checkValidity());
  expect(screen.getByRole('spinbutton', { name: 'formatted' })).toBeValid();
});

it('never changes a read-only field through custom Unicode paste handling', async () => {
  const user = userEvent.setup(); const onChange = vi.fn();
  render(<NumberInput value="1234.50" step="any" readOnly onChange={onChange} />);
  const input = screen.getByRole('spinbutton');
  await user.click(input); await user.paste('−9,876.50');
  expect(input).toHaveValue('1,234.50');
  expect(onChange).not.toHaveBeenCalled();
});

it('moves an off-step value onto the valid decimal grid with arrow keys', async () => {
  const user = userEvent.setup();
  render(<Controlled value="0.015" min={0} step="0.01" />);
  const input = screen.getByRole('spinbutton');
  expect(input).toBeInvalid();
  await user.click(input); await user.keyboard('{ArrowUp}');
  expect(input).toHaveValue('0.02');
  expect(input).toBeValid();
});
