/**
 * สรุปรายวัน — ใบเสร็จของการใช้เครดิตชำระ (PR3): ไม่ใช่เงินที่รับในวันนั้น. API ไม่นับในยอดรวม / แยกตามวิธี /
 * ค่าปรับรวม · ตารางยังแสดงเป็นรายการ พร้อมป้ายช่องทาง "ใช้ยอดเครดิตในสัญญา" และบรรทัด "ไม่นับในยอดรับ".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentSummary from '../PaymentSummary';
import type { DailySummary } from '../../types';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { month: '2026-10', days: [] } }) },
}));

const CONTRACT = { contractNumber: 'TEST-20261001-001', customer: { name: 'ทดสอบ เครดิต' } };

const SUMMARY: DailySummary = {
  date: '2026-10-02',
  totalPayments: 2,
  totalAmount: 1515.83,
  totalLateFees: 0,
  byMethod: { ONLINE_GATEWAY: 1515.83 },
  data: [
    {
      id: 'r1',
      receiptNumber: 'RT-202610-00001',
      receiptType: 'INSTALLMENT',
      amount: '1515.83',
      installmentNo: 1,
      paymentMethod: 'ONLINE_GATEWAY',
      paidDate: '2026-10-02T03:00:00.000Z',
      contract: CONTRACT,
      issuedByName: null,
    },
    {
      id: 'r2',
      receiptNumber: 'RT-202610-00002',
      receiptType: 'INSTALLMENT',
      amount: '2000',
      installmentNo: 2,
      paymentMethod: 'CREDIT_BALANCE',
      paidDate: '2026-10-02T04:00:00.000Z',
      contract: CONTRACT,
      issuedByName: null,
    },
  ],
};

describe('PaymentSummary — ใบใช้เครดิตชำระ (PR3)', () => {
  it('แสดงเป็นรายการพร้อมป้าย "ใช้ยอดเครดิตในสัญญา" และ "ไม่นับในยอดรับ" · แยกตามวิธีเป็นภาษาไทย', () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PaymentSummary
          summaryDate="2026-10-02"
          onDateChange={() => {}}
          summary={SUMMARY}
          loadingSummary={false}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('ใช้ยอดเครดิตในสัญญา')).toBeInTheDocument();
    expect(screen.getByText('ไม่นับในยอดรับ')).toBeInTheDocument();
    // KPI "แยกตามวิธี" + ป้ายของแถว — ไม่เป็นรหัสดิบ ONLINE_GATEWAY
    expect(screen.getAllByText('ชำระออนไลน์')).toHaveLength(2);
    expect(screen.queryByText('ONLINE_GATEWAY')).not.toBeInTheDocument();
  });
});
