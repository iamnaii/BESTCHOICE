import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn(), patch: (...args: unknown[]) => apiPatch(...args) },
}));
// สิทธิ์สร้างลูกค้าอ่านจาก useAuth — ค่าเริ่มต้นเป็นฝ่ายขาย (สร้างได้) เทสสิทธิ์สลับเป็นบัญชี
const authRole = { role: 'SALES' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1', role: authRole.role } }) }));
// ฟอร์มสร้างลูกค้ามีเทสของตัวเอง — ที่นี่เช็คแค่ว่าเปิดเป็น popup (ไม่ navigate) ส่งค่าตั้งต้นถูก และสร้างเสร็จแล้วผูกห้อง
vi.mock('@/components/customer/CustomerCreateDialog', async () => {
  const actual = await vi.importActual<typeof import('@/components/customer/CustomerCreateDialog')>('@/components/customer/CustomerCreateDialog');
  return {
    __esModule: true,
    splitDisplayName: actual.splitDisplayName,
    default: (p: { open: boolean; submitLabel?: string; initialValues?: Record<string, string>; onCreated: (c: { id: string; name: string }) => void; onUseExisting?: (c: { id: string; name: string }) => void }) =>
      p.open ? (
        <div data-testid="create-dialog">
          <span>{JSON.stringify(p.initialValues)}</span>
          <span>{p.submitLabel}</span>
          <button onClick={() => p.onCreated({ id: 'c-new', name: 'ลูกค้าใหม่' })}>จำลองสร้างเสร็จ</button>
          <button onClick={() => p.onUseExisting?.({ id: 'c-old', name: 'คนเดิม' })}>จำลองใช้คนเดิม</button>
        </div>
      ) : null,
  };
});
// บล็อกเดิมของแผงลูกค้าหนักและมีไดอะล็อกเยอะ — ที่นี่ทดสอบโครงแท็บ ไม่ใช่เนื้อในของแผงเดิม
vi.mock('./Customer360Panel', () => ({ __esModule: true, default: (p: { sections?: string[] }) => <div data-testid="c360">{(p.sections ?? []).join(',')}</div> }));
vi.mock('./ProductContextCard', () => ({ __esModule: true, default: () => <div data-testid="product-card" /> }));
vi.mock('@/pages/TodosPage/components/TodoForm', () => ({ __esModule: true, TodoForm: (p: { open: boolean; defaults?: { roomId?: string; title?: string } }) => (p.open ? <div data-testid="todo-form">{p.defaults?.roomId}|{p.defaults?.title}</div> : null) }));

import RoomDossier from './RoomDossier';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ROOM = {
  id: 'r-1',
  channel: 'FACEBOOK',
  displayName: 'สมชาย ก.',
  pictureUrl: null,
  createdAt: '2026-03-12T07:15:00Z',
  lastMessageAt: '2026-09-05T09:00:00Z',
  totalMessages: 34,
  customer: null,
  attribution: {
    firstTouch: '2026-09-05T06:49:00Z',
    lastTouch: '2026-09-05T06:49:00Z',
    campaign: { campaignId: '120246504706250534', campaignName: 'ฝนตกไม่อยากออกจากบ้าน', adName: 'ฝนตกไม่อยากออกจากบ้าน', adPhotoUrl: null },
  },
};

describe('RoomDossier — แผงขวา 3 แท็บ (โครง OBI)', () => {
  it('keeps credit as the second group after customer information', () => {
    wrap(<RoomDossier room={ROOM} customerId={null} activeRoomId="r-1" />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(headings.slice(0, 3)).toEqual(['ข้อมูลลูกค้า', 'ตรวจเครดิต', 'มาจากโฆษณา']);
  });
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: [] });
    apiPatch.mockReset();
    apiPatch.mockResolvedValue({ data: {} });
    authRole.role = 'SALES';
  });

  it('สร้างลูกค้าใหม่: เปิดเป็น popup ในห้อง (ไม่ navigate) · เติมชื่อ/นามสกุลจากชื่อห้อง + ชื่อ Facebook เมื่อเป็นห้อง Facebook · ป้ายปุ่ม "บันทึกและผูกกับแชท"', () => {
    wrap(<RoomDossier room={ROOM} customerId={null} activeRoomId="r-1" />);
    expect(screen.queryByTestId('create-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /สร้างลูกค้าใหม่/ }));
    const dlg = screen.getByTestId('create-dialog');
    expect(dlg).toHaveTextContent('บันทึกและผูกกับแชท');
    expect(JSON.parse(dlg.querySelector('span')!.textContent!)).toEqual({ firstName: 'สมชาย', lastName: 'ก.', facebookName: 'สมชาย ก.' });
    // ยังอยู่หน้าเดิม — ไม่มีการ navigate ไป /customers
    expect(screen.getByText('⚠ ห้องนี้ยังไม่ได้ผูกกับลูกค้า')).toBeInTheDocument();
  });

  it('ห้อง LINE ไม่เติมชื่อ Facebook', () => {
    wrap(<RoomDossier room={{ ...ROOM, channel: 'LINE_SHOP', displayName: 'Nan' }} customerId={null} activeRoomId="r-1" />);
    fireEvent.click(screen.getByRole('button', { name: /สร้างลูกค้าใหม่/ }));
    expect(JSON.parse(screen.getByTestId('create-dialog').querySelector('span')!.textContent!)).toEqual({ firstName: 'Nan', lastName: '' });
  });

  it('สร้างเสร็จ → PATCH /staff-chat/rooms/:id/customer ด้วย id ใหม่ · เจอคนเดิม (409) → ผูกคนเดิมด้วยเส้นทางเดียวกัน', async () => {
    wrap(<RoomDossier room={ROOM} customerId={null} activeRoomId="r-1" />);
    fireEvent.click(screen.getByRole('button', { name: /สร้างลูกค้าใหม่/ }));
    fireEvent.click(screen.getByRole('button', { name: 'จำลองสร้างเสร็จ' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/staff-chat/rooms/r-1/customer', { customerId: 'c-new' }));
    fireEvent.click(screen.getByRole('button', { name: 'จำลองใช้คนเดิม' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/staff-chat/rooms/r-1/customer', { customerId: 'c-old' }));
  });

  it('บทบาทที่ POST /customers ไม่รับ (เช่น ACCOUNTANT) → ปุ่มสร้างลูกค้าใหม่ปิดพร้อมเหตุผล · ปุ่มค้นหาลูกค้าเดิมยังกดได้', () => {
    authRole.role = 'ACCOUNTANT';
    wrap(<RoomDossier room={ROOM} customerId={null} activeRoomId="r-1" />);
    const btn = screen.getByRole('button', { name: /สร้างลูกค้าใหม่/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('เจ้าของ'));
    expect(screen.getByRole('button', { name: /ค้นหาลูกค้าเดิม/ })).toBeEnabled();
  });

  it('ห้องยังไม่ผูก: หัวบอกตรง ๆ · กล่องเตือน + 2 ปุ่ม · เริ่มคุยเมื่อ · มาจากโฆษณา · ช่องทางแชทไม่วาดแถวที่ไม่รู้', () => {
    wrap(<RoomDossier room={ROOM} customerId={null} activeRoomId="r-1" />);
    expect(screen.getByText('ยังไม่ได้ผูกกับลูกค้าในระบบ')).toBeInTheDocument();
    expect(screen.getByText('⚠ ห้องนี้ยังไม่ได้ผูกกับลูกค้า')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ค้นหาลูกค้าเดิม/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /สร้างลูกค้าใหม่/ })).toBeInTheDocument();
    expect(screen.getByText('เริ่มคุยเมื่อ')).toBeInTheDocument();
    expect(screen.getByText('ฝนตกไม่อยากออกจากบ้าน')).toBeInTheDocument();
    expect(screen.getByText('ห้องที่กำลังเปิดอยู่')).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่ผูกบัญชี/)).toBeNull();
    // ยังไม่ผูก → ไม่ยิง cross-channel / summary
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/cross-channel'));
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringContaining('/chat-summary'));
    // ปุ่มเปิดโปรไฟล์ปิดไว้
    expect(screen.getByRole('button', { name: 'เปิดโปรไฟล์ลูกค้าเต็มหน้า' })).toBeDisabled();
  });

  it('นัดหมายของห้อง: โหลดจาก /todos?roomId · โชว์ในแท็บ 1 · ปุ่มตั้งนัดเปิดฟอร์ม Todo ผูกห้อง', async () => {
    apiGet.mockImplementation((url: string, cfg?: { params?: { roomId?: string } }) =>
      url === '/todos' && cfg?.params?.roomId === 'r-1'
        ? Promise.resolve({ data: { data: [{ id: 't1', title: 'มารับ iPhone 15', status: 'TODO', priority: 'MEDIUM', dueDate: '2099-01-01T09:00:00Z', assignee: { id: 'u', name: 'แนน' }, createdAt: '2026-09-04T10:00:00Z', tags: [], createdById: 'u' }] } })
        : Promise.resolve({ data: [] }),
    );
    wrap(<RoomDossier room={ROOM} customerId={null} />);
    await waitFor(() => expect(screen.getByText(/มารับ iPhone 15/)).toBeInTheDocument());
    expect(screen.getByText('แนน · ตั้งเมื่อ 04/09')).toBeInTheDocument();
    expect(screen.queryByTestId('todo-form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^ตั้งนัด$/ }));
    expect(screen.getByTestId('todo-form')).toHaveTextContent('r-1|นัด สมชาย ก.');
  });

  it('ทักเพจโดยตรง (ไม่มี attribution) → บอกว่าไม่ได้มาจากโฆษณา ไม่ปั้นข้อมูล', () => {
    wrap(<RoomDossier room={{ ...ROOM, attribution: null }} customerId={null} />);
    expect(screen.getByText('ทักเพจโดยตรง — ไม่ได้มาจากโฆษณา')).toBeInTheDocument();
  });

  it('แท็บ 2/3 ของห้องยังไม่ผูก = สถานะว่างที่บอกทางไปต่อ · ประกัน = ช่องตรวจ IMEI ที่ยิง warranty-lookup', async () => {
    apiGet.mockImplementation((url: string) =>
      url.includes('warranty-lookup')
        ? Promise.resolve({ data: { customer: { name: 'ธนกฤต' }, devices: [{ product: { id: 'p', brand: 'Apple', model: 'iPhone 14', imeiSerial: '356821090123457' }, contract: { id: 'c', contractNumber: 'CT-1', status: 'ACTIVE' }, warrantyWindows: { sevenDayDefect: null, shopWarranty: null, mfrWarranty: 187 } }] } })
        : Promise.resolve({ data: [] }),
    );
    wrap(<RoomDossier room={ROOM} customerId={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /สัญญา\/ชำระ/ }));
    expect(screen.getByText('ยังไม่มี — ห้องนี้ยังไม่มีเบอร์และยังไม่ผูกลูกค้า')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /ประกัน/ }));
    fireEvent.change(screen.getByLabelText('IMEI หรือ Serial'), { target: { value: '356821090123457' } });
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจ' }));
    await waitFor(() => expect(screen.getByText('Apple iPhone 14')).toBeInTheDocument());
    expect(apiGet).toHaveBeenCalledWith('/repair-tickets/warranty-lookup', { params: { imei: '356821090123457' } });
    expect(screen.getByText(/ประกันศูนย์ เหลือ 187 วัน/)).toBeInTheDocument();
  });

  it('ห้องผูกแล้ว: แท็บ 2 = บล็อกเงินของแผงเดิม · แท็บ 3 = บล็อกเครื่อง · เลขบนแท็บมาจาก summary', async () => {
    apiGet.mockImplementation((url: string) =>
      url.includes('/chat-summary')
        ? Promise.resolve({ data: { activeContracts: [{ id: 'c1', contractNumber: 'CT-1', status: 'ACTIVE', product: { name: 'iPhone 14 128GB', warrantyExpireDate: '2027-03-12' }, serialNumber: '356821090123457', paidInstallments: 3, totalInstallments: 12, monthlyPayment: 2290, nextDueDate: '2026-10-05' }], recentPayments: [], callLogs: [], totalOutstanding: '0' } })
        : Promise.resolve({ data: [] }),
    );
    const linked = { ...ROOM, customer: { id: 'cus-1', name: 'สมชาย กิตติวัฒนโสภณ', phone: '0891112233' } };
    wrap(<RoomDossier room={linked} customerId="cus-1" />);
    await waitFor(() => expect(screen.getByRole('tab', { name: /สัญญา\/ชำระ/ })).toHaveTextContent('1'));
    expect(screen.getByRole('tab', { name: /ประกัน/ })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('tab', { name: /สัญญา\/ชำระ/ }));
    // การ์ดสัญญาตัวเอกจากข้อมูล summary + ปุ่ม "ดำเนินการ"/ไดอะล็อกของแผงเดิม (sections=actions)
    expect(screen.getByText('iPhone 14 128GB')).toBeInTheDocument();
    expect(screen.getByText(/ชำระแล้ว/)).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'รับชำระ' })).toBeInTheDocument();
    expect(screen.getByTestId('c360')).toHaveTextContent('actions');
    fireEvent.click(screen.getByRole('tab', { name: /ประกัน/ }));
    expect(screen.getByText('ประกันศูนย์')).toBeInTheDocument();
    expect(screen.getByText('356821090123457')).toBeInTheDocument();
    expect(screen.getByTestId('c360')).toHaveTextContent('mdm');
    expect(screen.getByRole('button', { name: 'เปิดโปรไฟล์ลูกค้าเต็มหน้า' })).toBeEnabled();
  });

  it('เปลี่ยนห้อง → กลับแท็บ 1 เสมอ', () => {
    const { rerender } = wrap(<RoomDossier room={ROOM} customerId={null} />);
    fireEvent.click(screen.getByRole('tab', { name: /ประกัน/ }));
    expect(screen.getByRole('tab', { name: /ประกัน/ })).toHaveAttribute('aria-selected', 'true');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <RoomDossier room={{ ...ROOM, id: 'r-2' }} customerId={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('tab', { name: /ข้อมูลลูกค้า/ })).toHaveAttribute('aria-selected', 'true');
  });
});
