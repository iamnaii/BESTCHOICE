import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Command, CommandInput, CommandList } from '../command';

/**
 * ช่องค้นหาของ dropdown ที่ค้นได้ (ผู้ขาย, พนักงาน, ลูกค้า, ⌘K …) ต้องเป็นกรอบเดียวกับไอคอน
 * กรอบโฟกัสของแอป (outline 2px ห่าง 3px — styles/admin-colors.css) จึงล้อมทั้งช่องรวมไอคอน
 * และมีระยะในหัวรายการพอให้กรอบโฟกัสไม่ถูก Command (overflow-hidden) ตัดขอบ
 */
describe('CommandInput', () => {
  const mount = () =>
    render(
      <Command>
        <CommandInput placeholder="ค้นหาผู้ติดต่อ" />
        <CommandList />
      </Command>,
    );

  it('ไอคอนค้นหาอยู่ในกรอบเดียวกับช่องพิมพ์ และช่องพิมพ์มีกรอบของตัวเอง', () => {
    mount();
    const input = screen.getByPlaceholderText('ค้นหาผู้ติดต่อ');
    expect(input).toHaveClass('border', 'rounded-md', 'pl-9');
    const box = input.parentElement!;
    expect(box).toHaveClass('relative');
    expect(box.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('หัวรายการมีระยะรอบช่อง ไม่ให้กรอบโฟกัสถูกตัด และไม่ปิดกรอบโฟกัสของแอป', () => {
    mount();
    const input = screen.getByPlaceholderText('ค้นหาผู้ติดต่อ');
    expect(input.closest('[data-slot="command-input-wrapper"]')).toHaveClass('p-2');
    expect(input.className).not.toMatch(/outline-none|focus-visible:ring-0/);
  });
});
