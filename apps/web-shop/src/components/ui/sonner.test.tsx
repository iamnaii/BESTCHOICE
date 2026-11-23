import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { Toaster } from './sonner';

describe('storefront Toaster', () => {
  it.each([
    ['success', 'บันทึกสำเร็จ', 'check-circle'],
    ['info', 'มีข้อความใหม่', 'info'],
    ['warning', 'ใกล้ถึงกำหนด', 'warning'],
    ['error', 'บันทึกไม่สำเร็จ', 'xcircle'],
    ['loading', 'กำลังบันทึก', 'spinner-gap'],
  ] as const)('announces a %s toast with its decorative glyph', async (type, message, icon) => {
    render(<Toaster position="top-center" />);
    act(() => { toast[type](message, { duration: Infinity }); });

    const region = screen.getByRole('region', { name: /^Notifications/ });
    expect(region).toHaveAttribute('aria-live', 'polite');
    const item = (await within(region).findByText(message)).closest('li');
    expect(item).toBeVisible();
    expect(item?.querySelector('svg.app-icon-' + icon)).toHaveAttribute('aria-hidden', 'true');
    if (type === 'loading') {
      expect(item?.querySelector('svg')).toHaveClass('motion-safe:animate-spin');
    }
  });

  it('keeps action and dismissal behavior with a named close button', async () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Toaster closeButton />);
    act(() => {
      toast.success('บันทึกพร้อมเปิด', {
        duration: Infinity,
        action: { label: 'เปิด', onClick: onAction },
      });
      toast.info('ข้อความที่ปิดได้', { duration: Infinity, onDismiss });
    });

    const message = await screen.findByText('ข้อความที่ปิดได้');
    const item = message.closest('li')!;
    const close = within(item).getByRole('button', { name: 'Close toast' });
    expect(close.querySelector('svg.app-icon-x')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(close);
    expect(onDismiss).toHaveBeenCalledOnce();
    await waitFor(() => expect(message).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'เปิด' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('keeps per-slot caller overrides and supplies defaults for the other slots', async () => {
    render(<Toaster icons={{ success: <span aria-hidden="true">custom success</span> }} />);
    act(() => {
      toast.success('สำเร็จ', { duration: Infinity });
      toast.warning('เตือน', { duration: Infinity });
    });

    expect(await screen.findByText('custom success')).toBeInTheDocument();
    const warningItem = (await screen.findByText('เตือน')).closest('li');
    expect(warningItem?.querySelector('svg.app-icon-warning')).toBeInTheDocument();
  });
});
