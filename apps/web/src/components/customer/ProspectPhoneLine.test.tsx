import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProspectPhoneLine from './ProspectPhoneLine';

describe('ProspectPhoneLine', () => {
  it('ผู้สนใจจากแชท → "จากแชท · ยังไม่มีเบอร์" (ไม่ใช่บรรทัดว่าง)', () => {
    render(<ProspectPhoneLine phone={null} chatPlaceholder />);
    expect(screen.getByText('จากแชท · ยังไม่มีเบอร์')).toBeInTheDocument();
  });
  it('มีเบอร์ → แสดงเบอร์ · ไม่มีเบอร์และไม่ใช่ผู้สนใจจากแชท → ขีด', () => {
    const { rerender } = render(<ProspectPhoneLine phone="0812345678" />);
    expect(screen.getByText('0812345678')).toBeInTheDocument();
    rerender(<ProspectPhoneLine phone={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
