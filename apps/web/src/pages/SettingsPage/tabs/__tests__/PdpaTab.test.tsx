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

import { PdpaTab } from '../PdpaTab';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

describe('PdpaTab', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
  });

  it('renders ready-for-strict-mode banner when plaintextCount=0', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/pdpa-encryption/status') {
        return Promise.resolve({
          data: {
            strictMode: false,
            totalCustomers: 100,
            encryptedCount: 100,
            plaintextCount: 0,
            readyForStrictMode: true,
            encryptionKeyConfigured: true,
            hashSaltConfigured: true,
          },
        });
      }
      if (url === '/pdpa-encryption/backfill-runs') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error('unexpected url ' + url));
    });

    wrap(<PdpaTab />);
    await waitFor(() => {
      expect(screen.getByText('พร้อมเปิด Strict Mode')).toBeInTheDocument();
    });
    // Progress sentence uses sub-spans, so match the wrapper paragraph by
    // the text "เข้ารหัสไปแล้ว" + tolerance for the numeric spans.
    expect(screen.getByText(/เข้ารหัสไปแล้ว/)).toBeInTheDocument();
    // backfill button should be disabled when no plaintext rows remain
    const backfillBtn = screen.getByRole('button', { name: /เริ่ม Backfill/ });
    expect(backfillBtn).toBeDisabled();
  });

  it('renders plaintext warning + enables Backfill when plaintextCount > 0', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/pdpa-encryption/status') {
        return Promise.resolve({
          data: {
            strictMode: false,
            totalCustomers: 100,
            encryptedCount: 70,
            plaintextCount: 30,
            readyForStrictMode: false,
            encryptionKeyConfigured: true,
            hashSaltConfigured: true,
          },
        });
      }
      if (url === '/pdpa-encryption/backfill-runs') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error('unexpected url ' + url));
    });

    wrap(<PdpaTab />);
    await waitFor(() => {
      expect(screen.getByText(/ยังเหลือ 30 คน/)).toBeInTheDocument();
    });
    const backfillBtn = screen.getByRole('button', { name: /เริ่ม Backfill/ });
    expect(backfillBtn).not.toBeDisabled();
  });

  it('shows env-var setup warning when PII_ENCRYPTION_KEY missing', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/pdpa-encryption/status') {
        return Promise.resolve({
          data: {
            strictMode: false,
            totalCustomers: 0,
            encryptedCount: 0,
            plaintextCount: 0,
            readyForStrictMode: true,
            encryptionKeyConfigured: false,
            hashSaltConfigured: true,
          },
        });
      }
      if (url === '/pdpa-encryption/backfill-runs') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error('unexpected url ' + url));
    });

    wrap(<PdpaTab />);
    // Wait for the "ยังไม่ได้ตั้ง" badge (only rendered when key/salt absent).
    await waitFor(() => {
      expect(screen.getByText('ยังไม่ได้ตั้ง')).toBeInTheDocument();
    });
    // Switch must be disabled until env is ready
    const toggle = screen.getByRole('switch', { name: /เปิดปิด PDPA strict mode/ });
    expect(toggle).toBeDisabled();
  });

  it('renders backfill history when runs exist', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/pdpa-encryption/status') {
        return Promise.resolve({
          data: {
            strictMode: false,
            totalCustomers: 100,
            encryptedCount: 100,
            plaintextCount: 0,
            readyForStrictMode: true,
            encryptionKeyConfigured: true,
            hashSaltConfigured: true,
          },
        });
      }
      if (url === '/pdpa-encryption/backfill-runs') {
        return Promise.resolve({
          data: [
            {
              id: 'r1',
              status: 'COMPLETED',
              totalRecords: 100,
              processedRecords: 100,
              skippedRecords: 0,
              startedAt: '2026-05-18T10:00:00Z',
              finishedAt: '2026-05-18T10:00:42Z',
              errorMessage: null,
              triggeredBy: 'cli',
              triggeredByUser: null,
              hostname: 'pod-1',
            },
          ],
        });
      }
      return Promise.reject(new Error('unexpected url ' + url));
    });

    wrap(<PdpaTab />);
    await waitFor(() => {
      expect(screen.getByText('สำเร็จ')).toBeInTheDocument();
    });
    // history table renders the row
    expect(screen.getByText('cli')).toBeInTheDocument();
  });
});
