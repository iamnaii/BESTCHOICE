import { clawbackCarriedText } from '../payroll-copy';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PayrollReviewPanel } from '../PayrollReviewPanel';
import type { PayrollSystemNotes } from '../../types';

const NO_LINK_TEXT = 'ให้เจ้าของหรือผู้จัดการสาขาตรวจที่เมนู ลงเวลา';
// ชื่อลิงก์ + คำอ่านสำหรับโปรแกรมอ่านหน้าจอ "(เปิดแท็บใหม่)"
const LINK_NAME = /^เปิดวันนั้นที่ ลงเวลา/;

const notes = (n: Partial<PayrollSystemNotes>): PayrollSystemNotes => ({ review: [], warnings: [], ...n });

const LINES = [
  {
    employeeName: 'สมศรี มีสุข',
    systemNotes: notes({
      review: [{ dayId: 'd-9', date: '2026-10-09', branchId: 'b1', flags: ['AFTER_PIN_LOCKOUT'], blocking: false }],
    }),
  },
  {
    employeeName: 'วิชัย ทองดี',
    systemNotes: notes({
      review: [{ dayId: 'd-21', date: '2026-10-21', branchId: 'b2', flags: ['DEVICE_CONFLICT'], blocking: true }],
    }),
  },
];

function mount(
  viewer: { role: string; branchId: string | null },
  lines: Array<{ employeeName: string; systemNotes: PayrollSystemNotes | null }> = LINES,
) {
  return render(
    <MemoryRouter>
      <PayrollReviewPanel lines={lines} viewer={viewer} />
    </MemoryRouter>,
  );
}

const reviewCards = () => within(screen.getByRole('region', { name: /วันที่ต้องตรวจ/ })).getAllByRole('listitem');

describe('PayrollReviewPanel — review days from stored systemNotes', () => {
  it('lists every review day with DEVICE_CONFLICT first and a destructive เครื่องถูกใช้ซ้อน chip', () => {
    mount({ role: 'OWNER', branchId: null });
    expect(screen.getByRole('heading', { name: 'วันที่ต้องตรวจ (2)' })).toBeInTheDocument();
    const [first, second] = reviewCards();
    expect(within(first).getByText('วิชัย ทองดี')).toBeInTheDocument();
    const chip = within(first).getByText('เครื่องถูกใช้ซ้อน');
    expect(chip.closest('[data-flag]')).toHaveClass('text-destructive');
    expect(within(first).getByText('พ 21 ต.ค.')).toBeInTheDocument();
    expect(within(second).getByText('สมศรี มีสุข')).toBeInTheDocument();
    expect(within(second).getByText('ตอกหลังพักรหัส')).toBeInTheDocument();
  });

  it('OWNER gets a link to that day and its branch on the attendance page (R13)', () => {
    mount({ role: 'OWNER', branchId: null });
    const links = screen.getAllByRole('link', { name: LINK_NAME });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/attendance?tab=today&date=2026-10-21&branchId=b2',
      '/attendance?tab=today&date=2026-10-09&branchId=b1',
    ]);
    expect(screen.queryByText(NO_LINK_TEXT)).not.toBeInTheDocument();
  });

  it('BRANCH_MANAGER gets the link only for days of their own branch', () => {
    mount({ role: 'BRANCH_MANAGER', branchId: 'b1' });
    const [otherBranchDay, ownBranchDay] = reviewCards();
    expect(within(otherBranchDay).queryByRole('link')).not.toBeInTheDocument();
    expect(within(otherBranchDay).getByText(NO_LINK_TEXT)).toBeInTheDocument();
    expect(within(ownBranchDay).getByRole('link', { name: LINK_NAME })).toHaveAttribute(
      'href',
      '/attendance?tab=today&date=2026-10-09&branchId=b1',
    );
  });

  it('ACCOUNTANT gets no link — only the text naming who checks it', () => {
    mount({ role: 'ACCOUNTANT', branchId: 'b1' });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByText(NO_LINK_TEXT)).toHaveLength(2);
  });
});

describe('PayrollReviewPanel — warnings', () => {
  it('shows the cutoff once (Buddhist year), daily-staff and other-document warnings with a count', () => {
    const closableAt = '2026-11-01T11:00:00.000Z';
    mount({ role: 'OWNER', branchId: null }, [
      {
        employeeName: 'กมล แสงทอง',
        systemNotes: notes({
          warnings: [
            { code: 'NOT_MONTHLY_OR_NO_BASE', otHours: '4.0' },
            { code: 'NOT_YET_CLOSABLE', closableAt },
          ],
        }),
      },
      {
        employeeName: 'ปรีชา ศรีสุข',
        systemNotes: notes({
          warnings: [
            {
              code: 'IN_OTHER_DOCUMENT',
              documentId: 'doc-x',
              documentNumber: 'PR-20261101-0003',
              branchName: 'สระบุรี',
              status: 'DRAFT',
            },
            { code: 'NOT_YET_CLOSABLE', closableAt },
          ],
        }),
      },
    ]);
    expect(screen.getByRole('heading', { name: 'คำเตือน (3)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /วันที่ต้องตรวจ/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        'ส่งขออนุมัติได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้',
      ),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        'พนักงานรายวัน/สัญญาจ้าง หรือไม่มีเงินเดือนในทะเบียน — ระบบไม่คิด OT ให้ ลงเวลาเดือนนี้มี OT 4 ชม. กรอกในรายได้พิเศษเอง',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('กมล แสงทอง')).toBeInTheDocument();
    expect(
      screen.getByText('OT ของ ปรีชา ศรีสุข เดือนนี้อยู่ในใบ PR-20261101-0003 แล้ว — เอาออกจากใบใดใบหนึ่งก่อน'),
    ).toBeInTheDocument();
  });

  it('R20 FX1: no PIN and no attendance data tell the user they can type the OT under รายได้พิเศษ, with the name', () => {
    mount({ role: 'OWNER', branchId: null }, [
      { employeeName: 'สมใจ ไม่มีรหัส', systemNotes: notes({ warnings: [{ code: 'NO_PIN' }] }) },
      { employeeName: 'มานี สาขาใหม่', systemNotes: notes({ warnings: [{ code: 'NO_ATTENDANCE' }] }) },
    ]);
    expect(screen.getByRole('heading', { name: 'คำเตือน (2)' })).toBeInTheDocument();
    const items = within(screen.getByRole('heading', { name: 'คำเตือน (2)' }).closest('section') as HTMLElement).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(
      'สมใจ ไม่มีรหัส ยังไม่มีรหัสตอกบัตร — เดือนนี้ไม่มีข้อมูลลงเวลา ระบบจึงไม่คิด OT ให้ — กรอก OT เองได้ที่ รายได้พิเศษ',
    );
    expect(items[1]).toHaveTextContent(
      'มานี สาขาใหม่ เดือนนี้ไม่มีข้อมูลลงเวลา ระบบจึงไม่คิด OT ให้ — กรอก OT เองได้ที่ รายได้พิเศษ',
    );
    expect(within(items[1]).getByText('มานี สาขาใหม่')).toHaveClass('font-semibold');
  });

  // D4 ส่วนที่ 2 (P2-R19.3) — คำเตือนค่าคอมสามแบบ (ถ้อยคำตามตาราง copy) · ใบ FINANCE ไม่มีค่าคอม (2026-10-29) — คำเตือนเก่าที่ยังเก็บอยู่ในร่างไม่แสดง
  it('commission warnings: IN_OTHER_DOCUMENT with name/count/number, CLAWBACK_CARRIED and PAID_OUTSIDE with the name; a stored legacy FINANCE_BLOCKED is not shown', () => {
    mount({ role: 'OWNER', branchId: null }, [
      {
        employeeName: 'สมศรี มีสุข',
        systemNotes: notes({
          warnings: [
            { code: 'COMMISSION_FINANCE_BLOCKED', count: 2 } as never,
            { code: 'CLAWBACK_CARRIED', deducted: '1000.00', carried: '400.00' },
            { code: 'CLAWBACK_PAID_OUTSIDE_PAYROLL', reference: 'CT-20260901-0003' },
          ],
        }),
      },
      {
        employeeName: 'วิชัย ทองดี',
        systemNotes: notes({
          warnings: [
            { code: 'COMMISSION_IN_OTHER_DOCUMENT', count: 2, documentId: 'doc-9', documentNumber: 'PR-20261101-0003' },
          ],
        }),
      },
    ]);
    const heading = screen.getByRole('heading', { name: 'คำเตือน (3)' });
    const items = within(heading.closest('section') as HTMLElement).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'สมศรี มีสุข หักคืนค่าคอมได้ 1,000.00 บาท (ไม่เกินค่าคอมงวดนี้) — ยกไปงวดหน้า 400.00 บาท',
      'สมศรี มีสุข ค่าคอม CT-20260901-0003 ถูกเรียกคืน แต่จ่ายไปนอกใบเงินเดือน — ระบบไม่หักให้อัตโนมัติ ถ้าจะหัก ให้ใส่รายการหักในใบนี้เอง',
      'ค่าคอม 2 รายการของ วิชัย ทองดี อยู่ในใบ PR-20261101-0003 แล้ว',
    ]);
    expect(within(items[1]).getByText('สมศรี มีสุข')).toHaveClass('font-semibold');
  });

  it('CLAWBACK_CARRIED with nothing deducted this period says so instead of "หักคืนค่าคอมได้ 0.00 บาท"', () => {
    expect(clawbackCarriedText('0.00', '509.70')).toBe('งวดนี้ไม่มีค่าคอมให้หัก — ยกยอดหักคืน 509.70 บาท ไปงวดหน้า');
    expect(clawbackCarriedText('629.40', '627.60')).toBe('หักคืนค่าคอมได้ 629.40 บาท (ไม่เกินค่าคอมงวดนี้) — ยกไปงวดหน้า 627.60 บาท');
  });

  it('a warning code the web does not know yet is skipped instead of crashing the panel', () => {
    mount({ role: 'OWNER', branchId: null }, [
      {
        employeeName: 'ใหม่',
        systemNotes: notes({ warnings: [{ code: 'SOMETHING_NEW' } as never, { code: 'NO_PIN' }] }),
      },
    ]);
    expect(screen.getByRole('heading', { name: 'คำเตือน (1)' })).toBeInTheDocument();
  });

  // คำตัดสินเจ้าของ 2026-10-29 — ใบจากปุ่มใช้แม่แบบตัดแถว OT ที่กรอกเองของคนที่ตอกบัตรออก แล้วบอกในแผงตรวจ
  it('TYPED_OT_REMOVED names the person, the row count and the amount, and how to keep a previous-month fix', () => {
    mount({ role: 'OWNER', branchId: null }, [
      { employeeName: 'สมศรี มีสุข', systemNotes: notes({ warnings: [{ code: 'TYPED_OT_REMOVED', count: 2, amount: '1250.50' }] }) },
    ]);
    const items = within(screen.getByRole('heading', { name: 'คำเตือน (1)' }).closest('section') as HTMLElement).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(
      'สมศรี มีสุข ระบบเอาแถว OT ที่กรอกไว้ในแม่แบบออก 2 แถว (1,250.50 บาท) เพราะคิด OT จากลงเวลาให้แล้ว — ถ้าเป็นการแก้ OT ของเดือนก่อน ให้เพิ่มแถวใหม่แล้วติ๊ก "รายการปรับปรุงงวดก่อน"',
    );
    expect(within(items[0]).getByText('สมศรี มีสุข')).toHaveClass('font-semibold');
  });

  it('renders nothing when no line has stored notes', () => {
    const { container } = mount({ role: 'OWNER', branchId: null }, [
      { employeeName: 'ใหม่', systemNotes: null },
      { employeeName: 'ว่าง', systemNotes: notes({}) },
    ]);
    expect(container).toBeEmptyDOMElement();
  });
});
