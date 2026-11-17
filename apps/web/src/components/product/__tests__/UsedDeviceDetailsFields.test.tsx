// apps/web/src/components/product/__tests__/UsedDeviceDetailsFields.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UsedDeviceDetailsFields from '../UsedDeviceDetailsFields';

const value = { batteryHealth: '89', warrantyExpired: false, warrantyExpireDate: '2027-01-31', hasBox: true };

const backgroundClasses = (el: HTMLElement) => [...el.classList].filter((c) => /(^|:)bg-/.test(c));

describe('UsedDeviceDetailsFields — ช่องวันที่ประกันศูนย์', () => {
  it('ช่องวันที่ใช้พื้นเดียวกับช่องแบตเตอรี่ (bg-card) — ThaiDateInput ไม่ทับพื้นของผู้เรียก', () => {
    render(<UsedDeviceDetailsFields value={value} onChange={vi.fn()} idPrefix="t" />);
    const battery = screen.getByLabelText(/% แบตเตอรี่/);
    const date = screen.getByLabelText('ประกันศูนย์ถึง');
    expect(date).toHaveAttribute('readonly');
    expect(backgroundClasses(battery)).toEqual(['bg-card']);
    expect(backgroundClasses(date)).toEqual(['bg-card']);
  });
});
