import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/lib/api';
import { ReceivingSummary } from './ReceivingSummary';
import type { ReceivingUnitForm } from '../types';
import { defaultChecklist } from '../constants';
import { buildScreens } from '../receiving-flow.util';
import { emptyAnglePhotos } from '@/constants/photo-angles';
import { bangkokTodayIso, formatIsoDate, type SupplierDocForm } from '../supplier-doc.util';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }));

/**
 * ข3 — ส่วน "เอกสารจากผู้จัดจำหน่าย" ในหน้าสรุปก่อนยืนยันรับสินค้า (แบบหน้าจอที่เจ้าของเคาะ 2026-10-01).
 * flow เต็ม (เดินทีละเครื่อง → สรุป → ยืนยัน) อยู่ที่ GoodsReceivingModal.test.tsx
 */
const accessory: ReceivingUnitForm = {
  poItemId: 'line-1',
  label: 'เคสใส iPhone 15 #1',
  category: 'ACCESSORY',
  brand: '',
  model: 'iPhone 15',
  color: '',
  storage: '',
  accessoryType: 'เคส',
  accessoryBrand: 'ทั่วไป',
  imeiSerial: '',
  serialNumber: '',
  status: 'PASS',
  rejectReason: '',
  defectReason: '',
  batteryHealth: '',
  warrantyExpired: false,
  warrantyExpireDate: '',
  hasBox: true,
  checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
  sellingPrice: '290',
  installmentPrice: '',
  photos: [],
  anglePhotos: emptyAnglePhotos(),
  costPrice: '150',
};

function Harness({ start, onConfirm }: { start: SupplierDocForm; onConfirm: () => void }) {
  const [doc, setDoc] = useState(start);
  const [notes, setNotes] = useState('');
  const units = [accessory];
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReceivingSummary
        units={units}
        screens={buildScreens(units)}
        mode="po"
        notes={notes}
        setNotes={setNotes}
        onEditScreen={vi.fn()}
        onBack={vi.fn()}
        onConfirm={onConfirm}
        supplierDoc={doc}
        setSupplierDoc={setDoc}
        supplierHasVat
        supplierId="sup-1"
      />
    </QueryClientProvider>
  );
}

const confirmButton = () => screen.getByRole('button', { name: 'ยืนยันรับสินค้า 1 ชิ้น' });
const today = formatIsoDate(bangkokTodayIso());

describe('ReceivingSummary — เอกสารจากผู้จัดจำหน่าย (ข3)', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockResolvedValue({ data: { duplicates: [], periodClosed: false } });
  });

  it('ไม่มีเอกสาร: ซ่อนเลขที่/วันที่ · บังคับเหตุผลในหมายเหตุ · ลงบัญชีวันที่รับของ', () => {
    const onConfirm = vi.fn();
    render(<Harness start={{ type: 'TAX_INVOICE', number: '', date: '' }} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('radio', { name: 'ไม่มีเอกสาร' }));
    expect(screen.queryByLabelText('เลขที่เอกสาร')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('วันที่ในเอกสาร')).not.toBeInTheDocument();
    expect(screen.getByText(`ระบบลงบัญชีรับสินค้าด้วย วันที่รับของ (${today}) · กรุณาเขียนเหตุผลที่ไม่มีเอกสารในหมายเหตุใบรับ`)).toBeInTheDocument();
    expect(screen.getByTestId('receiving-summary')).toHaveTextContent(`ลงบัญชีวันที่${today} (วันที่รับของ)`);

    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('กรุณาเขียนเหตุผลที่ไม่มีเอกสาร เช่น ร้านไม่ออกบิล')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('หมายเหตุใบรับ *'), { target: { value: 'ร้านไม่ออกบิล' } });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('วันที่ในอนาคตไม่ผ่าน', () => {
    const onConfirm = vi.fn();
    render(<Harness start={{ type: 'TAX_INVOICE', number: 'IV-1', date: '2999-01-01' }} onConfirm={onConfirm} />);
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(`วันที่ในเอกสารต้องไม่เกินวันนี้ (${today})`)).toBeInTheDocument();
  });

  it('งวดของวันที่ในเอกสารปิด + เลขซ้ำ: เตือนทั้งสองอย่างแต่ยังกดยืนยันได้ · บรรทัดลงบัญชีเปลี่ยนเป็นวันที่รับของ', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { duplicates: [{ grNumber: 'GR-2026-09-012', receivedAt: '2026-09-02T03:00:00.000Z', poNumber: 'PO-1' }], periodClosed: true },
    });
    const onConfirm = vi.fn();
    render(<Harness start={{ type: 'TAX_INVOICE', number: 'IV2609-0877', date: '2026-08-28' }} onConfirm={onConfirm} />);

    await waitFor(() => expect(screen.getByText(/ปิดงวดบัญชีแล้ว/)).toBeInTheDocument());
    expect(screen.getByText(/ปิดงวดบัญชีแล้ว/)).toHaveTextContent(
      `เดือนสิงหาคม 2569 ปิดงวดบัญชีแล้ว — ระบบจะลงบัญชีรับสินค้าวันที่รับของ (${today}) แทน · เก็บวันที่ในเอกสารไว้ตามจริง และแจ้งฝ่ายบัญชีให้ทราบ`,
    );
    expect(screen.getByText(/เคยใช้กับใบรับของ/)).toHaveTextContent(
      'เลขที่ IV2609-0877 เคยใช้กับใบรับของ GR-2026-09-012 ของผู้จัดจำหน่ายรายนี้ — ตรวจว่าไม่ได้กรอกซ้ำ (ยังรับของได้)',
    );
    expect(screen.getByTestId('receiving-summary')).toHaveTextContent(`ลงบัญชีวันที่${today} (วันที่รับของ)`);
    expect(api.get).toHaveBeenCalledWith('/purchase-orders/receiving-doc-check', {
      params: { supplierId: 'sup-1', docNumber: 'IV2609-0877', docDate: '2026-08-28' },
    });

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
