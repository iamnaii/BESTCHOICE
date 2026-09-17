import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Customer } from '../types';
import CustomerSearch from './CustomerSearch';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn() },
  getErrorMessage: (error: Error) => error.message,
}));
// ค้นหาทันทีที่พิมพ์ (ไม่รอ timer ของ debounce)
vi.mock('@/hooks/useDebounce', () => ({ useDebounce: (v: unknown) => v }));

// แถวตามที่ GET /customers/search คืนจริง — ผู้สนใจจากแชทมี phone = null + ธง chatPlaceholder
const PROSPECT = { id: 'p1', name: 'สมชาย ใจดี', phone: null, nationalId: null, _count: { contracts: 0 }, chatPlaceholder: true };
const REAL = { id: 'c1', name: 'สมชาย ใจงาม', phone: '0812345678', nationalId: '1100000000001', _count: { contracts: 2 }, chatPlaceholder: false };

/** ถือ state แบบเดียวกับหน้า POS — เลือกแถวแล้วการ์ดลูกค้าที่เลือกได้ข้อมูลแถวนั้นตรง ๆ */
function Harness() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Customer | null>(null);
  return (
    <CustomerSearch
      customerSearch={search}
      setCustomerSearch={setSearch}
      selectedCustomer={selected}
      onSelectCustomer={setSelected}
      onClearCustomer={() => setSelected(null)}
    />
  );
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText(/พิมพ์อย่างน้อย 2 ตัวอักษร/), { target: { value: 'สมชาย' } });
}

/** การ์ดลูกค้าที่เลือก = กล่องที่มีปุ่ม "เปลี่ยน" */
const selectedCard = () => screen.getByRole('button', { name: 'เปลี่ยน' }).parentElement!;

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: [PROSPECT, REAL] });
});

describe('POS CustomerSearch — ผู้สนใจจากแชทที่ยังไม่มีเบอร์', () => {
  it('ผลค้นหา: ผู้สนใจโชว์ "จากแชท · ยังไม่มีเบอร์" · ลูกค้าจริงยังโชว์เบอร์', async () => {
    renderSearch();
    const prospect = await screen.findByRole('button', { name: /สมชาย ใจดี/ });
    expect(prospect).toHaveTextContent('จากแชท · ยังไม่มีเบอร์');
    const real = screen.getByRole('button', { name: /สมชาย ใจงาม/ });
    expect(real).toHaveTextContent('0812345678');
    expect(real).not.toHaveTextContent('จากแชท');
    expect(apiGet).toHaveBeenCalledWith('/customers/search', { params: { q: 'สมชาย' } });
  });

  it('เลือกผู้สนใจแล้ว การ์ดลูกค้าโชว์ป้ายแทนเบอร์ว่าง', async () => {
    renderSearch();
    fireEvent.click(await screen.findByRole('button', { name: /สมชาย ใจดี/ }));
    const card = selectedCard();
    expect(card).toHaveTextContent('สมชาย ใจดี');
    expect(card).toHaveTextContent('จากแชท · ยังไม่มีเบอร์ | สัญญา 0 รายการ');
    // เดิม: เบอร์ null ⇒ บรรทัดเหลือแค่ "| สัญญา 0 รายการ" (ช่องเบอร์ว่าง)
    const line = within(card).getByText(/สัญญา 0 รายการ/);
    expect(line.textContent?.trim().startsWith('|')).toBe(false);
  });

  it('เลือกลูกค้าจริง การ์ดยังโชว์เบอร์ + จำนวนสัญญาเหมือนเดิม', async () => {
    renderSearch();
    fireEvent.click(await screen.findByRole('button', { name: /สมชาย ใจงาม/ }));
    const card = selectedCard();
    expect(card).toHaveTextContent('0812345678 | สัญญา 2 รายการ');
    expect(card).not.toHaveTextContent('จากแชท');
  });
});
