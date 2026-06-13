import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SettingsPage from '../index';

let mockRole = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}));
// stub tab bodies (avoid data fetching); only the active tab mounts.
vi.mock('../tabs/ContactsTab', () => ({ ContactsTab: () => <div>contacts-body</div> }));
vi.mock('../tabs/EmployeesTab', () => ({ EmployeesTab: () => <div>employees-body</div> }));

function renderAt(hash = '') {
  window.location.hash = hash;
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('SettingsPage — role-gated tabs', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('OWNER เห็นแท็บ master-data + config', () => {
    mockRole = 'OWNER';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'พนักงาน' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'บริษัท' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'PDPA' })).toBeTruthy();
  });

  it('FINANCE_MANAGER เห็นเฉพาะ ผู้ติดต่อ', () => {
    mockRole = 'FINANCE_MANAGER';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'พนักงาน' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'บริษัท' })).toBeNull();
  });

  it('ACCOUNTANT เห็น ผู้ติดต่อ + พนักงาน (ไม่เห็น config)', () => {
    mockRole = 'ACCOUNTANT';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'พนักงาน' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'บริษัท' })).toBeNull();
  });

  it('role ที่ไม่อนุญาต (SALES) ถูก redirect (ไม่เห็นแท็บ)', () => {
    mockRole = 'SALES';
    renderAt();
    expect(screen.queryByRole('tab', { name: 'ผู้ติดต่อ' })).toBeNull();
  });

  it('hash ที่ไม่มีสิทธิ์ (FM เปิด #vat) → ตกไปแท็บแรกที่เห็น (ผู้ติดต่อ)', () => {
    mockRole = 'FINANCE_MANAGER';
    renderAt('#vat');
    expect(screen.getByText('contacts-body')).toBeTruthy();
  });
});
