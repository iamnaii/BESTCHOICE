import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApproverSection } from '@/components/expense-form-v4/ApproverSection';

let currentUser: { name: string } | null;
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: currentUser }) }));
beforeEach(() => { currentUser = { name: 'ผู้บันทึกจริง' }; });

describe('ApproverSection', () => {
  it('shows the current recorder and explains authenticated approval without a nominee input', () => {
    render(<ApproverSection />);
    expect(screen.getByText('ผู้บันทึกจริง')).toBeInTheDocument();
    expect(screen.getByText('ระบบบันทึกชื่อจากผู้มีสิทธิ์ที่กดอนุมัติจริง')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('does not invent a recorder when there is no authenticated user', () => {
    currentUser = null; render(<ApproverSection />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
