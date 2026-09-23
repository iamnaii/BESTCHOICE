import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OutcomePicker from './OutcomePicker';
import type { OutcomeOption } from './after-sales';

const OPTIONS: OutcomeOption[] = [
  { outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'SHOP' },
  {
    outcome: 'SAME_MODEL_EXCHANGE',
    enabled: true,
    implemented: false,
    note: 'เปลี่ยนรุ่นเดิมให้ลูกค้าทันที',
  },
  {
    outcome: 'PRICED_EXCHANGE',
    enabled: false,
    implemented: false,
    reason: 'ต้องผ่อนมาแล้วอย่างน้อย 3 งวด',
  },
];

describe('OutcomePicker — เลือกทางออกเคสหลังการขาย', () => {
  it('ปุ่มซ่อมกดได้ → เรียก onChange("REPAIR")', async () => {
    const onChange = vi.fn();
    render(<OutcomePicker options={OPTIONS} value={null} onChange={onChange} />);

    const repairButton = screen.getByRole('button', { name: /ซ่อม/ });
    expect(repairButton).toBeEnabled();
    await userEvent.click(repairButton);
    expect(onChange).toHaveBeenCalledWith('REPAIR');
  });

  it('ปุ่ม "เปลี่ยนรุ่นเดิม" ปิดพร้อมข้อความ "เปิดใช้ในรอบถัดไป" (enabled แต่ implemented=false)', () => {
    render(<OutcomePicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: /เปลี่ยนรุ่นเดิม/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('เปิดใช้ในรอบถัดไป');
  });

  it('ปุ่ม "เปลี่ยนแบบมีราคา" ปิดพร้อม reason จากเซิร์ฟเวอร์ (enabled=false)', () => {
    render(<OutcomePicker options={OPTIONS} value={null} onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: /เปลี่ยนแบบมีราคา/ });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('ต้องผ่อนมาแล้วอย่างน้อย 3 งวด');
  });

  it('ทุกปุ่มเป็น <button type="button" aria-pressed> — 3 ปุ่มพอดี', () => {
    render(<OutcomePicker options={OPTIONS} value="REPAIR" onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('aria-pressed');
    }
    expect(screen.getByRole('button', { name: /ซ่อม/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /เปลี่ยนรุ่นเดิม/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
