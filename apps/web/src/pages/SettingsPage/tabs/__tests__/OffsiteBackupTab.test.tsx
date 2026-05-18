import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import React from 'react';

// Mock api before importing the component
const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { OffsiteBackupTab } from '../OffsiteBackupTab';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, ui),
  );
}

describe('OffsiteBackupTab', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
  });

  it('renders config + history table when status returns runs', async () => {
    apiGet.mockResolvedValue({
      data: {
        enabled: true,
        destBucket: 'bestchoice-backups-offsite',
        retentionDays: 30,
        sqlSourceBucket: 'bestchoice-sql-exports',
        runs: [
          {
            id: 'r1',
            startedAt: '2026-05-18T03:30:00Z',
            finishedAt: '2026-05-18T03:31:42Z',
            status: 'SUCCESS',
            filesCount: 12,
            totalBytes: 1024 * 1024 * 5,
            errorMessage: null,
            triggeredBy: 'cron',
            destBucket: 'bestchoice-backups-offsite',
          },
        ],
      },
    });

    wrap(<OffsiteBackupTab />);

    await waitFor(() => {
      expect(screen.getByText('bestchoice-backups-offsite')).toBeInTheDocument();
    });
    expect(screen.getByText('30 วัน')).toBeInTheDocument();
    expect(screen.getByText('สำเร็จ')).toBeInTheDocument();
    // Size formatted
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('cron')).toBeInTheDocument();
  });

  it('shows warning banner when sqlSourceBucket is not set', async () => {
    apiGet.mockResolvedValue({
      data: {
        enabled: false,
        destBucket: 'dest',
        retentionDays: 30,
        sqlSourceBucket: null,
        runs: [],
      },
    });

    wrap(<OffsiteBackupTab />);

    await waitFor(() => {
      expect(screen.getByText(/OFFSITE_BACKUP_SQL_SOURCE_BUCKET/)).toBeInTheDocument();
    });
    expect(screen.getByText(/ยังไม่มีประวัติการสำรองข้อมูล/)).toBeInTheDocument();
  });

  it('runs backup when "สำรองข้อมูลตอนนี้" is clicked', async () => {
    apiGet.mockResolvedValue({
      data: {
        enabled: true,
        destBucket: 'dest',
        retentionDays: 30,
        sqlSourceBucket: 'sql-src',
        runs: [],
      },
    });
    apiPost.mockResolvedValue({
      data: {
        id: 'r-new',
        status: 'SUCCESS',
        filesCount: 7,
        totalBytes: 2048,
        durationMs: 4321,
        errorMessage: null,
      },
    });

    wrap(<OffsiteBackupTab />);

    const btn = await screen.findByRole('button', { name: /สำรองข้อมูลตอนนี้/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/backup/offsite-now');
    });
  });
});
