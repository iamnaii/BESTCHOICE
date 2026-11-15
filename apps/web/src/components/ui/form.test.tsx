import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './form';
function Example({ title }: { title: string }) {
  const form = useForm({ defaultValues: { name: '' } });
  return <Form {...form}><form aria-label={title} onSubmit={form.handleSubmit(vi.fn())}>
    <FormField control={form.control} name="name" rules={{ required: 'กรุณากรอกชื่อ' }} render={({ field }) => (
      <FormItem><FormLabel>ชื่อ</FormLabel><FormControl><input {...field} /></FormControl>
        <FormDescription>ชื่อที่ใช้ติดต่อ</FormDescription><FormMessage /></FormItem>
    )} /><button type="submit">บันทึก</button>
  </form></Form>;
}
describe('form field semantics', () => {
  it('focuses the input from its label and connects errors without duplicate IDs across forms', async () => {
    const user = userEvent.setup();
    render(<><Example title="ลูกค้า" /><Example title="ผู้ติดต่อ" /></>);
    const first = within(screen.getByRole('form', { name: 'ลูกค้า' }));
    const second = within(screen.getByRole('form', { name: 'ผู้ติดต่อ' }));
    const input = first.getByRole('textbox', { name: 'ชื่อ' });
    expect(input.id).not.toBe(second.getByRole('textbox', { name: 'ชื่อ' }).id);
    await user.click(first.getByText('ชื่อ', { selector: 'label' }));
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleDescription('ชื่อที่ใช้ติดต่อ');
    await user.click(first.getByRole('button', { name: 'บันทึก' }));
    expect(await first.findByText('กรุณากรอกชื่อ')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('ชื่อที่ใช้ติดต่อ กรุณากรอกชื่อ');
    expect(second.getByRole('textbox', { name: 'ชื่อ' })).toHaveAttribute('aria-invalid', 'false');
    await user.type(input, 'ทดสอบ');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('uses label style A: FormLabel = formLabelClass and FormItem has no stacked gap', async () => {
    const user = userEvent.setup();
    render(<Example title="ลูกค้า" />);
    const label = screen.getByText('ชื่อ', { selector: 'label' });
    expect(label).toHaveClass('mb-3', 'block', 'text-sm', 'font-medium', 'leading-snug', 'text-foreground');
    expect(label).not.toHaveClass('text-xs');
    const item = label.closest('[data-slot="form-item"]');
    expect(item).toHaveClass('min-w-0');
    expect(item).not.toHaveClass('space-y-1.5');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    const message = await screen.findByText('กรุณากรอกชื่อ');
    expect(message).toHaveClass('mt-1.5');
    expect(label).toHaveClass('text-destructive');
    expect(label).not.toHaveClass('text-foreground');
  });

  it('keeps a FormDescription off its control: the same mt-1.5 gap as FormMessage', () => {
    render(<Example title="ลูกค้า" />);
    const description = screen.getByText('ชื่อที่ใช้ติดต่อ');
    expect(description).toHaveClass('mt-1.5', 'text-2xs', 'text-muted-foreground');
  });
});
