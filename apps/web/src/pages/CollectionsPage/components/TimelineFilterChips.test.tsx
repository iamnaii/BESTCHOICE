import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimelineFilterChips from './TimelineFilterChips';

describe('TimelineFilterChips', () => {
  it('ไม่ส่ง chips → ชุดติดตามหนี้เดิม 7 ชิปตามลำดับ', () => {
    render(<TimelineFilterChips value="ALL" onChange={() => {}} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'ทั้งหมด',
      'ชำระ',
      'แจ้งเตือน',
      'โทร',
      'หนังสือ',
      'เครื่อง',
      'สถานะ',
    ]);
    expect(screen.getByRole('button', { name: 'ทั้งหมด' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ส่ง chips → ใช้ชุดที่ส่ง พร้อมจำนวน ชิปที่เลือก และ onChange ส่ง value ของชิป', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TimelineFilterChips
        value="chat"
        onChange={onChange}
        counts={{ chat: 4 }}
        chips={[
          { value: 'ALL', label: 'ทั้งหมด' },
          { value: 'chat', label: 'แชท' },
          { value: 'sale', label: 'ขาย/สัญญา' },
        ]}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['ทั้งหมด', 'แชท4', 'ขาย/สัญญา']);
    expect(screen.getByRole('button', { name: /^แชท/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ขาย/สัญญา' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'ขาย/สัญญา' }));
    expect(onChange).toHaveBeenCalledWith('sale');
  });
});
