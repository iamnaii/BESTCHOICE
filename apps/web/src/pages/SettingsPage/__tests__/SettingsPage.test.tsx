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
vi.mock('../tabs/InternalControlTab', () => ({
  InternalControlTab: () => <div>internal-control-body</div>,
}));

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
    expect(screen.queryByRole('tab', { name: 'พนักงาน' })).toBeNull();
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

  it('ACCOUNTANT เห็น ผู้ติดต่อ เท่านั้น (ไม่เห็น config หรือ พนักงาน)', () => {
    mockRole = 'ACCOUNTANT';
    renderAt();
    expect(screen.getByRole('tab', { name: 'ผู้ติดต่อ' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'พนักงาน' })).toBeNull();
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

  it('ไม่มีแท็บ "ผู้ใช้งาน" แล้ว + มีแท็บ "ระบบควบคุม & สิทธิ์" (OWNER)', () => {
    mockRole = 'OWNER';
    renderAt();
    expect(screen.queryByRole('tab', { name: 'ผู้ใช้งาน' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'ระบบควบคุม & สิทธิ์' })).toBeTruthy();
  });

  it('alias ลิงก์เก่า #users → เปิดแท็บ ระบบควบคุม & สิทธิ์ (OWNER)', () => {
    mockRole = 'OWNER';
    renderAt('#users');
    expect(screen.getByText('internal-control-body')).toBeTruthy();
  });
});
