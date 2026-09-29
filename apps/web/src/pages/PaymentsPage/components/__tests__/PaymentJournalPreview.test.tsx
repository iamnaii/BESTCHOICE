import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { JePreviewPanel, type JePreview } from '../PaymentJournalPreview';

/** สัญญา 17,000/12 งวด: 2A = 2,115.00 (Dr 1,515.83 + 99.17 + 500.00) · 2B = 1,515.83 */
const accrualLines = (posted: boolean): JePreview['lines'] =>
  (
    [
      ['11-2103', 'ลูกหนี้ค้างชำระ', '1515.83', '0.00'],
      ['21-2102', 'ภาษีขายรอเรียกเก็บ', '99.17', '0.00'],
      ['11-2106', 'รายได้รอตัดบัญชี-ดอกเบี้ย', '500.00', '0.00'],
      ['11-2101', 'ลูกหนี้ผ่อนชำระ', '0.00', '1416.66'],
      ['11-2105', 'ลูกหนี้ภาษีขายรอเรียกเก็บ', '0.00', '99.17'],
      ['41-1101', 'รายได้ดอกเบี้ย', '0.00', '500.00'],
      ['21-2101', 'ภาษีขาย ภ.พ.30', '0.00', '99.17'],
    ] as const
  ).map(([accountCode, accountName, debit, credit]) => ({
    accountCode,
    accountName,
    debit,
    credit,
    description: '',
    block: '2A' as const,
    posted,
  }));

const receiptLines: JePreview['lines'] = [
  {
    accountCode: '11-1101',
    accountName: 'เงินสด',
    debit: '1515.83',
    credit: '0.00',
    description: 'รับเงิน',
    block: '2B',
    posted: false,
  },
  {
    accountCode: '11-2103',
    accountName: 'ลูกหนี้ค้างชำระ',
    debit: '0.00',
    credit: '1515.83',
    description: 'ล้างลูกหนี้ค้างชำระ',
    block: '2B',
    posted: false,
  },
];

const basePreview = (over: Partial<JePreview>): JePreview => ({
  lines: receiptLines,
  subtotals: {
    '2A': { debit: '2115.00', credit: '2115.00', balanced: true },
    '2B': { debit: '1515.83', credit: '1515.83', balanced: true },
  },
  totalDebit: '1515.83',
  totalCredit: '1515.83',
  isBalanced: true,
  dueDate: '2026-10-11T17:00:00.000Z',
  ...over,
});

describe('JePreviewPanel — รายการตั้งลูกหนี้งวด (2A)', () => {
  it('งวดยังไม่ตั้งลูกหนี้งวด → แสดงบล็อก 2A ติดป้าย "ลงพร้อมการรับชำระนี้" + หมายเหตุ 2 รายการ', () => {
    render(
      <JePreviewPanel
        isLoading={false}
        preview={basePreview({
          accrual2A: {
            lines: accrualLines(false),
            subtotal: { debit: '2115.00', credit: '2115.00', balanced: true },
          },
          accrualMode: 'CONSOLIDATED_PAYING_AHEAD',
          accrualPostedAt: '2026-09-29T00:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText('2A — ตั้งลูกหนี้งวด (ACCRUAL)')).toBeInTheDocument();
    expect(screen.getByText('ลงพร้อมการรับชำระนี้')).toBeInTheDocument();
    expect(screen.queryByText('โพสต์แล้ว')).not.toBeInTheDocument();
    expect(screen.getByText('2,115.00 = 2,115.00')).toBeInTheDocument();
    expect(screen.getByText(/ระบบจะลงรายการ 2A และ 2B เป็น 2 รายการ/)).toBeInTheDocument();
    expect(screen.queryByText(/โพสต์รวม/)).not.toBeInTheDocument();
  });

  it('งวดตั้งลูกหนี้งวดไปแล้ว → บล็อก 2A เป็นบริบท ติดป้าย "โพสต์แล้ว" ไม่มีหมายเหตุ', () => {
    render(
      <JePreviewPanel
        isLoading={false}
        preview={basePreview({
          accrual2A: {
            lines: accrualLines(true),
            subtotal: { debit: '2115.00', credit: '2115.00', balanced: true },
          },
          accrualMode: '2B_ONLY',
        })}
      />,
    );

    expect(screen.getByText('2A — ถึงกำหนดงวด (ACCRUAL)')).toBeInTheDocument();
    expect(screen.getByText('โพสต์แล้ว')).toBeInTheDocument();
    expect(screen.queryByText('ลงพร้อมการรับชำระนี้')).not.toBeInTheDocument();
    expect(screen.queryByText(/ระบบจะลงรายการ 2A และ 2B/)).not.toBeInTheDocument();
  });

  it('ไม่มีบล็อก 2A (เช่น ปรับดิว) → แสดงเฉพาะใบรับชำระ', () => {
    render(
      <JePreviewPanel
        isLoading={false}
        preview={basePreview({
          subtotals: { '2B': { debit: '1515.83', credit: '1515.83', balanced: true } },
        })}
      />,
    );

    expect(screen.getByText('2B — รับชำระ')).toBeInTheDocument();
    expect(screen.queryByText(/^2A —/)).not.toBeInTheDocument();
  });

  it('เลือกชำระผ่าน QR → ป้ายกำกับและหมายเหตุบอกว่า "เมื่อเงินเข้า" · หัวบล็อกรับชำระเป็น "2B — รับชำระ" แม้มีบล็อก 2A', () => {
    render(
      <JePreviewPanel
        isLoading={false}
        viaGateway
        preview={basePreview({
          accrual2A: {
            lines: accrualLines(false),
            subtotal: { debit: '2115.00', credit: '2115.00', balanced: true },
          },
          accrualMode: 'CONSOLIDATED_PAYING_AHEAD',
          accrualPostedAt: '2026-09-29T00:00:00.000Z',
        })}
      />,
    );

    expect(screen.getByText('ลงเมื่อเงินเข้า')).toBeInTheDocument();
    expect(screen.queryByText('ลงพร้อมการรับชำระนี้')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '* งวดนี้ยังไม่ได้ตั้งลูกหนี้งวด — เมื่อเงินเข้า ระบบจะลงรายการ 2A และ 2B เป็น 2 รายการ ในคราวเดียวกัน',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2B — รับชำระ')).toBeInTheDocument();
    expect(screen.queryByText(/อนุโลม/)).not.toBeInTheDocument();
  });

  // คำตัดสิน R17 (2026-09-29): QR ที่หน้าจอหักเครดิตออกให้แล้ว — server ตอบด้วยประโยคเดียวทาง error ของ
  // คำขอ preview (ไม่มีผล preview) แผงต้องแสดงประโยคนั้นในกล่องข้อความผิดพลาด และไม่แสดงรายการบัญชีใดเลย
  it('เลือกชำระผ่าน QR และยอด QR ถูกหักเครดิตออกแล้ว → กล่องข้อความผิดพลาดแสดงประโยคจาก server · ไม่มีบล็อก 2A · ไม่มีบล็อก 2B · ไม่มีป้าย', () => {
    const sentence =
      'การชำระผ่าน QR ไม่หักเครดิตคงเหลือของลูกค้า — ยอด QR 1,015.83 บาท จึงยังไม่ครบยอดที่ต้องชำระของงวดนี้ (1,515.83 บาท) ' +
      'เมื่อเงินเข้า ระบบจะบันทึกเป็นการรับชำระบางส่วน และยังไม่ตั้งลูกหนี้งวด (2A) ' +
      'หากต้องการให้งวดนี้ชำระครบเมื่อเงินเข้า ให้นำเครื่องหมายถูกออกจากกล่อง "มีเครดิตคงเหลือ" เพื่อส่ง QR เต็มยอด';
    render(
      <JePreviewPanel isLoading={false} viaGateway preview={undefined} errorMessage={sentence} />,
    );

    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.getByText('ไม่สามารถสร้าง JE preview ได้')).toBeInTheDocument();
    expect(screen.queryByText(/^2A —/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^2B —/)).not.toBeInTheDocument();
    expect(screen.queryByText('ลงเมื่อเงินเข้า')).not.toBeInTheDocument();
    expect(screen.queryByText(/ระบบจะตั้งลูกหนี้งวด/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ระบบจะลงรายการ 2A และ 2B/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ลูกค้าจ่ายล่วงหน้า/)).not.toBeInTheDocument();
  });
});
