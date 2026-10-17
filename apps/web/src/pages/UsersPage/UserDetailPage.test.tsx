import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserDetailPage from './UserDetailPage';
const mocks = vi.hoisted(() => ({ detail: vi.fn(), create: vi.fn(), saveProfile: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn(async () => ({ data: [] })) }, getErrorMessage: () => 'เกิดข้อผิดพลาด' }));
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
beforeEach(() => vi.clearAllMocks());
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
