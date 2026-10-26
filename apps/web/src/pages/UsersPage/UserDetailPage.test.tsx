import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserDetailPage from './UserDetailPage';
const mocks = vi.hoisted(() => ({ detail: vi.fn(), create: vi.fn(), saveProfile: vi.fn() }));
const apiMock = vi.hoisted(() => ({ get: vi.fn(async () => ({ data: [] })), post: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: apiMock, getErrorMessage: () => 'เกิดข้อผิดพลาด' }));
let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-owner', role } }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ viewerRoleEnabled: false }) }));
vi.mock('@/lib/api/users', () => ({ usersApi: mocks, userKeys: { detail: (id: string) => ['user', id] } }));
function open(path: string) {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/users/new" element={<UserDetailPage />} />
      <Route path="/users/:id" element={<UserDetailPage />} />
    </Routes></MemoryRouter>
  </QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); role = 'OWNER'; apiMock.get.mockImplementation(async () => ({ data: [] })); });
describe('user detail route modes', () => {
  it('opens the static new route with editable credentials and creates instead of updating undefined', async () => {
    const user = userEvent.setup();
    mocks.create.mockReturnValue(new Promise(() => {}));
    open('/users/new');
    expect(screen.getByRole('heading', {name:'เพิ่มผู้ใช้ใหม่'})).toBeInTheDocument();
    const email=screen.getByLabelText(/อีเมล \(เข้าสู่ระบบ\)/);
    expect(email).toBeEnabled(); expect(email).toBeRequired();
    expect(screen.getByLabelText('รหัสผ่าน *')).toBeRequired();
    await user.type(email,'test@example.invalid');
    await user.type(screen.getByLabelText('รหัสผ่าน *'),'Example!234');
    await user.click(screen.getByRole('tab',{name:'ข้อมูลบุคคล'}));
    await user.type(screen.getByLabelText('ชื่อ-นามสกุล *'),'ทดสอบ ผู้ใช้');
    await user.click(screen.getByRole('button',{name:'บันทึก'}));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({name:'ทดสอบ ผู้ใช้',email:'test@example.invalid',password:'Example!234'})));
    expect(mocks.detail).not.toHaveBeenCalled(); expect(mocks.saveProfile).not.toHaveBeenCalled();
  });
  it('keeps existing account email read-only and does not require a replacement password', async () => {
    mocks.detail.mockResolvedValue({id:'user-a',name:'ผู้ใช้เดิม',email:'existing@example.invalid',role:'SALES',isActive:true});
    open('/users/user-a');
    expect(await screen.findByRole('heading',{name:'ผู้ใช้เดิม'})).toBeInTheDocument();
    expect(screen.getByLabelText(/อีเมล \(เข้าสู่ระบบ\)/)).toBeDisabled();
    expect(screen.getByLabelText('รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)')).not.toBeRequired();
    expect(mocks.detail).toHaveBeenCalledWith('user-a');
  });
});

/**
 * ก้อน 7 A16 §13.1 — บล็อก "ไลน์พนักงาน (แจ้งเตือนภายใน)" บนแท็บข้อมูลบุคคล: ผูกด้วยรหัส 6 หลักผ่าน Staff OA
 * (ช่อง LINE ID เดิม = ไอดีค้นหาเพื่อน ใช้ push ไม่ได้)
 */
const baseUser = { id: 'user-a', name: 'สมหญิง ทดสอบ', email: 'somying@example.invalid', role: 'ACCOUNTANT', isActive: true, lineId: 'somying.line', lineStaffUserId: null, lineLinkCode: null, lineLinkCodeExpiresAt: null };
describe('staff LINE link card', () => {
  it('L1: ยังไม่ผูก → สร้างรหัสผูก LINE → POST link-code แล้วแสดงรหัส + ขั้นตอน + เวลาหมดอายุ', async () => {
    const user = userEvent.setup();
    mocks.detail.mockResolvedValue(baseUser);
    apiMock.post.mockResolvedValue({ data: { code: '123456', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } });
    open('/users/user-a');
    await user.click(await screen.findByRole('tab', { name: 'ข้อมูลบุคคล' }));
    expect(screen.getByLabelText('LINE ID (สำหรับค้นหาเพื่อน)')).toHaveAccessibleDescription(/ไม่ใช่ช่องนี้/);
    const card = screen.getByRole('region', { name: 'ไลน์พนักงาน (แจ้งเตือนภายใน)' });
    expect(card).toHaveTextContent('ยังไม่ผูก');
    await user.click(screen.getByRole('button', { name: 'สร้างรหัสผูก LINE' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/staff-notify/users/user-a/link-code'));
    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(card).toHaveTextContent(/หมดอายุใน/);
    expect(card).toHaveTextContent(/ส่งรหัสนี้ในแชท/);
    expect(screen.queryByRole('button', { name: 'ส่งข้อความทดสอบ' })).not.toBeInTheDocument();
  });

  it('L2: ผูกแล้ว → ส่งข้อความทดสอบ POST test · ยกเลิกการผูก (ยืนยัน) DELETE link', async () => {
    const user = userEvent.setup();
    mocks.detail.mockResolvedValue({ ...baseUser, lineStaffUserId: 'U4af4980629abcd' });
    apiMock.post.mockResolvedValue({ data: { ok: true } });
    apiMock.delete.mockResolvedValue({ data: { ok: true } });
    open('/users/user-a');
    await user.click(await screen.findByRole('tab', { name: 'ข้อมูลบุคคล' }));
    const card = screen.getByRole('region', { name: 'ไลน์พนักงาน (แจ้งเตือนภายใน)' });
    expect(card).toHaveTextContent('ผูกแล้ว');
    expect(card).toHaveTextContent('U…abcd');
    expect(screen.queryByRole('button', { name: 'สร้างรหัสผูก LINE' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ส่งข้อความทดสอบ' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/staff-notify/users/user-a/test'));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'ยกเลิกการผูก' }));
    await user.click(await screen.findByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith('/staff-notify/users/user-a/link'));
  });

  it('L3: ไม่ใช่ OWNER หรือผู้ใช้ใหม่ → ไม่มีบล็อกผูก LINE', async () => {
    const user = userEvent.setup();
    role = 'ACCOUNTANT';
    mocks.detail.mockResolvedValue(baseUser);
    const first = open('/users/user-a');
    await user.click(await screen.findByRole('tab', { name: 'ข้อมูลบุคคล' }));
    expect(screen.queryByRole('region', { name: 'ไลน์พนักงาน (แจ้งเตือนภายใน)' })).not.toBeInTheDocument();
    first.unmount();

    role = 'OWNER';
    open('/users/new');
    await user.click(await screen.findByRole('tab', { name: 'ข้อมูลบุคคล' }));
    expect(screen.queryByRole('region', { name: 'ไลน์พนักงาน (แจ้งเตือนภายใน)' })).not.toBeInTheDocument();
  });
});
