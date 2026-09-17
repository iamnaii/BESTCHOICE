import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildCustomerColumns } from '../components/customerColumns';
import type { RowMenuItem } from '../components/CustomerCells';
import type { CustomerRow } from '../types';

/**
 * เมนูท้ายแถวของแท็บลูกค้า — M-W8: `nationalId` เป็น nullable แล้ว
 * ⇒ แถวที่ไม่มีเลขบัตรต้องไม่มี "คัดลอกเลขบัตร" (เดิมกดแล้วคัดลอกค่าว่าง) แบบเดียวกับ "คัดลอกเบอร์โทร"
 */

function row(overrides: Partial<CustomerRow>): CustomerRow {
  return {
    id: 'c1',
    name: 'สมชาย ผ่อนดี',
    nickname: null,
    phone: '0810000001',
    nationalId: '1234567890123',
    occupation: null,
    salary: null,
    createdAt: '2026-09-01T03:00:00.000Z',
    _count: { contracts: 0 },
    activeContracts: 0,
    overdueContracts: 0,
    latestCreditStatus: null,
    latestCreditScore: null,
    ...overrides,
  };
}

function menuItems(c: CustomerRow, onCopy = vi.fn()): RowMenuItem[] {
  const columns = buildCustomerColumns({
    isOwner: true,
    isOwnerOrManager: true,
    canViewSalary: false,
    canOpenChat: true,
    onDelete: vi.fn(),
    onCopy,
    navigate: vi.fn(),
  });
  const actions = columns.find((col) => col.key === 'actions');
  if (!actions?.render) throw new Error('missing actions column');
  const el = actions.render(c, actions, 0);
  if (!isValidElement<{ items: RowMenuItem[] }>(el)) throw new Error('actions column must render RowMenu');
  return el.props.items;
}

describe('เมนูท้ายแถว — คัดลอกเลขบัตร', () => {
  it('มีเลขบัตร → มีเมนู และคัดลอกเลขนั้น', () => {
    const onCopy = vi.fn();
    const item = menuItems(row({}), onCopy).find((i) => i.key === 'copy-nid');
    expect(item?.label).toBe('คัดลอกเลขบัตร');
    item?.onSelect();
    expect(onCopy).toHaveBeenCalledWith('1234567890123', 'เลขบัตร');
  });

  it('ไม่มีเลขบัตร (null) → ไม่มีเมนูคัดลอกเลขบัตร · เมนูอื่นยังอยู่', () => {
    const keys = menuItems(row({ nationalId: null })).map((i) => i.key);
    expect(keys).not.toContain('copy-nid');
    expect(keys).toEqual(expect.arrayContaining(['open', 'copy-phone', 'delete']));
  });
});
