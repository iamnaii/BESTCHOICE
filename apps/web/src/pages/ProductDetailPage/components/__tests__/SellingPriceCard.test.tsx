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

  // fix-round I1: ราคาที่โชว์มา fallback จาก prices[] label (คอลัมน์ดิบ null) ต้องติดป้ายเตือน
  // เพราะเว็บลูกค้า/readiness gate อ่านคอลัมน์ ไม่อ่าน prices[] — แอดมินเห็นราคาแต่เครื่องไม่ขึ้นเว็บ
  it('ติดป้ายเตือนเมื่อราคาที่โชว์มาจาก fallback (prices[] แทนคอลัมน์จริง)', () => {
    render(
      <SellingPriceCard
        cashPrice="17000"
        installmentPrice={null}
        priceAutofilledAt={null}
        cashIsFallback
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(
      screen.getByText('ราคาจากระบบเดิม — ยังไม่ได้ตั้งราคาขายใหม่ เครื่องนี้จะยังไม่ขึ้นเว็บ'),
    ).toBeInTheDocument();
  });

  it('ไม่ติดป้ายเตือน fallback เมื่อราคามาจากคอลัมน์จริง', () => {
    render(
      <SellingPriceCard
        cashPrice="17000"
        installmentPrice="19900"
        priceAutofilledAt={null}
        cashIsFallback={false}
        installmentIsFallback={false}
        canEdit
        onEdit={vi.fn()}
      />,
    );
    expect(
      screen.queryByText('ราคาจากระบบเดิม — ยังไม่ได้ตั้งราคาขายใหม่ เครื่องนี้จะยังไม่ขึ้นเว็บ'),
    ).toBeNull();
  });
});

// รีดีไซน์ 2026-09-11: บรรทัดสถานะขึ้นเว็บในการ์ดราคา + ราคาในระบบเดิมเป็นลิงก์เล็ก (เฉพาะเมื่อมีแถว)
describe('SellingPriceCard — สถานะขึ้นเว็บ + ราคาในระบบเดิม', () => {
  const baseProps = {
    cashPrice: '19900',
    installmentPrice: '19900',
    priceAutofilledAt: null,
    canEdit: true,
    onEdit: vi.fn(),
  };

  it('พร้อมขึ้นเว็บ → "ขึ้นเว็บแล้ว · ลิงก์ส่งลูกค้าใช้ได้" + ปุ่มไปแท็บขึ้นเว็บ', async () => {
    const onGoOnline = vi.fn();
    render(
      <SellingPriceCard
        {...baseProps}
        readiness={{ isReady: true, checks: [] }}
        onGoOnline={onGoOnline}
      />,
    );
    expect(screen.getByText('ขึ้นเว็บแล้ว · ลิงก์ส่งลูกค้าใช้ได้')).toBeInTheDocument();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(screen.getByRole('button', { name: /ขึ้นเว็บ/ }));
    expect(onGoOnline).toHaveBeenCalled();
  });

  it('ยังไม่พร้อม → บอกเงื่อนไขแรกที่ยังไม่ผ่าน', () => {
    render(
      <SellingPriceCard
        {...baseProps}
        readiness={{
          isReady: false,
          checks: [
            { key: 'price', label: 'มีราคาขาย', ok: true, severity: 'blocking' },
            { key: 'photos', label: 'รูป 6 มุมครบ', ok: false, severity: 'blocking' },
            { key: 'desc', label: 'มีคำอธิบาย', ok: false, severity: 'blocking' },
          ],
        }}
        onGoOnline={vi.fn()}
      />,
    );
    expect(screen.getByText('ยังขึ้นเว็บไม่ได้ · รูป 6 มุมครบ')).toBeInTheDocument();
  });

  it('ราคาในระบบเดิม: ไม่มีแถว → ไม่โชว์ · มี 2 แถว → ลิงก์เล็กเปิดรายการ', async () => {
    const { rerender } = render(<SellingPriceCard {...baseProps} legacyPrices={[]} />);
    expect(screen.queryByText(/ราคาในระบบเดิม/)).toBeNull();

    rerender(
      <SellingPriceCard
        {...baseProps}
        legacyPrices={[
          { id: 'l1', label: 'ราคาเงินสด', amount: '18900', isDefault: true },
          { id: 'l2', label: 'ราคาผ่อน GFIN', amount: '23000', isDefault: false },
        ]}
      />,
    );
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.click(screen.getByRole('button', { name: 'ราคาในระบบเดิม (2)' }));
    expect(await screen.findByText('ราคาผ่อน GFIN')).toBeInTheDocument();
    expect(screen.getByText('23,000 ฿')).toBeInTheDocument();
  });
});
