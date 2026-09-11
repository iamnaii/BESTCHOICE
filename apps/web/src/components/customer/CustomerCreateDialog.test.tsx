import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const apiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => apiPost(...args) },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'error'),
}));
vi.mock('@/lib/cardReader', () => ({ checkCardReaderStatus: vi.fn(), readSmartCard: vi.fn() }));
vi.mock('@/lib/compressImage', () => ({ compressImageForOcr: vi.fn() }));

import CustomerCreateDialog, { splitDisplayName } from './CustomerCreateDialog';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** เลขบัตรที่ผ่าน checksum (คำนวณตาม isValidThaiNationalId) — ฟอร์มปฏิเสธเลขมั่ว */
const VALID_NID = '1234567890121';

/* ส่วน "บุคคลอ้างอิง" ใช้ placeholder/label ชุดเดียวกับข้อมูลหลัก — ช่องแรกใน DOM คือของข้อมูลหลักเสมอ */
const mainField = (placeholder: string) => screen.getAllByPlaceholderText(placeholder)[0];
const fillRequired = () => {
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
  fireEvent.change(mainField('X-XXXX-XXXXX-XX-X'), { target: { value: VALID_NID } });
  fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
};

describe('splitDisplayName', () => {
  it('คำแรก = ชื่อ ที่เหลือ = นามสกุล · ว่าง/null ได้ช่องว่าง', () => {
    expect(splitDisplayName('นันทิชา ใจดี')).toEqual({ firstName: 'นันทิชา', lastName: 'ใจดี' });
    expect(splitDisplayName('  Nan  ')).toEqual({ firstName: 'Nan', lastName: '' });
    expect(splitDisplayName('สม ชาย ทอง ดี')).toEqual({ firstName: 'สม', lastName: 'ชาย ทอง ดี' });
    expect(splitDisplayName(null)).toEqual({ firstName: '', lastName: '' });
  });
});

describe('CustomerCreateDialog', () => {
  // ห้ามคืนค่า mock ออกจาก hook — vitest จะถือว่าเป็น cleanup แล้วเรียก apiPost() หลังเทส (ยิง reject ลอย)
  beforeEach(() => { apiPost.mockReset(); });

  it('เติมค่าตั้งต้น · ปุ่มบันทึกใช้ป้ายที่ส่งมา · บันทึกแล้ว POST /customers และเรียก onCreated ด้วยลูกค้าที่ได้ แล้วปิด', async () => {
    apiPost.mockResolvedValue({ data: { id: 'c-new', name: 'นันทิชา ใจดี' } });
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <CustomerCreateDialog
        open
        onOpenChange={onOpenChange}
        initialValues={{ firstName: 'นันทิชา', lastName: 'ใจดี', facebookName: 'Nan' }}
        submitLabel="บันทึกและผูกกับแชท"
        context={<div>บันทึกแล้วจะผูกกับห้องแชท Nan</div>}
        onCreated={onCreated}
      />,
    );
    expect(screen.getByRole('heading', { name: 'เพิ่มลูกค้าใหม่' })).toBeInTheDocument();
    expect(screen.getByText('บันทึกแล้วจะผูกกับห้องแชท Nan')).toBeInTheDocument();
    expect(mainField('กรอกชื่อ')).toHaveValue('นันทิชา');
    expect(mainField('กรอกนามสกุล')).toHaveValue('ใจดี');
    expect(screen.getByPlaceholderText('ชื่อบน Facebook')).toHaveValue('Nan');

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกและผูกกับแชท' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, payload] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers');
    expect(payload).toMatchObject({ name: 'นันทิชา ใจดี', nationalId: VALID_NID, phone: '0812345678', prefix: 'นาย', facebookName: 'Nan' });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'c-new', name: 'นันทิชา ใจดี' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ไม่ผ่าน validation → ไม่ยิง API (เลขบัตร/เบอร์ยังบังคับเหมือนหน้าลูกค้า)', async () => {
    wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} initialValues={{ firstName: 'ก', lastName: 'ข' }} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณากรอกเลขบัตรประชาชน')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('409 ลูกค้าซ้ำ → โชว์ชื่อคนเดิม + ปุ่ม "ใช้ลูกค้าเดิมคนนี้แทน" เรียก onUseExisting แล้วปิด · ไม่เรียก onCreated', async () => {
    // mockRejectedValue สร้าง promise ที่ reject ทันทีตั้งแต่ตั้งค่า → Node นับเป็น unhandled ก่อนถูกเรียก จึงต้อง reject ตอนถูกเรียกเท่านั้น
    apiPost.mockImplementation(() => Promise.reject({ response: { status: 409, data: { message: 'dup', existingCustomer: { id: 'c-old', name: 'สมชาย คนเดิม' } } } }));
    const onCreated = vi.fn();
    const onUseExisting = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <CustomerCreateDialog open onOpenChange={onOpenChange} initialValues={{ firstName: 'สมชาย', lastName: 'ใหม่' }} onCreated={onCreated} onUseExisting={onUseExisting} />,
    );
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('สมชาย คนเดิม');
    fireEvent.click(screen.getByRole('button', { name: /ใช้ลูกค้าเดิมคนนี้แทน/ }));
    expect(onUseExisting).toHaveBeenCalledWith({ id: 'c-old', name: 'สมชาย คนเดิม' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('409 แต่ผู้เรียกไม่รับ onUseExisting → บอกแค่ข้อความ ไม่มีปุ่ม', async () => {
    apiPost.mockImplementation(() => Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย คนเดิม' } } } }));
    wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใหม่' }} onCreated={vi.fn()} />);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /ใช้ลูกค้าเดิมคนนี้แทน/ })).toBeNull();
  });

  it('ปิดแล้วเปิดใหม่ = ฟอร์มเปล่า (state อยู่ในฟอร์มที่ mount เฉพาะตอนเปิด)', () => {
    const { rerender } = wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(mainField('กรอกชื่อ'), { target: { value: 'ค้าง' } });
    expect(mainField('กรอกชื่อ')).toHaveValue('ค้าง');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CustomerCreateDialog open={false} onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CustomerCreateDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(mainField('กรอกชื่อ')).toHaveValue('');
  });
});
