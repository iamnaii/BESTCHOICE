import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DossierDisclosure from './DossierDisclosure';

describe('dossier disclosure', () => {
  it('hides controls while collapsed and preserves an unfinished draft when reopened', () => {
    render(<DossierDisclosure title="ข้อมูลเพิ่มเติม" summary="ประวัติและข้อมูลอื่น">
      <label>บันทึกเพิ่มเติม<input defaultValue="" /></label>
      <button type="button">บันทึก</button>
    </DossierDisclosure>);
    const trigger = screen.getByRole('button', { name: 'ข้อมูลเพิ่มเติม' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'บันทึก' })).toBeNull();
    fireEvent.click(trigger);
    const draft = screen.getByRole('textbox', { name: 'บันทึกเพิ่มเติม' });
    fireEvent.change(draft, { target: { value: 'ร่างที่ยังไม่บันทึก' } });
    fireEvent.click(trigger);
    expect(draft).toBeInTheDocument();
    expect(draft).not.toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox')).toHaveValue('ร่างที่ยังไม่บันทึก');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeVisible();
  });
});
