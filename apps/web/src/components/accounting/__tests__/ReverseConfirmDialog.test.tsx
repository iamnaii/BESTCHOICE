import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReverseConfirmDialog } from '../ReverseConfirmDialog';
import type { IcabModule } from '../types';

vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({
    reversePermission: 'OWNER+FINANCE_MANAGER',
    reverseReasonRequired: true,
    reverseReasons: [{ code: 'r1', label: 'บันทึกผิดบัญชี' }],
  }),
}));

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: [] })) },
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
);

/**
 * The reverse-dialog mockup lists a ภ.พ.30 (VAT-filing) impact warning so the
 * accountant is reminded that an already-filed VAT period must be amended.
 * It must appear for EVERY module (expense + asset have input VAT too),
 * not just other_income.
 */
describe('ReverseConfirmDialog — impact notes', () => {
  const modules: IcabModule[] = ['other_income', 'expense', 'asset'];

  it.each(modules)('shows the ภ.พ.30 VAT-filing warning for module=%s', (module) => {
    render(
      wrap(
        <ReverseConfirmDialog
          open
          module={module}
          docNumber="DOC-1"
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/ภ\.พ\.30/)).toBeInTheDocument();
  });
});
