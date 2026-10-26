import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { DEFAULT_RECEIPT_WARRANTY_TERMS } from '@installment/shared';

// hook ต้องคืน object ใหม่ทุกครั้ง (บทเรียน vitest: hook ห้ามคืน mock object เดียวกัน) — ใช้ useState จริงให้ปุ่ม แก้ไข ทำงาน
const hoisted = vi.hoisted(() => ({
  values: {} as Record<string, string>,
  mutate: vi.fn(),
}));
vi.mock('../hooks/useSettingsEditor', () => ({
  useSettingsEditor: () => {
    const [editingSection, setEditingSection] = React.useState<string | null>(null);
    return {
      values: hoisted.values,
      editingSection,
      setEditingSection,
      saveMutation: { mutate: hoisted.mutate, isPending: false },
    };
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));

import ReceiptsSettingsPage from '../ReceiptsSettingsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <ReceiptsSettingsPage />
    </MemoryRouter>,
  );
}

describe('ReceiptsSettingsPage — ข้อความเงื่อนไขประกันร้านท้ายใบเสร็จ', () => {
  beforeEach(() => {
    hoisted.values = {};
    hoisted.mutate.mockReset();
  });

  it('shows the page title, the field and the default text as a hint', () => {
    renderPage();
    expect(screen.getByText('ตั้งค่าใบเสร็จขายสด')).toBeInTheDocument();
    expect(screen.getByText('เงื่อนไขประกัน')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(DEFAULT_RECEIPT_WARRANTY_TERMS.slice(0, 20)))).toBeInTheDocument();
  });

  it('saves the edited text under receipt_shop_warranty_terms', () => {
    hoisted.values = { receipt_shop_warranty_terms: 'ข้อความเดิม' };
    renderPage();
    fireEvent.click(screen.getByText('แก้ไข'));
    const input = screen.getByLabelText('เงื่อนไขประกันร้านท้ายใบเสร็จ') as HTMLInputElement;
    expect(input.value).toBe('ข้อความเดิม');
    fireEvent.change(input, { target: { value: 'ประกันร้าน 30 วัน ไม่รวมตกน้ำ' } });
    fireEvent.click(screen.getByText('บันทึก'));
    expect(hoisted.mutate).toHaveBeenCalledWith([{ key: 'receipt_shop_warranty_terms', value: 'ประกันร้าน 30 วัน ไม่รวมตกน้ำ' }]);
  });
});
