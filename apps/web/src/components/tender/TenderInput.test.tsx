import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TenderInput, useTenders } from './TenderInput';
import { TenderRow, initialTenders, tenderMethodsLabel, tenderStatus, toTenderPayload } from './tender-utils';

function Harness({ due }: { due: number }) {
  const { rows, setRows, status, payload } = useTenders(due);
  return (
    <div>
      <TenderInput due={due} value={rows} onChange={setRows} />
      <button type="button" disabled={!status.ready}>บันทึก</button>
      <pre data-testid="payload">{JSON.stringify(payload)}</pre>
    </div>
  );
}

const payloadOf = () => JSON.parse(screen.getByTestId('payload').textContent ?? '[]');

describe('tender-utils', () => {
  it('a single full-amount cash row is ready; transfer needs a 6+ char reference', () => {
    expect(tenderStatus(initialTenders(12500), 12500)).toMatchObject({ ready: true, label: 'รับครบแล้ว' });
    const transfer: TenderRow[] = [{ method: 'BANK_TRANSFER', amount: '9900.00', reference: '12345' }];
    expect(tenderStatus(transfer, 9900)).toMatchObject({ ready: false, label: 'ยังขาดเลขอ้างอิง' });
    expect(tenderStatus([{ ...transfer[0], reference: ' 123456 ' }], 9900).ready).toBe(true);
  });

  it('reports short / over amounts without floating point drift', () => {
    const rows: TenderRow[] = [{ method: 'CASH', amount: '0.1', reference: '' }, { method: 'CASH', amount: '0.2', reference: '' }];
    expect(tenderStatus(rows, 0.3).ready).toBe(true);
    expect(tenderStatus([{ method: 'CASH', amount: '9500', reference: '' }], 9900).label).toBe('ยังขาด 400.00');
    expect(tenderStatus([{ method: 'CASH', amount: '10000', reference: '' }], 9900).label).toBe('เกิน 100.00');
  });

  it('sends no rows when nothing is due, trims references and omits them for cash', () => {
    expect(toTenderPayload(initialTenders(0), 0)).toEqual([]);
    expect(toTenderPayload([
      { method: 'CASH', amount: '5000', reference: 'junk' },
      { method: 'QR_EWALLET', amount: '4900.50', reference: ' QR5569012044 ' },
    ], 9900.5)).toEqual([{ method: 'CASH', amount: 5000 }, { method: 'QR_EWALLET', amount: 4900.5, reference: 'QR5569012044' }]);
    expect(tenderMethodsLabel(['CASH', 'BANK_TRANSFER', 'CASH'])).toBe('เงินสด + โอนธนาคาร');
  });
});

describe('TenderInput', () => {
  it('single method: fills the full amount by itself — staff type nothing, save is enabled', () => {
    render(<Harness due={12500} />);
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue(12500);
    expect(screen.getByRole('status')).toHaveTextContent('รับครบแล้ว');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled();
    expect(payloadOf()).toEqual([{ method: 'CASH', amount: 12500 }]);
  });

  it('follows the amount due when the price changes (single method)', () => {
    function Changing() {
      const [due, setDue] = useState(9900);
      return (<><button type="button" onClick={() => setDue(9400)}>ลดราคา</button><Harness due={due} /></>);
    }
    render(<Changing />);
    fireEvent.click(screen.getByRole('button', { name: 'ลดราคา' }));
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue(9400);
    expect(payloadOf()).toEqual([{ method: 'CASH', amount: 9400 }]);
  });

  it('transfer: the reference field appears and blocks saving until it has 6+ characters', () => {
    render(<Harness due={9900} />);
    expect(screen.queryByLabelText(/เลขอ้างอิงการโอน/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('วิธีรับเงิน'), { target: { value: 'BANK_TRANSFER' } });
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('ยังขาดเลขอ้างอิง');
    fireEvent.change(screen.getByLabelText(/เลขอ้างอิงการโอน/), { target: { value: '014820931177' } });
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled();
    expect(payloadOf()).toEqual([{ method: 'BANK_TRANSFER', amount: 9900, reference: '014820931177' }]);
  });

  it('split bill: typing the first amount fills the rest into the second row; short totals block saving', () => {
    render(<Harness due={9900} />);
    fireEvent.click(screen.getByRole('button', { name: /เพิ่มวิธีรับเงิน/ }));
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('จำนวนเงิน วิธีที่ 1'), { target: { value: '5000' } });
    expect(screen.getByLabelText('จำนวนเงิน วิธีที่ 2')).toHaveValue(4900);
    fireEvent.change(screen.getByLabelText(/เลขอ้างอิงการโอน วิธีที่ 2/), { target: { value: '014820931177' } });
    expect(screen.getByRole('status')).toHaveTextContent('รับครบแล้ว');
    expect(payloadOf()).toEqual([{ method: 'CASH', amount: 5000 }, { method: 'BANK_TRANSFER', amount: 4900, reference: '014820931177' }]);

    fireEvent.change(screen.getByLabelText('จำนวนเงิน วิธีที่ 2'), { target: { value: '4500' } });
    expect(screen.getByRole('status')).toHaveTextContent('ยังขาด 400.00');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  });

  it('removing back to one row restores the full amount; at most 4 rows', () => {
    render(<Harness due={9900} />);
    const add = () => fireEvent.click(screen.getByRole('button', { name: /เพิ่มวิธีรับเงิน/ }));
    add(); add(); add();
    expect(screen.queryByRole('button', { name: /เพิ่มวิธีรับเงิน/ })).not.toBeInTheDocument();
    screen.getAllByRole('button', { name: 'นำออก' }).slice(1).forEach(() => fireEvent.click(screen.getAllByRole('button', { name: 'นำออก' })[1]));
    expect(screen.getByLabelText('จำนวนเงิน')).toHaveValue(9900);
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled();
  });

  it('shows the change helper only for a single cash row, and it never changes what is recorded', () => {
    render(<Harness due={12500} />);
    fireEvent.change(screen.getByLabelText('ลูกค้ายื่นเงินมา'), { target: { value: '13000' } });
    expect(screen.getByText('500.00 ฿')).toBeInTheDocument();
    expect(payloadOf()).toEqual([{ method: 'CASH', amount: 12500 }]);
    fireEvent.change(screen.getByLabelText('วิธีรับเงิน'), { target: { value: 'QR_EWALLET' } });
    expect(screen.queryByLabelText('ลูกค้ายื่นเงินมา')).not.toBeInTheDocument();
  });

  it('nothing due: renders a note and sends no rows', () => {
    render(<Harness due={0} />);
    expect(screen.getByTestId('tender-none')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeEnabled();
    expect(payloadOf()).toEqual([]);
  });
});
