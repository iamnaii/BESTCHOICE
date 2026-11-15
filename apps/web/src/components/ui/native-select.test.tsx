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

describe('NativeSelect leadingIcon and tone', () => {
  it('renders a decorative leading icon and owns the left padding over the caller className', () => {
    render(
      <NativeSelect
        aria-label="ผู้รับมอบหมาย"
        leadingIcon={<svg data-testid="lead-icon" />}
        className="pl-9 rounded-xl"
      >
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    expect(select).toHaveClass('pl-10');
    expect(select).not.toHaveClass('pl-9');
    const slot = screen.getByTestId('lead-icon').parentElement as HTMLElement;
    expect(slot).toHaveAttribute('data-slot', 'native-select-leading-icon');
    expect(slot).toHaveAttribute('aria-hidden', 'true');
    expect(slot).toHaveClass(
      'pointer-events-none',
      'absolute',
      'left-3',
      'top-1/2',
      '-translate-y-1/2',
      'size-4',
      'text-muted-foreground',
    );
  });

  it('places the icon after the select so the disabled state dims it too', () => {
    render(
      <NativeSelect aria-label="ผู้รับมอบหมาย" disabled leadingIcon={<svg data-testid="lead-icon" />}>
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'ผู้รับมอบหมาย' });
    const slot = screen.getByTestId('lead-icon').parentElement as HTMLElement;
    expect(slot).toHaveClass('peer-disabled:opacity-50');
    expect(select.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('adds no icon slot and no extra left padding without leadingIcon', () => {
    const { container } = render(<NativeSelect aria-label="สาขา">{options}</NativeSelect>);
    expect(container.querySelector('[data-slot="native-select-leading-icon"]')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'สาขา' })).not.toHaveClass('pl-10');
  });

  it('tone="warning" appends border-warning last so it beats border-input and caller border colours', () => {
    render(
      <NativeSelect aria-label="แหล่งรหัสย่อย" tone="warning" className="border-border">
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย' });
    expect(select).toHaveClass('border-warning');
    expect(select).not.toHaveClass('border-input');
    expect(select).not.toHaveClass('border-border');
    expect(select).not.toHaveAttribute('tone');
  });

  it('tone="default" keeps the standard border', () => {
    render(
      <NativeSelect aria-label="แหล่งรหัสย่อย" tone="default">
        {options}
      </NativeSelect>,
    );
    const select = screen.getByRole('combobox', { name: 'แหล่งรหัสย่อย' });
    expect(select).toHaveClass('border-input');
    expect(select).not.toHaveClass('border-warning');
  });
});
