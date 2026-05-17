import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ComingSoonPage, type ComingSoonPageProps } from './ComingSoonPage';
import type { ReactNode } from 'react';

const wrap = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ComingSoonPage', () => {
  it('renders feature name and SP badge', () => {
    wrap(<ComingSoonPage feature="ใบเสนอราคา" trackingSP="SP5" />);
    expect(screen.getByText('ใบเสนอราคา')).toBeInTheDocument();
    expect(screen.getByText(/SP5/)).toBeInTheDocument();
    expect(screen.getByText(/ฟีเจอร์หน้าร้านเพิ่มเติม/)).toBeInTheDocument();
  });

  it('shows ETA when provided', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP2" eta="ภายในไตรมาส 3/2026" />);
    expect(screen.getByText('ภายในไตรมาส 3/2026')).toBeInTheDocument();
  });

  it('shows description when provided', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP3" description="หน้านี้สำคัญมาก" />);
    expect(screen.getByText('หน้านี้สำคัญมาก')).toBeInTheDocument();
  });

  it('does NOT show ETA section when ETA not provided', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP4" />);
    expect(screen.queryByText(/คาดว่าจะเสร็จ/)).not.toBeInTheDocument();
  });

  it('renders tracking link when provided', () => {
    wrap(
      <ComingSoonPage
        feature="X"
        trackingSP="SP3"
        trackingIssueUrl="https://github.com/test/repo/issues/100"
      />
    );
    const link = screen.getByText(/ติดตามความคืบหน้า/).closest('a');
    expect(link).toHaveAttribute('href', 'https://github.com/test/repo/issues/100');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides tracking link when not provided', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP5" />);
    expect(screen.queryByText(/ติดตามความคืบหน้า/)).not.toBeInTheDocument();
  });

  it('always shows back-to-home button', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP4" />);
    const back = screen.getByText(/ย้อนกลับหน้าหลัก/).closest('a');
    expect(back).toHaveAttribute('href', '/');
  });

  it('renders all 5 trackingSP values without crash', () => {
    const sps: Array<ComingSoonPageProps['trackingSP']> = ['SP2', 'SP3', 'SP4', 'SP5', 'SP6'];
    for (const sp of sps) {
      const { unmount } = wrap(<ComingSoonPage feature="test" trackingSP={sp} />);
      expect(screen.getByText(`Sub-project ${sp.slice(2)}:`, { exact: false })).toBeInTheDocument();
      unmount();
    }
  });
});
