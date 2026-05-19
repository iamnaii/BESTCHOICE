/**
 * P4-SP3 — DocumentConfigPage 9-tab smoke test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DocumentConfigPage from '../DocumentConfigPage';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { value: null } }),
    put: vi.fn(),
    patch: vi.fn(),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

describe('DocumentConfigPage', () => {
  it('renders 9 tabs', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DocumentConfigPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('เลขที่/รูปแบบทั่วไป')).toBeInTheDocument();
    expect(screen.getByText('ใบรับเงินมัดจำ')).toBeInTheDocument();
    expect(screen.getByText('ใบเสร็จรับเงิน')).toBeInTheDocument();
    expect(screen.getByText('ใบลดหนี้')).toBeInTheDocument();
    expect(screen.getByText('ใบสั่งซื้อ (PO)')).toBeInTheDocument();
    expect(screen.getByText('ค่าใช้จ่าย')).toBeInTheDocument();
    expect(screen.getByText('รับใบลดหนี้')).toBeInTheDocument();
    expect(screen.getByText('ใบรวมจ่าย')).toBeInTheDocument();
    expect(screen.getByText('ซื้อสินทรัพย์')).toBeInTheDocument();
  });
});
