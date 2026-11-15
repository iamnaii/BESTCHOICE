import * as React from 'react';
import { cn } from '@/lib/utils';
import { formLabelClass } from './form-styles';

type LabeledFieldProps = {
  label: React.ReactNode;
  /** id of the control; also the prefix of the label/hint/error ids. */
  htmlFor: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

type ControlAriaProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
};

/** Stable ids so a Combobox trigger can point `aria-labelledby` at the label. */
function labeledFieldIds(htmlFor: string) {
  return {
    labelId: `${htmlFor}-label`,
    hintId: `${htmlFor}-hint`,
    errorId: `${htmlFor}-error`,
  };
}

function hasContent(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

/**
 * Label + control + hint/error for forms that do not use react-hook-form
 * (shadcn's FormField name is taken). Label style = formLabelClass.
 * A single element child gets aria-describedby / aria-invalid / aria-required;
 * other children (fragments, text, arrays) are rendered as-is — wire them with
 * labeledFieldIds().
 */
function LabeledField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className,
  children,
}: LabeledFieldProps) {
  const { labelId, hintId, errorId } = labeledFieldIds(htmlFor);
  const showHint = hasContent(hint);
  const showError = hasContent(error);
  const describedBy = [showHint ? hintId : null, showError ? errorId : null]
    .filter(Boolean)
    .join(' ');

  let control = children;
  if (
    React.isValidElement<ControlAriaProps>(children) &&
    children.type !== React.Fragment &&
    (describedBy || showError || required)
  ) {
    const existing = children.props['aria-describedby'];
    control = React.cloneElement(children, {
      'aria-describedby': [existing, describedBy].filter(Boolean).join(' ') || undefined,
      ...(showError ? { 'aria-invalid': true } : {}),
      ...(required ? { 'aria-required': true } : {}),
    });
  }

  return (
    <div data-slot="labeled-field" className={cn('min-w-0', className)}>
      <label id={labelId} htmlFor={htmlFor} className={formLabelClass}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {control}
      {showHint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {showError ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium leading-snug text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { LabeledField, labeledFieldIds, type LabeledFieldProps };
