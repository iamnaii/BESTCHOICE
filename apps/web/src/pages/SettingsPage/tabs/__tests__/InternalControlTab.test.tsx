import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InternalControlTab } from '../InternalControlTab';

// mock การ์ดลูกทั้ง 5 — เทสนี้ตรวจ "การประกอบ/จัดกลุ่ม" ไม่ใช่ internals ของการ์ด
vi.mock('../../components/MakerCheckerToggle', () => ({
  MakerCheckerToggle: () => <div>maker-checker</div>,
}));
vi.mock('../../components/ReversePermissionCard', () => ({
  ReversePermissionCard: () => <div>reverse-permission</div>,
}));
vi.mock('../../components/ReverseReasonsManagementCard', () => ({
  ReverseReasonsManagementCard: () => <div>reverse-reasons</div>,
}));
vi.mock('../../components/PettyCashCustodianCard', () => ({
  PettyCashCustodianCard: () => <div>petty-cash</div>,
}));
vi.mock('../../components/TestModeToggle', () => ({
  TestModeToggle: () => <div>test-mode</div>,
}));

describe('InternalControlTab', () => {
  it('แสดงการ์ดควบคุมครบ 5 อัน', () => {
    render(<InternalControlTab />);
    expect(screen.getByText('maker-checker')).toBeTruthy();
    expect(screen.getByText('reverse-permission')).toBeTruthy();
    expect(screen.getByText('reverse-reasons')).toBeTruthy();
    expect(screen.getByText('petty-cash')).toBeTruthy();
    expect(screen.getByText('test-mode')).toBeTruthy();
  });

  it('แสดงหัวข้อกลุ่มครบ 3 กลุ่ม', () => {
    render(<InternalControlTab />);
    expect(screen.getByText('การอนุมัติ & สิทธิ์')).toBeTruthy();
    expect(screen.getByText('เงินสด')).toBeTruthy();
    expect(screen.getByText('ความปลอดภัย')).toBeTruthy();
  });
});
