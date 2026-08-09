import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReadinessCard from '../ReadinessCard';
import type { ProductReadinessResponse } from '../../hooks/useProductReadiness';

/**
 * fixture ต้อง **ผูก type กับ adapter** (`ProductReadinessResponse` จาก
 * useProductReadiness.ts) ห้ามพิมพ์ shape ด้วยมือ — ถ้าวันหลัง B0 เปลี่ยนชื่อฟิลด์
 * (เช่น isReady → ready) หรือเพิ่ม/ลบ field บังคับอย่าง severity แล้ว adapter ถูกแก้ตาม
 * เทสต์นี้ต้อง **tsc แดงทันที** ไม่ใช่ผ่านเงียบๆ ด้วย object literal ที่ไม่มีใครตรวจ
 */
const ready: ProductReadinessResponse = {
  productId: 'p-1',
  isReady: true,
  isOnlineVisible: true,
  checks: [
    { key: 'IN_STOCK', label: 'อยู่ในสต็อก', ok: true, severity: 'blocking' },
    { key: 'PHOTO', label: 'มีรูปขึ้นเว็บอย่างน้อย 1 รูป', ok: true, severity: 'blocking' },
    { key: 'CASH_PRICE', label: 'มีราคาเงินสด', ok: true, severity: 'blocking' },
  ],
};

describe('ReadinessCard', () => {
  it('พร้อมขึ้นเว็บ → หัวข้อบอกว่าพร้อม + ไล่ข้อครบ', () => {
    render(<ReadinessCard isLoading={false} isError={false} data={ready} />);
    expect(screen.getByText('พร้อมขึ้นเว็บ')).toBeInTheDocument();
    expect(screen.getByText('มีราคาเงินสด')).toBeInTheDocument();
  });

  it('ยังไม่พร้อม → แสดงข้อที่ยังขาด + คำแนะนำ', () => {
    render(
      <ReadinessCard
        isLoading={false}
        isError={false}
        data={{
          ...ready,
          isReady: false,
          checks: [
            { key: 'IN_STOCK', label: 'อยู่ในสต็อก', ok: true, severity: 'blocking' },
            {
              key: 'CASH_PRICE',
              label: 'มีราคาเงินสด',
              ok: false,
              severity: 'blocking',
              hint: 'กรอกราคาเงินสดที่การ์ดราคาขาย',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('ยังขึ้นเว็บไม่ได้')).toBeInTheDocument();
    expect(screen.getByText('กรอกราคาเงินสดที่การ์ดราคาขาย')).toBeInTheDocument();
  });

  it('โหลดอยู่ / โหลดพลาด ก็ไม่พัง', () => {
    const { rerender } = render(<ReadinessCard isLoading isError={false} data={undefined} />);
    expect(screen.getByText('กำลังตรวจสถานะขึ้นเว็บ...')).toBeInTheDocument();
    rerender(<ReadinessCard isLoading={false} isError data={undefined} />);
    expect(screen.getByText('ตรวจสถานะขึ้นเว็บไม่สำเร็จ')).toBeInTheDocument();
  });

  it('checks ว่าง → ไม่ล้ม', () => {
    render(<ReadinessCard isLoading={false} isError={false} data={{ ...ready, checks: [] }} />);
    expect(screen.getByText('พร้อมขึ้นเว็บ')).toBeInTheDocument();
  });

  it('severity info (เช่น isDemo) → render เป็น note ไม่ใช่ ✓/✗ และไม่ใช้ hardcode key', () => {
    render(
      <ReadinessCard
        isLoading={false}
        isError={false}
        data={{
          ...ready,
          checks: [
            ...ready.checks,
            {
              key: 'IS_DEMO',
              label: 'เครื่อง demo — แสดงตัวอย่างบนเว็บเท่านั้น',
              ok: false,
              severity: 'info',
              hint: 'ไม่นับเป็นเงื่อนไขพร้อมขึ้นเว็บ',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('พร้อมขึ้นเว็บ')).toBeInTheDocument();
    expect(screen.getByText('เครื่อง demo — แสดงตัวอย่างบนเว็บเท่านั้น')).toBeInTheDocument();
    expect(screen.getByText('ไม่นับเป็นเงื่อนไขพร้อมขึ้นเว็บ')).toBeInTheDocument();
    // severity: 'info' ไม่ render ไอคอน ✗ ("ยังไม่ผ่าน") แม้ ok=false — พิสูจน์ว่า branch บน
    // severity จริง ไม่ใช่แค่ branch บน ok
    expect(screen.queryByLabelText('ยังไม่ผ่าน')).toBeNull();
  });
});
