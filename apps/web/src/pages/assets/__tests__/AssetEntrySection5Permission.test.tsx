// PR 2a Task 6 (P7) — AssetEntrySection5Permission: user picker + per-row
// view/edit/post checkboxes + enforcement-deferred disclaimer.
//
// Coverage:
//  - Section header text "กำหนดสิทธิ์ (Permission)"
//  - Empty-state hint when no permissions are set
//  - Disclaimer text that API enforcement is deferred
//  - Old "ผู้อนุมัติ" label from the legacy single-approver UI no longer renders
//
// Deferred (Radix Select interaction): the user picker uses Radix Select which
// portals into a layer JSDOM cannot fully render. Adding/removing users + the
// per-row checkboxes are validated manually for this PR; future work can use
// Playwright for full e2e flows.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AssetEntrySection5Permission } from '../components/AssetEntrySection5Permission';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: {
        data: [
          { id: 'u1', name: 'สุทธินีย์ คงเดช', role: 'OWNER' },
          { id: 'u2', name: 'เอกนรินทร์ คงเดช', role: 'FINANCE_MANAGER' },
        ],
      },
    }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({ defaultValues: { permissionConfig: [] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <FormProvider {...(methods as any)}>{children}</FormProvider>;
}

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Wrapper>
        <AssetEntrySection5Permission />
      </Wrapper>
    </QueryClientProvider>,
  );
};

describe('AssetEntrySection5Permission — P7 permission UI', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders section header "กำหนดสิทธิ์ (Permission)"', async () => {
    renderSection();
    expect(
      await screen.findByText('กำหนดสิทธิ์ (Permission)'),
    ).toBeInTheDocument();
  });

  it('shows empty state when no permissions set', async () => {
    renderSection();
    expect(
      await screen.findByText(/ยังไม่มีผู้ใช้ในรายการสิทธิ์/),
    ).toBeInTheDocument();
  });

  it('shows enforcement-deferred disclaimer', async () => {
    renderSection();
    expect(
      await screen.findByText(/บังคับสิทธิ์ที่ระดับ API จะเพิ่มในเฟสถัดไป/),
    ).toBeInTheDocument();
  });

  it('does NOT render legacy approver dropdown text', async () => {
    renderSection();
    await screen.findByText('กำหนดสิทธิ์ (Permission)');
    // The legacy component had a stand-alone "ผู้อนุมัติ" label — must be gone.
    expect(screen.queryByText(/^ผู้อนุมัติ$/)).not.toBeInTheDocument();
  });
});
