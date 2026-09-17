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
import { customerSchema, prospectFillSchema } from '@/lib/schemas';

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
/** โหมด fill: ช่องบังคับมีแค่เบอร์ — คำนำหน้า/เลขบัตร/นามสกุลว่างได้ (M-W4) */
const fillProspectRequired = () => {
  fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
};
/** ป้ายของช่อง (FormLabel) ตามลำดับใน DOM — ใช้ตรวจลำดับช่องตาม mockup */
const formLabels = () => Array.from(document.querySelectorAll('[data-slot="form-label"]')).map((l) => (l.textContent ?? '').trim());
/** ข้อความ error ใต้ช่อง (FormMessage ตั้ง id เป็น `<name>-error`) */
const fieldError = (name: string) => document.getElementById(`${name}-error`);
const FILL_NOTE = 'ชื่อเติมให้จากห้องแชทแล้ว แก้ได้ · บันทึกแล้วผู้สนใจคนนี้จะเช็คเครดิตและทำสัญญาได้ทันที';
const DUP_PHONE_FIELD_ERROR = 'เบอร์นี้มีลูกค้าใช้อยู่แล้ว';
/**
 * 3 ก.ย. 2569 เวลา 11:30 UTC — `formatThaiDateShort` อ่านวันตาม timezone ของเครื่อง
 * เวลาท้องถิ่น = 11:30 + offset ⇒ ยังเป็นวันที่ 3 เมื่อ offset อยู่ในช่วง [−11:30, +12:30)
 * = ทุก timezone ตั้งแต่ UTC−11 ถึง UTC+12 (ไม่ครอบ UTC−12, +12:45, +13, +14 — ช่วงกว้างสุดที่
 * instant เดียวทำได้คือ 24 ชม.) · เดิม 05:00Z เลื่อนเป็นวันที่ 2 ตั้งแต่ UTC−6 ไปทางตะวันตก
 * ตรวจแล้ว: TZ=Pacific/Pago_Pago (−11) · America/Regina (−6) · UTC · Asia/Bangkok · Pacific/Auckland (+12 ในเดือนกันยายน)
 */
const CREATED_AT = '2026-09-03T11:30:00.000Z';
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

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

  // M-W4 เปลี่ยนเฉพาะโหมด fill — โหมดสร้างยังบังคับคำนำหน้าเหมือนเดิม
  it('โหมดสร้าง: ไม่เลือกคำนำหน้า → "กรุณาเลือกคำนำหน้า" และไม่ยิง API', async () => {
    wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} initialValues={{ firstName: 'ก', lastName: 'ข' }} onCreated={vi.fn()} />);
    fireEvent.change(mainField('X-XXXX-XXXXX-XX-X'), { target: { value: VALID_NID } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('กรุณาเลือกคำนำหน้า')).toBeInTheDocument();
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

  // B6: โหมด fill เรียงช่องใหม่ตาม mockup — โหมดสร้างต้องคงลำดับ/ดอกจันเดิมทุกช่อง
  it('โหมดสร้าง: ลำดับช่องข้อมูลหลักคงเดิม · นามสกุลยังบังคับ (มีดอกจัน)', () => {
    wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(formLabels().slice(0, 7)).toEqual([
      'คำนำหน้า',
      'ชื่อ *',
      'นามสกุล *',
      'เลขบัตรประชาชน (13 หลัก) *',
      'เบอร์โทร *',
      'ชื่อเล่น',
      'วันเกิด',
    ]);
    expect(screen.queryByText(FILL_NOTE)).toBeNull();
  });

  // B7 ทำเฉพาะโหมด fill (mockup บอร์ด 4) — กล่อง 409 ของโหมดสร้างต้องไม่เปลี่ยน แม้ API ส่งคีย์ใหม่มา
  it('โหมดสร้าง: 409 ที่มี createdAt/activeContracts → กล่องเหมือนเดิม ไม่มีชิปคนเดิม · ไม่ขึ้น error ใต้ช่องเบอร์', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย คนเดิม', createdAt: CREATED_AT, activeContracts: 1 }, field: 'phone' } } }),
    );
    wrap(<CustomerCreateDialog open onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใหม่' }} onCreated={vi.fn()} />);
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('มีลูกค้าเบอร์นี้หรืออีเมลนี้อยู่แล้ว: สมชาย คนเดิม');
    expect(alert).not.toHaveTextContent('ลูกค้าตั้งแต่');
    expect(alert).not.toHaveTextContent('ผ่อนอยู่');
    expect(fieldError('phone')).toBeNull();
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

  // M-W4: ป้าย "คำนำหน้า" ไม่มีดอกจัน (mockup บอร์ด 3) และ fill-contact รับ prefix แบบ optional ⇒ ไม่บังคับ
  it('ไม่เลือกคำนำหน้า → บันทึกผ่าน ไม่ขึ้น "กรุณาเลือกคำนำหน้า" · payload ไม่มีคีย์ prefix', async () => {
    apiPost.mockResolvedValue({ data: { id: 'p1', name: 'สมชาย ใจดี', phone: '0812345678' } });
    const onFilled = vi.fn();
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} onFilled={onFilled} />);
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('');
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('กรุณาเลือกคำนำหน้า')).toBeNull();
    const [url, payload] = apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/customers/p1/fill-contact');
    expect(payload).toEqual({ phone: '0812345678', name: 'สมชาย ใจดี' });
    expect(payload).not.toHaveProperty('prefix');
    await waitFor(() => expect(onFilled).toHaveBeenCalled());
  });

  it('สคีมาโหมด fill: ไม่ส่งคำนำหน้ามาเลย → ผ่านและได้สตริงว่าง · สคีมาโหมดสร้างยังปฏิเสธ', () => {
    const input = { firstName: 'Nan', nationalId: '', isForeigner: false, phone: '0812345678' };
    const parsed = prospectFillSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.prefix).toBe('');
    expect(customerSchema.safeParse({ ...input, lastName: 'ใจดี', nationalId: VALID_NID }).success).toBe(false);
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

  // R44: เลขบัตรซ้ำต้องไม่ถูกเล่าเป็นเบอร์ซ้ำ — ปุ่ม "แก้เบอร์" เป็นประตูตันสำหรับเคสนี้
  it('เลขบัตรซ้ำ (409 field=nationalId) → alert พูดถึงเลขบัตร + ปุ่ม "แก้เลขบัตร" · ไม่มีปุ่ม "แก้เบอร์" · ยังรวมกับคนเดิมได้', async () => {
    apiPost.mockRejectedValue({ response: { status: 409, data: { message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว', existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี' }, field: 'nationalId' } } });
    const onUseExisting = vi.fn();
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} onUseExisting={onUseExisting} />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'นาย' } });
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345678' } });
    fireEvent.change(mainField('X-XXXX-XXXXX-XX-X'), { target: { value: VALID_NID } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`เลขบัตรประชาชน ${VALID_NID} เป็นของลูกค้าเดิมอยู่แล้ว`);
    expect(alert).toHaveTextContent('ระบบไม่สร้างซ้ำ — รวมแชทห้องนี้และผลเช็คเครดิตเข้าคนเดิม หรือแก้เลขบัตรแล้วบันทึกใหม่');
    expect(alert).toHaveTextContent(`· เลขบัตร ${VALID_NID}`);
    expect(alert).not.toHaveTextContent('เบอร์ 0812345678 เป็นของลูกค้าเดิมอยู่แล้ว');
    expect(screen.getByRole('button', { name: 'แก้เลขบัตร' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แก้เบอร์' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'รวมกับลูกค้าเดิมคนนี้' }));
    expect(onUseExisting).toHaveBeenCalledWith({ id: 'c-old', name: 'สมชาย ใจดี' });
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

  // B5: mockup บอร์ด 3 ไม่มีดอกจันที่นามสกุล — ใช้ป้าย "ไม่บังคับ" แบบเดียวกับเลขบัตร
  // B6: ลำดับ คำนำหน้า·ชื่อ·นามสกุล → เบอร์·ชื่อเล่น → เลขบัตร → ชื่อ Facebook → โน้ตท้ายฟอร์ม
  it('ลำดับช่องตาม mockup บอร์ด 3 · นามสกุลเป็น "ไม่บังคับ" · โน้ตอยู่ท้ายฟอร์มหลังชื่อ Facebook · ปุ่มอ่านบัตรอยู่บนสุด', () => {
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    expect(formLabels()).toEqual([
      'คำนำหน้า',
      'ชื่อ *',
      'นามสกุล ไม่บังคับ',
      'เบอร์โทร *',
      'ชื่อเล่น',
      'เลขบัตรประชาชน (13 หลัก) ไม่บังคับ — เติมตอนทำสัญญาก็ได้',
      'ชื่อ Facebook',
    ]);
    const note = screen.getByText(FILL_NOTE);
    expect(follows(screen.getByPlaceholderText('ชื่อบน Facebook'), note)).toBe(true);
    expect(follows(note, screen.getByRole('button', { name: 'บันทึก' }))).toBe(true);
    expect(follows(screen.getByRole('button', { name: /อ่านบัตร Smart Card/ }), mainField('กรอกชื่อ'))).toBe(true);
  });

  it('สคีมาโหมด fill: ไม่ส่งนามสกุลมาเลย → ได้สตริงว่าง (ชนิด output ตรงกับฟอร์ม)', () => {
    const parsed = prospectFillSchema.safeParse({ prefix: 'นาย', firstName: 'Nan', nationalId: '', isForeigner: false, phone: '0812345678' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.lastName).toBe('');
  });

  // B7 (mockup บอร์ด 4): ชิปคนเดิมบอก "ลูกค้าตั้งแต่" + "ผ่อนอยู่ N สัญญา" · error ใต้ช่องเบอร์
  it('เบอร์ซ้ำ คนเดิมซื้อแล้ว (purchased) → ชิป "โทร · ลูกค้าตั้งแต่ 3 ก.ย. 69" + "ผ่อนอยู่ 1 สัญญา" + error ใต้ช่องเบอร์ · กด "แก้เบอร์" แล้ว error หาย', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: CREATED_AT, activeContracts: 1, purchased: true }, field: 'phone' } } }),
    );
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} onUseExisting={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('สมชาย ใจดี · โทร 0812345678 · ลูกค้าตั้งแต่ 3 ก.ย. 69');
    expect(alert).toHaveTextContent('ผ่อนอยู่ 1 สัญญา');
    expect(fieldError('phone')).toHaveTextContent(DUP_PHONE_FIELD_ERROR);
    fireEvent.click(screen.getByRole('button', { name: 'แก้เบอร์' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fieldError('phone')).toBeNull();
    // RHF setFocus โฟกัสใน setTimeout
    await waitFor(() => expect(mainField('0XX-XXX-XXXX')).toHaveFocus());
  });

  // M-W3: นิยามเจ้าของ — ลูกค้า = ซื้อแล้ว ที่เหลือ = ผู้สนใจ (ธง purchased จาก API — เว็บไม่เดาเอง)
  it('เบอร์ซ้ำ คนเดิมยังไม่เคยซื้อ (purchased: false) → ชิปบอก "ผู้สนใจตั้งแต่" ไม่ใช่ "ลูกค้าตั้งแต่"', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: CREATED_AT, activeContracts: 0, purchased: false }, field: 'phone' } } }),
    );
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('สมชาย ใจดี · โทร 0812345678 · ผู้สนใจตั้งแต่ 3 ก.ย. 69');
    expect(alert).not.toHaveTextContent('ลูกค้าตั้งแต่');
    expect(alert).not.toHaveTextContent('ผ่อนอยู่');
  });

  it('API ส่ง createdAt แต่ไม่บอก purchased → ไม่เดาว่าเป็นลูกค้าหรือผู้สนใจ ตัดส่วนวันที่ทิ้ง (ชิปผ่อนอยู่ยังแสดง)', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: CREATED_AT, activeContracts: 1 }, field: 'phone' } } }),
    );
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('สมชาย ใจดี · โทร 0812345678ผ่อนอยู่ 1 สัญญา');
    expect(alert).not.toHaveTextContent('ตั้งแต่');
    expect(alert).not.toHaveTextContent('3 ก.ย. 69');
  });

  it('error ใต้ช่องเบอร์หายเมื่อแก้ค่าในช่อง (ไม่ต้องกด "แก้เบอร์")', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: CREATED_AT, activeContracts: 1 }, field: 'phone' } } }),
    );
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByRole('alert');
    expect(fieldError('phone')).toHaveTextContent(DUP_PHONE_FIELD_ERROR);
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0812345679' } });
    await waitFor(() => expect(fieldError('phone')).toBeNull());
  });

  it('409 จาก API เก่า (ไม่มี createdAt/activeContracts) → ชิปมีแค่ชื่อ · โทร ไม่มี "ลูกค้าตั้งแต่"/"ผ่อนอยู่" และไม่พัง', async () => {
    apiPost.mockImplementation(() => Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี' } } } }));
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('สมชาย ใจดี · โทร 0812345678');
    expect(alert).not.toHaveTextContent('ลูกค้าตั้งแต่');
    expect(alert).not.toHaveTextContent('ผ่อนอยู่');
    expect(alert).not.toHaveTextContent('Invalid');
    // body ไม่บอก field = เบอร์ (พฤติกรรมเดิม R44) ⇒ ยังชี้ช่องเบอร์
    expect(fieldError('phone')).toHaveTextContent(DUP_PHONE_FIELD_ERROR);
  });

  it('createdAt อ่านไม่ได้ + activeContracts 0 → ตัดส่วนวันที่ทิ้ง (ไม่โชว์ "-") และไม่มีชิปผ่อนอยู่', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: 'not-a-date', activeContracts: 0, purchased: true }, field: 'phone' } } }),
    );
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('ตั้งแต่');
    expect(alert).not.toHaveTextContent('ผ่อนอยู่');
    expect(alert).not.toHaveTextContent(' · -');
  });

  it('เลขบัตรซ้ำที่มีคีย์ใหม่ → ชิป "เลขบัตร · ลูกค้าตั้งแต่" + "ผ่อนอยู่ 2 สัญญา" · ไม่ขึ้น error ใต้ช่องเบอร์', async () => {
    apiPost.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: CREATED_AT, activeContracts: 2, purchased: true }, field: 'nationalId' } } }),
    );
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.change(mainField('X-XXXX-XXXXX-XX-X'), { target: { value: VALID_NID } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`สมชาย ใจดี · เลขบัตร ${VALID_NID} · ลูกค้าตั้งแต่ 3 ก.ย. 69`);
    expect(alert).toHaveTextContent('ผ่อนอยู่ 2 สัญญา');
    expect(alert).not.toHaveTextContent('· โทร');
    expect(fieldError('phone')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'แก้เลขบัตร' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(mainField('X-XXXX-XXXXX-XX-X')).toHaveFocus());
  });

  it('พิมพ์เบอร์ใหม่ทับระหว่างรอผล → ไม่ติด error "เบอร์นี้มีลูกค้าใช้อยู่แล้ว" ให้เบอร์ใหม่ที่ยังไม่ได้ตรวจ', async () => {
    let rejectFn: ((reason?: unknown) => void) | undefined;
    apiPost.mockImplementation(() => new Promise((_resolve, reject) => { rejectFn = reject; }));
    wrap(<CustomerCreateDialog open mode="fill" fillCustomerId="p1" onOpenChange={vi.fn()} initialValues={{ firstName: 'สมชาย', lastName: 'ใจดี' }} onCreated={vi.fn()} />);
    fillProspectRequired();
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    fireEvent.change(mainField('0XX-XXX-XXXX'), { target: { value: '0899999999' } });
    rejectFn!({ response: { status: 409, data: { existingCustomer: { id: 'c-old', name: 'สมชาย ใจดี', createdAt: CREATED_AT, activeContracts: 1 }, field: 'phone' } } });
    await screen.findByRole('alert');
    expect(fieldError('phone')).toBeNull();
  });
});
