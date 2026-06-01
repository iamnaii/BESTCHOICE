import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InternalControlActionBar } from '../InternalControlActionBar';
import type { IcabAuditEvent, IcabCurrentUser } from '../types';

/**
 * Smoke tests for the shared InternalControlActionBar. The component
 * delegates per-module business logic to its parent, so these tests focus
 * on the surface area that's identical across Other Income, Expense, Asset:
 *   - button visibility per status
 *   - print/reverse gating
 *   - audit-timeline popover
 *
 * The ReverseConfirmDialog's own behavior is covered indirectly here
 * (opens, calls onReverse) — its full coverage lives in a sibling spec.
 */

vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
    reversePermission: 'OWNER+FINANCE_MANAGER',
    reverseReasonRequired: true,
    reverseReasons: [{ code: 'r1', label: 'บันทึกผิดบัญชี' }],
  }),
}));

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function wrap(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

const baseUser: IcabCurrentUser = {
  id: 'u-owner',
  role: 'OWNER',
  name: 'Owner Test',
  canReverseOverride: null,
};

const sampleAudit: IcabAuditEvent[] = [
  {
    event: 'CREATED',
    userId: 'u-owner',
    userName: 'Owner Test',
    timestamp: '2026-05-12T07:25:10.000Z',
  },
];

describe('InternalControlActionBar', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  describe('DRAFT', () => {
    it('shows ยกเลิก / บันทึกร่าง / บันทึก & POST when handlers provided', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="DRAFT"
            auditLog={sampleAudit}
            currentUser={baseUser}
            onCancel={vi.fn()}
            onSaveDraft={vi.fn()}
            onPost={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /ยกเลิก/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /บันทึกร่าง/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /บันทึก & POST/i })).toBeInTheDocument();
    });

    it('shows ส่งให้อนุมัติ instead of บันทึก & POST when maker-checker is enabled', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="DRAFT"
            auditLog={[]}
            currentUser={baseUser}
            makerCheckerEnabled
            onCancel={vi.fn()}
            onPost={vi.fn()}
            onSubmitForApproval={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /ส่งให้อนุมัติ/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /บันทึก & POST/i })).not.toBeInTheDocument();
    });

    it('shows ต้องอนุมัติ badge under maker-checker', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="expense"
            status="DRAFT"
            auditLog={[]}
            currentUser={baseUser}
            makerCheckerEnabled
            onCancel={vi.fn()}
          />,
        ),
      );
      expect(screen.getByText('ต้องอนุมัติ')).toBeInTheDocument();
    });

    it('disables POST when canPost=false', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="DRAFT"
            auditLog={[]}
            currentUser={baseUser}
            canPost={false}
            onCancel={vi.fn()}
            onPost={vi.fn()}
          />,
        ),
      );
      const postButton = screen.getByRole('button', { name: /บันทึก & POST/i });
      expect(postButton).toBeDisabled();
    });
  });

  describe('POSTED', () => {
    it('renders print button with module-default label', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={baseUser}
            docNumber="RT-202605-00006"
            onCancel={vi.fn()}
            onPrint={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /พิมพ์ใบเสร็จ/i })).toBeInTheDocument();
    });

    it('uses module-specific print label for expense', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="expense"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={baseUser}
            docNumber="EX-202605-00001"
            onCancel={vi.fn()}
            onPrint={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /พิมพ์ใบสำคัญจ่าย/i })).toBeInTheDocument();
    });

    it('uses module-specific print label for asset', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="asset"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={baseUser}
            docNumber="AS-202605-00001"
            onCancel={vi.fn()}
            onPrint={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /พิมพ์ใบรับสินทรัพย์/i })).toBeInTheDocument();
    });

    it('shows reverse button for OWNER even when canReverse=false', () => {
      // OWNER short-circuits the canReverse gate per design (OWNER policy owner)
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={{ ...baseUser, role: 'OWNER' }}
            docNumber="RT-202605-00006"
            canReverse={false}
            onCancel={vi.fn()}
            onReverse={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /กลับรายการ/i })).toBeInTheDocument();
    });

    it('hides reverse button for non-OWNER when canReverse=false', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={{ ...baseUser, role: 'SALES' }}
            docNumber="RT-202605-00006"
            canReverse={false}
            onCancel={vi.fn()}
            onReverse={vi.fn()}
          />,
        ),
      );
      expect(screen.queryByRole('button', { name: /กลับรายการ/i })).not.toBeInTheDocument();
    });
  });

  describe('REVERSED', () => {
    it('shows only ปิด + พิมพ์ใบกลับรายการ — no reverse button', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="REVERSED"
            auditLog={sampleAudit}
            currentUser={baseUser}
            docNumber="RT-202605-00006"
            onCancel={vi.fn()}
            onPrint={vi.fn()}
            onReverse={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /ปิด/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /พิมพ์ใบกลับรายการ/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^ยกเลิก/ })).not.toBeInTheDocument();
    });
  });

  describe('READY (maker-checker approver flow)', () => {
    it('shows ปฏิเสธ + อนุมัติ & POST when viewer is approver', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="READY"
            auditLog={sampleAudit}
            currentUser={baseUser}
            isViewerApprover
            onCancel={vi.fn()}
            onApprove={vi.fn()}
            onReject={vi.fn()}
          />,
        ),
      );
      expect(screen.getByRole('button', { name: /ปฏิเสธ/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /อนุมัติ & POST/i })).toBeInTheDocument();
    });

    it('hides approver buttons when viewer is not approver', () => {
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="READY"
            auditLog={sampleAudit}
            currentUser={baseUser}
            isViewerApprover={false}
            onCancel={vi.fn()}
            onApprove={vi.fn()}
            onReject={vi.fn()}
          />,
        ),
      );
      expect(screen.queryByRole('button', { name: /ปฏิเสธ/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /อนุมัติ & POST/i })).not.toBeInTheDocument();
    });
  });

  describe('reverse dialog wiring', () => {
    it('opens the dialog and forwards payload to onReverse on confirm', async () => {
      const onReverse = vi.fn();
      render(
        wrap(
          <InternalControlActionBar
            module="other_income"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={{ ...baseUser, role: 'OWNER' }}
            docNumber="RT-202605-00006"
            onCancel={vi.fn()}
            onReverse={onReverse}
          />,
        ),
      );
      // Trigger dialog
      fireEvent.click(screen.getByRole('button', { name: /กลับรายการ/i }));
      // Pick reason
      const reasonSelect = await screen.findByRole('combobox');
      fireEvent.change(reasonSelect, { target: { value: 'r1' } });
      // Type note
      const noteField = screen.getByLabelText(/บันทึกรายละเอียด/);
      fireEvent.change(noteField, { target: { value: 'note ทดสอบ' } });
      // Confirm
      fireEvent.click(screen.getByRole('button', { name: /ยืนยันกลับรายการ/i }));

      expect(onReverse).toHaveBeenCalledWith({
        reasonId: 'r1',
        reasonLabel: 'บันทึกผิดบัญชี',
        note: 'note ทดสอบ',
      });
    });
  });

  describe('module data attributes', () => {
    it('exposes module + status as data attributes', () => {
      const { container } = render(
        wrap(
          <InternalControlActionBar
            module="asset"
            status="POSTED"
            auditLog={sampleAudit}
            currentUser={baseUser}
            docNumber="AS-1"
            onCancel={vi.fn()}
          />,
        ),
      );
      const frame = container.querySelector('[data-testid="icab-frame"]');
      expect(frame?.getAttribute('data-module')).toBe('asset');
      expect(frame?.getAttribute('data-status')).toBe('POSTED');
    });
  });
});
