/**
 * P2-SP2 / P4-SP3 — DocumentConfigPage tests
 *
 * Tests the tabbed shell. The numbering-tab content (prefix table, format
 * selector) is rendered by NumberingConfigTab when the 'numbering' tab is
 * active (the default). Other tabs render DocTypeConfigForm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

// --- mock api -------------------------------------------------------------
const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

// --- mock useDocumentTitle (side-effect only, not under test) -------------
vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => undefined,
}));

import DocumentConfigPage from './DocumentConfigPage';

function renderPage(search = '') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/settings/document-config${search}`] },
        React.createElement(DocumentConfigPage),
      ),
    ),
  );
}

function setDefaultMocks() {
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/settings') return { data: [] };
    if (url.startsWith('/settings/doc-config/preview')) {
      const usp = new URLSearchParams(url.split('?')[1] ?? '');
      const prefix = usp.get('prefix') ?? 'XX';
      return {
        data: {
          sample: `${prefix}-2605-001`,
          format: 'PREFIX-YYMM-NNN',
          resetCycle: 'yearly',
          prefix,
        },
      };
    }
    return { data: null };
  });
}

describe('DocumentConfigPage (P4-SP3 tabbed shell)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    setDefaultMocks();
  });

  it('renders all 9 tab labels', async () => {
    renderPage();

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

  it('renders PageHeader title "ตั้งค่าเอกสาร"', () => {
    renderPage();
    expect(screen.getByText('ตั้งค่าเอกสาร')).toBeInTheDocument();
  });

  it('default tab is numbering — fetches /settings and shows prefix table rows', async () => {
    renderPage();

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/settings');
    });

    // NumberingConfigTab renders the canonical 8 doc-type rows
    expect(await screen.findByText('รายจ่าย (Expense)')).toBeInTheDocument();
    expect(screen.getByText('ใบลดหนี้ (Credit Note)')).toBeInTheDocument();
    expect(screen.getByText('สัญญาผ่อน (Contract)')).toBeInTheDocument();
  });
});
