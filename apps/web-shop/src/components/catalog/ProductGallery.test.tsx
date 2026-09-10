import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProductGallery } from './ProductGallery';

const images = ['/front.jpg', '/back.jpg', '/side.jpg'];
afterEach(() => vi.unstubAllGlobals());

describe('product gallery', () => {
  it('supports arrow keys, thumbnails, an accessible lightbox and Escape', async () => {
    const user = userEvent.setup();
    render(<ProductGallery images={images} alt="iPhone 13" />);
    const gallery = screen.getByRole('region', { name: 'รูปสินค้า' });
    await user.click(screen.getByRole('button', { name: 'รูปถัดไป' }));
    expect(screen.getByText('รูป 2 / 3')).toBeInTheDocument();
    fireEvent.keyDown(gallery, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'รูปที่ 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'รูปที่ 1' }));
    await user.click(screen.getByRole('button', { name: 'ดูรูปขยาย' }));
    const dialog = screen.getByRole('dialog', { name: 'iPhone 13' });
    await user.click(within(dialog).getByRole('button', { name: 'รูปถัดไป' }));
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('รูป 2 / 3')).toBeInTheDocument();
  });

  it('swipes horizontally without opening the lightbox and leaves vertical gestures alone', () => {
    class TestPointerEvent extends MouseEvent {
      pointerId = 1;
      isPrimary = true;
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    render(<ProductGallery images={images} alt="iPhone 13" />);
    const photo = screen.getByRole('button', { name: 'ดูรูปขยาย' });
    fireEvent.pointerDown(photo, { clientX: 200, clientY: 100, button: 0 });
    fireEvent.pointerUp(photo, { clientX: 70, clientY: 105, button: 0 });
    fireEvent.click(photo);
    expect(screen.getByText('รูป 2 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.pointerDown(photo, { clientX: 200, clientY: 100, button: 0 });
    fireEvent.pointerUp(photo, { clientX: 190, clientY: 240, button: 0 });
    expect(screen.getByText('รูป 2 / 3')).toBeInTheDocument();
    fireEvent.pointerDown(photo, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(photo, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.click(photo);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows an image failure and resets media selection for another device', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProductGallery key="first" images={images} alt="iPhone 13" />);
    fireEvent.error(screen.getByAltText('iPhone 13 รูปที่ 1'));
    expect(screen.getByText('โหลดรูปนี้ไม่สำเร็จ ลองเลือกรูปอื่น')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'รูปที่ 3' }));
    rerender(<ProductGallery key="second" images={['/new-device.jpg']} alt="iPhone 14" />);
    expect(screen.getByText('รูป 1 / 1')).toBeInTheDocument();
    expect(screen.getByAltText('iPhone 14 รูปที่ 1')).toHaveAttribute('src', '/new-device.jpg');
    expect(screen.queryByRole('button', { name: 'รูปถัดไป' })).not.toBeInTheDocument();
  });
});
