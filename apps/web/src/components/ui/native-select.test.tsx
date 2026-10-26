import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { NativeSelect } from './native-select';

const options = <><option value="">เลือกสาขา</option><option value="b">สาขาทดสอบ</option></>;

describe('NativeSelect form compatibility', () => {
  it('keeps labels, native validation, form data and uncontrolled reset', () => {
    render(<form data-testid="form"><label htmlFor="branch">สาขา</label><NativeSelect id="branch" name="branch" required defaultValue="">{options}</NativeSelect></form>);
    const select = screen.getByRole('combobox', { name: 'สาขา' }) as HTMLSelectElement;
    const form = screen.getByTestId('form') as HTMLFormElement;
    expect(select.checkValidity()).toBe(false);
    fireEvent.change(select, { target: { value: 'b' } });
    expect(select.checkValidity()).toBe(true);
    expect(new FormData(form).get('branch')).toBe('b');
    form.reset();
    expect(select.value).toBe('');
  });

  it('keeps controlled updates and passes the actual select to refs/events', () => {
    const ref = createRef<HTMLSelectElement>();
    const change = vi.fn();
    const blur = vi.fn();
    const { rerender } = render(<NativeSelect ref={ref} aria-label="สาขา" value="" onChange={change} onBlur={blur}>{options}</NativeSelect>);
    const select = screen.getByRole('combobox');
    expect(ref.current).toBe(select);
    fireEvent.change(select, { target: { value: 'b' } });
    expect(change).toHaveBeenCalledOnce();
    expect(change.mock.calls[0][0].target).toBe(select);
    fireEvent.blur(select);
    expect(blur).toHaveBeenCalledOnce();
    rerender(<NativeSelect ref={ref} aria-label="สาขา" value="b" onChange={change}>{options}</NativeSelect>);
    expect(select).toHaveValue('b');
  });

  it('respects disabled controls and disabled fieldsets in native form submission', () => {
    render(<form data-testid="form"><fieldset disabled><NativeSelect name="branch" aria-label="สาขา" defaultValue="b">{options}</NativeSelect></fieldset><NativeSelect name="other" aria-label="อีกสาขา" disabled defaultValue="b">{options}</NativeSelect></form>);
    for (const select of screen.getAllByRole('combobox')) expect(select).toBeDisabled();
    expect([...new FormData(screen.getByTestId('form') as HTMLFormElement).keys()]).toEqual([]);
  });

  it('preserves React Hook Form registration, focus and submitted values', async () => {
    function RegisteredForm() {
      const { register, getValues, setFocus } = useForm({ defaultValues: { branch: '' } });
      return <><NativeSelect aria-label="สาขา" {...register('branch')}>{options}</NativeSelect><button onClick={() => setFocus('branch')}>โฟกัส</button><button onClick={() => submit(getValues())}>อ่านค่า</button></>;
    }
    const submit = vi.fn();
    render(<RegisteredForm />);
    fireEvent.click(screen.getByRole('button', { name: 'โฟกัส' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'อ่านค่า' }));
    expect(submit).toHaveBeenCalledWith({ branch: 'b' });
  });
});
