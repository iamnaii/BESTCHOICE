import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader';

describe('PageHeader supplemental instructions', () => {
  it('keeps the purpose visible and lets the user open complete instructions', async () => {
    const user = userEvent.setup();
    const props = {
      title: 'รับเครื่องคืน',
      subtitle: 'บันทึกรับเครื่องคืนและติดตามการยืนยัน',
      helpLabel: 'ขั้นตอนรับเครื่องคืน',
      help: 'สาขาบันทึกใบรับเครื่องคืน แล้วฝ่ายการเงินตรวจสอบและยืนยัน',
    };
    render(<PageHeader {...props} />);
    expect(screen.getByText(props.subtitle)).toBeVisible();
    const toggle = screen.getByText(props.helpLabel);
    expect(screen.getByText(props.help)).not.toBeVisible();
    await user.click(toggle);
    expect(screen.getByText(props.help)).toBeVisible();
    await user.click(toggle);
    expect(screen.getByText(props.help)).not.toBeVisible();
    expect(screen.getByText(props.subtitle)).toBeVisible();
  });

  it('does not add an empty help control to ordinary pages', () => {
    const { container } = render(
      <PageHeader title="ลูกค้า" subtitle="ค้นหาและจัดการข้อมูลลูกค้า" />,
    );
    expect(screen.getByRole('heading', { name: 'ลูกค้า' })).toBeVisible();
    expect(container.querySelector('details')).toBeNull();
  });
});
