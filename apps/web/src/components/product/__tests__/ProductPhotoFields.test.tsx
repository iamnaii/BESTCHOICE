import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ProductPhotoFields, { prepareProductPhoto } from '../ProductPhotoFields';

describe('named product and evidence photo slots', () => {
  it('keeps six angles and four internal evidence slots separate', () => {
    render(<ProductPhotoFields photos={{ front: 'front.png' }} evidencePhotos={{ imeiScreen: 'imei.png', batteryScreen: 'battery.png' }} onChange={vi.fn()} />);
    const angles = screen.getByRole('region', { name: 'รูปสินค้า 6 มุม' });
    const evidence = screen.getByRole('region', { name: 'หลักฐานประกอบสัญญา' });
    expect(within(angles).getByText('1/6')).toBeInTheDocument();
    for (const name of ['หน้า', 'หลัง', 'ซ้าย', 'ขวา', 'บน', 'ล่าง']) expect(within(angles).getByLabelText(`อัปโหลดรูป${name}`)).toBeInTheDocument();
    for (const name of ['หน้า IMEI', 'ตราครุฑ', 'หน้า % แบต', 'ประวัติการเปลี่ยนอะไหล่']) expect(within(evidence).getByLabelText(`อัปโหลดรูป${name}`)).toBeInTheDocument();
    expect(within(angles).queryByAltText('รูปหน้า IMEI')).not.toBeInTheDocument();
  });
  it('removes the exact evidence key and previews the original photo', async () => {
    const onChange = vi.fn();
    render(<ProductPhotoFields evidencePhotos={{ regulatory: 'regulatory.png' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'ดูรูปตราครุฑ' }));
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', 'regulatory.png');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'ลบรูปตราครุฑ' }));
    expect(onChange).toHaveBeenCalledWith('regulatory', null);
  });
  it('read-only viewers have no upload or delete controls', () => {
    render(<ProductPhotoFields evidencePhotos={{ imeiScreen: 'imei.png' }} />);
    expect(screen.queryByLabelText('อัปโหลดรูปหน้า IMEI')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ลบรูปหน้า IMEI' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดูรูปหน้า IMEI' })).toBeEnabled();
  });
  it('rejects unsupported and oversized files before decoding', async () => {
    await expect(prepareProductPhoto(new File(['x'], 'bad.svg', { type: 'image/svg+xml' }))).rejects.toThrow('รองรับ JPG');
    const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' });
    await expect(prepareProductPhoto(large)).rejects.toThrow('ไม่เกิน 5MB');
  });
});
