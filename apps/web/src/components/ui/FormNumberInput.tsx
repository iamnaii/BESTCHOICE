import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { NumberInput, type NumberInputProps } from './NumberInput';

type Props<T extends FieldValues> = Omit<NumberInputProps, 'value' | 'defaultValue' | 'name' | 'onChange' | 'ref'> & {
  control?: Control<T>;
  name: FieldPath<T>;
  valueAsNumber?: boolean;
};

/** Controlled RHF bridge: register() would read the comma-formatted DOM value. */
export function FormNumberInput<T extends FieldValues>({ name, control, valueAsNumber, onBlur, ...props }: Props<T>) {
  const { field } = useController({ name, control });
  const value = typeof field.value === 'number' && !Number.isFinite(field.value) ? '' : field.value ?? '';
  return <NumberInput {...props} name={field.name} value={value} ref={field.ref}
    onBlur={(event) => { field.onBlur(); onBlur?.(event); }}
    onChange={(event) => field.onChange(valueAsNumber ? event.target.valueAsNumber : event.target.value)} />;
}
