/**
 * CommandPalette — settings registry integration tests
 *
 * TDD: these tests were written BEFORE the implementation was added to
 * CommandPalette.tsx to verify that settingsRegistry items are indexed
 * into the palette and correctly role-filtered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommandPalette from './CommandPalette';

/* ── environment polyfills ──────────────────────────────────────────────── */

// cmdk calls scrollIntoView on list items; jsdom doesn't implement it
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/* ── mocks ─────────────────────────────────────────────────────────────── */

// Mock useNavigate — CommandPalette calls it but we don't need navigation in tests
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

// Mock useUnionSearch — returns empty server search results
vi.mock('@/pages/CollectionsPage/hooks/useUnionSearch', () => ({
  useUnionSearch: () => ({
    data: { contracts: [], customers: [], imeis: [], letterTrackings: [] },
    isLoading: false,
  }),
}));

// Mock useDebounce — returns value immediately (no timer delay in tests)
vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: (v: unknown) => v,
}));

// Controlled mock for useAuth
const mockUser = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser(), isLoading: false }),
}));

/* ── helpers ────────────────────────────────────────────────────────────── */

function makeOwner() {
  return { id: 'u-owner', role: 'OWNER', name: 'Owner' };
}

function makeFinanceManager() {
  return { id: 'u-fm', role: 'FINANCE_MANAGER', name: 'FM' };
}

function makeAccountant() {
  return { id: 'u-acc', role: 'ACCOUNTANT', name: 'ACC' };
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Render palette in its "open" state.
 * CommandPalette returns null when !open; we dispatch Ctrl+K after mount.
 */
async function renderPaletteOpen(userObj: { id: string; role: string; name: string }) {
  mockUser.mockReturnValue(userObj);

  render(<CommandPalette />, { wrapper: Wrapper });

  // Dispatch Ctrl+K inside act() to trigger the state update that opens the palette
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
  });
}

/* ── tests ──────────────────────────────────────────────────────────────── */

describe('CommandPalette — settings registry integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Re-apply scrollIntoView polyfill after each test in case cleanup removed it
    if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
  });

  it('shows "บัญชี & ภาษี › VAT" entry for OWNER', async () => {
    await renderPaletteOpen(makeOwner());

    const vatEntry = screen.getByText('บัญชี & ภาษี › VAT');
    expect(vatEntry).toBeInTheDocument();
  });

  it('shows "ระบบ & ความปลอดภัย › โหมดทดสอบ" for OWNER', async () => {
    await renderPaletteOpen(makeOwner());

    const entry = screen.getByText('ระบบ & ความปลอดภัย › โหมดทดสอบ');
    expect(entry).toBeInTheDocument();
  });

  it('hides OWNER-only settings items from FINANCE_MANAGER', async () => {
    await renderPaletteOpen(makeFinanceManager());

    // "โหมดทดสอบ" (system › test-mode) is OWNER-only — must not appear for FM
    expect(screen.queryByText('ระบบ & ความปลอดภัย › โหมดทดสอบ')).not.toBeInTheDocument();

    // "VAT" (accounting › vat) is also OWNER-only — must not appear for FM
    expect(screen.queryByText('บัญชี & ภาษี › VAT')).not.toBeInTheDocument();
  });

  it('shows ALL-role items (like PEAK mapping) to FINANCE_MANAGER', async () => {
    await renderPaletteOpen(makeFinanceManager());

    // "PEAK mapping" (accounting › peak-mapping) has roles ALL which includes FM
    const entry = screen.getByText('บัญชี & ภาษี › PEAK mapping');
    expect(entry).toBeInTheDocument();
  });

  it('keeps the existing flat "ตั้งค่าระบบ" → /settings top-level entry for OWNER', async () => {
    await renderPaletteOpen(makeOwner());

    // The original top-level settings entry must still be present alongside registry items
    const settingsEntry = screen.getByText('ตั้งค่าระบบ');
    expect(settingsEntry).toBeInTheDocument();
  });

  it('shows "การเงิน & สินเชื่อ › GFIN" for OWNER (route-kind item)', async () => {
    await renderPaletteOpen(makeOwner());

    const gfinEntry = screen.getByText('การเงิน & สินเชื่อ › GFIN');
    expect(gfinEntry).toBeInTheDocument();
  });

  it('hides "การเงิน & สินเชื่อ › GFIN" from FINANCE_MANAGER (OWNER-only)', async () => {
    await renderPaletteOpen(makeFinanceManager());

    // finance › gfin has roles: ['OWNER'] — FM must not see it
    expect(screen.queryByText('การเงิน & สินเชื่อ › GFIN')).not.toBeInTheDocument();
  });

  it('dedupes /branches — "สาขา" appears exactly once (no registry collision)', async () => {
    await renderPaletteOpen(makeOwner());

    // Base pages entry "สาขา" must be present exactly once
    const branchItems = screen.getAllByText('สาขา');
    expect(branchItems).toHaveLength(1);

    // The registry-derived label "บริษัท & สาขา › สาขา" must NOT appear (deduped)
    expect(screen.queryByText('บริษัท & สาขา › สาขา')).not.toBeInTheDocument();
  });

  it('dedupes /users — "จัดการผู้ใช้" appears exactly once (no registry collision)', async () => {
    await renderPaletteOpen(makeOwner());

    // Base pages entry "จัดการผู้ใช้" must be present exactly once
    const userItems = screen.getAllByText('จัดการผู้ใช้');
    expect(userItems).toHaveLength(1);

    // The registry-derived label "ผู้ใช้ & สิทธิ์ › ผู้ใช้ / พนักงาน" must NOT appear (deduped)
    expect(screen.queryByText('ผู้ใช้ & สิทธิ์ › ผู้ใช้ / พนักงาน')).not.toBeInTheDocument();
  });

  it('shows "สมุดผู้ติดต่อ" → /contacts entry exactly once for OWNER (no registry dup)', async () => {
    await renderPaletteOpen(makeOwner());

    // contacts was removed from the registry (P6) — only the base pages entry remains
    const entries = screen.getAllByText('สมุดผู้ติดต่อ');
    expect(entries).toHaveLength(1);
  });

  it('shows "สมุดผู้ติดต่อ" → /contacts entry for FINANCE_MANAGER', async () => {
    await renderPaletteOpen(makeFinanceManager());

    const entry = screen.getByText('สมุดผู้ติดต่อ');
    expect(entry).toBeInTheDocument();
  });

  it('shows "สมุดผู้ติดต่อ" → /contacts entry for ACCOUNTANT', async () => {
    await renderPaletteOpen(makeAccountant());

    const entry = screen.getByText('สมุดผู้ติดต่อ');
    expect(entry).toBeInTheDocument();
  });
});
