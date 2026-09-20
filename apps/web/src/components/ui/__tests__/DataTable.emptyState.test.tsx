import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable, { type Column } from '../DataTable';

/**
 * บนจอมือถือ ตารางกว้างกว่ากล่องเลื่อน (`minWidth`) — ถ้า "สถานะว่าง" อยู่ใน `<td>` มันจะถูกจัด
 * กึ่งกลางตามความกว้างของตาราง แล้วข้อความ/ไอคอนหลุดขอบขวาของจอ (วัดจริงที่ 390px: ตาราง 640px
 * พื้นที่มองเห็น 348px → ข้อความอยู่ที่ 212–470px). jsdom ไม่คำนวณ layout จึงปักที่โครงสร้าง:
 * สถานะว่างต้องอยู่นอกกล่องเลื่อนของตาราง แต่ยังอยู่ในการ์ดเดียวกัน
 */

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [{ key: 'name', label: 'ชื่อ', render: (r) => <span>{r.name}</span> }];

describe('DataTable empty state', () => {
  it('อยู่นอกกล่องเลื่อนของตาราง จึงกว้างเท่าพื้นที่ที่มองเห็น ไม่ใช่เท่าตาราง', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="ไม่มีข้อมูลในคิว" />);

    const scroller = screen.getByTestId('data-table');
    const message = screen.getByText('ไม่มีข้อมูลในคิว');

    expect(scroller).not.toContainElement(message);
    expect(scroller.parentElement).toContainElement(message);
    // หัวตารางยังอยู่ — ผู้ใช้ยังเห็นว่าตารางนี้มีคอลัมน์อะไร
    expect(screen.getByRole('columnheader', { name: 'ชื่อ' })).toBeInTheDocument();
  });

  it('ไม่โชว์สถานะว่างระหว่างกำลังโหลด', () => {
    render(<DataTable columns={columns} data={[]} isLoading emptyMessage="ไม่มีข้อมูลในคิว" />);

    expect(screen.queryByText('ไม่มีข้อมูลในคิว')).not.toBeInTheDocument();
  });
});
