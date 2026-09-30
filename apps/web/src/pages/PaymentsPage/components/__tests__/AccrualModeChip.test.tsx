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
  describe('ก1 — ตั้งลูกหนี้งวดเท่ายอดที่รับ / ส่วนที่เหลือ', () => {
    it('ใบบางส่วนก่อนครบกำหนด → หัวข้อ "จ่ายล่วงหน้าบางส่วน" และบอกยอดที่ตั้ง + ส่วนที่เหลือตั้งเมื่อไร', () => {
      render(
        <AccrualModeChip
          mode="CONSOLIDATED_PAYING_AHEAD"
          dueDate={DUE}
          accrualPostedAt={RECEIPT}
          portion="PARTIAL"
          accrualAmount="1000.00"
          accruedBefore="0.00"
        />,
      );
      expect(
        screen.getByText('ลูกค้าจ่ายล่วงหน้าบางส่วน · งวดนี้ครบกำหนด 12/10/2569'),
      ).toBeInTheDocument();
      expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toBe(
        'เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ 1,000.00 บาท ลงวันที่ 29/09/2569 (วันที่รับเงิน) ' +
          'แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ดอกเบี้ยและภาษีขายตามสัดส่วนของยอดนี้รับรู้ ณ วันที่ดังกล่าว ' +
          'ส่วนที่เหลือของงวดตั้งเมื่อรับชำระครบ หรือเมื่อถึงวันครบกำหนด',
      );
      expect(document.body.textContent).not.toContain('เต็มงวด');
    });

    it('ใบที่ทำให้งวดครบหลังตั้งไปแล้วบางส่วน → บอกยอดส่วนที่เหลือและยอดที่ตั้งไปแล้ว', () => {
      render(
        <AccrualModeChip
          mode="CONSOLIDATED_PAYING_AHEAD"
          dueDate={DUE}
          accrualPostedAt={RECEIPT}
          portion="REMAINDER"
          accrualAmount="515.83"
          accruedBefore="1000.00"
        />,
      );
      expect(
        screen.getByText('ลูกค้าจ่ายล่วงหน้า · งวดนี้ครบกำหนด 12/10/2569'),
      ).toBeInTheDocument();
      expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toBe(
        'เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) ส่วนที่เหลือของงวด 515.83 บาท (ตั้งไปแล้ว 1,000.00 บาท) ' +
          'ลงวันที่ 29/09/2569 (วันที่รับเงิน) แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ' +
          'ดอกเบี้ยและภาษีขายส่วนที่เหลือของงวดนี้รับรู้ ณ วันที่ดังกล่าว',
      );
    });

    it('ส่วนที่เหลือ ณ/หลังวันครบกำหนด (รอบกลางคืนตกหล่น) → หัวข้อ "ยังตั้งลูกหนี้งวดไม่ครบ" ลงวันครบกำหนด', () => {
      render(
        <AccrualModeChip
          mode="CONSOLIDATED_BACKFILL"
          dueDate={DUE}
          accrualPostedAt={DUE}
          portion="REMAINDER"
          accrualAmount="515.83"
          accruedBefore="1000.00"
        />,
      );
      expect(
        screen.getByText('งวดนี้ถึงกำหนดแล้ว (12/10/2569) แต่ยังตั้งลูกหนี้งวดไม่ครบ'),
      ).toBeInTheDocument();
      expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toContain(
        'ลงวันที่ 12/10/2569 (วันครบกำหนด)',
      );
    });

    it('QR ยอดบางส่วน → ไม่สัญญาวันที่บนหน้าจอ และบอกกรณีเงินเข้าตั้งแต่วันครบกำหนด', () => {
      const { container } = render(
        <AccrualModeChip
          mode="CONSOLIDATED_PAYING_AHEAD"
          dueDate={DUE}
          accrualPostedAt={RECEIPT}
          viaGateway
          portion="PARTIAL"
          accrualAmount="1000.00"
        />,
      );
      expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toBe(
        'เมื่อลูกค้าจ่ายผ่าน QR ระบบจะตั้งลูกหนี้งวด (2A) เท่ายอดที่รับ 1,000.00 บาท ลงวันที่เงินเข้าจริง ' +
          'แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ถ้าเงินเข้าตั้งแต่วันครบกำหนด ระบบตั้งลูกหนี้งวดของงวดนี้ไปแล้วในวันครบกำหนด ' +
          'จึงลงเฉพาะรับชำระ (2B)',
      );
      expect(container.textContent).not.toContain('29/09/2569');
    });

    it('ไม่ส่ง portion (server รุ่นก่อน) → ข้อความทั้งงวดเดิมทุกตัวอักษร', () => {
      render(
        <AccrualModeChip
          mode="CONSOLIDATED_PAYING_AHEAD"
          dueDate={DUE}
          accrualPostedAt={RECEIPT}
        />,
      );
      expect(screen.getByText(/ระบบจะตั้งลูกหนี้งวด/).textContent).toBe(
        'เมื่อบันทึก ระบบจะตั้งลูกหนี้งวด (2A) เต็มงวด ลงวันที่ 29/09/2569 (วันที่รับเงิน) ' +
          'แล้วลงรับชำระ (2B) ในคราวเดียวกัน — ดอกเบี้ยและภาษีขายของงวดนี้รับรู้ ณ วันที่ดังกล่าว',
      );
    });
  });
});
