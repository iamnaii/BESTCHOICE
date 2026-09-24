import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
const get = vi.fn(); const patch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), default: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a), post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({
  __esModule: true,
  default: (p: { open: boolean; initialValues?: { firstName?: string }; onCreated?: (customer: { id: string; name: string }) => void }) =>
    (p.open ? (
      <div data-testid="create-dialog">
        {p.initialValues?.firstName}
        <button type="button" onClick={() => p.onCreated?.({ id: 'c-new', name: 'ทดสอบ' })}>ทำให้สร้างลูกค้าสำเร็จ (จำลอง)</button>
      </div>
    ) : null),
}));
vi.mock('../LinkCustomerDialog', () => ({ __esModule: true, default: (p: { open: boolean }) => (p.open ? <div data-testid="link-dialog" /> : null) }));
import { toast } from 'sonner';
import GfinTab from './GfinTab';
import type { FinanceApplicationModel } from '../../hooks/useFinanceApplication';

const room = { id: 'r1', channel: 'FACEBOOK', displayName: 'Somying J.', customer: null } as any;
const model = (over: Partial<FinanceApplicationModel> = {}): FinanceApplicationModel => ({
  roomId: 'r1', current: null, history: [], preview: null, step: 1, loading: false, busy: false,
  start: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue(undefined), attachMessage: vi.fn(), upload: vi.fn(), fromProduct: vi.fn(), removeFile: vi.fn(),
  send: vi.fn().mockResolvedValue({ application: {}, messageText: 'TEXT', shareUrl: 'https://x/api/g/t' }), resend: vi.fn(), shareLink: vi.fn(), extend: vi.fn(), revoke: vi.fn(), result: vi.fn(), cancel: vi.fn(),
  ocrIdCard: vi.fn().mockResolvedValue({ nationalId: '1234567890123', nationalIdValid: true, prefix: 'น.ส.', firstName: 'สมหญิง', lastName: 'ใจดี', fullName: null, birthDate: '1997-12-27', address: null, addressStructured: null, confidence: 0.95 }),
  ...over,
});
const app = (over: Record<string, unknown> = {}) => ({ id: 'a1', number: 'BC-260924-001', status: 'DRAFT', roomId: 'r1', customerId: null, productId: null, customer: null, product: null, occupationOverride: null, messageOverride: null, messageText: null, sentAt: null, sentVia: null, resultSource: null, shareExpiresAt: null, shareRevokedAt: null, shareViewCount: 0, shareLastViewedAt: null, lastPartnerEventAt: null, closedAt: null, files: [], events: [], createdAt: '2026-09-24T12:00:00Z', ...over }) as any;
const renderTab = (gfin: FinanceApplicationModel, customerId: string | null = null) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><GfinTab room={room} customerId={customerId} gfin={gfin} onPickSlotForMessage={vi.fn()} /></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => { get.mockReset(); patch.mockReset(); });

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
    expect(await screen.findByText('อ่านบัตรแล้ว (OCR) · ตรวจทานก่อนสร้าง')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'สร้างลูกค้าและผูกห้อง' }));
    expect(screen.getByTestId('create-dialog')).toHaveTextContent('สมหญิง');
  });
  it('step 1 with a linked customer missing occupation: inline save PATCHes the customer', async () => {
    patch.mockResolvedValue({ data: {} });
    const gfin = model({ current: app({ customerId: 'c1', customer: { id: 'c1', name: 'สมหญิง ใจดี', phone: '0937581095', occupation: null, birthDate: '1997-12-27' } }), preview: { text: '', values: {}, missingFields: ['occupation'], missingRequiredSlots: [], warnings: [], canSend: false }, step: 1 });
    renderTab(gfin, 'c1');
    fireEvent.change(screen.getByLabelText('อาชีพ'), { target: { value: 'พนักงานบริษัท' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกอาชีพ' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/customers/c1', { occupation: 'พนักงานบริษัท' }));
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
    expect(screen.getByRole('button', { name: 'ผ่าน (แจ้งผ่านลิงก์)' })).toBeInTheDocument();
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
