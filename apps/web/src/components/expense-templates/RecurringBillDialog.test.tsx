import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ExpenseTemplate } from './RecurringBillDialog';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
let user: { id: string; role: string; branchId: string | null } = { id: 'u-owner', role: 'OWNER', branchId: null };
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
    patch: (...a: unknown[]) => apiPatch(...a),
  },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/hooks/useCoa', () => ({
  useCoaGroups: () => ({ data: { groups: [{ name: 'ค่าใช้จ่ายดำเนินงาน', accounts: [{ code: '53-1302', name: 'ค่าโทรศัพท์และอินเทอร์เน็ต' }, { code: '53-1301', name: 'ค่าเช่า' }] }] } }),
}));
vi.mock('@/components/expense-form-v4/VendorCombobox', () => ({
  VendorCombobox: ({ id, value, onSelectSupplier }: { id?: string; value: string; onSelectSupplier: (s: { name: string; taxId: string; supplierId: string }) => void }) => (
    <input id={id} value={value} onChange={(e) => onSelectSupplier({ name: e.target.value, taxId: '', supplierId: e.target.value === 'บมจ.ทิพยประกันภัย' ? 'sup-1' : '' })} />
  ),
}));
vi.mock('@/components/CashAccountSelect', () => ({
  CASH_ACCOUNT_CODES: ['11-1101', '11-1201'],
  CashAccountSelect: ({ value, onChange, disabled, id }: { id?: string; value?: string; onChange: (c: string) => void; disabled?: boolean }) => (
    <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      <option value="11-1201">11-1201 KBank</option>
    </select>
  ),
}));
import { RecurringBillDialog } from './RecurringBillDialog';

const NOW = new Date('2026-10-26T03:00:00Z'); // 26 ต.ค. 2569 10:00 ไทย
const branches = [{ id: 'br-1', name: 'ลาดพร้าว' }, { id: 'br-2', name: 'บางนา' }];
const onClose = vi.fn();
function mount(props: { template?: ExpenseTemplate | null; now?: Date } = {}) {
  apiGet.mockImplementation((path: string) => Promise.resolve({ data: path === '/branches' ? branches : [] }));
  apiPost.mockResolvedValue({ data: { id: 'tpl-new' } });
  apiPatch.mockResolvedValue({ data: { id: 'tpl-1', ruleChanged: false } });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecurringBillDialog open onClose={onClose} template={props.template ?? null} now={props.now ?? NOW} />
    </QueryClientProvider>,
  );
}
const field = (label: string) => screen.getByLabelText(label);
const submit = () => screen.getByRole('button', { name: 'บันทึกบิลประจำ' });
const template: ExpenseTemplate = {
  id: 'tpl-1', name: 'ประกันภัยร้าน (รายปี)', documentType: 'EXPENSE', branchId: 'br-1',
  prefilledData: { vendorName: 'บมจ.ทิพยประกันภัย', vendorSupplierId: 'sup-1', category: '53-1301', sampleAmount: 18900, paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' },
  isRecurring: true, recurringDay: 29, recurrence: 'YEARLY', recurringMonth: 10, reminderLeadDays: 7, startsOn: '2026-10-25T17:00:00.000Z',
  branch: { id: 'br-1', name: 'ลาดพร้าว' }, createdBy: { id: 'u-owner', name: 'เจ้าของ' }, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => { apiGet.mockReset(); apiPost.mockReset(); apiPatch.mockReset(); onClose.mockReset(); user = { id: 'u-owner', role: 'OWNER', branchId: null }; });

describe('กล่องตั้งบิลประจำ', () => {
  it('ราย 3 เดือน → ช่อง "เดือน" เปิดและบังคับ · รายเดือน → ช่องเดือนปิด', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    expect(field('เดือน')).toBeDisabled();
    await u.selectOptions(field('ความถี่'), 'QUARTERLY');
    expect(field('เดือน')).toBeEnabled();
    await u.type(field('ชื่อบิล'), 'ค่าทำบัญชี');
    await u.selectOptions(field('สาขา'), 'br-1');
    await u.type(field('วันครบกำหนด (วันที่ของเดือน)'), '5');
    await u.click(submit());
    expect(await screen.findByText('ราย 3 เดือนต้องระบุว่าเป็นเดือนที่ 1-3 ของไตรมาส')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('วันที่ 31 รายเดือน (วันนี้ 26 ม.ค. 2570) → พรีวิวงวดถัดไป 31 ม.ค. 2570 แล้วถัดไป 28 ก.พ.', async () => {
    const u = userEvent.setup();
    mount({ now: new Date('2027-01-26T03:00:00Z') });
    await screen.findByRole('dialog');
    await u.type(field('วันครบกำหนด (วันที่ของเดือน)'), '31');
    const preview = screen.getByTestId('recurring-preview');
    expect(preview).toHaveTextContent('งวดถัดไป: 31 ม.ค. 2570');
    expect(preview).toHaveTextContent('ระบบจะสร้างร่างและเตือนวันที่ 28 ม.ค.');
    expect(preview).toHaveTextContent('28 ก.พ.');
  });

  it('เตือนล่วงหน้า 31 วัน → ข้อความเดียวกับ API และไม่ส่ง', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await u.type(field('ชื่อบิล'), 'ค่าไฟ');
    await u.selectOptions(field('สาขา'), 'br-1');
    await u.type(field('วันครบกำหนด (วันที่ของเดือน)'), '15');
    await u.clear(field('เตือนล่วงหน้า (วัน)'));
    await u.type(field('เตือนล่วงหน้า (วัน)'), '31');
    await u.click(submit());
    expect(await screen.findByText('เตือนล่วงหน้าได้ 0-30 วัน')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ตั้งวิธีจ่ายแล้วต้องเลือกบัญชีที่จ่ายด้วย', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await u.type(field('ชื่อบิล'), 'ค่าไฟ');
    await u.selectOptions(field('สาขา'), 'br-1');
    await u.type(field('วันครบกำหนด (วันที่ของเดือน)'), '15');
    await u.selectOptions(field('วิธีจ่าย'), 'BANK_TRANSFER');
    await u.click(submit());
    expect(await screen.findByText('ตั้งวิธีจ่ายแล้วต้องเลือกบัญชีที่จ่ายด้วย')).toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('บันทึกใหม่: POST /expense-templates พร้อม payload ครบ แล้วปิดกล่อง', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await u.type(field('ชื่อบิล'), 'อินเทอร์เน็ต AIS Fibre');
    await u.type(field('ผู้รับเงิน / เจ้าหนี้'), 'บมจ.ทิพยประกันภัย');
    await u.selectOptions(field('สาขา'), 'br-2');
    await u.selectOptions(field('บัญชีค่าใช้จ่าย'), '53-1302');
    await u.type(field('ยอดประมาณ (บาท)'), '1284');
    await u.type(field('วันครบกำหนด (วันที่ของเดือน)'), '24');
    await u.selectOptions(field('วิธีจ่าย'), 'BANK_TRANSFER');
    await u.selectOptions(field('บัญชีที่จ่าย'), '11-1201');
    await u.click(submit());
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/expense-templates', {
      name: 'อินเทอร์เน็ต AIS Fibre',
      documentType: 'EXPENSE',
      branchId: 'br-2',
      prefilledData: { vendorName: 'บมจ.ทิพยประกันภัย', vendorSupplierId: 'sup-1', category: '53-1302', description: 'อินเทอร์เน็ต AIS Fibre', sampleAmount: 1284, paymentMethod: 'BANK_TRANSFER', depositAccountCode: '11-1201' },
      isRecurring: true,
      recurrence: 'MONTHLY',
      recurringDay: 24,
      recurringMonth: null,
      reminderLeadDays: 3,
      startsOn: '2026-10-26',
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('โหมดแก้ไข: เติมค่าเดิม สาขาอ่านอย่างเดียว · PATCH ไม่ส่ง branchId/documentType · ติ๊ก "เปิดใช้บิลประจำ" ออกได้', async () => {
    const u = userEvent.setup();
    mount({ template });
    await screen.findByRole('dialog');
    expect(field('ชื่อบิล')).toHaveValue('ประกันภัยร้าน (รายปี)');
    expect(field('สาขา')).toBeDisabled();
    expect(screen.getByText('ย้ายสาขา = ปิดบิลนี้แล้วตั้งใหม่')).toBeInTheDocument();
    expect(field('ความถี่')).toHaveValue('YEARLY');
    expect(field('เดือน')).toHaveValue('10');
    expect(field('วันครบกำหนด (วันที่ของเดือน)')).toHaveValue(29);
    expect(field('เตือนล่วงหน้า (วัน)')).toHaveValue(7);
    expect(field('เริ่มนับงวดแรกตั้งแต่')).toHaveValue('2026-10-26');
    expect(field('บัญชีที่จ่าย')).toHaveValue('11-1201');
    expect(field('เปิดใช้บิลประจำ')).toBeChecked();
    await u.clear(field('เตือนล่วงหน้า (วัน)'));
    await u.type(field('เตือนล่วงหน้า (วัน)'), '5');
    await u.click(submit());
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/expense-templates/tpl-1', expect.objectContaining({ name: 'ประกันภัยร้าน (รายปี)', isRecurring: true, recurrence: 'YEARLY', recurringDay: 29, recurringMonth: 10, reminderLeadDays: 5 })));
    const body = apiPatch.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('branchId');
    expect(body).not.toHaveProperty('documentType');
    expect(body).not.toHaveProperty('startsOn'); // ไม่ได้แก้วันเริ่ม = ไม่ส่ง (รีวิว I2)
  });

  it('โหมดแก้ไข: บิลเก่าที่เริ่มนับเกิน 90 วัน บันทึกได้ถ้าไม่แตะวันเริ่ม (รีวิว I2)', async () => {
    const u = userEvent.setup();
    mount({ template: { ...template, startsOn: '2026-06-25T17:00:00.000Z' } }); // 26 มิ.ย. 69 = 122 วันก่อน NOW
    await screen.findByRole('dialog');
    expect(field('เริ่มนับงวดแรกตั้งแต่')).toHaveValue('2026-06-26');
    await u.clear(field('เตือนล่วงหน้า (วัน)'));
    await u.type(field('เตือนล่วงหน้า (วัน)'), '5');
    await u.click(submit());
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    expect(apiPatch.mock.calls[0][1]).not.toHaveProperty('startsOn');
    expect(screen.queryByText(/ย้อนหลังได้ไม่เกิน/)).toBeNull();
  });

  it('ส่งไม่ผ่าน: ช่องที่ผิดมี aria-invalid + aria-describedby ชี้ข้อความผิดพลาด และโฟกัสไปช่องแรกที่ผิด', async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await u.click(submit());
    const day = field('วันครบกำหนด (วันที่ของเดือน)');
    expect(day).toHaveAttribute('aria-invalid', 'true');
    const errId = day.getAttribute('aria-describedby');
    expect(errId).toBeTruthy();
    expect(document.getElementById(errId!)).toHaveTextContent('บิลประจำต้องระบุวันครบกำหนด 1-31');
    expect(field('ชื่อบิล')).toHaveFocus();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ผู้จัดการสาขาสร้างใหม่: สาขาถูกล็อกเป็นสาขาตนเอง', async () => {
    user = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'br-2' };
    mount();
    await screen.findByRole('dialog');
    await waitFor(() => expect(field('สาขา')).toHaveValue('br-2'));
    expect(field('สาขา')).toBeDisabled();
  });
});
