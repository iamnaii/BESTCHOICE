import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { Button } from '../button';
import SummaryCardHelp from '../SummaryCardHelp';
import TopSellersCard from '@/pages/ShopHomePage/components/TopSellersCard';

// House touch-target minimum (typography audit item 5): mobile (< lg) ≥ 44px, desktop (≥ lg) ≥ 32px.
const tokens = (el: HTMLElement) => el.className.split(/\s+/);

describe('Button mode="link" (LIFF "← กลับไปดูสัญญา", "ดูสัญญาของฉัน →", "← กลับไปโปรไฟล์")', () => {
  it('is ≥ 44px on mobile (size md) and ≥ 32px on desktop despite h-auto', () => {
    render(
      <Button variant="ghost" mode="link" asChild>
        <a href="/liff/contract">← กลับไปดูสัญญา</a>
      </Button>,
    );
    const cls = tokens(screen.getByText('← กลับไปดูสัญญา'));
    expect(cls).toContain('max-lg:min-h-11');
    expect(cls).toContain('lg:min-h-8');
  });
});

describe('SummaryCardHelp ("การลงบัญชี" on /payments)', () => {
  it('trigger is ≥ 44px on mobile, ≥ 32px on desktop, and keeps its 32px layout box on mobile', () => {
    render(
      <SummaryCardHelp label="การลงบัญชี" title="รับชำระวันนี้">
        รายละเอียด
      </SummaryCardHelp>,
    );
    const cls = tokens(screen.getByRole('button', { name: /การลงบัญชี/ }));
    expect(cls).toContain('max-lg:min-h-11');
    expect(cls).toContain('min-h-8');
    expect(cls.some((c) => /^max-lg:-my-/.test(c))).toBe(true);
  });
});

describe('TopSellersCard ("ตามรุ่น" / "ตามหมวด" on /)', () => {
  it('toggle pills are ≥ 44px on mobile and ≥ 36px on desktop', () => {
    render(
      <MemoryRouter>
        <TopSellersCard data={{ byModel: [{ name: 'iPhone 15', count: 3 }], byCategory: [] }} />
      </MemoryRouter>,
    );
    for (const name of ['ตามรุ่น', 'ตามหมวด']) {
      const cls = tokens(screen.getByRole('button', { name }));
      expect(cls).toContain('max-lg:min-h-11');
      expect(cls).toContain('min-h-9');
    }
  });
});
