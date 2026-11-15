import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get: apiGet }, getErrorMessage: (e: unknown) => String(e) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AuditLogsPage from './AuditLogsPage';

describe('AuditLogsPage — S1-04 ช่องกรองหน้าตาเดียวกัน', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => ({
      data: url === '/audit/logs'
        ? { data: [], total: 0 }
        : { todayCount: 0, weekCount: 0, totalCount: 0, recentErrors: 0 },
    }));
  });

  it('ช่อง "รายการ" ใช้ formControlClass (ขอบ border-input พื้น bg-background) · ช่องวันที่เว้นที่ให้ไอคอนปฏิทิน', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuditLogsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const entity = await screen.findByLabelText('รายการ');
    expect(entity).toHaveClass('rounded-lg', 'border-input', 'bg-background');
    // className เดิม "px-3" ทับ "pr-9" ของ ThaiDateInput (tailwind-merge) ⇒ ไอคอนทับตัวอักษร (F4)
    for (const label of ['จากวันที่', 'ถึงวันที่']) {
      expect(screen.getByLabelText(label)).toHaveClass('pr-9');
    }
  });
});
