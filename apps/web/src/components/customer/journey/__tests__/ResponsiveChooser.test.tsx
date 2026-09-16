import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { ResponsiveChooser } from '../ResponsiveChooser';

/**
 * 🔴 Radix Popover/Dialog ต้องใช้ userEvent (jsdom ไม่มี PointerEvent) · hook ของ vitest ห้าม return ค่า
 * useIsMobile จริงคืน false ในเรนเดอร์แรก — mock ให้คงที่ต่อเทส (pattern StockPage/ProductsPage.test.tsx)
 */
const mocks = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));

function Host({ onOpenChange = () => {} }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ResponsiveChooser
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      title="บันทึกการติดต่อ"
      trigger={
        <Button variant="outline" size="sm">
          เปิดตัวเลือก
        </Button>
      }
    >
      <button type="button" onClick={() => setOpen(false)}>
        เลือกแล้วปิด
      </button>
    </ResponsiveChooser>
  );
}

beforeEach(() => {
  mocks.mobile = false;
});

describe('ResponsiveChooser', () => {
  it('จอกว้าง: Popover ชิดขวา กว้าง w-80 · dialog ชื่อตามหัวข้อ · ปุ่มเปิดอยู่สถานะ open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Host onOpenChange={onOpenChange} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'เปิดตัวเลือก' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('data-state', 'open');
    expect(dialog).toHaveClass('w-80');
    expect(dialog).toHaveAttribute('data-align', 'end');
    expect(dialog).not.toHaveClass('rounded-t-2xl');
    expect(within(dialog).getByText('บันทึกการติดต่อ')).toHaveClass('mb-3', 'text-sm', 'font-semibold', 'leading-snug');

    await user.click(within(dialog).getByRole('button', { name: 'เลือกแล้วปิด' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('จอกว้าง: กด Esc ปิด และแจ้ง onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Host onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: 'เปิดตัวเลือก' }));
    await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('จอเล็ก (<1024): Sheet ด้านล่าง มุมบนโค้ง · หัวข้อเป็น heading · มีคำอธิบายสำหรับโปรแกรมอ่านจอ', async () => {
    mocks.mobile = true;
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole('button', { name: 'เปิดตัวเลือก' }));

    const dialog = await screen.findByRole('dialog', { name: 'บันทึกการติดต่อ' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(dialog).toHaveClass('rounded-t-2xl', 'max-h-[80vh]', 'overflow-y-auto');
    expect(dialog).not.toHaveClass('w-80');
    expect(within(dialog).getByRole('heading', { name: 'บันทึกการติดต่อ' })).toBeInTheDocument();
    expect(within(dialog).getByText('เลือกจากตัวเลือกด้านล่าง')).toHaveClass('sr-only');

    await user.click(within(dialog).getByRole('button', { name: 'เลือกแล้วปิด' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
