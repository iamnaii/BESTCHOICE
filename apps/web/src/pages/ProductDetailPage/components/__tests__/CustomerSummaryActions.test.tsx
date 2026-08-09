import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CustomerSummaryActions from '../CustomerSummaryActions';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('CustomerSummaryActions', () => {
  it('คัดลอกสรุปตามข้อความที่ส่งเข้ามาเป๊ะ', async () => {
    render(
      <CustomerSummaryActions
        summaryText={'Apple iPhone 13\nราคาเงินสด 15,900 บาท'}
        shareUrl="https://www.bestchoicephone.com/products/p-1"
        isReady
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'คัดลอกสรุปส่งลูกค้า' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Apple iPhone 13\nราคาเงินสด 15,900 บาท'),
    );
  });

  it('คัดลอกลิงก์ได้เมื่อพร้อมขึ้นเว็บ', async () => {
    render(
      <CustomerSummaryActions summaryText="x" shareUrl="https://www.bestchoicephone.com/products/p-1" isReady />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'คัดลอกลิงก์' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://www.bestchoicephone.com/products/p-1'),
    );
  });

  it('ปุ่มลิงก์ถูก disable เมื่อยังไม่พร้อมขึ้นเว็บ + บอกเหตุผล', async () => {
    render(<CustomerSummaryActions summaryText="x" shareUrl="https://example.com/products/p-1" isReady={false} />);
    const btn = screen.getByRole('button', { name: 'คัดลอกลิงก์' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'เครื่องนี้ยังไม่ขึ้นเว็บ — ลิงก์จะเปิดไม่เจอ');
    await userEvent.click(btn);
    expect(writeText).not.toHaveBeenCalled();
  });
});
