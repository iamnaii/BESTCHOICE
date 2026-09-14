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
    // โหมดสร้าง (ค่าเริ่มต้น) ต้องเห็นครบทุก section — ตรงข้ามกับโหมด fill ที่ซ่อนสี่ section นี้ตาม mockup
    expect(screen.getByText('บุคคลอ้างอิง')).toBeInTheDocument();
    expect(screen.getByText('ที่อยู่')).toBeInTheDocument();
    expect(screen.getByText('ข้อมูลที่ทำงาน')).toBeInTheDocument();
    expect(screen.getByText('ข้อมูลติดต่อเพิ่มเติม')).toBeInTheDocument();

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

describe('CustomerCreateDialog mode="fill" (เพิ่มเบอร์/ข้อมูลผู้สนใจ)', () => {
  beforeEach(() => { apiPost.mockReset(); });

  it('หัวเป็น "เพิ่มเบอร์/ข้อมูลผู้สนใจ" · เลขบัตรไม่บังคับ · บันทึกแล้ว POST /customers/:id/fill-contact โดยไม่ส่ง nationalId ว่าง · เรียก onFilled แล้วปิด', async () => {
    apiPost.mockResolvedValue({ data: { id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' } });
    const onFilled = vi.fn();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    wrap(
      <CustomerCreateDialog
        open
        mode="fill"
        fillCustomerId="p1"
        onOpenChange={onOpenChange}
        initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี', facebookName: 'สมชาย ใจดี' }}
        submitLabel="บันทึก"
        onCreated={onCreated}
        onFilled={onFilled}
      />,
    );
    expect(screen.getByRole('heading', { name: 'เพิ่มเบอร์/ข้อมูลผู้สนใจ' })).toBeInTheDocument();
    expect(screen.getByText(/ไม่บังคับ — เติมตอนทำสัญญาก็ได้/)).toBeInTheDocument();
    expect(screen.getByText('ชื่อเติมให้จากห้องแชทแล้ว แก้ได้ · บันทึกแล้วผู้สนใจคนนี้จะเช็คเครดิตและทำสัญญาได้ทันที')).toBeInTheDocument();
    // ตาม mockup board 3 — section เหล่านี้ต้องไม่โผล่ในโหมด fill (ตรงข้ามกับโหมดสร้างด้านบน)
    expect(screen.queryByText('บุคคลอ้างอิง')).toBeNull();
    expect(screen.queryByText('ที่อยู่')).toBeNull();
    expect(screen.queryByText('ข้อมูลที่ทำงาน')).toBeNull();
    expect(screen.queryByText('ข้อมูลติดต่อเพิ่มเติม')).toBeNull();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, payload] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers/p1/fill-contact');
    expect(payload).toEqual({ phone: '0812345678', name: 'สมชาย ใจดี', prefix: 'นาย', facebookName: 'สมชาย ใจดี' });
    expect(payload).not.toHaveProperty('nationalId');
    await waitFor(() => expect(onFilled).toHaveBeenCalledWith({ id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  // R43: ชื่อในแชทมักเป็นคำเดียว (`splitDisplayName('Nan')` → lastName '') — โหมด fill ต้องไม่บังคับนามสกุล
  // ไม่งั้นปุ่มหลักของการ์ดผู้สนใจกดไม่ผ่านตั้งแต่ครั้งแรก ทั้งที่ DTO ฝั่ง API รับ name แบบ optional
  it('ชื่อคำเดียว (ไม่มีนามสกุล) → บันทึกผ่าน ไม่ขึ้น "กรุณากรอกนามสกุล" · name ที่ส่งไม่มีช่องว่างต่อท้าย', async () => {
    apiPost.mockResolvedValue({ data: { id: 'p1', name: 'Nan', phone: '0812345678' } });
    const onFilled = vi.fn();
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'Nan' }} onCreated={vi.fn()} onFilled={onFilled} />);
    expect(mainField('กรอกนามสกุล')).toHaveValue('');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('กรุณากรอกนามสกุล')).toBeNull();
    const [url, payload] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers/p1/fill-contact');
    expect(payload).toEqual({ phone: '0812345678', name: 'Nan', prefix: 'นาย' });
    await waitFor(() => expect(onFilled).toHaveBeenCalledWith({ id: 'p1', name: 'Nan', phone: '0812345678' }));
  });

  it('เบอร์ซ้ำ (409 existingCustomer) → alert ตาม mockup + ปุ่ม "รวมกับลูกค้าเดิมคนนี้" เรียก onUseExisting แล้วปิด · ปุ่ม "แก้เบอร์" กลับไปแก้ฟอร์ม', async () => {
    apiPost.mockRejectedValue({ response: { status: 409, data: { message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี' } } } });
    const onUseExisting = vi.fn();
    const onOpenChange = vi.fn();
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={onOpenChange} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} onUseExisting={onUseExisting} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('เบอร์ 0812345678 เป็นของลูกค้าเดิมอยู่แล้ว');
    expect(alert).toHaveTextContent('ระบบไม่สร้างซ้ำ — รวมแชทห้องนี้และผลเช็คเครดิตเข้าคนเดิม หรือแก้เบอร์แล้วบันทึกใหม่');
    expect(alert).toHaveTextContent('สมชาย ใจดี');
    fireEvent.click(screen.getByRole('button', { name: 'แก้เบอร์' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'รวมกับลูกค้าเดิมคนนี้' }));
    expect(onUseExisting).toHaveBeenCalledWith({ id: 'c-old', name: 'สมชาย ใจดี' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('alert 409 โชว์เบอร์ที่ส่งไปตอนกดบันทึก ไม่ใช่เบอร์ที่พิมพ์ทับระหว่างรอผล (กัน race — ช่องเบอร์ไม่ถูก disable ระหว่าง pending)', async () => {
    let rejectFn: ((reason?: unknown) => void) | undefined;
    apiPost.mockImplementation(() => new Promise((_resolve, reject) => { rejectFn = reject; }));
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    // พิมพ์เบอร์ใหม่ทับระหว่างรอผลจาก server — ก่อน fix ค่านี้จะไปโผล่ใน alert แทนเบอร์ที่ส่งจริง
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0899999999' } });
    rejectFn!({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี' } } } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('เบอร์ 0812345678 เป็นของลูกค้าเดิมอยู่แล้ว');
    expect(alert).not.toHaveTextContent('0899999999');
  });

});
