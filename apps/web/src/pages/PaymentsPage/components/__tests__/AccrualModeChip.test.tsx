import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AccrualModeChip } from '../AccrualModeChip';

/**
 * ข้อความบนจอต้องตรงกับที่ระบบทำจริง (คำตัดสินฝ่ายบัญชี 2026-09-28):
 * งวดที่ยังไม่มีรายการตั้งลูกหนี้งวด (2A) ถูกตั้งในการบันทึกเดียวกับการรับชำระ —
 * ไม่ใช่ "รวมเป็น JE เดียว" และไม่ใช่ "รอรอบกลางคืน".
 */
describe('AccrualModeChip', () => {
  const DUE = '2026-10-11T17:00:00.000Z'; // 12 ต.ค. 2569 00:00 เวลาไทย
  const RECEIPT = '2026-09-29T00:00:00.000Z'; // วันที่รับเงิน 29 ก.ย. 2569

  it('งวดตั้งลูกหนี้แล้ว (2B_ONLY) → ไม่แสดงป้าย', () => {
    const { container } = render(<AccrualModeChip mode="2B_ONLY" dueDate={DUE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('จ่ายล่วงหน้า → บอกว่าจะตั้งลูกหนี้งวดลงวันที่รับเงิน', () => {
    render(
      <AccrualModeChip mode="CONSOLIDATED_PAYING_AHEAD" dueDate={DUE} accrualPostedAt={RECEIPT} />,
    );
    expect(screen.getByText('ลูกค้าจ่ายล่วงหน้า · งวดนี้ครบกำหนด 12/10/2569')).toBeInTheDocument();
    const detail = screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent ?? '';
    expect(detail).toContain('ลงวันที่ 29/09/2569 (วันที่รับเงิน)');
    expect(detail).toContain('แล้วลงรับชำระ (2B) ในคราวเดียวกัน');
  });

  it('ถึงวันครบกำหนดแล้วแต่ยังไม่ตั้งลูกหนี้งวด → บอกว่าจะลงวันครบกำหนด และไม่เรียกงวดนี้ว่าเกินกำหนด', () => {
    render(<AccrualModeChip mode="CONSOLIDATED_BACKFILL" dueDate={DUE} accrualPostedAt={DUE} />);
    expect(
      screen.getByText('งวดนี้ถึงกำหนดแล้ว (12/10/2569) แต่ยังไม่ได้ตั้งลูกหนี้งวด'),
    ).toBeInTheDocument();
    expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toContain(
      'ลงวันที่ 12/10/2569 (วันครบกำหนด)',
    );
    expect(document.body.textContent).not.toContain('เกินกำหนด');
    expect(document.body.textContent).not.toContain('เลยกำหนด');
  });

  it('ไม่มีข้อความเดิมที่ไม่เป็นจริง', () => {
    const { container } = render(
      <AccrualModeChip mode="CONSOLIDATED_BACKFILL" dueDate={DUE} accrualPostedAt={DUE} />,
    );
    expect(container.textContent).not.toContain('จะรันคืนนี้');
    expect(container.textContent).not.toContain('เป็น JE เดียว');
  });

  it('เลือกชำระผ่าน QR → ไม่สัญญาวันที่บนหน้าจอ: บอกว่าลงวันที่เงินเข้าจริง', () => {
    const { container } = render(
      <AccrualModeChip
        mode="CONSOLIDATED_PAYING_AHEAD"
        dueDate={DUE}
        accrualPostedAt={RECEIPT}
        viaGateway
      />,
    );
    expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toBe(
      'เมื่อลูกค้าจ่ายผ่าน QR ระบบจะตั้งลูกหนี้งวด (2A) เต็มงวด ลงวันที่เงินเข้าจริง ' +
        '(ถ้าเงินเข้าหลังวันครบกำหนด จะลงวันครบกำหนด) แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ' +
        'วันที่อาจไม่ตรงกับวันที่ที่เลือกบนหน้านี้',
    );
    // วันที่รับเงินที่เลือกบนหน้าจอ (29/09/2569) ต้องไม่ถูกแสดงเป็นวันที่ลงรายการ
    expect(container.textContent).not.toContain('29/09/2569');
  });
});
