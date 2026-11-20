import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

const authState = vi.hoisted(() => ({ role: 'OWNER' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: authState.role } }) }));
vi.mock('../terms/TermsTab', () => ({ TermsTab: () => <p>terms-tab</p> }));
vi.mock('../calc/CalcTab', () => ({ CalcTab: () => <p>calc-tab</p> }));
vi.mock('../GfinPrecheckSettingsPanel', () => ({ GfinPrecheckSettingsPanel: () => <p>line-tab</p> }));

import GfinConfigPage from '../index';

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
}
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <GfinConfigPage />
      <Where />
    </MemoryRouter>,
  );

describe('GfinConfigPage', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
  });

  it('เจ้าของเปิดครั้งแรก = แท็บเงื่อนไข & ราคา · มี 3 แท็บ', () => {
    renderAt('/settings/finance/gfin');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['เงื่อนไข & ราคา', 'ทดลองคำนวณ', 'กลุ่มไลน์ & ข้อความ']);
    expect(screen.getByText('terms-tab')).toBeInTheDocument();
  });

  it('?tab=calc เปิดแท็บทดลองคำนวณ · กดแท็บแล้ว URL เปลี่ยน', async () => {
    renderAt('/settings/finance/gfin?tab=calc');
    expect(screen.getByText('calc-tab')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'กลุ่มไลน์ & ข้อความ' }));
    expect(screen.getByTestId('where').textContent).toBe('?tab=line');
  });

  it('ไม่ใช่เจ้าของ เห็นเฉพาะกลุ่มไลน์ แม้ส่ง ?tab=terms', () => {
    authState.role = 'FINANCE_MANAGER';
    renderAt('/settings/finance/gfin?tab=terms');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByText('line-tab')).toBeInTheDocument();
  });
});
