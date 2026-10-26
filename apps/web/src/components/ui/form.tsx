import * as React from 'react';
import {
  useFormContext,
  Controller,
  FormProvider,
  type FieldValues,
  type FieldPath,
  type ControllerProps,
} from 'react-hook-form';
import { Slot } from '@radix-ui/react-slot';
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
const FormItemContext = React.createContext<{ id: string }>({ id: '' });

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
  const { id } = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();
  const fieldState = getFieldState(fieldContext.name, formState);

  return {
    name: fieldContext.name,
    formItemId: `${id}-control`,
    formDescriptionId: `${id}-description`,
    formMessageId: `${id}-error`,
    ...fieldState,
  };
}

/* ─── Form Item ─── */
function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn('min-w-0 space-y-1.5', className)} {...props} />
    </FormItemContext.Provider>
  );
}

/* ─── Form Label ─── */
function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();
  return (
    <Label
      data-slot="form-label"
      htmlFor={formItemId}
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
function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-invalid={!!error}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      {...props}
    />
  );
}

/* ─── Form Description ─── */
function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      id={formDescriptionId}
      data-slot="form-description"
      className={cn('text-2xs text-muted-foreground', className)}
      {...props}
    />
  );
}

/* ─── Form Message (error) ─── */
function FormMessage({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message) : children;

  if (!body) return null;

  return (
    <p
      id={formMessageId}
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
