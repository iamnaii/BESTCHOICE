import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ApprovalTable from './ApprovalTable';
import type { CaseRow } from './after-sales';

/** 3 แถวจากมockup C (task-12-brief §Step 1): PRICED REVIEW (ผจก.สาขาอนุมัติได้) ·
 * SAME_MODEL (MGR ยืนยัน/ปฏิเสธ) · PRICED ESCALATE (เจ้าของเท่านั้น) */
function pricedRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: 'case-1',
    caseNumber: 'AS-20260924-0001',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'PRICED_EXCHANGE',
    stage: 'AWAITING_APPROVAL',
    stale: false,
    daysInStage: 1,
    receivedAt: '2026-09-20T03:00:00.000Z',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13',
    deviceImei: '359123456789012',
    customer: { id: 'cust-1', name: 'คุณสมหญิง ตาราง', phone: '0812345678' },
    branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    receivedBy: { id: 'user-1', name: 'ธนา' },
    repairTicket: null,
    exchange: {
      kind: 'PRICED',
      mode: 'PRICED',
      approvalTier: 'REVIEW',
      requestStatus: 'PENDING',
      buybackPrice: '8000.00',
      ncvSnapshot: '10000.00',
      approverRole: 'BRANCH_MANAGER',
      oldProduct: { brand: 'Apple', model: 'iPhone 13', storage: '128GB', imeiSerial: 'IMEI-OLD' },
      newProduct: {
        id: 'p2',
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '128GB',
        imeiSerial: 'IMEI-NEW',
      },
      replacementContract: null,
      requestedBy: { id: 'user-1', name: 'ธนา' },
    },
    ...over,
  };
}

function sameModelRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: 'case-2',
    caseNumber: 'AS-20260924-0002',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'SAME_MODEL_EXCHANGE',
    stage: 'AWAITING_APPROVAL',
    stale: false,
    daysInStage: 1,
    receivedAt: '2026-09-21T03:00:00.000Z',
    deviceBrand: 'Samsung',
    deviceModel: 'A55',
    deviceImei: '359000000000002',
    customer: { id: 'cust-2', name: 'คุณสมชาย ตาราง', phone: '0898765432' },
    branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    receivedBy: { id: 'user-2', name: 'นิภา' },
    repairTicket: null,
    exchange: {
      kind: 'SAME_MODEL',
      mode: null,
      approvalTier: null,
      requestStatus: null,
      buybackPrice: null,
      ncvSnapshot: null,
      approverRole: 'BRANCH_MANAGER',
      oldProduct: { brand: 'Samsung', model: 'A55', storage: '128GB', imeiSerial: 'IMEI-OLD-2' },
      newProduct: {
        id: 'p3',
        brand: 'Samsung',
        model: 'A55',
        storage: '128GB',
        imeiSerial: 'IMEI-NEW-2',
      },
      replacementContract: null,
      requestedBy: { id: 'user-2', name: 'นิภา' },
    },
    ...over,
  };
}

function escalateRow(over: Partial<CaseRow> = {}): CaseRow {
  return {
    id: 'case-3',
    caseNumber: 'AS-20260924-0003',
    source: 'INSTALLMENT_CONTRACT',
    outcome: 'PRICED_EXCHANGE',
    stage: 'AWAITING_APPROVAL',
    stale: true,
    daysInStage: 3,
    receivedAt: '2026-09-19T03:00:00.000Z',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 12',
    deviceImei: '359000000000003',
    customer: { id: 'cust-3', name: 'คุณมานี มีดี', phone: '0855555555' },
    branch: { id: 'branch-1', name: 'ลาดพร้าว' },
    receivedBy: { id: 'user-3', name: 'สมศักดิ์' },
    repairTicket: null,
    exchange: {
      kind: 'PRICED',
      mode: 'PRICED',
      approvalTier: 'ESCALATE',
      requestStatus: 'PENDING',
      buybackPrice: '5000.00',
      ncvSnapshot: '20000.00',
      approverRole: 'OWNER',
      oldProduct: { brand: 'Apple', model: 'iPhone 12', storage: '64GB', imeiSerial: 'IMEI-OLD-3' },
      newProduct: null,
      replacementContract: {
        id: 'contract-9',
        contractNumber: 'CT-20260924-0009',
        status: 'DRAFT',
      },
      requestedBy: { id: 'user-3', name: 'สมศักดิ์' },
    },
    ...over,
  };
}

function renderTable(role: string, rows: CaseRow[] = [pricedRow(), sameModelRow(), escalateRow()]) {
  const onAction = vi.fn();
  render(
    <MemoryRouter>
      <ApprovalTable rows={rows} role={role} onAction={onAction} />
    </MemoryRouter>,
  );
  return { onAction };
}

function rowByCase(caseNumber: string) {
  const table = screen.getByRole('table');
  const cell = within(table).getByText(caseNumber);
  const row = cell.closest('tr');
  if (!row) throw new Error(`row not found for ${caseNumber}`);
  return within(row);
}

describe('ApprovalTable — role matrix (task-12-brief Step 1)', () => {
  it('BM: แถว 1 (PRICED REVIEW) "อนุมัติ" enabled, แถว 2 (SAME_MODEL) "ยืนยันเปลี่ยนเครื่อง", แถว 3 (PRICED ESCALATE) "อนุมัติ" disabled + "รอเจ้าของ"', () => {
    renderTable('BRANCH_MANAGER');

    const row1 = rowByCase('AS-20260924-0001');
    expect(row1.getByRole('button', { name: 'อนุมัติ' })).not.toBeDisabled();

    const row2 = rowByCase('AS-20260924-0002');
    expect(row2.getByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' })).toBeInTheDocument();
    expect(row2.getByRole('button', { name: 'ปฏิเสธ' })).toBeInTheDocument();

    const row3 = rowByCase('AS-20260924-0003');
    expect(row3.getByRole('button', { name: 'อนุมัติ' })).toBeDisabled();
    expect(row3.getByText('รอเจ้าของอนุมัติ')).toBeInTheDocument();
  });

  it('OWNER: ทุกปุ่ม enabled ทุกแถว', () => {
    renderTable('OWNER');

    const row1 = rowByCase('AS-20260924-0001');
    expect(row1.getByRole('button', { name: 'อนุมัติ' })).not.toBeDisabled();

    const row2 = rowByCase('AS-20260924-0002');
    expect(row2.getByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' })).not.toBeDisabled();
    expect(row2.getByRole('button', { name: 'ปฏิเสธ' })).not.toBeDisabled();

    const row3 = rowByCase('AS-20260924-0003');
    expect(row3.getByRole('button', { name: 'อนุมัติ' })).not.toBeDisabled();
    expect(row3.getByRole('button', { name: 'ปฏิเสธ' })).not.toBeDisabled();
    expect(row3.queryByText('รอเจ้าของอนุมัติ')).not.toBeInTheDocument();
  });

  it('FINANCE_MANAGER: ไม่มีปุ่มดำเนินการ (อนุมัติ/ปฏิเสธ/ยืนยันเปลี่ยนเครื่อง) เหลือแค่ "เปิดเคส" ทุกแถว', () => {
    renderTable('FINANCE_MANAGER');
    const table = screen.getByRole('table');

    expect(within(table).queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'ปฏิเสธ' })).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' }),
    ).not.toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: 'เปิดเคส' })).toHaveLength(3);
  });
});

describe('ApprovalTable — คอลัมน์ (mockup C)', () => {
  it('แสดงหัวคอลัมน์ครบตามบรีฟ', () => {
    renderTable('OWNER');
    for (const header of [
      'ขอเมื่อ',
      'เคส',
      'ลูกค้า',
      'เครื่องเดิม → ใหม่',
      'ประเภท/ราคา',
      'ใครอนุมัติได้',
      'การกระทำ',
    ]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('ผู้ยื่น + ราคารับซื้อ/% ของยอดคงเหลือ + สัญญาใหม่ + ป้ายผู้อนุมัติ render ถูก', () => {
    renderTable('OWNER');

    const row1 = rowByCase('AS-20260924-0001');
    expect(row1.getByText('ธนา')).toBeInTheDocument();
    // 8000/10000 = 80%
    expect(row1.getByText('รับซื้อ 8,000.00 · 80% ของยอดคงเหลือ')).toBeInTheDocument();
    // T12-1 — แถว PRICED ต่อท้าย tier · แถว SAME_MODEL ป้ายเปล่า
    expect(row1.getByText('ผจก.สาขา (REVIEW)')).toBeInTheDocument();
    expect(rowByCase('AS-20260924-0002').getByText('ผจก.สาขา')).toBeInTheDocument();

    const row3 = rowByCase('AS-20260924-0003');
    expect(row3.getByText('สัญญาใหม่ CT-20260924-0009')).toBeInTheDocument();
    expect(row3.getByText('เจ้าของเท่านั้น (ESCALATE)')).toBeInTheDocument();
    expect(row3.getByText(/ยังไม่เลือก/)).toBeInTheDocument();
  });

  it('การกระทำเรียก onAction พร้อม row และ action ที่ถูกต้อง (confirm/approve/reject/open)', async () => {
    const { onAction } = renderTable('OWNER');
    const row2 = rowByCase('AS-20260924-0002');
    row2.getByRole('button', { name: 'ยืนยันเปลี่ยนเครื่อง' }).click();
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-2' }), 'confirm');
    row2.getByRole('button', { name: 'ปฏิเสธ' }).click();
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-2' }), 'reject');

    const row1 = rowByCase('AS-20260924-0001');
    row1.getByRole('button', { name: 'อนุมัติ' }).click();
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-1' }), 'approve');
    row1.getByRole('button', { name: 'เปิดเคส' }).click();
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-1' }), 'open');
  });
});

describe('ApprovalTable — แถว PRICED ที่ผูกคำขอไม่สำเร็จ (residual sweep)', () => {
  it('requestStatus null → ไม่มี "อนุมัติ"/"ปฏิเสธ" ทุก role แต่ยังมี "เปิดเคส"', () => {
    const stuck = pricedRow({
      exchange: { ...pricedRow().exchange!, requestStatus: null, approvalTier: null },
    });
    for (const role of ['OWNER', 'BRANCH_MANAGER']) {
      const { unmount } = render(
        <MemoryRouter>
          <ApprovalTable rows={[stuck]} role={role} onAction={vi.fn()} />
        </MemoryRouter>,
      );
      const row = rowByCase('AS-20260924-0001');
      expect(row.queryByRole('button', { name: 'อนุมัติ' })).not.toBeInTheDocument();
      expect(row.queryByRole('button', { name: 'ปฏิเสธ' })).not.toBeInTheDocument();
      expect(row.getByRole('button', { name: 'เปิดเคส' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('ApprovalTable — ว่าง', () => {
  it('ไม่มีแถว → ข้อความ "ไม่มีรายการรออนุมัติ"', () => {
    renderTable('OWNER', []);
    expect(screen.getByText('ไม่มีรายการรออนุมัติ')).toBeInTheDocument();
  });
});
