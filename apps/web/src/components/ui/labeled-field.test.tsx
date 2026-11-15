import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabeledField, labeledFieldIds } from './labeled-field';
import { formLabelClass } from './form-styles';

describe('LabeledField', () => {
  it('names the control with a formLabelClass label that has a stable id', () => {
    const { container } = render(
      <LabeledField label="ชื่อบัญชี" htmlFor="acc" className="md:col-span-2">
        <input id="acc" />
      </LabeledField>,
    );
    const input = screen.getByLabelText('ชื่อบัญชี');
    expect(input).toHaveAttribute('id', 'acc');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');

    const label = container.querySelector('#acc-label');
    expect(label?.tagName).toBe('LABEL');
    expect(label).toHaveAttribute('for', 'acc');
    expect(label?.className).toBe(formLabelClass);

    const wrapper = container.querySelector('[data-slot="labeled-field"]');
    expect(wrapper).toHaveClass('md:col-span-2');
    expect(labeledFieldIds('acc')).toEqual({
      labelId: 'acc-label',
      hintId: 'acc-hint',
      errorId: 'acc-error',
    });
  });

  it('marks required with a decorative red asterisk and aria-required, keeping the name clean', () => {
    render(
      <LabeledField label="ชื่อ" htmlFor="name" required>
        <input id="name" required />
      </LabeledField>,
    );
    const input = screen.getByRole('textbox', { name: 'ชื่อ' });
    expect(input).toHaveAttribute('aria-required', 'true');
    const star = screen.getByText('*');
    expect(star).toHaveAttribute('aria-hidden', 'true');
    expect(star).toHaveClass('text-destructive');
  });

  it('links hint and error through aria-describedby, flags invalid and announces the error', () => {
    render(
      <LabeledField label="ยอด" htmlFor="amt" hint="ไม่รวม VAT" error="กรุณาระบุยอด">
        <input id="amt" aria-describedby="amt-extra" />
      </LabeledField>,
    );
    const input = screen.getByRole('textbox', { name: 'ยอด' });
    expect(input).toHaveAttribute('aria-describedby', 'amt-extra amt-hint amt-error');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('ไม่รวม VAT กรุณาระบุยอด');
    expect(screen.getByText('ไม่รวม VAT')).toHaveAttribute('id', 'amt-hint');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('กรุณาระบุยอด');
    expect(alert).toHaveAttribute('id', 'amt-error');
    expect(alert).toHaveClass('text-destructive');
  });

  it('renders no hint or error nodes when absent and leaves fragment children untouched', () => {
    const { container } = render(
      <LabeledField label="ป้าย" htmlFor="x" hint="" error={null}>
        <>
          <input id="x" />
        </>
      </LabeledField>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('#x-hint')).toBeNull();
    expect(container.querySelector('#x-error')).toBeNull();
    expect(screen.getByLabelText('ป้าย')).not.toHaveAttribute('aria-describedby');
  });

  it('lets a combobox trigger reuse the label id through aria-labelledby', () => {
    const { labelId } = labeledFieldIds('branch');
    render(
      <LabeledField label="สาขา" htmlFor="branch">
        <button type="button" role="combobox" id="branch" aria-labelledby={labelId} aria-expanded={false}>
          สาขาทดสอบ
        </button>
      </LabeledField>,
    );
    expect(screen.getByRole('combobox', { name: 'สาขา' })).toHaveAttribute('id', 'branch');
  });
});
