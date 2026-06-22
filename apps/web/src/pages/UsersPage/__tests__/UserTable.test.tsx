import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import { UserTable } from '../components/UserTable';

const baseUser = {
  id: 'u1', email: 'a@b.com', name: 'สมชาย', role: 'SALES', branchId: null, isActive: true,
  employeeId: 'EMP-001', nickname: null, phone: null, lineId: null, address: null,
  avatarUrl: null, startDate: null, nationalId: null, birthDate: null, lastLoginAt: null,
  createdAt: '2026-01-01', branch: null,
  employeeProfile: { id: 'p1', position: 'พนักงานขาย', employmentType: 'MONTHLY' as const, resignedDate: null },
};

describe('UserTable HR column', () => {
  it('shows HR position + employee badge', () => {
    render(
      <MemoryRouter>
        <UserTable users={[baseUser]} branches={[]} isLoading={false} isError={false} error={null}
          onRetry={() => {}} onEdit={vi.fn()} onToggleActive={() => {}} onBulkDeactivate={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('พนักงานขาย').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ทำงาน').length).toBeGreaterThan(0);
  });
});
