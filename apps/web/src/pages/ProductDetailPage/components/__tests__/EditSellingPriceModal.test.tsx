import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import EditSellingPriceModal from '../EditSellingPriceModal';

describe('EditSellingPriceModal', () => {
  it('มีช่อง "ราคาขาย GFIN" — พิมพ์แล้วส่งค่าทั้งสามช่องกลับ', async () => {
    const onChange = vi.fn();
    render(
      <EditSellingPriceModal
        isOpen
        onClose={vi.fn()}
        values={{ cashPrice: '15900', installmentPrice: '19900', financePrice: '' }}
        onChange={onChange}
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );
    expect(screen.getByText(/ว่างอยู่ = ใช้ราคาผ่อน BESTCHOICE/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('ราคาขาย GFIN (บาท)'), '2');
    expect(onChange).toHaveBeenLastCalledWith({ cashPrice: '15900', installmentPrice: '19900', financePrice: '2' });
  });

  it('ล้างช่องราคาขาย GFIN ได้ → onChange ส่ง financePrice เป็นสตริงว่าง', async () => {
    const onChange = vi.fn();
    render(
      <EditSellingPriceModal
        isOpen
        onClose={vi.fn()}
        values={{ cashPrice: '15900', installmentPrice: '19900', financePrice: '2' }}
        onChange={onChange}
        onSubmit={vi.fn()}
        isPending={false}
      />,
    );
    await userEvent.clear(screen.getByLabelText('ราคาขาย GFIN (บาท)'));
    expect(onChange).toHaveBeenLastCalledWith({ cashPrice: '15900', installmentPrice: '19900', financePrice: '' });
  });
});
