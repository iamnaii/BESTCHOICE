import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import ContractSummaryCard from '../ContractSummaryCard';

const contract = {
  id: 'c-1',
  contractNumber: 'CT-2026-09-0123',
  status: 'ACTIVE',
  createdAt: '2026-09-05T03:00:00.000Z',
  customerName: 'วรรณา สุขใจ',
  salespersonName: 'เอ',
  sellingPrice: '19900',
  downPayment: '2985',
  totalMonths: 12,
  monthlyPayment: '1838.26',
  paidInstallments: 1,
  nextDueDate: '2026-11-05T00:00:00.000Z',
};

describe('ContractSummaryCard — การ์ดสัญญาแทนเครื่องคำนวณเมื่อขายผ่อนแล้ว', () => {
  it('โชว์เลขที่ · ลูกค้า · งวดละ · ชำระแล้ว k/N · งวดถัดไป · ลิงก์ไปหน้าสัญญา', () => {
    render(
      <BrowserRouter>
        <ContractSummaryCard contract={contract} />
      </BrowserRouter>,
    );
    expect(screen.getByText('CT-2026-09-0123')).toBeInTheDocument();
    expect(screen.getByText('วรรณา สุขใจ')).toBeInTheDocument();
    expect(screen.getByText('1,838.26')).toBeInTheDocument();
    expect(screen.getByText('ชำระแล้ว 1 / 12 งวด')).toBeInTheDocument();
    expect(screen.getByText(/งวดถัดไป 05\/11\/(2569|2026)/)).toBeInTheDocument();
    expect(screen.getByText('ผ่อนอยู่')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ประวัติการชำระ/ })).toHaveAttribute('href', '/contracts/c-1');
  });

  it('สัญญาค้างชำระ → ป้ายสถานะแดง · ชำระครบ → ไม่มีงวดถัดไป', () => {
    render(
      <BrowserRouter>
        <ContractSummaryCard contract={{ ...contract, status: 'OVERDUE' }} />
      </BrowserRouter>,
    );
    expect(screen.getByText('ค้างชำระ')).toBeInTheDocument();

    render(
      <BrowserRouter>
        <ContractSummaryCard
          contract={{ ...contract, status: 'COMPLETED', paidInstallments: 12, nextDueDate: null }}
        />
      </BrowserRouter>,
    );
    expect(screen.getByText('ชำระแล้ว 12 / 12 งวด')).toBeInTheDocument();
    expect(screen.getByText('ครบกำหนด')).toBeInTheDocument();
    expect(screen.getByText('ผ่อนครบแล้ว')).toBeInTheDocument();
  });
});
