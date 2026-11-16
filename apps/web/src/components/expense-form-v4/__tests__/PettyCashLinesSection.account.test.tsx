import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));
vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: () => ({
    data: { groups: [{ category: 'ค่าใช้จ่าย', accounts: [{ code: '53-1101', name: 'ค่าไฟฟ้า' }] }] },
  }),
}));
vi.mock('../VendorCombobox', () => ({
  VendorCombobox: () => <button type="button">ผู้ขาย</button>,
}));

import { PettyCashLinesSection } from '../PettyCashLinesSection';
import { newPettyCashLine, type PettyCashFormFields } from '../types';

function Harness() {
  const [value, setValue] = useState<PettyCashFormFields>(() => ({ custodianName: '', lines: [newPettyCashLine()] }));
  return <PettyCashLinesSection value={value} onChange={setValue} />;
}

// owner 2026-11-16 (R2 T7 review): the mobile card's "หมวดบัญชี" label is a real <label htmlFor> on the picker.
describe('PettyCashLinesSection — หมวดบัญชี (real AccountCombobox)', () => {
  beforeEach(() => { mobile.value = false; });

  it('mobile card: the visible label names the picker through htmlFor (no aria-label)', () => {
    mobile.value = true;
    render(<Harness />);
    const trigger = screen.getByLabelText('หมวดบัญชี');
    expect(trigger).toBe(screen.getByRole('combobox', { name: 'หมวดบัญชี' }));
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('desktop table: the picker keeps its aria-label', () => {
    render(<Harness />);
    const trigger = screen.getByLabelText('หมวดบัญชี');
    expect(trigger).toBe(screen.getByRole('combobox', { name: 'หมวดบัญชี' }));
    expect(trigger).toHaveAttribute('aria-label', 'หมวดบัญชี');
  });
});
