import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import ContactDetailPage from '../ContactDetailPage';
import { contactsApi } from '@/lib/api/contacts';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/contacts')>();
  return {
    ...actual,
    contactsApi: { ...actual.contactsApi, detail: vi.fn(), list: vi.fn(), merge: vi.fn() },
  };
});

vi.mock('@/lib/api/customers', () => ({
  customerKeys: { summary: (id: string) => ['customer-summary', id] },
  customersApi: { summary: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  })),
}));

function asOwner() {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: 'u1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  });
}

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/contacts/${id}`]}>
        <Routes>
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactDetailPage', () => {
  it('shows party identity ONCE in the hero (taxId not duplicated in the role tile)', async () => {
    (contactsApi.detail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-00002',
      name: 'บ.แอปเปิล',
      roles: ['SUPPLIER'],
      isActive: true,
      taxId: '0105500000010',
      phone: '021112222',
      email: null,
      address: null,
      lineId: null,
      peakContactCode: null,
      customers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
      suppliers: [
        {
          id: 's1',
          name: 'บ.แอปเปิล',
          type: 'JURISTIC',
          taxId: '0105500000010',
          branchCode: '00000',
          contactName: 'คุณเอ',
          contactPhone: '02',
          phone: '02',
          hasVat: true,
          address: 'กทม',
        },
      ],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getAllByText('บ.แอปเปิล').length).toBeGreaterThan(0));
    // taxId ปรากฏครั้งเดียว (ใน hero) — ไม่ซ้ำในการ์ด role
    expect(screen.getAllByText('0105500000010')).toHaveLength(1);
    // การ์ดผู้ขายยังลิงก์ไป workspace
    const link = screen.getByRole('link', { name: /แก้ไข|เปิดข้อมูล|ผู้ขาย/ });
    expect(link).toHaveAttribute('href', '/suppliers/s1');
    // ฟิลด์เฉพาะ role ยังอยู่ในการ์ด
    expect(screen.getByText('คุณเอ (02)')).toBeInTheDocument();
  });

  it('copies the phone number from the hero quick action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-1',
      name: 'นราธิป',
      roles: ['SUPPLIER'],
      isActive: true,
      taxId: null,
      phone: '0891112222',
      email: null,
      address: null,
      lineId: null,
      peakContactCode: null,
      customers: [],
      suppliers: [
        { id: 's1', name: 'นราธิป', type: 'INDIVIDUAL', taxId: null, branchCode: null,
          contactName: null, contactPhone: null, phone: '0891112222', hasVat: false, address: null },
      ],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
    });
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    wrap('c1');
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'คัดลอกเบอร์' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('0891112222'));
  });

  it('shows customer financial KPIs in the top summary strip', async () => {
    const { customersApi } = await import('@/lib/api/customers');
    (customersApi.summary as any).mockResolvedValue({
      id: 'cus1',
      name: 'นราธิป',
      phone: '08',
      activeContracts: 2,
      overdueCount: 1,
      totalOutstandingThb: 15000,
    });
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-00001',
      name: 'นราธิป',
      roles: ['CUSTOMER'],
      isActive: true,
      taxId: null,
      phone: '08',
      email: null,
      address: null,
      lineId: null,
      peakContactCode: null,
      suppliers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
      customers: [{ id: 'cus1', name: 'นราธิป', prefix: 'คุณ', phone: '08' }],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/15,000/)).toBeInTheDocument());
    expect(screen.getByText('ยอดค้างชำระ')).toBeInTheDocument();
    expect(screen.getByText('งวดค้าง')).toBeInTheDocument();
  });

  it('shows an empty-state hint when the contact has no role links', async () => {
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-1',
      name: 'คนเดียวดาย',
      roles: [],
      isActive: true,
      taxId: null,
      phone: '0800000000',
      email: null,
      address: null,
      lineId: null,
      peakContactCode: null,
      customers: [],
      suppliers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByText('คนเดียวดาย')).toBeInTheDocument());
    expect(screen.getByText(/ยังไม่ผูกกับลูกค้า\/ผู้ขาย/)).toBeInTheDocument();
    // เบอร์โผล่เป็น text ครั้งเดียว (Field ใน hero grid) — empty-state ไม่โชว์เบอร์ซ้ำอีกชุด
    expect(screen.getAllByText('0800000000')).toHaveLength(1);
  });

  it('OWNER merges a searched duplicate into the current contact', async () => {
    asOwner();
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1', contactCode: 'P-1', name: 'A', roles: ['CUSTOMER'], isActive: true,
      taxId: null, phone: null, email: null, address: null, lineId: null, peakContactCode: null,
      customers: [], suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [],
    });
    (contactsApi.list as any).mockResolvedValue({
      data: [{ id: 'c2', contactCode: 'P-2', name: 'A dup', roles: ['SUPPLIER'], isActive: true,
        taxId: '0105', phone: null, email: null, address: null, lineId: null, peakContactCode: null }],
      total: 1, page: 1, limit: 50,
    });
    const mergeSpy = ((contactsApi.merge as any) = vi.fn().mockResolvedValue({ primaryId: 'c1' }));
    const user = userEvent.setup();
    wrap('c1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'A' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'รวมผู้ติดต่อซ้ำ' }));
    const searchInput = await screen.findByPlaceholderText(/ค้นหา/);
    await user.type(searchInput, 'A dup');
    const candidate = await screen.findByText('A dup');
    await user.click(candidate);
    const confirmBtn = await screen.findByRole('button', { name: 'รวมผู้ติดต่อ' });
    await user.click(confirmBtn);
    await waitFor(() => expect(mergeSpy).toHaveBeenCalledWith('c1', 'c2'));
  });

  it('hides the merge action for non-OWNER roles', async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u2', role: 'SALES', branchId: null }, isLoading: false, isAuthenticated: true,
    });
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1', contactCode: 'P-1', name: 'A', roles: ['CUSTOMER'], isActive: true,
      taxId: null, phone: null, email: null, address: null, lineId: null, peakContactCode: null,
      customers: [], suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'A' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'รวมผู้ติดต่อซ้ำ' })).not.toBeInTheDocument();
  });

  it('shows the VAT status band for a supplier-only contact', async () => {
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1', contactCode: 'P-9', name: 'ร้านวัสดุ', roles: ['SUPPLIER'], isActive: true,
      taxId: '0105', phone: null, email: null, address: null, lineId: null, peakContactCode: null,
      customers: [],
      suppliers: [
        { id: 's1', name: 'ร้านวัสดุ', type: 'INDIVIDUAL', taxId: '0105', branchCode: null,
          contactName: null, contactPhone: null, phone: null, hasVat: true, address: null },
      ],
      tradeInsAsSeller: [], externalFinanceCompany: [],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ร้านวัสดุ' })).toBeInTheDocument());
    expect(screen.getByText('สถานะภาษี')).toBeInTheDocument();
    expect(screen.getAllByText('จด VAT').length).toBeGreaterThan(0);
  });

  it('shows the seller name in the trade-in tile (not just the date)', async () => {
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1', contactCode: 'P-7', name: 'สมชาย', roles: ['TRADE_IN_SELLER'], isActive: true,
      taxId: null, phone: '0812223333', email: null, address: null, lineId: null, peakContactCode: null,
      customers: [], suppliers: [], externalFinanceCompany: [],
      tradeInsAsSeller: [
        { id: 't1', sellerName: 'สมชาย', sellerPhone: '0899998888', createdAt: '2026-05-01T03:00:00.000Z' },
      ],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'สมชาย' })).toBeInTheDocument());
    // 'คนขายมือสอง' appears as both the hero role badge and the tile title
    expect(screen.getAllByText('คนขายมือสอง').length).toBeGreaterThan(0);
    // seller name + phone shown in the tile (parenthesised string is unique to the tile, not the hero h1)
    expect(screen.getByText(/สมชาย \(0899998888\)/)).toBeInTheDocument();
  });

  it('hides the summary strip when the summary fetch fails, but still renders the card', async () => {
    const { customersApi } = await import('@/lib/api/customers');
    (customersApi.summary as any).mockRejectedValue(new Error('network'));
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1', contactCode: 'P-00001', name: 'ลูกค้าเอ', roles: ['CUSTOMER'], isActive: true,
      taxId: null, phone: '08', email: null, address: null, lineId: null, peakContactCode: null,
      suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [],
      customers: [{ id: 'cus1', name: 'ลูกค้าเอ', prefix: 'คุณ', phone: '08' }],
    });
    wrap('c1');
    // hero + customer tile still render despite the failed summary query
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ลูกค้าเอ' })).toBeInTheDocument());
    expect(screen.getByText('เปิดข้อมูลลูกค้า / แก้ไข')).toBeInTheDocument();
    // the summary fetch WAS attempted (and rejected) — proves the hide is due to
    // the failure path, not merely an un-fired query
    await waitFor(() => expect(customersApi.summary).toHaveBeenCalledWith('cus1'));
    // ...but the financial KPI strip is hidden (no half-strip on fetch failure)
    expect(screen.queryByText('ยอดค้างชำระ')).not.toBeInTheDocument();
  });
});
