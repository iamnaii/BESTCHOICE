import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CategoryPage } from '../CategoryPage';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
// mock inline components ของหมวด system ให้เบา
vi.mock('@/pages/SettingsPage/components/TestModeToggle', () => ({ TestModeToggle: () => <div>test-mode-body</div> }));
vi.mock('@/pages/SettingsPage/tabs/PdpaTab', () => ({ PdpaTab: () => <div>pdpa-body</div> }));
vi.mock('@/pages/SettingsPage/tabs/OffsiteBackupTab', () => ({ OffsiteBackupTab: () => <div>backup-body</div> }));

function renderCat(id: string) {
  return render(<MemoryRouter><CategoryPage categoryId={id} /></MemoryRouter>);
}

describe('CategoryPage', () => {
  it('render inline component sections ของหมวด (system)', () => {
    role = 'OWNER';
    renderCat('system');
    expect(screen.getByText('test-mode-body')).toBeTruthy();
    expect(screen.getByText('pdpa-body')).toBeTruthy();
    expect(screen.getByText('backup-body')).toBeTruthy();
  });

  it('render external item เป็นลิงก์', () => {
    role = 'OWNER';
    renderCat('system');
    const link = screen.getByRole('link', { name: /Audit Log/ });
    expect(link.getAttribute('href')).toBe('/audit-logs');
  });

  it('หมวดไม่รู้จัก → ข้อความว่าง ไม่ crash', () => {
    role = 'OWNER';
    renderCat('nope');
    expect(screen.getByText('ไม่พบหมวดนี้')).toBeTruthy();
  });
});
