import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

import ReportsPage from './ReportsPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MemoryRouter, null, React.createElement(ReportsPage)),
    ),
  );
}

describe('ReportsPage — EntityProfitReport default date range (PR #1327)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/aging')) return { data: {} };
      if (url.startsWith('/reports/entity-profit')) return { data: {} };
      throw new Error(`unexpected url ${url}`);
    });
    // Freeze ONLY Date (timers stay real so waitFor keeps working). The report
    // computes its default range from LOCAL time, so anchor the clock with a
    // local-time constructor: 2026-07-01 00:30 local. On an Asia/Bangkok
    // machine this instant is 2026-06-30T17:30:00Z — the exact month-boundary
    // where the pre-fix toISOString() code shifted firstDay back to 2026-06-30
    // (last day of the PREVIOUS month).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 1, 0, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to the FULL current local month — no UTC shift on firstDay/lastDay', async () => {
    renderPage();

    // Switch to the กำไร Shop/Finance tab (EntityProfitReport).
    fireEvent.click(screen.getByRole('button', { name: 'กำไร Shop/Finance' }));

    // The report query must use the local-month boundaries — NOT the
    // UTC-shifted 2026-06-30 start the old toISOString() code produced, and
    // NOT "today" as the end.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/reports/entity-profit?startDate=2026-07-01&endDate=2026-07-31',
      );
    });

    // Default = full current month → the "เดือนนี้" chip reads active and the
    // label renders as the bare month name.
    expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('date-range-label')).toHaveTextContent(/^กรกฎาคม 2569$/);
  });
});

describe('ReportsPage — toISOString UTC-shift bug (dateFilter default + CSV filename)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/aging')) return { data: {} };
      if (url.startsWith('/reports/daily-payments')) return { data: {} };
      if (url.startsWith('/reports/export/contracts')) return { data: new Blob(['csv']) };
      throw new Error(`unexpected url ${url}`);
    });
    // Freeze ONLY Date (timers stay real so waitFor keeps working). Anchor the
    // clock with a LOCAL-time constructor: 2026-07-03 01:30 local. On an
    // Asia/Bangkok machine this instant is 2026-07-02T18:30:00Z — before
    // 07:00 BKK, where new Date().toISOString().slice(0, 10) returns
    // YESTERDAY (2026-07-02) while the local calendar date is 2026-07-03.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 3, 1, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('daily-payment tab defaults its date filter to the LOCAL date, not the UTC date', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'ชำระรายวัน' }));

    // The report query must use the local calendar day — NOT the UTC-shifted
    // 2026-07-02 the old toISOString() default produced.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith('/reports/daily-payments?date=2026-07-03');
    });
  });

  it('stamps the CSV export filename with the LOCAL date, not the UTC date', async () => {
    renderPage();

    // jsdom has no URL.createObjectURL — stub it, and capture the anchor the
    // export mutation creates so its download filename is observable. Spies
    // go in AFTER render so React's own element creation is not captured.
    window.URL.createObjectURL = vi.fn(() => 'blob:mock') as typeof URL.createObjectURL;
    window.URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const anchors: HTMLAnchorElement[] = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const el = realCreateElement(tagName, options);
      if (tagName === 'a') anchors.push(el as HTMLAnchorElement);
      return el;
    }) as typeof document.createElement);

    fireEvent.click(screen.getByRole('button', { name: 'ส่งออก CSV' }));

    await waitFor(() => expect(anchors).toHaveLength(1));
    expect(anchors[0].download).toBe('contracts-export-2026-07-03.csv');
  });
});
