import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HeardFromChips } from '../HeardFromChips';

/** ลำดับบนบอร์ด HeardFrom (a)(b)(c1) และ Main (e) = JOURNEY_HEARD_FROM_CODES — ปักตัวอักษรจริงไว้ ไม่อ่านจาก shared */
const LABELS_IN_ORDER = ['โฆษณา FB', 'เพจ/โพสต์', 'TikTok', 'LINE', 'Google', 'เพื่อนแนะนำ', 'ผ่านหน้าร้าน', 'ลูกค้าเก่า', 'อื่น ๆ'];

function chips(): HTMLButtonElement[] {
  const group = screen.getByRole('group', { name: 'ลูกค้ารู้จักร้านจากไหน' });
  return within(group)
    .getAllByRole('button')
    .filter((button): button is HTMLButtonElement => button.hasAttribute('aria-pressed'));
}

describe('HeardFromChips', () => {
  it('หัวข้อ "(ไม่บังคับ)" + ชิป 9 ตัวตามลำดับ · ยังไม่มีคำตอบไม่มีชิปไหนถูกเลือก · ไม่มี onSkip ไม่มีปุ่มข้าม', () => {
    render(<HeardFromChips value={null} onSelect={() => {}} skipStyle="text" />);

    expect(screen.getByText('ลูกค้ารู้จักร้านจากไหน (ไม่บังคับ)')).toHaveClass('text-xs', 'font-medium', 'text-muted-foreground');
    expect(chips().map((chip) => chip.textContent)).toEqual(LABELS_IN_ORDER);
    expect(chips().every((chip) => chip.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.queryByRole('button', { name: 'ข้าม' })).toBeNull();
  });

  it('value เลือกชิปเดียว และแตะส่งรหัสของชิปที่แตะ (รวมชิปที่เลือกอยู่แล้ว)', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HeardFromChips value="LINE" onSelect={onSelect} skipStyle="text" />);

    const pressed = chips().filter((chip) => chip.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((chip) => chip.textContent)).toEqual(['LINE']);

    await user.click(screen.getByRole('button', { name: 'เพื่อนแนะนำ' }));
    expect(onSelect).toHaveBeenCalledWith('FRIEND');
    await user.click(screen.getByRole('button', { name: 'LINE' }));
    expect(onSelect).toHaveBeenLastCalledWith('LINE');
  });

  it('pendingCode: ชิปนั้นหมุน + ทุกชิปล็อกกันแตะซ้ำ + ปุ่มข้ามล็อก', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <HeardFromChips value={null} onSelect={onSelect} pendingCode="WALK_BY" onSkip={() => {}} skipStyle="ghost-button" />,
    );

    const busy = screen.getByRole('button', { name: 'ผ่านหน้าร้าน' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelector('svg.animate-spin')).not.toBeNull();
    expect(chips().every((chip) => chip.disabled)).toBe(true);
    expect(screen.getByRole('button', { name: 'ข้าม' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Google' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disabled ล็อกทุกชิป', () => {
    render(<HeardFromChips value={null} onSelect={() => {}} disabled skipStyle="text" />);
    expect(chips()).toHaveLength(9);
    expect(chips().every((chip) => chip.disabled)).toBe(true);
  });

  it('skipStyle="ghost-button": "ข้าม" เป็น Button ghost sm (ป้ายบนแท็บการเดินทาง)', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<HeardFromChips value={null} onSelect={() => {}} onSkip={onSkip} skipStyle="ghost-button" />);

    const skip = screen.getByRole('button', { name: 'ข้าม' });
    expect(skip).toHaveAttribute('data-slot', 'button');
    expect(skip).toHaveAttribute('type', 'button');
    await user.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('skipStyle="text": "ข้าม" เป็นปุ่มข้อความเล็ก (การ์ดสร้างสัญญา · dialog สร้างลูกค้า)', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<HeardFromChips value="FRIEND" onSelect={() => {}} onSkip={onSkip} skipStyle="text" />);

    const skip = screen.getByRole('button', { name: 'ข้าม' });
    expect(skip).not.toHaveAttribute('data-slot');
    expect(skip).toHaveAttribute('type', 'button');
    expect(skip).toHaveClass('text-xs', 'leading-snug', 'text-muted-foreground', 'hover:text-foreground');
    await user.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
