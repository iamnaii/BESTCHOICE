import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GoodsReceivingModal, receivingIsDirty } from './GoodsReceivingModal';
import type { PurchaseOrder, ReceivingUnitForm } from '../types';
import { defaultChecklist } from '../constants';
import { emptyAnglePhotos } from '@/constants/photo-angles';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const po = {
  id: 'po-1',
  poNumber: 'PO-2026-09-006',
  supplier: { id: 's1', name: 'บริษัท ไอเดียโมบาย จำกัด', contactName: null, phone: '', hasVat: false },
  items: [],
} as unknown as PurchaseOrder;

// the same shape openReceiveModal seeds: phones undecided, accessories counted as received
const seed = (over: Partial<ReceivingUnitForm>): ReceivingUnitForm => ({
  poItemId: 'line-1',
  label: 'Apple iPhone 17 Pro Deep Blue 256GB #1',
  category: 'PHONE_NEW',
  brand: 'Apple',
  model: 'iPhone 17 Pro',
  color: 'Deep Blue',
  storage: '256GB',
  accessoryType: '',
  accessoryBrand: '',
  imeiSerial: '',
  serialNumber: '',
  status: '',
  rejectReason: '',
  defectReason: '',
  batteryHealth: '',
  warrantyExpired: false,
  warrantyExpireDate: '',
  hasBox: true,
  checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
  sellingPrice: '45900',
  installmentPrice: '49900',
  photos: [],
  anglePhotos: emptyAnglePhotos(),
  costPrice: '42900',
  ...over,
});
const initialUnits = (): ReceivingUnitForm[] => [
  seed({}),
  seed({ label: 'Apple iPhone 17 Pro Deep Blue 256GB #2' }),
  seed({ poItemId: 'line-2', label: 'Apple iPhone 15 Black 128GB #1', category: 'PHONE_USED', model: 'iPhone 15', color: 'Black', storage: '128GB', sellingPrice: '17900', installmentPrice: '19900', costPrice: '14500' }),
  seed({ poItemId: 'line-3', label: 'เคส Spigen สำหรับ iPhone 17 Pro #1', category: 'ACCESSORY', accessoryType: 'เคส', accessoryBrand: 'Spigen', model: 'iPhone 17 Pro', color: '', storage: '', status: 'PASS', sellingPrice: '', installmentPrice: '', costPrice: '350' }),
  seed({ poItemId: 'line-3', label: 'เคส Spigen สำหรับ iPhone 17 Pro #2', category: 'ACCESSORY', accessoryType: 'เคส', accessoryBrand: 'Spigen', model: 'iPhone 17 Pro', color: '', storage: '', status: 'PASS', sellingPrice: '', installmentPrice: '', costPrice: '350' }),
];

function Harness({ onClose = vi.fn(), confirmClose, handle = vi.fn(), units: start = initialUnits() }: { onClose?: () => void; confirmClose?: (proceed: () => void) => void; handle?: () => void; units?: ReceivingUnitForm[] }) {
  const [units, setUnits] = useState<ReceivingUnitForm[]>(start);
  const [notes, setNotes] = useState('');
  return (
    <GoodsReceivingModal
      isOpen
      onClose={onClose}
      selectedPO={po}
      receivingUnits={units}
      setReceivingUnits={setUnits}
      receivingNotes={notes}
      setReceivingNotes={setNotes}
      goodsReceivingMutation={{ isPending: false } as never}
      handleGoodsReceiving={handle}
      confirmClose={confirmClose}
    />
  );
}

const imei = () => screen.getByLabelText(/^IMEI/) as HTMLInputElement;
const serial = () => screen.getByLabelText(/^หมายเลขซีเรียล/) as HTMLInputElement;
const enter = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter' });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe('GoodsReceivingModal — one device per screen', () => {
  it('opens on the first phone with the ordering facts and a locked next button', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'รับสินค้า' })).toBeInTheDocument();
    expect(screen.getByText('PO-2026-09-006')).toBeInTheDocument();
    expect(screen.getByText('เครื่องที่ 1 จาก 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'iPhone 17 Pro' })).toBeInTheDocument();
    expect(screen.getByText('42,900 บาท')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4); // 3 phones + 1 accessory line
    expect(screen.getByRole('button', { name: 'ไปเครื่องถัดไป' })).toBeDisabled();
    expect(screen.getByTestId('next-hint')).toHaveTextContent('กรอก IMEI และซีเรียลให้ครบก่อน');
    expect(document.activeElement).toBe(imei());
    // a new phone takes no photo
    expect(screen.queryByText('ถ่ายรูป')).not.toBeInTheDocument();
    expect(document.querySelector('button[type="submit"]')).toBeNull();
  });

  it('two scans: Enter on IMEI jumps to serial, Enter on serial marks ผ่าน and opens the next device', () => {
    render(<Harness />);
    type(imei(), '356000000090601');
    enter(imei());
    expect(document.activeElement).toBe(serial());
    type(serial(), 'QASN0906A');
    enter(serial());
    expect(screen.getByText('เครื่องที่ 2 จาก 5')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ชิ้นที่ 1' })).toHaveAttribute('aria-selected', 'false');
    // the second device waits for its own ผ่าน/ไม่ผ่าน; once passed it carries the line's prices
    expect(screen.queryByTestId('price-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ผ่าน' }));
    expect((screen.getByLabelText(/^ราคาเงินสด/) as HTMLInputElement).value).toBe('45900');
    expect((screen.getByLabelText(/^ราคาผ่อน/) as HTMLInputElement).value).toBe('49900');
  });

  it('ไม่ผ่าน opens the red box and waits for a reason; the next button then says so', () => {
    render(<Harness />);
    type(imei(), '356000000090777');
    type(serial(), 'QASN0906C');
    fireEvent.click(screen.getByRole('button', { name: 'ไม่ผ่าน' }));
    expect(screen.getByTestId('reject-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('price-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกแล้วไปเครื่องถัดไป' })).toBeDisabled();
    expect(screen.getByTestId('next-hint')).toHaveTextContent('เลือกสาเหตุที่ไม่ผ่านก่อน');
    fireEvent.change(screen.getByLabelText(/^สาเหตุ/), { target: { value: 'SCREEN' } });
    expect(screen.getByRole('button', { name: 'บันทึกแล้วไปเครื่องถัดไป' })).toBeEnabled();
    expect(screen.getByLabelText('ถ่ายรูปความเสียหาย')).toBeInTheDocument();
  });

  it('a used phone must carry battery % and a warranty answer before it can pass', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'ชิ้นที่ 3' }));
    expect(screen.getByText('เครื่องที่ 3 จาก 5 · มือสอง')).toBeInTheDocument();
    type(imei(), '351234567890123');
    type(serial(), 'DX3K2Q9L');
    fireEvent.click(screen.getByRole('button', { name: 'ผ่าน' }));
    expect(screen.getByTestId('used-panel')).toBeInTheDocument();
    expect(screen.getByTestId('next-hint')).toHaveTextContent('กรอก % แบตเตอรี่ก่อน');
    type(screen.getByLabelText(/^% แบตเตอรี่/), '89');
    expect(screen.getByTestId('next-hint')).toHaveTextContent('กรอกวันหมดประกันหรือติ๊กหมดประกันแล้ว');
    fireEvent.click(screen.getByLabelText('หมดประกันแล้ว'));
    expect(screen.getByRole('button', { name: 'ไปเครื่องถัดไป' })).toBeEnabled();
    expect(screen.getByTestId('angle-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('ถ่ายรูปด้านหน้า')).toBeInTheDocument();
    expect(screen.getByTestId('angle-panel')).toHaveTextContent('ถ่ายแล้ว 0/6 มุม');
    expect(screen.getByLabelText('รูปตำหนิ/ความเสียหาย')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เปิดเช็คลิสต์' }));
    expect(screen.getByTestId('checklist')).toBeInTheDocument();
  });

  it('an accessory line is counted: lowering the count opens the reason box, the price applies to the line', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'เคส Spigen 2 ชิ้น' }));
    expect(screen.getByText('ชิ้นที่ 4–5 จาก 5')).toBeInTheDocument();
    expect(screen.getByTestId('received-count')).toHaveTextContent('2');
    expect(screen.getByTestId('next-hint')).toHaveTextContent('กรอกราคาเงินสดก่อน');
    fireEvent.click(screen.getByRole('button', { name: 'ลดจำนวนที่รับได้' }));
    expect(screen.getByTestId('received-count')).toHaveTextContent('1');
    expect(screen.getByTestId('group-reject-panel')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^สาเหตุ/), { target: { value: 'COSMETIC' } });
    type(screen.getByLabelText(/^ราคาเงินสด/), '590');
    expect(screen.getByRole('button', { name: 'รับเคส Spigen 1 ชิ้น · ไปสรุป' })).toBeEnabled();
  });

  it('walks every piece, lands on the summary table and hands the confirm to the page', () => {
    const handle = vi.fn();
    render(<Harness handle={handle} />);
    expect(screen.getByRole('button', { name: 'ดูสรุปทั้งหมด' })).toBeDisabled();
    // 1 · 2 — new phones, scan + Enter
    type(imei(), '356000000090601');
    type(serial(), 'QASN0906A');
    enter(serial());
    type(imei(), '356000000090602');
    type(serial(), 'QASN0906B');
    enter(serial());
    // 3 — used phone
    type(imei(), '351234567890123');
    type(serial(), 'DX3K2Q9L');
    fireEvent.click(screen.getByRole('button', { name: 'ผ่าน' }));
    type(screen.getByLabelText(/^% แบตเตอรี่/), '89');
    fireEvent.click(screen.getByLabelText('หมดประกันแล้ว'));
    fireEvent.click(screen.getByRole('button', { name: 'ไปเครื่องถัดไป' }));
    // 4–5 — accessories
    type(screen.getByLabelText(/^ราคาเงินสด/), '590');
    fireEvent.click(screen.getByRole('button', { name: 'รับเคส Spigen 2 ชิ้น · ไปสรุป' }));

    const summary = screen.getByTestId('receiving-summary');
    expect(within(summary).getByRole('heading', { name: 'ตรวจครบแล้ว 5 ชิ้น' })).toBeInTheDocument();
    const rows = within(summary).getAllByRole('button', { name: /^แก้ไข / });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('356000000090601');
    expect(rows[0]).toHaveTextContent('49,900');
    expect(rows[2]).toHaveTextContent('แบต 89% · มีกล่อง');
    expect(rows[3]).toHaveTextContent('ผ่าน 2 ชิ้น');
    // the used phone passed without its six angles → it waits in the photo queue, the other 4 go on sale
    expect(rows[2]).toHaveTextContent('0/6 มุม');
    expect(summary).toHaveTextContent(/เข้าคลังพร้อมขาย\s*4 ชิ้น/);
    expect(summary).toHaveTextContent(/รอถ่ายรูป 6 มุมก่อนขึ้นขาย\s*1 ชิ้น/);
    fireEvent.change(within(summary).getByLabelText('หมายเหตุใบรับ'), { target: { value: 'กล่องบุบ 1 กล่อง' } });
    fireEvent.click(within(summary).getByRole('button', { name: 'ยืนยันรับสินค้า 5 ชิ้น' }));
    expect(handle).toHaveBeenCalledTimes(1);
    // tapping a row goes back to that device
    fireEvent.click(rows[1]);
    expect(screen.getByText('เครื่องที่ 2 จาก 5')).toBeInTheDocument();
  });

  it('Esc and the X button close at once when nothing was typed, but ask first once something was', () => {
    const onClose = vi.fn();
    const confirmClose = vi.fn();
    render(<Harness onClose={onClose} confirmClose={confirmClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    type(imei(), '3560');
    fireEvent.click(screen.getByRole('button', { name: 'ปิด' }));
    expect(confirmClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('receivingIsDirty', () => {
  it('compares against the seeds the modal opened with — any edit, even a price, counts', () => {
    const baseline = JSON.stringify(initialUnits());
    expect(receivingIsDirty(initialUnits(), baseline)).toBe(false);
    expect(receivingIsDirty(initialUnits(), null)).toBe(false);
    const priced = initialUnits();
    priced[3] = { ...priced[3], sellingPrice: '590' };
    expect(receivingIsDirty(priced, baseline)).toBe(true);
    const decided = initialUnits();
    decided[0] = { ...decided[0], status: 'PASS' };
    expect(receivingIsDirty(decided, baseline)).toBe(true);
  });
});
