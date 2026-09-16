import type { FormEvent } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceChip, ChoiceChipRow } from '../ChoiceChip';

describe('ChoiceChip', () => {
  it('aria-pressed ตาม active · type=button แตะในฟอร์มไม่ส่งฟอร์ม', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: FormEvent) => {
      e.preventDefault();
    });
    const onClick = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <ChoiceChip active onClick={onClick}>
          โทร
        </ChoiceChip>
        <ChoiceChip active={false} onClick={() => {}}>
          LINE
        </ChoiceChip>
      </form>,
    );

    const on = screen.getByRole('button', { name: 'โทร' });
    expect(on).toHaveAttribute('type', 'button');
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveClass('border-primary', 'bg-primary', 'text-primary-foreground');
    const off = screen.getByRole('button', { name: 'LINE' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(off).toHaveClass('border-input', 'bg-card', 'text-foreground');

    await user.click(on);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('จอต่ำกว่า lg สูง 44px (Q17) — กฎอยู่ที่ชิปตัวเดียว', () => {
    render(
      <ChoiceChip active={false} onClick={() => {}}>
        หน้าร้าน
      </ChoiceChip>,
    );
    expect(screen.getByRole('button', { name: 'หน้าร้าน' })).toHaveClass(
      'rounded-full',
      'text-xs',
      'leading-snug',
      'max-lg:h-11',
      'max-lg:px-4',
      'max-lg:text-sm',
    );
  });

  it('disabled กดไม่ได้', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ChoiceChip active={false} disabled onClick={onClick}>
        นัดแล้ว
      </ChoiceChip>,
    );
    const chip = screen.getByRole('button', { name: 'นัดแล้ว' });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ชิปที่กำลังบันทึก: สปินเนอร์ + ดูเป็นชิปที่เลือก + ไม่จางแม้ disabled · ชิปอื่นจาง', () => {
    render(
      <ChoiceChipRow label="ผล">
        <ChoiceChip active={false} busy disabled onClick={() => {}}>
          นัดแล้ว
        </ChoiceChip>
        <ChoiceChip active={false} disabled onClick={() => {}}>
          ไม่รับสาย
        </ChoiceChip>
      </ChoiceChipRow>,
    );

    const busy = screen.getByRole('button', { name: 'นัดแล้ว' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-pressed', 'true');
    expect(busy).toHaveClass('bg-primary');
    expect(busy.querySelector('svg.animate-spin')).not.toBeNull();
    expect(busy.className).not.toContain('disabled:opacity-40');

    const idle = screen.getByRole('button', { name: 'ไม่รับสาย' });
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg')).toBeNull();
    expect(idle).toHaveClass('disabled:opacity-40', 'disabled:cursor-not-allowed', 'bg-card');
  });
});

describe('ChoiceChipRow', () => {
  it('มีป้าย → group ชื่อตามป้าย + คำใบ้ตัวเล็กข้างป้าย', () => {
    render(
      <ChoiceChipRow label="ผล" hint="เลือกช่องทางก่อน">
        <ChoiceChip active={false} disabled onClick={() => {}}>
          นัดแล้ว
        </ChoiceChip>
      </ChoiceChipRow>,
    );
    const group = screen.getByRole('group', { name: 'ผล' });
    expect(within(group).getByText('เลือกช่องทางก่อน')).toHaveClass('text-2xs', 'text-muted-foreground/80');
    const row = within(group).getByRole('button', { name: 'นัดแล้ว' }).parentElement;
    expect(row).toHaveClass('flex', 'flex-wrap', 'gap-1.5', 'max-lg:gap-2');
  });

  it('ไม่มีป้าย → ไม่เป็น group (ผู้ห่อตั้งชื่อกลุ่มเอง เช่น HeardFromChips)', () => {
    render(
      <ChoiceChipRow>
        <ChoiceChip active={false} onClick={() => {}}>
          Google
        </ChoiceChip>
      </ChoiceChipRow>,
    );
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument();
  });
});
