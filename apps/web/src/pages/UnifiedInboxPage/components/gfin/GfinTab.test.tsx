import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
const get = vi.fn(); const patch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), default: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({
  __esModule: true,
  splitDisplayName: (name: string | null | undefined) => ({ firstName: (name ?? '').split(' ')[0] ?? '', lastName: (name ?? '').split(' ').slice(1).join(' ') }),
  default: (p: { open: boolean; mode?: 'create' | 'fill'; fillCustomerId?: string; initialValues?: { firstName?: string }; onCreated?: (customer: { id: string; name: string }) => void; onFilled?: (customer: { id: string; name: string }) => void }) =>
    (p.open ? (p.mode === 'fill' ? (
      <div data-testid="fill-dialog" data-fill-id={p.fillCustomerId}>
        {p.initialValues?.firstName}
        <button type="button" onClick={() => p.onFilled?.({ id: p.fillCustomerId!, name: 'สมหญิง ใจดี' })}>ทำให้เติมข้อมูลสำเร็จ (จำลอง)</button>
      </div>
    ) : (
      <div data-testid="create-dialog">
        {p.initialValues?.firstName}
        <button type="button" onClick={() => p.onCreated?.({ id: 'c-new', name: 'ทดสอบ' })}>ทำให้สร้างลูกค้าสำเร็จ (จำลอง)</button>
      </div>
    )) : null),
}));
const authRole = { role: 'SALES' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1', role: authRole.role } }) }));
vi.mock('../LinkCustomerDialog', () => ({ __esModule: true, default: (p: { open: boolean }) => (p.open ? <div data-testid="link-dialog" /> : null) }));
import { toast } from 'sonner';
import GfinTab from './GfinTab';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';
import type { DossierRoom } from '../RoomDossier';

const room = { id: 'r1', channel: 'FACEBOOK', displayName: 'Somying J.', customer: null } as any;
const placeholderRoom: DossierRoom = { ...room, customer: { id: 'p-1', name: 'Somying J.', phone: null, chatPlaceholder: true } };
const model = (over: Partial<FinanceApplicationModel> = {}): FinanceApplicationModel => ({
  roomId: 'r1', current: null, history: [], preview: null, step: 1, loading: false, busy: false,
  start: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue(undefined), attachMessage: vi.fn(), upload: vi.fn(), fromProduct: vi.fn(), removeFile: vi.fn(),
  customerFields: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue({ application: {}, messageText: 'TEXT', shareUrl: 'https://x/api/g/t' }), resend: vi.fn(), shareLink: vi.fn(), extend: vi.fn().mockResolvedValue({ expiresAt: '', url: '', rotated: false }), revoke: vi.fn().mockResolvedValue(undefined), result: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined),
  ocrIdCard: vi.fn().mockResolvedValue({ nationalId: '1234567890123', nationalIdValid: true, prefix: 'น.ส.', firstName: 'สมหญิง', lastName: 'ใจดี', fullName: null, birthDate: '1997-12-27', address: null, addressStructured: null, confidence: 0.95 }),
  ...over,
});
const app = (over: Record<string, unknown> = {}) => ({ id: 'a1', number: 'BC-260924-001', status: 'DRAFT', roomId: 'r1', customerId: null, productId: null, customer: null, product: null, occupationOverride: null, messageOverride: null, messageText: null, sentAt: null, sentVia: null, resultSource: null, shareExpiresAt: null, shareRevokedAt: null, shareViewCount: 0, shareLastViewedAt: null, lastPartnerEventAt: null, closedAt: null, files: [], events: [], createdAt: '2026-09-24T12:00:00Z', ...over }) as any;
const renderTab = (gfin: FinanceApplicationModel, customerId: string | null = null, theRoom: DossierRoom = room) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><GfinTab room={theRoom} customerId={customerId} gfin={gfin} onPickSlotForMessage={vi.fn()} /></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => { get.mockReset(); patch.mockReset(); authRole.role = 'SALES'; vi.mocked(toast.error).mockClear(); vi.mocked(toast.success).mockClear(); });

describe('GfinTab', () => {
  it('empty state offers "เริ่มใบยื่น" and starts a draft', async () => {
    const gfin = model();
    renderTab(gfin);
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใบยื่น' }));
    await waitFor(() => expect(gfin.start).toHaveBeenCalled());
  });
  it('step 1 without a linked customer: reading an ID-card image pre-fills the create dialog', async () => {
    const gfin = model({ current: app({ files: [{ id: 'f1', slot: 'ID_CARD', sourceMessageId: 'm1', mimeType: 'image/jpeg', size: 1, originalName: null, source: 'CHAT_MESSAGE', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '' }] }), step: 1 });
    renderTab(gfin);
    fireEvent.click(screen.getByRole('button', { name: 'อ่านบัตรจากรูปที่หยิบไว้' }));
    await waitFor(() => expect(gfin.ocrIdCard).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('อ่านบัตรแล้ว (OCR) · ตรวจทานก่อนบันทึก')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' }));
    expect(screen.getByTestId('create-dialog')).toHaveTextContent('สมหญิง');
  });
  // final review C1 — SALES/ผจก.การเงินเรียก PATCH /customers ไม่ได้ (403): อาชีพ → occupationOverride ของใบ · เบอร์/วันเกิด → customer-fields
  it('step 1 with a linked customer missing occupation: inline save stores occupationOverride on the application (no PATCH /customers)', async () => {
    const gfin = model({ current: app({ customerId: 'c1', customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: null, birthDate: '1997-12-27' } }), preview: { text: '', values: {}, missingFields: ['occupation'], missingRequiredSlots: [], warnings: [], canSend: false }, step: 1 });
    renderTab(gfin, 'c1');
    fireEvent.change(screen.getByLabelText('อาชีพ'), { target: { value: 'พนักงานบริษัท' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกอาชีพ' }));
    await waitFor(() => expect(gfin.update).toHaveBeenCalledWith({ occupationOverride: 'พนักงานบริษัท' }));
    expect(patch).not.toHaveBeenCalled();
  });
  it('step 1 missing phone / birth date: inline saves go through gfin.customerFields (feature-scoped endpoint)', async () => {
    const gfin = model({ current: app({ customerId: 'c1', customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: null, occupation: 'ค้าขาย', birthDate: null } }), preview: { text: '', values: {}, missingFields: ['phone', 'age'], missingRequiredSlots: [], warnings: [], canSend: false }, step: 1 });
    renderTab(gfin, 'c1');
    fireEvent.change(screen.getByLabelText('เบอร์โทร'), { target: { value: '081234567' } });
    expect(screen.getByRole('button', { name: 'บันทึกเบอร์' })).toBeDisabled(); // 9 หลักไม่ผ่าน — API รับ 10 หลักเท่านั้น
    fireEvent.change(screen.getByLabelText('เบอร์โทร'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกเบอร์' }));
    await waitFor(() => expect(gfin.customerFields).toHaveBeenCalledWith({ phone: '0812345678' }));
    fireEvent.change(screen.getByLabelText('วันเกิด'), { target: { value: '1997-12-27' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกวันเกิด' }));
    await waitFor(() => expect(gfin.customerFields).toHaveBeenCalledWith({ birthDate: '1997-12-27' }));
    expect(patch).not.toHaveBeenCalled();
  });
  it('a room holding a chat placeholder counts as not linked: offers "เพิ่มเบอร์/ข้อมูลลูกค้า" (fill the same person) instead of inline fields', async () => {
    // ใบร่างเก่าที่เคยคัดลอก placeholder มาเป็นลูกค้า — ต้องไม่ถือเป็นลูกค้าจริง
    const gfin = model({ current: app({ customerId: 'p-1', customer: { id: 'p-1', name: 'Somying J.', phone: null, occupation: null, birthDate: null } }), preview: { text: '', values: {}, missingFields: ['phone'], missingRequiredSlots: [], warnings: [], canSend: false }, step: 1 });
    renderTab(gfin, 'p-1', placeholderRoom);
    expect(screen.queryByLabelText('เบอร์โทร')).toBeNull();
    expect(screen.queryByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มเบอร์/ข้อมูลลูกค้า (คนเดิมจากแชท)' }));
    const dialog = screen.getByTestId('fill-dialog');
    expect(dialog).toHaveAttribute('data-fill-id', 'p-1');
    expect(dialog).toHaveTextContent('Somying');
    fireEvent.click(screen.getByRole('button', { name: 'ทำให้เติมข้อมูลสำเร็จ (จำลอง)' }));
    await waitFor(() => expect(gfin.update).toHaveBeenCalledWith({ customerId: 'p-1' }));
  });
  it('a room already linked to a real customer while the draft is empty: offers to use that customer (no duplicate create)', async () => {
    const realRoom: DossierRoom = { ...room, customer: { id: 'c9', name: 'สมชาย ใจดี', phone: '0811111111', chatPlaceholder: false } };
    const gfin = model({ current: app({}), step: 1 });
    renderTab(gfin, 'c9', realRoom);
    expect(screen.queryByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ลูกค้าของห้องนี้ (สมชาย ใจดี)' }));
    await waitFor(() => expect(gfin.update).toHaveBeenCalledWith({ customerId: 'c9' }));
  });
  it('FINANCE_MANAGER cannot POST /customers — the create button is disabled with a hint (link to an existing customer still works)', () => {
    authRole.role = 'FINANCE_MANAGER';
    renderTab(model({ current: app({}), step: 1 }));
    expect(screen.getByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ผูกกับลูกค้าเดิม (ค้นหาจากเลขบัตร/เบอร์)' })).toBeEnabled();
  });
  it('step 4 copy flow: confirm dialog → send(COPY) → text copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const gfin = model({ current: app({ customerId: 'c1', productId: 'p1', product: { id: 'p1', name: 'iPhone 13 Pro Max', brand: 'Apple', model: '13 Pro Max', storage: '256GB', color: 'ทอง', imeiSerial: '355908667841899', category: 'PHONE_USED', status: 'IN_STOCK' }, customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: 'พนักงาน', birthDate: '1997-12-27' } }), preview: { text: '1.ชื่อลูกค้า : สมหญิง ใจดี', values: {}, missingFields: [], missingRequiredSlots: [], warnings: ['ยังไม่มีรูปหน้าจอตั้งค่าเครื่อง'], canSend: true }, step: 4 });
    renderTab(gfin, 'c1');
    expect(screen.getByText('1.ชื่อลูกค้า : สมหญิง ใจดี')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ส่งเช็ค GFIN' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกข้อความ + ลิงก์' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /ตรวจแล้วว่าไฟล์ทุกใบเป็นของลูกค้าคนนี้/ }));
    fireEvent.click(screen.getByRole('button', { name: 'คัดลอกและทำเครื่องหมายว่าส่งแล้ว' }));
    await waitFor(() => expect(gfin.send).toHaveBeenCalledWith('COPY'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('TEXT'));
  });
  it('status card after MORE_INFO shows the partner note, resend, and staff result buttons', () => {
    const gfin = model({ current: app({ status: 'MORE_INFO', customerId: 'c1', productId: 'p1', sentAt: '2026-09-24T12:04:00Z', shareExpiresAt: '2026-10-01T12:04:00Z', shareViewCount: 2, lastPartnerEventAt: '2026-09-24T12:14:00Z', events: [{ id: 'e1', kind: 'SENT', actorType: 'STAFF', actorUserId: 'u', actorName: null, note: null, meta: null, createdAt: '2026-09-24T12:04:00Z' }, { id: 'e2', kind: 'PARTNER_MORE_INFO', actorType: 'PARTNER', actorUserId: null, actorName: null, note: 'ขอรูปหน้าจอแบตเพิ่มค่ะ', meta: null, createdAt: '2026-09-24T12:14:00Z' }] }), step: 4 });
    renderTab(gfin, 'c1');
    expect(screen.getByText('GFIN ขอเพิ่ม')).toBeInTheDocument();
    // ข้อความขอเพิ่มโผล่สองที่โดยตั้งใจ: ไทม์ไลน์ (ประวัติ) + แบนเนอร์ "ขั้นต่อไป" (เด่นให้กดต่อ) — getAllByText แทน getByText
    expect(screen.getAllByText(/ขอรูปหน้าจอแบตเพิ่มค่ะ/).length).toBeGreaterThan(0);
    expect(screen.getByText(/เปิดดู 2 ครั้ง/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เพิ่มรูปแล้วส่งเพิ่ม' })).toBeInTheDocument();
    // minor 1 — ปุ่มของร้าน = บันทึกผลที่ได้ในไลน์ ไม่ใช่ "แจ้งผ่านลิงก์"
    expect(screen.getByRole('button', { name: 'ผ่าน' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ไม่ผ่าน' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ขอเพิ่ม' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /แจ้งผ่านลิงก์/ })).toBeNull();
  });
  it('badge says "(แจ้งผ่านลิงก์)" only when GFIN answered on the link page — a staff-recorded result does not', () => {
    const closed = (resultSource: 'PARTNER_LINK' | 'STAFF') => app({ status: 'APPROVED', resultSource, customerId: 'c1', productId: 'p1', sentAt: '2026-09-24T12:04:00Z', shareExpiresAt: '2026-10-01T12:04:00Z', closedAt: '2026-09-24T13:00:00Z' });
    const { unmount } = renderTab(model({ current: closed('PARTNER_LINK'), step: 4 }), 'c1');
    expect(screen.getByText('ผ่าน (แจ้งผ่านลิงก์)')).toBeInTheDocument();
    unmount();
    renderTab(model({ current: closed('STAFF'), step: 4 }), 'c1');
    expect(screen.queryByText('ผ่าน (แจ้งผ่านลิงก์)')).toBeNull();
  });
  it('I1: a closed application renders the status card with "เมื่อผ่านแล้ว" and "เริ่มใบยื่นใหม่" (not the empty "ใบยื่นใหม่" state)', async () => {
    const gfin = model({ current: app({ status: 'APPROVED', resultSource: 'PARTNER_LINK', customerId: 'c1', productId: 'p1', sentAt: '2026-09-24T12:04:00Z', closedAt: '2026-09-24T13:00:00Z' }), step: 4 });
    renderTab(gfin, 'c1');
    expect(screen.queryByText('ใบยื่นใหม่')).toBeNull();
    expect(screen.getByText('เมื่อผ่านแล้ว ขั้นต่อไป')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มใบยื่นใหม่' }));
    await waitFor(() => expect(gfin.start).toHaveBeenCalled());
  });
  it('minor 2: resend whose clipboard write fails → error toast pointing at "คัดลอกข้อความอีกครั้ง", which then copies the resend text', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const gfin = model({
      current: app({ status: 'MORE_INFO', customerId: 'c1', productId: 'p1', messageText: 'ORIGINAL', sentAt: '2026-09-24T12:04:00Z', shareExpiresAt: '2026-10-01T12:04:00Z', files: [{ id: 'f9', slot: 'DEVICE_SCREEN', sourceMessageId: null, mimeType: 'image/jpeg', size: 1, originalName: 'screen.jpg', source: 'UPLOAD', sourceAngle: null, sortOrder: 0, sentAt: null, createdAt: '' }] }),
      resend: vi.fn().mockResolvedValue({ application: {}, messageText: 'RESEND TEXT', shareUrl: 'https://x/api/g/t', rotated: false }),
      step: 4,
    });
    renderTab(gfin, 'c1');
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มรูปแล้วส่งเพิ่ม' }));
    fireEvent.click(screen.getByRole('button', { name: 'ส่งเพิ่ม (1 ไฟล์ใหม่)' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('คัดลอกข้อความอีกครั้ง')));
    fireEvent.click(screen.getByRole('button', { name: /คัดลอกข้อความอีกครั้ง/ }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('RESEND TEXT'));
  });
  it('I2 + minor 7: a revoked link offers "ออกลิงก์ใหม่"; "เปิดหน้าลิงก์" opens the staff view (?src=staff)', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const gfin = model({
      current: app({ status: 'SENT', customerId: 'c1', productId: 'p1', messageText: 'TEXT', sentAt: '2026-09-24T12:04:00Z', shareExpiresAt: '2099-10-01T12:04:00Z' }),
      shareLink: vi.fn().mockResolvedValue({ url: 'https://x/api/g/tok', expiresAt: null, revokedAt: null }),
      step: 4,
    });
    const { unmount } = renderTab(gfin, 'c1');
    fireEvent.click(screen.getByRole('button', { name: 'เปิดหน้าลิงก์' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://x/api/g/tok?src=staff', '_blank', 'noopener,noreferrer'));
    expect(screen.getByRole('button', { name: 'ต่ออายุ' })).toBeInTheDocument();
    unmount();
    const revoked = model({ current: app({ status: 'SENT', customerId: 'c1', productId: 'p1', messageText: 'TEXT', sentAt: '2026-09-24T12:04:00Z', shareExpiresAt: '2099-10-01T12:04:00Z', shareRevokedAt: '2026-09-24T12:30:00Z' }), step: 4 });
    renderTab(revoked, 'c1');
    fireEvent.click(screen.getByRole('button', { name: 'ออกลิงก์ใหม่' }));
    await waitFor(() => expect(revoked.extend).toHaveBeenCalled());
    open.mockRestore();
  });
  it('minor 3: "แก้ข้อความ" starts from the current preview text without the system link line', () => {
    const gfin = model({ current: app({ customerId: 'c1', productId: 'p1' }), preview: { text: '1.ชื่อลูกค้า : สมหญิง ใจดี\nส่งโดย ป๊อป · BESTCHOICE\nเอกสารทั้งหมด 3 ไฟล์: {{link}}', values: {}, missingFields: [], missingRequiredSlots: [], warnings: [], canSend: true }, step: 4 });
    renderTab(gfin, 'c1');
    fireEvent.click(screen.getByRole('button', { name: 'แก้ข้อความ' }));
    expect(screen.getByLabelText('ข้อความ 12 ข้อ')).toHaveValue('1.ชื่อลูกค้า : สมหญิง ใจดี\nส่งโดย ป๊อป · BESTCHOICE');
  });
  it('customer created but room-link PATCH fails: shows a retry toast instead of failing silently', async () => {
    patch.mockRejectedValue(new Error('network down'));
    const gfin = model({ current: app({}), step: 1 });
    renderTab(gfin);
    fireEvent.click(screen.getByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' }));
    fireEvent.click(screen.getByRole('button', { name: 'ทำให้สร้างลูกค้าสำเร็จ (จำลอง)' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/staff-chat/rooms/r1/customer', { customerId: 'c-new' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'สร้างลูกค้าแล้ว แต่ผูกกับแชทไม่สำเร็จ',
      expect.objectContaining({ action: expect.objectContaining({ label: 'ลองผูกอีกครั้ง' }) }),
    ));
  });
});
