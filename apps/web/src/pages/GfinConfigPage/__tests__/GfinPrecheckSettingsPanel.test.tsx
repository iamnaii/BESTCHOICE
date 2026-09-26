import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: authState.role } }) }));
const apiGet = vi.fn(); const apiPut = vi.fn(); const apiPost = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), default: { get: (...a: unknown[]) => apiGet(...a), put: (...a: unknown[]) => apiPut(...a), post: (...a: unknown[]) => apiPost(...a) } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';
import { GfinPrecheckSettingsPanel, GFIN_PRECHECK_SETTINGS_QUERY_KEY } from '../GfinPrecheckSettingsPanel';

const DEFAULT_TEMPLATE = 'รายละเอียดที่ต้องแจ้งเช็คค่ะ\n1.ชื่อลูกค้า : {{customerName}}\nเอกสารทั้งหมด {{fileCount}} ไฟล์: {{link}}';
const settings = {
  company: { lineGroupId: 'C1', precheckTemplate: null },
  groups: [
    { groupId: 'C1', groupName: 'GFIN : BESTCHOICE (67301219)', pictureUrl: null, memberCount: 6, joinedAt: '2026-09-25T09:00:00Z', leftAt: null },
    { groupId: 'C0', groupName: 'กลุ่มเก่า', pictureUrl: null, memberCount: 3, joinedAt: '2026-08-01T09:00:00Z', leftAt: '2026-09-20T09:00:00Z' },
  ],
  defaultTemplate: DEFAULT_TEMPLATE,
  status: { groupId: 'C1', groupName: 'GFIN : BESTCHOICE (67301219)', botInGroup: true, tokenConfigured: true, ready: true, reason: null },
};
function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => { authState.role = 'OWNER'; apiGet.mockReset(); apiPut.mockReset(); apiPost.mockReset(); apiGet.mockResolvedValue({ data: settings }); apiPut.mockResolvedValue({ data: settings }); apiPost.mockResolvedValue({ data: { ok: true, groupName: 'GFIN : BESTCHOICE (67301219)', requestId: 'r1' } }); vi.mocked(toast.error).mockClear(); vi.mocked(toast.success).mockClear(); });

describe('GfinPrecheckSettingsPanel', () => {
  it('lists groups: the linked one checked, the one the bot left disabled with a badge; status line says ready', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByRole('radio', { name: /GFIN : BESTCHOICE \(67301219\)/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /กลุ่มเก่า/ })).toBeDisabled();
    expect(screen.getByText('บอทออกจากกลุ่มแล้ว')).toBeInTheDocument();
    expect(screen.getByText(/พร้อมส่งด้วยบอท/)).toBeInTheDocument();
  });
  it('no groups yet → 3-step instructions and no radio list', async () => {
    apiGet.mockResolvedValue({ data: { ...settings, groups: [], company: { lineGroupId: null, precheckTemplate: null }, status: { ...settings.status, groupId: null, groupName: null, ready: false, reason: 'NOT_LINKED' } } });
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByText(/เชิญ OA ไฟแนนซ์เข้ากลุ่ม/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
  // F5 (final-fix wave) — save ต้องส่งเฉพาะช่องที่ถูกแก้จริง ๆ ไม่ใช่ทั้งสองช่องเสมอ (เดิมส่ง lineGroupId
  // ทับซ้ำทุกครั้งแม้ผู้ใช้ไม่ได้แตะกลุ่มเลย → กลุ่มที่บอทออกไปแล้ว (leftAt ตั้งไว้) ทำ save พังด้วยข้อความ
  // "บอทออกจากกลุ่มนี้แล้ว" ทั้งที่แค่แก้แม่แบบข้อความ)
  it('F5: selecting a different group and saving sends lineGroupId alone (the field actually edited)', async () => {
    // เดิม (Radix) คลิกซ้ำที่ radio ที่เลือกอยู่แล้วไม่ยิง onValueChange — ต้องเลือก "อีก" กลุ่มจึงนับเป็นการแก้จริง
    apiGet.mockResolvedValue({
      data: { ...settings, groups: [...settings.groups, { groupId: 'C2', groupName: 'กลุ่มสำรอง', pictureUrl: null, memberCount: 2, joinedAt: '2026-09-10T09:00:00Z', leftAt: null }] },
    });
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    await screen.findByRole('radio', { name: /GFIN : BESTCHOICE/ });
    await userEvent.click(screen.getByRole('radio', { name: /กลุ่มสำรอง/ }));
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/gfin-precheck-settings', { lineGroupId: 'C2' }));
    expect(toast.success).toHaveBeenCalled();
  });
  it('F5: template-only edit sends precheckTemplate alone, without lineGroupId', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    const ta = await screen.findByLabelText('แม่แบบข้อความ 12 ข้อ');
    fireEvent.change(ta, { target: { value: 'เพิ่มเติม {{link}}' } });
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/gfin-precheck-settings', { precheckTemplate: 'เพิ่มเติม {{link}}' }));
    const payload = apiPut.mock.calls[0][1];
    expect(payload).not.toHaveProperty('lineGroupId');
  });
  it('F5: no edits at all → "บันทึก" is disabled (no request, no toast)', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    await screen.findByRole('radio', { name: /GFIN : BESTCHOICE/ });
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
    expect(apiPut).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  // F6 (final-fix wave) — เลือกกลุ่มอื่นแล้วยังไม่กดบันทึก ปุ่ม "ส่งข้อความทดสอบ" ต้องปิดไว้ก่อน ไม่งั้นข้อความ
  // ทดสอบจะไปเข้ากลุ่มที่จอแสดงไว้ (เลือกใหม่) แทนกลุ่มที่บันทึกจริง (ยังเป็นกลุ่มเดิม)
  it('F6: selecting another (unsaved) enabled group disables "ส่งข้อความทดสอบ" until saved', async () => {
    apiGet.mockResolvedValue({
      data: { ...settings, groups: [...settings.groups, { groupId: 'C2', groupName: 'กลุ่มสำรอง', pictureUrl: null, memberCount: 2, joinedAt: '2026-09-10T09:00:00Z', leftAt: null }] },
    });
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    await screen.findByRole('radio', { name: /GFIN : BESTCHOICE/ });
    const testButton = screen.getByRole('button', { name: 'ส่งข้อความทดสอบ' });
    expect(testButton).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: /กลุ่มสำรอง/ }));
    expect(testButton).toBeDisabled();
    expect(testButton).toHaveAttribute('title', 'บันทึกกลุ่มที่เลือกก่อน');
  });
  it('template without {{link}} is blocked client-side with the shared error label', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    const ta = await screen.findByLabelText('แม่แบบข้อความ 12 ข้อ');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'เช็ค {{{{customerName}}}}');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('{{link}}'));
    expect(apiPut).not.toHaveBeenCalled();
  });
  // F8 (final-fix wave) — "ใช้ค่าเริ่มต้น" ต้องล้างช่องเป็นค่าว่าง (แสดงแม่แบบเริ่มต้นเป็น placeholder) ไม่ใช่
  // copy ข้อความเริ่มต้นไปเก็บใน DB — ไม่งั้นถ้าแม่แบบเริ่มต้นในโค้ดถูกแก้ทีหลัง บริษัทที่เคยกดปุ่มนี้จะค้าง
  // สำเนาเก่าอยู่ ไม่ได้ตามแม่แบบใหม่โดยอัตโนมัติ
  it('F8: "ใช้ค่าเริ่มต้น" ล้างช่องเป็นค่าว่าง (placeholder = แม่แบบเริ่มต้น) และบันทึกส่ง precheckTemplate: null', async () => {
    apiGet.mockResolvedValue({ data: { ...settings, company: { lineGroupId: 'C1', precheckTemplate: 'เก่า {{link}}' } } });
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    const ta = await screen.findByLabelText('แม่แบบข้อความ 12 ข้อ');
    expect(ta).toHaveValue('เก่า {{link}}');
    await userEvent.click(screen.getByRole('button', { name: 'ใช้ค่าเริ่มต้น' }));
    expect(ta).toHaveValue('');
    expect(ta).toHaveAttribute('placeholder', DEFAULT_TEMPLATE);
    await userEvent.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/gfin-precheck-settings', { precheckTemplate: null }));
  });
  it('"ส่งข้อความทดสอบ" POSTs and toasts the group name', async () => {
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    await userEvent.click(await screen.findByRole('button', { name: 'ส่งข้อความทดสอบ' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/gfin-precheck-settings/test-message'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('GFIN : BESTCHOICE (67301219)'));
  });
  it('fix round 1 — unsaved template edits survive a background refetch that returns the same settings (no stale-overwrite)', async () => {
    // structuralSharing: false forces the query to hand the component a BRAND NEW settings
    // object on every refetch (even one with identical values) — the worst case for a
    // useEffect-that-syncs-from-data bug. apiGet also returns a freshly-cloned object each
    // call so it isn't the exact same reference twice in a row either.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, structuralSharing: false } } });
    apiGet.mockImplementation(() => Promise.resolve({ data: { ...settings, company: { ...settings.company } } }));
    render(
      <QueryClientProvider client={qc}>
        <GfinPrecheckSettingsPanel />
      </QueryClientProvider>,
    );
    const ta = await screen.findByLabelText('แม่แบบข้อความ 12 ข้อ');
    await userEvent.clear(ta);
    await userEvent.type(ta, 'ข้อความที่พิมพ์ค้างไว้ยังไม่ได้กดบันทึก');
    expect(ta).toHaveValue('ข้อความที่พิมพ์ค้างไว้ยังไม่ได้กดบันทึก');

    // Background refetch (reconnect / another invalidation elsewhere) resolves to the SAME settings —
    // must not clobber the text the user is still typing.
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    await qc.invalidateQueries({ queryKey: GFIN_PRECHECK_SETTINGS_QUERY_KEY });
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));

    expect(ta).toHaveValue('ข้อความที่พิมพ์ค้างไว้ยังไม่ได้กดบันทึก');
  });
  it('FINANCE_MANAGER can edit; SALES is read-only', async () => {
    authState.role = 'FINANCE_MANAGER';
    const { unmount } = render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByRole('button', { name: 'บันทึก' })).toBeInTheDocument();
    unmount();
    authState.role = 'SALES';
    render(<Wrapper><GfinPrecheckSettingsPanel /></Wrapper>);
    expect(await screen.findByRole('radio', { name: /GFIN : BESTCHOICE/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'บันทึก' })).toBeNull();
  });
});
