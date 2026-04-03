import * as React from 'react';
import {
  useFormContext,
  Controller,
  FormProvider,
  type FieldValues,
  type FieldPath,
  type ControllerProps,
  type UseFormReturn,
} from 'react-hook-form';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/* ─── Form Provider (re-export for convenience) ─── */
const Form = FormProvider;

/* ─── Form Field Context ─── */
type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ ...props }: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

/* ─── useFormField hook ─── */
function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);

  return {
    name: fieldContext.name,
    ...fieldState,
  };
}

/* ─── Form Item ─── */
function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="form-item" className={cn('space-y-1.5', className)} {...props} />;
}

/* ─── Form Label ─── */
function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error } = useFormField();
  return (
    <Label
      data-slot="form-label"
      className={cn(
        'text-xs font-medium',
        error && 'text-destructive',
        className,
      )}
      {...props}
    />
  );
}

/* ─── Form Control — wraps the input with aria attributes ─── */
function FormControl({ ...props }: React.ComponentProps<'div'>) {
  const { error, name } = useFormField();
  return (
    <div
      data-slot="form-control"
      aria-invalid={!!error}
      aria-describedby={error ? `${name}-error` : undefined}
      {...props}
    />
  );
}

/* ─── Form Description ─── */
function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="form-description"
      className={cn('text-2xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/* ─── Form Message (error) ─── */
function FormMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { error, name } = useFormField();
  const body = error ? String(error.message) : children;

  if (!body) return null;

  return (
    <p
      id={`${name}-error`}
      data-slot="form-message"
      className={cn('text-2xs font-medium text-destructive animate-in fade-in-0 slide-in-from-top-1 duration-200', className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
