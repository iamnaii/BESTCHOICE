import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopPettyCashPage from '..';
import type { PettyCashMovementsPage, PettyCashSummary } from '../types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), auth: { role: 'OWNER' } }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get, post: mocks.post, put: mocks.put }, getErrorMessage: (error: Error) => error.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1', role: mocks.auth.role, branchId: null } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const summary = (over: Partial<PettyCashSummary> = {}): PettyCashSummary => ({
  accountCode: 'S11-1106',
  balance: '6514.00',
  limit: { value: '20000.00', source: 'SET', updatedAt: '2026-10-10T07:00:00.000Z' },
  headroom: '13486.00',
  overLimit: '0.00',
  month: { key: '2026-10', label: 'ตุลาคม 2569', opening: '0.00', closing: '6514.00', topUps: { amount: '10000.00', count: 1 }, returns: { amount: '0.00', count: 0 }, supplierPayments: { amount: '3486.00', count: 2 }, other: { amount: '0.00', count: 0 }, net: '6514.00' },
  banks: [
    { code: 'S11-1202', label: 'ธนาคารหน้าร้าน (จ่ายออก)' },
    { code: 'S11-1201', label: 'ธนาคารหน้าร้าน (รับเข้า)' },
  ],
  defaultBank: { TOP_UP: 'S11-1202', RETURN: 'S11-1201' },
  asOf: '2026-10-18T07:02:00.000Z',
  ...over,
});

const movements: PettyCashMovementsPage = {
  month: { key: '2026-10', label: 'ตุลาคม 2569' },
  opening: '0.00',
  closing: '6514.00',
  rows: [
    { id: 'l3', journalEntryId: 'je3', journalEntryNo: 'JE-202610-00042', date: '2026-10-17T17:00:00.000Z', kind: 'SUPPLIER_PAYMENT', label: 'จ่ายผู้จัดจำหน่าย · ชำระค่าสินค้า', bankAccountCode: null, bankLabel: null, po: { id: 'po1', number: 'PO-20261018-0007', supplierName: 'ร้านเจ๊หน่อย' }, movementId: null, hasEvidence: false, note: null, inAmount: '0.00', outAmount: '486.00', balanceAfter: '6514.00', createdByName: 'ปอ' },
    { id: 'l2', journalEntryId: 'je2', journalEntryNo: 'JE-202610-00031', date: '2026-10-14T17:00:00.000Z', kind: 'SUPPLIER_PAYMENT', label: 'จ่ายผู้จัดจำหน่าย · มัดจำ', bankAccountCode: null, bankLabel: null, po: { id: 'po2', number: 'PO-20261015-0003', supplierName: 'บริษัท ไอที ซัพพลาย' }, movementId: null, hasEvidence: false, note: null, inAmount: '0.00', outAmount: '3000.00', balanceAfter: '7000.00', createdByName: 'ปอ' },
    { id: 'l1', journalEntryId: 'je1', journalEntryNo: 'JE-202610-00018', date: '2026-10-09T17:00:00.000Z', kind: 'TOP_UP', label: 'เติมจาก ธนาคารหน้าร้าน (จ่ายออก)', bankAccountCode: 'S11-1202', bankLabel: 'ธนาคารหน้าร้าน (จ่ายออก)', po: null, movementId: 'm1', hasEvidence: true, note: 'เติมรอบแรก', inAmount: '10000.00', outAmount: '0.00', balanceAfter: '10000.00', createdByName: 'เจ้าของ' },
  ],
};

function renderPage(role: string, summaryOver: Partial<PettyCashSummary> = {}) {
  mocks.auth.role = role;
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/shop/petty-cash/summary') return { data: summary(summaryOver) };
    if (path === '/shop/petty-cash/movements') return { data: movements };
    throw new Error(`unexpected GET ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><ShopPettyCashPage /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => vi.clearAllMocks());

describe('ShopPettyCashPage — เงินสดย่อยหน้าร้าน (mockup กระดาน 1)', () => {
  it('เจ้าของ: ยอดคงเหลือ · วงเงิน · เติมได้อีก · ปุ่มเติม/คืน/ตั้งวงเงิน · สรุปเดือน · ตารางเคลื่อนไหวพร้อมยอดสะสม', async () => {
    renderPage('OWNER');
    expect(await screen.findByTestId('petty-cash-balance')).toHaveTextContent('6,514.00');
    expect(screen.getByText(/^วงเงิน/)).toBeInTheDocument();
    expect(screen.getByText('เติมได้อีก 13,486.00 บาท')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เติมเงินสดย่อย' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'คืนเงินเข้าธนาคาร' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /ตั้งวงเงิน/ })).toBeInTheDocument();
    // สรุปเดือน
    expect(screen.getByText('+10,000.00')).toBeInTheDocument();
    expect(screen.getByText('−3,486.00')).toBeInTheDocument();
    // ตาราง
    expect(await screen.findByText('PO-20261018-0007')).toBeInTheDocument();
    expect(screen.getByText('ร้านเจ๊หน่อย')).toBeInTheDocument();
    expect(screen.getByText('เติมจาก ธนาคารหน้าร้าน (จ่ายออก)')).toBeInTheDocument();
    expect(screen.getByText('JE-202610-00018')).toBeInTheDocument();
    expect(screen.getByText('7,000.00')).toBeInTheDocument(); // ยอดสะสมของแถวกลาง
    expect(screen.getByRole('combobox', { name: 'เดือน' })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('/shop/petty-cash/movements', { params: { month: '2026-10' } });
  });

  it('ตัวกรองชนิด: กด "เติม" เหลือเฉพาะแถวเติม', async () => {
    renderPage('OWNER');
    await screen.findByText('PO-20261018-0007');
    fireEvent.click(screen.getByRole('button', { name: 'เติม' }));
    expect(screen.queryByText('PO-20261018-0007')).not.toBeInTheDocument();
    expect(screen.getByText('เติมจาก ธนาคารหน้าร้าน (จ่ายออก)')).toBeInTheDocument();
  });

  it('ผจก.การเงิน: เติม/คืนได้ แต่ไม่มีปุ่มตั้งวงเงิน · ฝ่ายบัญชี: ดูอย่างเดียว', async () => {
    renderPage('FINANCE_MANAGER');
    expect(await screen.findByRole('button', { name: 'เติมเงินสดย่อย' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ตั้งวงเงิน/ })).not.toBeInTheDocument();
  });

  it('ฝ่ายบัญชี: ไม่มีปุ่มเติม/คืน/ตั้งวงเงิน แต่เห็นยอดและตาราง', async () => {
    renderPage('ACCOUNTANT');
    expect(await screen.findByTestId('petty-cash-balance')).toHaveTextContent('6,514.00');
    expect(screen.queryByRole('button', { name: 'เติมเงินสดย่อย' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'คืนเงินเข้าธนาคาร' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ตั้งวงเงิน/ })).not.toBeInTheDocument();
    expect(await screen.findByText('PO-20261018-0007')).toBeInTheDocument();
  });

  it('เกินวงเงิน (หลังลดวงเงิน) → เตือนและปุ่มเติมปิด · วงเงินยังเป็นค่าเริ่มต้น → บอกไว้', async () => {
    renderPage('OWNER', { limit: { value: '5000.00', source: 'DEFAULT', updatedAt: null }, headroom: '0.00', overLimit: '1514.00' });
    expect(await screen.findByText('เกินวงเงิน 1,514.00 บาท — คืนเงินเข้าธนาคารหรือตั้งวงเงินใหม่')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เติมเงินสดย่อย' })).toBeDisabled();
    expect(screen.getByText(/ค่าเริ่มต้น/)).toBeInTheDocument();
  });

  it('กดเติม → เปิดกล่องเติม · บันทึกแล้วส่ง multipart ไป /shop/petty-cash/top-ups และรีเฟรช', async () => {
    renderPage('OWNER');
    mocks.post.mockResolvedValue({ data: { movement: { id: 'm9', kind: 'TOP_UP', amount: '1000.00', journalEntryNo: 'JE-202610-00050' }, periodClosed: false, accountingNotified: false, duplicate: false, summary: summary() } });
    fireEvent.click(await screen.findByRole('button', { name: 'เติมเงินสดย่อย' }));
    expect(await screen.findByRole('heading', { name: 'เติมเงินสดย่อย' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'จำนวนเงินที่เติม (บาท)' }), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /บันทึกการเติม/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('/shop/petty-cash/top-ups');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('amount')).toBe('1000.00');
    expect((body as FormData).get('bankAccountCode')).toBe('S11-1202');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'เติมเงินสดย่อย' })).not.toBeInTheDocument());
  });
});
