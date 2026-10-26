import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { NumericFormat } from 'react-number-format';
import Decimal from 'decimal.js';
import { cn } from '@/lib/utils';
import { inputVariants } from './input';
import { formatNumericText, normalizeNumericText } from '@/utils/numericText';

type NumberChange = { target: { value: string; name: string; valueAsNumber: number } };
export type NumberInputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value' | 'defaultValue' | 'type'> & {
  value?: number | string;
  defaultValue?: number | string;
  /** Raw decimal string, without display commas. Empty and partial '-' stay editable. */
  onChange?: (event: NumberChange) => void;
  /** Preserve the existing classes when replacing a native input. */
  unstyled?: boolean;
  variant?: 'sm' | 'md' | 'lg';
};

function validationMessage(value: string, min: NumberInputProps['min'], max: NumberInputProps['max'], step: NumberInputProps['step'], base: NumberInputProps['defaultValue']) {
  if (!value) return ''; // `required` is handled by the browser.
  const normalized = normalizeNumericText(value);
  if (normalized == null) return 'กรุณากรอกตัวเลขให้ครบ';
  const n = new Decimal(normalized);
  if (min !== undefined && n.lt(min)) return `ค่าต้องไม่น้อยกว่า ${formatNumericText(min)}`;
  if (max !== undefined && n.gt(max)) return `ค่าต้องไม่เกิน ${formatNumericText(max)}`;
  if (step !== 'any') {
    const increment = new Decimal(step ?? 1);
    const stepBase = min ?? (base == null ? '0' : normalizeNumericText(String(base)) ?? '0');
    if (increment.gt(0) && !n.minus(stepBase).mod(increment).isZero()) {
      return `กรุณากรอกค่าตามช่วง ${formatNumericText(increment.toString())}`;
    }
  }
  return '';
}

/** Numeric editing with grouped display and raw values at the form boundary.
 * Keep this separate from Input: phone, IMEI, codes and years are identifiers.
 */
export function NumberInput({
  value, defaultValue, onChange, onBlur, onKeyDown, onPaste, ref,
  min, max, step, name, className, unstyled = false, variant,
  inputMode, ...props
}: NumberInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uncontrolled, setUncontrolled] = useState(String(defaultValue ?? ''));
  const raw = value === undefined ? uncontrolled : typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  const setRef = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === 'function') return ref(node);
    if (ref) ref.current = node;
  }, [ref]);
  const validate = useCallback((next: string) => {
    inputRef.current?.setCustomValidity(validationMessage(next, min, max, step, value ?? defaultValue));
  }, [min, max, step, value, defaultValue]);
  useEffect(() => { validate(raw); }, [raw, validate]);

  const change = (next: string) => {
    setUncontrolled(next);
    validate(next);
    // Match native number inputs at the form boundary for incomplete edits.
    // NumericFormat retains the visible '-' / '.' until the user finishes it.
    const rawValue = normalizeNumericText(next) == null ? '' : next;
    onChange?.({ target: { value: rawValue, name: name ?? '', valueAsNumber: rawValue ? Number(rawValue) : NaN } });
  };
  const numeric = normalizeNumericText(raw);
  return (
    <>
      <NumericFormat
        {...props}
        getInputRef={setRef}
        data-slot="input"
        data-numeric-input="true"
        type="text"
        role="spinbutton"
        inputMode={inputMode ?? (min !== undefined && Number(min) >= 0 ? 'decimal' : 'text')}
        value={raw}
        valueIsNumericString
        thousandSeparator=","
        decimalSeparator="."
        allowedDecimalSeparators={['.']}
        allowNegative
        aria-valuemin={min === undefined ? undefined : Number(min)}
        aria-valuemax={max === undefined ? undefined : Number(max)}
        aria-valuenow={numeric == null ? undefined : Number(numeric)}
        aria-valuetext={formatNumericText(raw)}
        className={cn(!unstyled && inputVariants({ variant }), 'tabular-nums', className)}
        onValueChange={(values, source) => {
          if (source.source === 'event') change(values.value);
        }}
        onBlur={(event) => {
          validate(event.currentTarget.value);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || props.readOnly || props.disabled || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const current = normalizeNumericText(event.currentTarget.value) ?? '0';
          const increment = new Decimal(step === 'any' ? 1 : step ?? 1);
          if (increment.lte(0)) return;
          const base = new Decimal(min ?? normalizeNumericText(String(value ?? defaultValue ?? 0)) ?? 0);
          const position = new Decimal(current).minus(base).div(increment);
          const nextStep = event.key === 'ArrowUp' ? position.floor().plus(1) : position.ceil().minus(1);
          let next = base.plus(nextStep.mul(increment));
          if (min !== undefined) next = Decimal.max(next, min);
          if (max !== undefined) next = Decimal.min(next, base.plus(new Decimal(max).minus(base).div(increment).floor().mul(increment)));
          change(next.toString());
        }}
        onPaste={(event) => {
          onPaste?.(event);
          if (event.defaultPrevented || props.readOnly || props.disabled) return;
          // Reject mixed/ambiguous clipboard text rather than silently changing its value.
          const pasted = event.clipboardData.getData('text');
          const normalized = normalizeNumericText(pasted);
          if (normalized == null) event.preventDefault();
          else if (pasted.includes('−')) {
            event.preventDefault();
            const node = event.currentTarget;
            const next = node.value.slice(0, node.selectionStart ?? 0).replace(/,/g, '')
              + normalized + node.value.slice(node.selectionEnd ?? node.value.length).replace(/,/g, '');
            if (normalizeNumericText(next) != null) change(next);
          }
        }}
      />
      {/* Native FormData must contain the raw value, never the display separators. */}
      {name && <input type="hidden" form={props.form} name={name} value={normalizeNumericText(raw) ?? ''} disabled={props.disabled} />}
    </>
  );
}
