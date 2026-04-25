import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MigrationBanner from './MigrationBanner';

const STORAGE_KEY = 'collections-migrated-banner-dismissed';

describe('MigrationBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Inside the 14-day window — DEPLOY_DATE = 2026-04-25
    vi.setSystemTime(new Date('2026-04-26T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('renders when not dismissed and within 14-day window', () => {
    render(<MigrationBanner />);
    expect(screen.getByText(/ย้ายจาก \/overdue มาที่ \/collections/)).toBeInTheDocument();
  });

  it('does not render when previously dismissed (localStorage flag set)', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    render(<MigrationBanner />);
    expect(screen.queryByText(/ย้ายจาก \/overdue/)).not.toBeInTheDocument();
  });

  it('dismiss click persists to localStorage and hides the banner', () => {
    render(<MigrationBanner />);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByLabelText('ปิดประกาศ'));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
    expect(screen.queryByText(/ย้ายจาก \/overdue/)).not.toBeInTheDocument();
  });

  it('does not render past the 14-day window even if not dismissed', () => {
    // 2026-05-10 is > 14 days after deploy date 2026-04-25
    vi.setSystemTime(new Date('2026-05-10T00:00:00Z'));
    render(<MigrationBanner />);
    expect(screen.queryByText(/ย้ายจาก \/overdue/)).not.toBeInTheDocument();
  });
});
