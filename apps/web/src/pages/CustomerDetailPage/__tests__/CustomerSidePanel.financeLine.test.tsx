import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerSidePanel from '../components/CustomerSidePanel';
import { detail } from './fixtures';
import type { CustomerDetail } from '../types';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

function renderPanel(over: Partial<CustomerDetail>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomerSidePanel
        customer={detail(over)}
        role="OWNER"
        canEdit={false}
        canUploadDocuments={false}
        onEdit={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const label = screen.getByText('LINE Finance (น้องเบส)');
  return within(label.parentElement as HTMLElement);
}

/**
 * Task 27 fix round 1 (review M-1) — ป้าย "LINE Finance (น้องเบส)" บนแผงข้างหน้าลูกค้าใช้ `financeLine.verified` (แถว OTP ที่ยังผูก)
 * เกณฑ์เดียวกับแถวสถานะในฟอร์มแก้ไขบนหน้าเดียวกัน — คอลัมน์ `lineIdFinance` ไม่ใช่เกณฑ์ · ป้าย/คำเดิม ไม่เปลี่ยนหน้าตา
 */
describe('CustomerSidePanel — ป้าย LINE Finance ตามแถว OTP', () => {
  it('คอลัมน์ค้างแต่ยังไม่ยืนยัน OTP → "ยังไม่ผูก"', () => {
    const row = renderPanel({
      lineIdFinance: 'U-typed',
      financeLine: { verified: false, linkedAt: null },
    });
    expect(row.getByText('ยังไม่ผูก')).toBeInTheDocument();
    expect(row.queryByText('ผูกแล้ว')).not.toBeInTheDocument();
  });

  it('ยืนยัน OTP แล้วแม้คอลัมน์ว่าง → "ผูกแล้ว"', () => {
    const row = renderPanel({
      lineIdFinance: null,
      financeLine: { verified: true, linkedAt: '2026-10-30T03:00:00.000Z' },
    });
    expect(row.getByText('ผูกแล้ว')).toBeInTheDocument();
  });

  it('ไม่รู้สถานะ (API ก่อน Task 27) → "ยังไม่ผูก" (ไม่อ้างว่าผูกจากคอลัมน์)', () => {
    const row = renderPanel({ lineIdFinance: 'U-typed', financeLine: undefined });
    expect(row.getByText('ยังไม่ผูก')).toBeInTheDocument();
  });
});
