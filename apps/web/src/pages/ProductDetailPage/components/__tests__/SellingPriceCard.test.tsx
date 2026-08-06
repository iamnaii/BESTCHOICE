import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SellingPriceCard from '../SellingPriceCard';

describe('SellingPriceCard', () => {
  it('แสดงราคาเงินสด/ราคาผ่อน จากคอลัมน์', () => {
    render(
      <SellingPriceCard
        cashPrice="15900"
        installmentPrice="19900"
        priceAutofilledAt={null}
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
    expect(screen.getByText('19,900 ฿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'แก้ราคา' })).toBeInTheDocument();
  });

  it('แสดง badge เมื่อราคาถูกเติมอัตโนมัติจากตารางราคากลาง', () => {
    render(
      <SellingPriceCard
        cashPrice="15900"
        installmentPrice={null}
        priceAutofilledAt="2026-08-01T03:00:00.000Z"
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('เติมอัตโนมัติจากตารางราคากลาง')).toBeInTheDocument();
  });

  it('ไม่มีราคา → เตือนว่ายังตอบลูกค้าไม่ได้ และซ่อนปุ่มแก้เมื่อไม่มีสิทธิ์', () => {
    render(
      <SellingPriceCard
        cashPrice={null}
        installmentPrice={null}
        priceAutofilledAt={null}
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByText('ยังไม่กำหนดราคา — แจ้งผู้จัดการก่อนเสนอลูกค้า')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้ราคา' })).toBeNull();
  });
});
