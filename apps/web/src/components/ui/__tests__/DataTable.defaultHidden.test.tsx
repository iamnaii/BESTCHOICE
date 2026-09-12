import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable, { type Column } from '../DataTable';

/**
 * `defaultHidden` เป็นความสามารถเดียวที่หน้ารายชื่อลูกค้าใหม่ต้องการจาก DataTable
 * (mockup ที่เจ้าของเคาะมีคอลัมน์ "ซ่อนเป็นค่าเริ่มต้น เปิดจากปุ่มคอลัมน์")
 * — `hideable` บอกแค่ว่าซ่อนได้ ไม่ใช่ซ่อนอยู่
 */

interface Row {
  id: string;
  name: string;
  secret: string;
  plain: string;
}

const rows: Row[] = [{ id: '1', name: 'ลูกค้าทดสอบ', secret: '1-2345-67890-12-3', plain: 'เห็นอยู่' }];

const columns: Column<Row>[] = [
  { key: 'name', label: 'ชื่อ', render: (r) => <span>{r.name}</span> },
  { key: 'secret', label: 'เลขบัตร', hideable: true, defaultHidden: true, render: (r) => <span>{r.secret}</span> },
  { key: 'plain', label: 'อาชีพ', hideable: true, render: (r) => <span>{r.plain}</span> },
];

describe('DataTable defaultHidden', () => {
  it('ซ่อนคอลัมน์ defaultHidden ตอน render แรก แล้วโชว์เมื่อกดสลับจากปุ่มคอลัมน์', () => {
    render(<DataTable columns={columns} data={rows} columnToggle />);

    // render แรก: คอลัมน์ที่ไม่ได้ defaultHidden ต้องอยู่ครบ
    expect(screen.getByRole('columnheader', { name: 'ชื่อ' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'อาชีพ' })).toBeInTheDocument();
    expect(screen.getByText('เห็นอยู่')).toBeInTheDocument();
    // ...แต่คอลัมน์ defaultHidden ต้องไม่มีทั้งหัวและเนื้อ
    expect(screen.queryByRole('columnheader', { name: 'เลขบัตร' })).not.toBeInTheDocument();
    expect(screen.queryByText('1-2345-67890-12-3')).not.toBeInTheDocument();

    // เปิดเมนู "คอลัมน์" — ปุ่มบอกจำนวนที่ซ่อนอยู่ และคอลัมน์ที่ซ่อนต้องยังอยู่ในเมนู
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 1' }));
    const toggle = screen.getByRole('button', { name: 'เลขบัตร' });
    fireEvent.click(toggle);

    expect(screen.getByRole('columnheader', { name: 'เลขบัตร' })).toBeInTheDocument();
    expect(screen.getByText('1-2345-67890-12-3')).toBeInTheDocument();
    // ...เปิดครบแล้วป้ายกลับเป็น 'คอลัมน์' เฉย ๆ (คำต่อท้ายเป็นส่วนเพิ่ม ไม่ใช่ชื่อใหม่)
    expect(screen.getByRole('button', { name: 'คอลัมน์' })).toBeInTheDocument();
  });

  it('ไม่มีคอลัมน์ที่ซ่อนอยู่ = ปุ่มยังชื่อ "คอลัมน์" เฉย ๆ (ผู้เรียกอีก ~20 หน้าไม่กระทบ)', () => {
    const visible: Column<Row>[] = columns.map(({ defaultHidden: _ignored, ...rest }) => rest);
    render(<DataTable columns={visible} data={rows} columnToggle />);
    expect(screen.getByRole('button', { name: 'คอลัมน์' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /ซ่อนอยู่/ }),
    ).not.toBeInTheDocument();

    // ซ่อนด้วยมือหนึ่งคอลัมน์ → คำต่อท้ายโผล่ตามจำนวนจริง
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์' }));
    fireEvent.click(screen.getByRole('button', { name: 'อาชีพ' }));
    expect(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 1' })).toBeInTheDocument();
  });

  it('ไม่ใส่ defaultHidden = พฤติกรรมเดิมทุกประการ (ผู้เรียกเดิมทุกที่ไม่ส่ง prop นี้)', () => {
    const legacy: Column<Row>[] = columns.map(({ defaultHidden: _ignored, ...rest }) => rest);
    render(<DataTable columns={legacy} data={rows} columnToggle />);
    for (const label of ['ชื่อ', 'เลขบัตร', 'อาชีพ']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });
});
