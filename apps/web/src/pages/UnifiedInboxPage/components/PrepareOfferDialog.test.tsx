import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PrepareOfferDialog from './PrepareOfferDialog';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  auth: vi.fn(() => ({ user: { id: 'staff', role: 'SALES', accessibleCompanies: ['SHOP'] } })),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: mocks.auth }));
vi.mock('@/lib/api', () => ({ default: { post: mocks.post }, getErrorMessage: () => 'ไม่มีสิทธิ์เข้าถึงห้องนี้' }));

const result = {
  roomId: 'room1', status: 'draft', aiStatus: 'ready', summary: 'สนใจ iPhone 15',
  query: 'iPhone 15', maxPriceThb: 20000, budgetSource: 'chat', createdAt: '2026-09-08T05:00:00Z',
  sources: [{ messageId: 'message1', createdAt: '2026-09-08T04:00:00Z', excerpt: 'สนใจ iPhone 15 งบไม่เกิน 20000 บาท' }],
  products: [{ productId: 'p1', name: 'iPhone 15', branchName: 'สาขาทดสอบ', cashPriceThb: 19000,
    productPath: '/products/p1', contractPath: '/contracts/create?customerId=c1&productId=p1&fromRoom=room1&months=12',
    quote: { monthlyThb: 1500.25, tenureMonths: 12, downAmountThb: 3000 }, draft: 'ร่างจากเครื่องคิดกลาง 1,500.25 บาท' }],
  nextStep: 'ตรวจเครดิตและทบทวนก่อนทำสัญญา',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ user: { id: 'staff', role: 'SALES', accessibleCompanies: ['SHOP'] } });
  mocks.post.mockResolvedValue({ data: result });
});

function mount(roomId = 'room1') {
  const onInsert = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui = (id: string) => <QueryClientProvider client={client}><MemoryRouter><PrepareOfferDialog roomId={id} onInsert={onInsert} /></MemoryRouter></QueryClientProvider>;
  const view = render(ui(roomId));
  return { onInsert, changeRoom: (id: string) => view.rerender(ui(id)) };
}

async function prepare() {
  fireEvent.click(screen.getByRole('button', { name: 'เตรียมข้อเสนอ' }));
  fireEvent.click(await screen.findByRole('button', { name: 'สรุปและค้นข้อเสนอ' }));
}

describe('PrepareOfferDialog', () => {
  it('waits for staff action, shows sourced prices, and only inserts a draft when explicitly selected', async () => {
    const { onInsert } = mount();
    expect(mocks.post).not.toHaveBeenCalled();
    await prepare();
    expect(await screen.findByText('ร่างข้อเสนอ · ยังไม่ได้ส่งหรือบันทึกการขาย')).toBeInTheDocument();
    expect(screen.getByText(/1,500.25 บาท\/งวด/)).toBeInTheDocument();
    expect(screen.getByText(/อ้างอิงข้อความลูกค้า 1 ข้อความ/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('ดูข้อความลูกค้าที่ใช้อ้างอิง'));
    expect(screen.getByText(result.sources[0].excerpt)).toBeVisible();
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'ตรวจเครดิตและทำสัญญา' })).toHaveAttribute('href', result.products[0].contractPath);
    fireEvent.click(screen.getByRole('button', { name: 'แทรกร่างในช่องพิมพ์' }));
    expect(onInsert).toHaveBeenCalledExactlyOnceWith(result.products[0].draft);
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/staff-chat/rooms/room1/prepare-offer', { query: undefined, maxPriceThb: undefined, tenureMonths: 12 });
  });

  it.each([
    { role: 'VIEWER', accessibleCompanies: ['SHOP'] },
    { role: 'SALES', accessibleCompanies: ['FINANCE'] },
    { role: 'FINANCE_MANAGER', accessibleCompanies: ['SHOP', 'FINANCE'] },
  ])('hides the action for unsupported role/company %j', (actor) => {
    mocks.auth.mockReturnValue({ user: { id: 'staff', ...actor } });
    mount();
    expect(screen.queryByRole('button', { name: 'เตรียมข้อเสนอ' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  // ก่อน 2026-09-10 เงื่อนไขคือ user.accessibleCompanies?.includes('SHOP') — และไม่มีแถวไหนใน prod
  // ที่คอลัมน์นี้ไม่ว่าง ปุ่มนี้จึงหายไปจากทุกคนเงียบ ๆ array ว่าง = ยังไม่ตั้งค่า ไม่ใช่ไม่มีสิทธิ์
  it('keeps the action for a SHOP role whose companies were never backfilled', () => {
    mocks.auth.mockReturnValue({ user: { id: 'staff', role: 'SALES', accessibleCompanies: [] } });
    mount();
    expect(screen.getByRole('button', { name: 'เตรียมข้อเสนอ' })).toBeInTheDocument();
  });

  it('does not display a late response from another room', async () => {
    let resolve!: (value: { data: typeof result }) => void;
    mocks.post.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { changeRoom, onInsert } = mount();
    await prepare();
    changeRoom('room2');
    resolve({ data: result });
    await waitFor(() => expect(screen.getByRole('button', { name: 'สรุปและค้นข้อเสนอ' })).toBeEnabled());
    expect(screen.queryByText('สนใจ iPhone 15')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'แทรกร่างในช่องพิมพ์' })).not.toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('allows a manual product search when AI is unavailable and omits unlinked contract actions', async () => {
    mocks.post.mockResolvedValue({ data: { ...result, aiStatus: 'unavailable', products: [{ ...result.products[0], contractPath: null }] } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'เตรียมข้อเสนอ' }));
    fireEvent.change(await screen.findByLabelText('รุ่นหรือความต้องการ'), { target: { value: ' iPhone 15 ' } });
    fireEvent.change(screen.getByLabelText('งบราคาเงินสดสูงสุด (บาท)'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('จำนวนงวดที่ต้องการ'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'สรุปและค้นข้อเสนอ' }));
    expect(await screen.findByText(/AI ยังสรุปไม่ได้/)).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/staff-chat/rooms/room1/prepare-offer', { query: 'iPhone 15', maxPriceThb: 20000, tenureMonths: 10 });
    expect(screen.queryByRole('link', { name: 'ตรวจเครดิตและทำสัญญา' })).not.toBeInTheDocument();
  });

  it('shows a permission failure without a draft and permits an explicit retry', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Forbidden'));
    const { onInsert } = mount();
    await prepare();
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่มีสิทธิ์เข้าถึงห้องนี้');
    expect(screen.queryByRole('button', { name: 'แทรกร่างในช่องพิมพ์' })).not.toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'สรุปและค้นข้อเสนอ' }));
    expect(await screen.findByText('สนใจ iPhone 15')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
