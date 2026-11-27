import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ClickToLoadMap from './ClickToLoadMap';

const SRC = 'https://maps.google.com/maps?q=test&z=16&output=embed';
const TITLE = 'แผนที่ร้านทดสอบ';

describe('ClickToLoadMap', () => {
  it('ก่อนกด: ไม่มี iframe และไม่มี google.com ใน HTML', () => {
    const { container } = render(<ClickToLoadMap src={SRC} title={TITLE} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.innerHTML).not.toContain('google.com');
    expect(screen.getByRole('button', { name: 'แสดงแผนที่' })).toBeTruthy();
    expect(
      screen.getByText('แผนที่มาจาก Google Maps เมื่อกดแสดง Google จะได้รับข้อมูลการใช้งานของคุณ'),
    ).toBeTruthy();
  });

  it('หลังกด: มี iframe เดียว src/title ถูก ปุ่มหาย และ focus อยู่ที่ iframe', () => {
    const { container } = render(<ClickToLoadMap src={SRC} title={TITLE} />);
    fireEvent.click(screen.getByRole('button', { name: 'แสดงแผนที่' }));
    const frames = container.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute('src')).toBe(SRC);
    expect(frames[0].getAttribute('title')).toBe(TITLE);
    expect(screen.queryByRole('button', { name: 'แสดงแผนที่' })).toBeNull();
    expect(document.activeElement).toBe(frames[0]);
  });
});
