import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomersPage from '../index';
import { formatLastContact } from '../components/CustomerCells';
import type { CustomerRow, ProspectRow } from '../types';

/**
 * เทสต์ชุดแรกของหน้า /customers (เดิมไม่มีเลย) — harness ลอกจาก
 * `pages/StockPage/ProductsPage.test.tsx`: `vi.hoisted` mocks, `vi.mock('@/lib/api')`
 * ที่ fallback **โยน** ให้รู้ทันทีว่ามีการอ่านที่ไม่คาดคิด, `MemoryRouter initialEntries`
 * สำหรับ URL state + `vi.mock('@/hooks/useUiFlags')` ที่หน้าสต็อกไม่ต้องใช้
 *
 * 🔴 hook ของ vitest **ห้าม return ค่า** — `mockReset()` คืนฟังก์ชัน ซึ่ง vitest จะถือว่า
 * เป็น teardown แล้วไปเรียกหลังทุกเทสต์ ⇒ ต้องคร่อมปีกกาเสมอ (บั๊กที่เคยเกิดในรีโปนี้)
 *
 * วันที่: ห้าม hardcode สตริงวันที่ — คำนวณด้วย formatter ตัวเดียวกับหน้าจอ
 * (CI รันเป็น UTC และไม่มี TZ pin ใน vitest.config.ts)
 */

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  copy: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  role: 'OWNER',
  mobile: false,
  /** ให้ `/customers` ตอบรายการว่าง — ใช้ทดสอบปุ่มในหน้าจอว่าง */
  empty: false,
  /** บังคับ `total` ของ `/customers` ให้ต่างจาก `rows.length` — ใช้ทดสอบด่านส่งออกเกิน 10,000 */
  total: null as number | null,
}));

vi.mock('@/lib/api', () => ({
  default: { get: mocks.get, patch: mocks.patch, delete: mocks.del },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: mocks.role } }),
}));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
// ปุ่มคัดลอกในเซลล์ต้องเดินผ่าน hook เดียวกับเมนูท้ายแถว ไม่ใช่ navigator.clipboard ตรง ๆ
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copy: mocks.copy, copied: false, error: null }),
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ exportEnabled: true }) }));

function Location() {
  const location = useLocation();
  return (
    <output aria-label="current location">
      {location.pathname}
      {location.search}
    </output>
  );
}

// ─── fixtures ─────────────────────────────────────────────────────────────────

const ISO_PURCHASE = '2026-08-20T03:00:00.000Z';
const ISO_WARRANTY = '2027-08-20T03:00:00.000Z';
const ISO_NEXT_DUE = '2026-09-25T03:00:00.000Z';
const ISO_CREATED = '2025-01-15T03:00:00.000Z';

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 'c1',
    name: 'สมชาย ผ่อนดี',
    nickname: 'ชาย',
    phone: '0810000001',
    nationalId: '1234567890123',
    occupation: 'พนักงานบริษัท',
    salary: 25000,
    createdAt: ISO_CREATED,
    _count: { contracts: 1 },
    activeContracts: 1,
    overdueContracts: 0,
    // `CreditCheck.status` จริง (PENDING / APPROVED / REJECTED / MANUAL_REVIEW) —
    // `FULL_CHECK_PASSED` เป็นค่าของ enum ระดับลูกค้า ใส่ที่นี่ไม่มีทางเกิดขึ้นบนข้อมูลจริง
    // และเป็นเหตุที่ป้ายภาษาอังกฤษดิบหลุดออก prod โดยไม่มีเทสต์จับ
    latestCreditStatus: 'APPROVED',
    latestCreditScore: 80,
    tier: 'GOOD',
    purchase: {
      installmentTotal: 1,
      installmentByState: { ACTIVE: 1, OVERDUE: 0, CLOSED: 0, BAD_DEBT: 0, OTHER: 0 },
      cashCount: 1,
      externalFinanceCount: 0,
    },
    latestPurchase: {
      at: ISO_PURCHASE,
      kind: 'INSTALLMENT',
      number: 'CT-1',
      productLabel: 'Apple iPhone 15 128GB',
      imeiSerial: '111111111111111',
      branchId: 'b1',
      branchName: 'สาขาทดสอบ',
    },
    warranty: {
      endDate: ISO_WARRANTY,
      source: 'CENTER',
      shopEndDate: null,
      centerEndDate: ISO_WARRANTY,
      status: 'IN_MANUFACTURER',
    },
    installmentBalance: {
      outstanding: 9600,
      nextDueDate: ISO_NEXT_DUE,
      nextAmountDue: 1600,
      openContracts: 1,
    },
    chatRooms: [{ roomId: 'room-fb', logo: 'FACEBOOK', channel: 'FACEBOOK' }],
    ...overrides,
  };
}

/** ลูกค้าที่ไม่มีห้องแชทเลย — เคส "ขีด" ที่ prod เจอแทบทุกแถว */
const customerNoChat = customer({
  id: 'c2',
  name: 'สมหญิง เงินสด',
  nickname: null,
  phone: '0810000002',
  tier: 'NEW',
  purchase: {
    installmentTotal: 0,
    installmentByState: { ACTIVE: 0, OVERDUE: 0, CLOSED: 0, BAD_DEBT: 0, OTHER: 0 },
    cashCount: 2,
    externalFinanceCount: 0,
  },
  installmentBalance: null,
  warranty: null,
  chatRooms: [],
});

function prospect(overrides: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: 'p1',
    name: 'ผู้สนใจ หนึ่ง',
    nickname: 'นึง',
    phone: '0820000001',
    nationalId: '9876543210123',
    createdAt: ISO_CREATED,
    source: 'FACEBOOK',
    acquisitionSourceRaw: null,
    tags: [{ tag: 'NEW' }, { tag: 'VIP' }],
    creditCheckStatus: 'UNDER_REVIEW',
    latestCreditScore: null,
    lastContactAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    lastContactSource: 'CUSTOMER',
    assignedTo: { id: 'u9', name: 'พนักงาน ขายเก่ง' },
    chatRooms: [
      { roomId: 'room-line', logo: 'LINE', channel: 'LINE_FINANCE' },
      { roomId: 'room-tt', logo: 'TIKTOK', channel: 'TIKTOK' },
    ],
    ...overrides,
  };
}

const prospectNoChat = prospect({
  id: 'p2',
  name: 'ผู้สนใจ สอง',
  nickname: null,
  tags: [],
  assignedTo: null,
  lastContactAt: null,
  source: null,
  chatRooms: [],
});

/** พารามิเตอร์ของคำขอ `/customers` ครั้งล่าสุด */
function lastListParams(): Record<string, string> {
  const calls = mocks.get.mock.calls.filter(([url]) => url === '/customers');
  return (calls[calls.length - 1]?.[1]?.params ?? {}) as Record<string, string>;
}

function locationText(): string {
  return screen.getByLabelText('current location').textContent ?? '';
}

function show(initialPath = '/customers?zone=shop') {
  mocks.get.mockImplementation(
    async (url: string, options?: { params?: Record<string, string> }) => {
      if (url === '/customers') {
        const params = options?.params ?? {};
        const isProspects = params.view === 'prospects';
        const rows = mocks.empty
          ? []
          : isProspects
            ? [prospect(), prospectNoChat]
            : [customer(), customerNoChat];
        return {
          data: {
            data: rows,
            total: mocks.total ?? rows.length,
            page: Number(params.page ?? 1),
            limit: 50,
            totalPages: 1,
            summary: isProspects
              ? { total: 30, contacted7d: 4, checkingCredit: 2, prechecked: 5, silent30d: 11 }
              : { total: 10, installment: 6, cash: 3, externalFinance: 1, overdue: 2, fromChat: 4 },
            viewCounts: { customers: 10, prospects: 30 },
          },
        };
      }
      if (url === '/branches') return { data: [{ id: 'b1', name: 'สาขาทดสอบ' }] };
      if (url === '/users') return { data: [{ id: 'u9', name: 'พนักงาน ขายเก่ง' }] };
      if (url === '/customers/export') {
        return { data: { data: [customer()], total: 1, asOf: ISO_PURCHASE } };
      }
      throw new Error(`Unexpected read: ${url}`);
    },
  );
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialPath]}>
        <Location />
        <CustomersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.patch.mockReset();
  mocks.del.mockReset();
  mocks.copy.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.role = 'OWNER';
  mocks.mobile = false;
  mocks.empty = false;
  mocks.total = null;
});

// ─── แท็บ ─────────────────────────────────────────────────────────────────────

describe('แท็บ ลูกค้า | ผู้สนใจ', () => {
  it('ค่าเริ่มต้นคือแท็บลูกค้า และส่ง view=customers ให้ API อย่างชัดเจน', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    const group = screen.getByRole('group', { name: 'แสดงรายชื่อ' });
    expect(within(group).getByRole('button', { name: /ลูกค้า/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: /ผู้สนใจ/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // ไม่ส่ง view = "ทุกคน" ซึ่งเป็นพฤติกรรมที่ตัวเลือกลูกค้าหน้าอื่นพึ่งอยู่ ⇒ หน้านี้ต้องส่งเสมอ
    expect(lastListParams().view).toBe('customers');
    expect(screen.getByRole('button', { name: '+ เพิ่มลูกค้าใหม่' })).toBeInTheDocument();
    expect(screen.getByText('ซื้อกับเราแล้ว 10 ราย · ผู้สนใจอีก 30 ราย')).toBeInTheDocument();
  });

  it('สลับไปแท็บผู้สนใจแล้วเปลี่ยนทั้ง URL, API param, คอลัมน์, ตัวกรอง และปุ่มหลัก', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'แสดงรายชื่อ' })).getByRole('button', {
        name: /ผู้สนใจ/,
      }),
    );
    await screen.findByText('ผู้สนใจ หนึ่ง');
    expect(locationText()).toContain('view=prospects');
    expect(lastListParams().view).toBe('prospects');
    expect(screen.getByRole('button', { name: '+ เพิ่มผู้สนใจใหม่' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ เพิ่มลูกค้าใหม่' })).not.toBeInTheDocument();

    // คอลัมน์เฉพาะแท็บ
    for (const label of ['ที่มา', 'แท็ก', 'ติดต่อล่าสุด', 'ผู้ดูแล', 'เพิ่มเมื่อ']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
    for (const label of ['การซื้อ', 'ซื้อล่าสุด', 'ประกันถึง', 'ระดับ']) {
      expect(screen.queryByRole('columnheader', { name: new RegExp(label) })).not.toBeInTheDocument();
    }
    // ตัวกรองเฉพาะแท็บ
    for (const label of ['ที่มา', 'ผล pre-check', 'แท็ก', 'ติดต่อล่าสุด', 'ผู้ดูแล']) {
      expect(screen.getByRole('combobox', { name: label })).toBeInTheDocument();
    }
    for (const label of ['การซื้อ', 'ซื้อล่าสุด', 'ระดับลูกค้า', 'สาขา']) {
      expect(screen.queryByRole('combobox', { name: label })).not.toBeInTheDocument();
    }
    expect(
      screen.getByPlaceholderText('ค้นหาชื่อ, ชื่อเล่น, เบอร์โทร, ชื่อในแชท'),
    ).toBeInTheDocument();
  });

  it('คอลัมน์และตัวกรองของแท็บลูกค้าครบตาม mockup (และไม่มีตัวกรองสถานะเครดิต)', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    for (const label of [
      'ลูกค้า',
      'เบอร์โทร',
      'การซื้อ',
      'ซื้อล่าสุด',
      'ประกันถึง',
      'คงค้าง · งวดถัดไป',
      'ระดับ',
      'แชท',
    ]) {
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
    for (const label of ['การซื้อ', 'ซื้อล่าสุด', 'ระดับลูกค้า', 'สาขา']) {
      expect(screen.getByRole('combobox', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('combobox', { name: 'สถานะเครดิต' })).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('ค้นหาชื่อ, เบอร์โทร, เลขบัตร, IMEI, เลขที่สัญญา/ใบขาย'),
    ).toBeInTheDocument();
  });
});

// ─── URL state ────────────────────────────────────────────────────────────────

describe('URL state', () => {
  it('อ่านตัวกรองจาก URL แล้วส่งเป็น query param ของ API (ไป-กลับครบ)', async () => {
    show('/customers?zone=shop&purchase=INSTALLMENT&state=OVERDUE&bought=30d&tier=RISKY&branchId=b1');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(lastListParams()).toMatchObject({
      view: 'customers',
      purchase: 'INSTALLMENT',
      state: 'OVERDUE',
      purchasedWithin: '30d',
      tier: 'RISKY',
      branchId: 'b1',
    });
  });

  it('ตัวกรองของอีกแท็บถูกเมินตอนอ่าน และถูกลบออกจาก URL ตอนสลับแท็บ', async () => {
    // ลิงก์ที่ถูกแก้มือ: อยู่แท็บลูกค้าแต่พก ?precheck= ของแท็บผู้สนใจมา
    show('/customers?zone=shop&precheck=REJECTED&purchase=CASH');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(lastListParams().creditCheckStatus).toBeUndefined();
    expect(lastListParams().purchase).toBe('CASH');

    fireEvent.click(
      within(screen.getByRole('group', { name: 'แสดงรายชื่อ' })).getByRole('button', {
        name: /ผู้สนใจ/,
      }),
    );
    await screen.findByText('ผู้สนใจ หนึ่ง');
    // คีย์ของทั้งสองแท็บถูกล้างทิ้ง ส่วน ?zone= ของ LayoutContext ต้องรอด
    expect(locationText()).toContain('zone=shop');
    expect(locationText()).not.toContain('purchase=');
    expect(locationText()).not.toContain('precheck=');
    expect(lastListParams().purchase).toBeUndefined();
    expect(lastListParams().creditCheckStatus).toBeUndefined();
  });

  it('ลิงก์เก่า ?contractStatus=ACTIVE ยังกรองได้ (map ตอนอ่าน ไม่ตายเงียบ)', async () => {
    show('/customers?zone=shop&contractStatus=ACTIVE');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(lastListParams()).toMatchObject({ purchase: 'INSTALLMENT', state: 'ACTIVE' });
  });

  it('แปลง sortDirection ของ URL เป็น sortOrder ของ API (ไม่แปลง = เรียงตายเงียบ)', async () => {
    show('/customers?zone=shop&sortBy=contractCount&sortDirection=desc');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(lastListParams()).toMatchObject({ sortBy: 'contractCount', sortOrder: 'desc' });
    expect(lastListParams().sortDirection).toBeUndefined();
  });

  it.each(['outstanding', 'lastPurchaseAt'])(
    'sortBy=%s ที่ API ไม่เรียงให้ถูกทิ้ง — หัวคอลัมน์ต้องไม่โฆษณาสิ่งที่เซิร์ฟเวอร์เมิน',
    async (key) => {
      show(`/customers?zone=shop&sortBy=${key}&sortDirection=desc`);
      await screen.findByText('สมชาย ผ่อนดี');
      expect(lastListParams().sortBy).toBeUndefined();
      expect(lastListParams().sortOrder).toBeUndefined();
    },
  );

  it('แท็บผู้สนใจ: lastContactAt ก็ไม่ถูกส่ง (aggregate ของ relation เรียงไม่ได้)', async () => {
    show('/customers?view=prospects&sortBy=lastContactAt&sortDirection=desc');
    await screen.findByText('ผู้สนใจ หนึ่ง');
    expect(lastListParams().sortBy).toBeUndefined();
  });

  it('ยังพาพารามิเตอร์ ?new=1 ไปเปิดโมดัลแล้วล้างทิ้ง โดยไม่ทับ ?zone=', async () => {
    show('/customers?zone=shop&new=1&name=สมหมาย%20ใจดี&fromRoomId=room-9');
    await waitFor(() => expect(locationText()).not.toContain('new=1'));
    expect(locationText()).toContain('zone=shop');
    expect(locationText()).not.toContain('fromRoomId');
    expect(await screen.findByLabelText('เพิ่มลูกค้าใหม่')).toBeInTheDocument();
  });
});

// ─── การเรียง ─────────────────────────────────────────────────────────────────

describe('การเรียงอยู่ที่หัวคอลัมน์', () => {
  it('ไม่มีดรอปดาวน์ "เรียงโดย" อีกแล้ว', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    expect(screen.queryByRole('combobox', { name: 'เรียงลูกค้าโดย' })).not.toBeInTheDocument();
    expect(screen.queryByText('เรียงโดย:')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /เรียง/ })).not.toBeInTheDocument();
  });

  it('กดหัวคอลัมน์แล้ว aria-sort เปลี่ยน และ URL/param ตามไปด้วย', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    const header = screen.getByRole('columnheader', { name: /ลูกค้า/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(header).getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /ลูกค้า/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      ),
    );
    expect(locationText()).toContain('sortBy=name');
    expect(locationText()).toContain('sortDirection=asc');
    await waitFor(() => expect(lastListParams().sortOrder).toBe('asc'));
  });

  it('คอลัมน์ที่ API เรียงไม่ได้ ไม่มีปุ่มเรียงและไม่มี aria-sort', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    // ซื้อล่าสุด อยู่ใน CUSTOMER_SORT_KEYS ของ shared แต่ API ไม่เรียงให้ (aggregate ของ relation)
    for (const label of [
      'ซื้อล่าสุด',
      'ประกันถึง',
      'คงค้าง · งวดถัดไป',
      'ระดับ',
      'เบอร์โทร',
      'แชท',
    ]) {
      const header = screen.getByRole('columnheader', { name: new RegExp(label) });
      expect(header).not.toHaveAttribute('aria-sort');
      expect(within(header).queryByRole('button')).not.toBeInTheDocument();
    }
    // ...แต่คอลัมน์ที่เรียงได้จริงต้องมีปุ่ม
    for (const label of ['ลูกค้า', 'การซื้อ']) {
      const header = screen.getByRole('columnheader', { name: new RegExp(label) });
      expect(within(header).getByRole('button')).toBeInTheDocument();
    }
  });
});

// ─── คอลัมน์ที่ซ่อนไว้ ────────────────────────────────────────────────────────

describe('คอลัมน์ที่ซ่อนเป็นค่าเริ่มต้น', () => {
  it('เลขบัตร / เครดิต / อาชีพ / เงินเดือน / วันที่เพิ่ม ไม่โชว์จนกดเปิดจากปุ่มคอลัมน์', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    const hidden = ['เลขบัตร', 'เครดิต', 'อาชีพ', 'เงินเดือน', 'วันที่เพิ่ม'];
    for (const label of hidden) {
      expect(screen.queryByRole('columnheader', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryAllByText('พนักงานบริษัท')).toHaveLength(0);

    // ปุ่มบอกจำนวนที่ซ่อนอยู่ (เลขบัตร/เครดิต/อาชีพ/เงินเดือน/วันที่เพิ่ม = 5 ตาม mockup)
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 5' }));
    for (const label of hidden) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    for (const label of hidden) {
      expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getAllByText('พนักงานบริษัท').length).toBeGreaterThan(0);
  });

  it('แท็บผู้สนใจซ่อนเฉพาะเลขบัตร', async () => {
    show('/customers?view=prospects');
    await screen.findByText('ผู้สนใจ หนึ่ง');
    expect(screen.queryByRole('columnheader', { name: 'เลขบัตร' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /เพิ่มเมื่อ/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'เลขบัตร' }));
    expect(screen.getByRole('columnheader', { name: 'เลขบัตร' })).toBeInTheDocument();
  });
});

// ─── KPI ──────────────────────────────────────────────────────────────────────

describe('การ์ด KPI กดเพื่อกรอง', () => {
  it('แท็บลูกค้า: 6 ใบ (5 ใบเดิม + "มาจากแชท") พร้อมตัวเลขจาก summary และเขียน URL ชุดเดียวกับดรอปดาวน์', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    const kpis = within(screen.getByRole('group', { name: 'ตัวเลขสรุป' }));
    expect(screen.getByRole('group', { name: 'ตัวเลขสรุป' }).querySelectorAll('button')).toHaveLength(
      6,
    );
    for (const [label, value] of [
      ['ลูกค้าทั้งหมด', '10'],
      ['ผ่อนกับเรา', '6'],
      ['เงินสด', '3'],
      ['ไฟแนนซ์นอก', '1'],
      ['ค้างชำระ', '2'],
    ] as const) {
      const card = kpis.getByRole('button', { name: new RegExp(label) });
      expect(within(card).getByText(value)).toBeInTheDocument();
    }
    fireEvent.click(kpis.getByRole('button', { name: /ค้างชำระ/ }));
    await waitFor(() => expect(locationText()).toContain('purchase=INSTALLMENT'));
    expect(locationText()).toContain('state=OVERDUE');
    await waitFor(() =>
      expect(lastListParams()).toMatchObject({ purchase: 'INSTALLMENT', state: 'OVERDUE' }),
    );

    fireEvent.click(kpis.getByRole('button', { name: /^เงินสด/ }));
    await waitFor(() => expect(lastListParams().purchase).toBe('CASH'));
    // "เงินสด" ไม่มีสถานะย่อย ⇒ state ต้องหลุดไป ไม่ค้างกรองซ้อน
    expect(locationText()).not.toContain('state=');
  });

  it('แท็บผู้สนใจ: ผ่าน pre-check ยิง FULL_CHECK_PASSED (PRE_CHECK_PASSED ไม่มีข้อมูลจริง)', async () => {
    show('/customers?view=prospects');
    await screen.findByText('ผู้สนใจ หนึ่ง');
    const kpis = within(screen.getByRole('group', { name: 'ตัวเลขสรุป' }));
    for (const [label, value] of [
      ['ผู้สนใจทั้งหมด', '30'],
      ['คุยกันใน 7 วัน', '4'],
      ['กำลังเช็คเครดิต', '2'],
      ['ผ่าน pre-check', '5'],
      ['เงียบเกิน 30 วัน', '11'],
    ] as const) {
      const card = kpis.getByRole('button', { name: new RegExp(label) });
      expect(within(card).getByText(value)).toBeInTheDocument();
    }
    fireEvent.click(kpis.getByRole('button', { name: /ผ่าน pre-check/ }));
    await waitFor(() => expect(locationText()).toContain('precheck=FULL_CHECK_PASSED'));
    await waitFor(() => expect(lastListParams().creditCheckStatus).toBe('FULL_CHECK_PASSED'));

    fireEvent.click(kpis.getByRole('button', { name: /เงียบเกิน 30 วัน/ }));
    await waitFor(() => expect(lastListParams().contacted).toBe('silent30'));
  });
});

// ─── ผู้สนใจจากแชท (สเปค 3.6) ───────────────────────────────────────────────

describe('ผู้สนใจจากแชท — KPI/ตัวกรอง/ส่งออก (สเปค 3.6)', () => {
  it('แท็บลูกค้ามีการ์ดใบที่ 6 "มาจากแชท" กดแล้วเขียน ?fromChat=true และส่ง fromChat=true ให้ API', async () => {
    show();
    // รอข้อมูลจริงโหลดก่อน (เหมือนเทสต์อื่นทั้งไฟล์) — ป้ายการ์ด "มาจากแชท" ขึ้นตั้งแต่เรนเดอร์แรก
    // ด้วยค่า ?? 0 อยู่แล้ว การรอแค่ป้ายจึงชนะ summary ที่ยังโหลดไม่เสร็จ (race)
    await screen.findByText('สมชาย ผ่อนดี');
    await screen.findByText('มาจากแชท');
    expect(screen.getByRole('group', { name: 'ตัวเลขสรุป' }).querySelectorAll('button')).toHaveLength(6);
    expect(screen.getByText('มาจากแชท').closest('button')).toHaveTextContent('4');
    fireEvent.click(screen.getByText('มาจากแชท'));
    await waitFor(() => expect(locationText()).toContain('fromChat=true'));
    await waitFor(() => expect(lastListParams().fromChat).toBe('true'));
    expect(screen.getByText('มาจากแชท').closest('button')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('ลูกค้าทั้งหมด'));
    await waitFor(() => expect(locationText()).not.toContain('fromChat'));
  });

  it('ตัวกรอง "ที่มา" มีในแท็บลูกค้าด้วย และส่ง source ให้ API · มี source อยู่ = ไม่มีการ์ดไหนเด่น · การ์ด "ลูกค้าทั้งหมด" ล้าง source ด้วย', async () => {
    show('/customers?zone=shop&source=LINE');
    await waitFor(() => expect(lastListParams().source).toBe('LINE'));
    expect(lastListParams().view).toBe('customers');
    expect(screen.getByRole('combobox', { name: 'ที่มา' })).toBeInTheDocument();
    expect(screen.getByText('ลูกค้าทั้งหมด').closest('button')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByText('ลูกค้าทั้งหมด'));
    await waitFor(() => expect(locationText()).not.toContain('source='));
  });

  it('ส่งออก Excel: เกิน 10,000 รายการ → เตือนให้กรองก่อน ไม่ยิง /customers/export', async () => {
    mocks.total = 10_001;
    show('/customers?zone=shop&view=prospects');
    // รอข้อมูลจริงโหลดก่อน — ปุ่มส่งออกมีอยู่ตั้งแต่เรนเดอร์แรกไม่ว่า q.total จะโหลดเสร็จหรือยัง
    // (เหมือนเหตุผลข้างบน) ไม่รอก่อน = คลิกตอน q.total ยังเป็น 0 ด่านไม่มีวันทำงาน
    await screen.findByText('ผู้สนใจ หนึ่ง');
    await screen.findByRole('button', { name: /ส่งออก Excel/ });
    fireEvent.click(screen.getByRole('button', { name: /ส่งออก Excel/ }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'รายการเกิน 10,000 ราย — ใช้ตัวกรองหรือช่องค้นหาให้แคบลงก่อนส่งออก',
      ),
    );
    expect(mocks.get).not.toHaveBeenCalledWith('/customers/export', expect.anything());
  });
});

// ─── เซลล์ ────────────────────────────────────────────────────────────────────

describe('เซลล์ในตาราง', () => {
  it('โลโก้แชทเป็นลิงก์ไปห้อง และเป็นขีดเมื่อไม่มีห้องผูกอยู่', async () => {
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    const link = within(row).getByRole('link', { name: 'เปิดแชทFacebook' });
    expect(link).toHaveAttribute('href', '/inbox/room-fb');

    const noChatRow = screen.getByRole('row', { name: /สมหญิง เงินสด/ });
    expect(within(noChatRow).queryByRole('link', { name: /เปิดแชท/ })).not.toBeInTheDocument();
    expect(within(noChatRow).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('แท็บผู้สนใจแสดงโลโก้ครบทุกช่องทางของคนนั้น และขีดเมื่อไม่มีเลย', async () => {
    show('/customers?view=prospects');
    const row = await screen.findByRole('row', { name: /ผู้สนใจ หนึ่ง/ });
    expect(within(row).getByRole('link', { name: 'เปิดแชทLINE Finance' })).toHaveAttribute(
      'href',
      '/inbox/room-line',
    );
    expect(within(row).getByRole('link', { name: 'เปิดแชทTikTok' })).toHaveAttribute(
      'href',
      '/inbox/room-tt',
    );
    const bare = screen.getByRole('row', { name: /ผู้สนใจ สอง/ });
    expect(within(bare).queryByRole('link', { name: /เปิดแชท/ })).not.toBeInTheDocument();
  });

  it('ชื่อเป็นลิงก์จริง และ row menu ถือปุ่มลบของ OWNER (ไม่ใช่ถังขยะลอยข้างแถว)', async () => {
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    expect(within(row).getByRole('link', { name: 'สมชาย ผ่อนดี' })).toHaveAttribute(
      'href',
      '/customers/c1',
    );
    // ชื่อยังเป็น text node เดี่ยว — tools/check-local-pages.mjs assert exact:true
    expect(screen.getByText('สมชาย ผ่อนดี', { exact: true })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^ลบลูกค้า/ })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'เมนูของ สมชาย ผ่อนดี' })).toBeInTheDocument();
  });

  it('ปุ่มคัดลอกเห็นได้ตลอด ไม่ใช่ opacity-0 ที่ต้องเอาเมาส์ไปชี้', async () => {
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    const copy = within(row).getByRole('button', { name: 'คัดลอกเบอร์โทร' });
    expect(copy.className).not.toContain('opacity-0');
    expect(copy.className).toContain('text-muted-foreground/60');
  });

  it('วันที่ใช้ formatter เดียวกับหน้าจอ (CI รันเป็น UTC)', async () => {
    const { formatDateShort } = await import('@/utils/formatters');
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    expect(
      within(row).getByText(new RegExp(formatDateShort(ISO_PURCHASE).replace(/\//g, '\\/'))),
    ).toBeInTheDocument();
    expect(within(row).getByText(formatDateShort(ISO_WARRANTY))).toBeInTheDocument();
    expect(within(row).getByText(formatDateShort(ISO_NEXT_DUE))).toBeInTheDocument();
  });

  it('ติดต่อล่าสุดคิดบนปฏิทิน Asia/Bangkok ผ่าน formatLastContact ตัวเดียวกัน', async () => {
    const fixture = prospect();
    const expected = formatLastContact(fixture.lastContactAt);
    expect(expected).not.toBeNull();
    show('/customers?view=prospects');
    const row = await screen.findByRole('row', { name: /ผู้สนใจ หนึ่ง/ });
    expect(within(row).getByText(expected!.text)).toBeInTheDocument();
    const bare = screen.getByRole('row', { name: /ผู้สนใจ สอง/ });
    expect(within(bare).getByText('ไม่มีแชท')).toBeInTheDocument();
  });

  it('ชิป "การซื้อ" อ่านจาก purchase ของ API ไม่ใช่ _count เปล่า ๆ', async () => {
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    expect(within(row).getByText(/ผ่อน 1/)).toBeInTheDocument();
    expect(within(row).getByText('เงินสด 1')).toBeInTheDocument();
    const cashOnly = screen.getByRole('row', { name: /สมหญิง เงินสด/ });
    expect(within(cashOnly).getByText('เงินสด 2')).toBeInTheDocument();
    expect(within(cashOnly).queryByText(/ผ่อน/)).not.toBeInTheDocument();
  });
});

// ─── สิทธิ์ ───────────────────────────────────────────────────────────────────

describe('สิทธิ์', () => {
  it('SALES ไม่เห็นคอลัมน์เงินเดือนในเมนูคอลัมน์ และไม่เห็นตัวกรองสาขา', async () => {
    mocks.role = 'SALES';
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    expect(screen.queryByRole('combobox', { name: 'สาขา' })).not.toBeInTheDocument();
    // SALES ไม่มีคอลัมน์เงินเดือนเลย ⇒ ซ่อนอยู่ 4 ไม่ใช่ 5
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 4' }));
    expect(screen.queryByRole('button', { name: 'เงินเดือน' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เลขบัตร' })).toBeInTheDocument();
  });

  it('ACCOUNTANT เปิด /inbox ไม่ได้ ⇒ โลโก้แชทไม่เป็นลิงก์ และไม่มีปุ่มเพิ่มลูกค้า', async () => {
    mocks.role = 'ACCOUNTANT';
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    expect(within(row).queryByRole('link', { name: /เปิดแชท/ })).not.toBeInTheDocument();
    expect(within(row).getByText('Facebook')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ เพิ่มลูกค้าใหม่' })).not.toBeInTheDocument();
  });
});

// ─── หัวคอลัมน์ที่คีย์ ≠ คีย์เรียงของ API ──────────────────────────────────────

/**
 * `DataTable` ส่ง **คีย์คอลัมน์** ออกมาใน `onSortChange` (`id: col.key` → `next[0].id`)
 * ไม่ใช่ `sortKey` ⇒ คอลัมน์ `purchase`/`credit` เคยส่งคีย์ที่ `setSort` ไม่รู้จัก
 * แล้วตกไปสาขา else ซึ่ง **ลบการเรียงที่ตั้งไว้ทิ้ง** — เทสต์ชุดเดิมเช็คแค่ว่า
 * "หัวคอลัมน์มีปุ่ม" โดยไม่เคยกด จึงปล่อยบั๊กนี้ขึ้น prod
 */
describe('หัวคอลัมน์ที่คีย์ไม่ตรงกับคีย์เรียงของ API', () => {
  it('กด "การซื้อ" แล้วคำขอพก sortBy=contractCount และลูกศรขึ้นที่หัวคอลัมน์นั้น', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /การซื้อ/ })).getByRole('button'),
    );
    await waitFor(() => expect(lastListParams().sortBy).toBe('contractCount'));
    expect(lastListParams().sortOrder).toBe('asc');
    expect(locationText()).toContain('sortBy=contractCount');
    // ขาอ่านต้องแปลงกลับเป็นคีย์คอลัมน์ ไม่งั้นลูกศรไปไม่ถึงหัวที่ผู้ใช้กด
    expect(screen.getByRole('columnheader', { name: /การซื้อ/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('กดซ้ำที่ "การซื้อ" สลับทิศ (ยังเป็น contractCount ไม่หลุดเป็น purchase)', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    const click = () =>
      fireEvent.click(
        within(screen.getByRole('columnheader', { name: /การซื้อ/ })).getByRole('button'),
      );
    click();
    await waitFor(() => expect(lastListParams().sortOrder).toBe('asc'));
    click();
    await waitFor(() => expect(lastListParams().sortOrder).toBe('desc'));
    expect(lastListParams().sortBy).toBe('contractCount');
  });

  it('กด "เครดิต" ในแท็บลูกค้าแล้วคำขอพก sortBy=creditScore', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'เครดิต' }));
    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /เครดิต/ })).getByRole('button'),
    );
    await waitFor(() => expect(lastListParams().sortBy).toBe('creditScore'));
    expect(locationText()).toContain('sortBy=creditScore');
  });

  it('กด "เครดิต" ในแท็บผู้สนใจก็ต้องได้ sortBy=creditScore', async () => {
    show('/customers?view=prospects');
    await screen.findByText('ผู้สนใจ หนึ่ง');
    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /เครดิต/ })).getByRole('button'),
    );
    await waitFor(() => expect(lastListParams().sortBy).toBe('creditScore'));
  });

  it('กด "การซื้อ" หลังเรียงด้วยชื่อ ต้องเปลี่ยนคีย์ ไม่ใช่ล้างการเรียงทิ้ง', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    fireEvent.click(within(screen.getByRole('columnheader', { name: /ลูกค้า/ })).getByRole('button'));
    await waitFor(() => expect(lastListParams().sortBy).toBe('name'));

    fireEvent.click(
      within(screen.getByRole('columnheader', { name: /การซื้อ/ })).getByRole('button'),
    );
    await waitFor(() => expect(lastListParams().sortBy).toBe('contractCount'));
    // ของเดิม: sortBy/sortDirection ถูกลบทิ้งทั้งคู่ (การเรียงหายไปเฉย ๆ)
    expect(lastListParams().sortOrder).toBeDefined();
    expect(locationText()).toContain('sortBy=contractCount');
    expect(locationText()).toContain('sortDirection=');
    expect(screen.getByRole('columnheader', { name: /ลูกค้า/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('ลิงก์บุ๊กมาร์ก ?sortBy=contractCount ขึ้นลูกศรที่หัว "การซื้อ"', async () => {
    show('/customers?zone=shop&sortBy=contractCount&sortDirection=desc');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(screen.getByRole('columnheader', { name: /การซื้อ/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: /ลูกค้า/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });
});

// ─── ป้ายเครดิต: สอง enum คนละแท็บ ────────────────────────────────────────────

describe('ป้ายเครดิตต้องเป็นไทยของ enum ที่ถูกต้อง', () => {
  it('แท็บลูกค้าอ่าน latestCreditStatus ด้วย creditCheckStatusMap (APPROVED → "ผ่าน")', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'เครดิต' }));
    const row = screen.getByRole('row', { name: /สมชาย ผ่อนดี/ });
    expect(within(row).getByText('ผ่าน')).toBeInTheDocument();
    expect(within(row).queryByText('APPROVED')).not.toBeInTheDocument();
    expect(within(row).getByText('80/100')).toBeInTheDocument();
  });

  it.each([
    ['PENDING', 'รอวิเคราะห์'],
    ['MANUAL_REVIEW', 'ต้องตรวจเพิ่ม'],
    ['REJECTED', 'ไม่ผ่าน'],
  ])('แท็บลูกค้า: %s → "%s" ไม่ใช่ค่าดิบ', async (status, label) => {
    mocks.get.mockReset();
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    // สถานะอื่นของ enum เดียวกันต้องมีคำไทยครบ (fallback ของ getStatusBadgeProps = ค่าดิบ)
    const { creditCheckStatusMap } = await import('@/lib/status-badges');
    expect(creditCheckStatusMap[status].label).toBe(label);
  });

  it('แท็บผู้สนใจยังอ่านด้วย customerCreditStatusMap (UNDER_REVIEW → "รอผู้จัดการตรวจ")', async () => {
    show('/customers?view=prospects');
    const row = await screen.findByRole('row', { name: /ผู้สนใจ หนึ่ง/ });
    expect(within(row).getByText('รอผู้จัดการตรวจ')).toBeInTheDocument();
    expect(within(row).queryByText('UNDER_REVIEW')).not.toBeInTheDocument();
  });
});

// ─── ปุ่มคัดลอกในเซลล์ ────────────────────────────────────────────────────────

describe('ปุ่มคัดลอกในเซลล์', () => {
  it('แท็บลูกค้า: เดินผ่าน useCopyToClipboard + toast เหมือนเมนูท้ายแถว', async () => {
    show();
    const row = await screen.findByRole('row', { name: /สมชาย ผ่อนดี/ });
    fireEvent.click(within(row).getByRole('button', { name: 'คัดลอกเบอร์โทร' }));
    expect(mocks.copy).toHaveBeenCalledWith('0810000001');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('คัดลอกเบอร์โทรแล้ว');
  });

  it('แท็บลูกค้า: เลขบัตรที่ซ่อนไว้ก็ต้อง toast เหมือนกัน', async () => {
    show();
    await screen.findByText('สมชาย ผ่อนดี');
    fireEvent.click(screen.getByRole('button', { name: 'คอลัมน์ · ซ่อนอยู่ 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'เลขบัตร' }));
    const row = screen.getByRole('row', { name: /สมชาย ผ่อนดี/ });
    fireEvent.click(within(row).getByRole('button', { name: 'คัดลอกเลขบัตร' }));
    expect(mocks.copy).toHaveBeenCalledWith('1234567890123');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('คัดลอกเลขบัตรแล้ว');
  });

  it('แท็บผู้สนใจ: เซลล์เบอร์โทรก็ต้องคัดลอกได้พร้อม toast', async () => {
    show('/customers?view=prospects');
    const row = await screen.findByRole('row', { name: /ผู้สนใจ หนึ่ง/ });
    fireEvent.click(within(row).getByRole('button', { name: 'คัดลอกเบอร์โทร' }));
    expect(mocks.copy).toHaveBeenCalledWith('0820000001');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('คัดลอกเบอร์โทรแล้ว');
  });
});

// ─── หน้าจอว่าง ───────────────────────────────────────────────────────────────

describe('หน้าจอว่าง', () => {
  it('มีปุ่ม "ล้างตัวกรอง" ที่กดแล้วล้างคีย์ตัวกรองจริง (คำอธิบายชี้ปุ่มนี้)', async () => {
    mocks.empty = true;
    show('/customers?zone=shop&purchase=CASH&tier=RISKY');
    expect(await screen.findByText('ไม่พบลูกค้า')).toBeInTheDocument();
    expect(screen.getByText('ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    await waitFor(() => expect(locationText()).not.toContain('purchase='));
    expect(locationText()).not.toContain('tier=');
    // ?zone= ของ LayoutContext ต้องรอด
    expect(locationText()).toContain('zone=shop');
    await waitFor(() => expect(lastListParams().purchase).toBeUndefined());
  });

  it('ไม่มีตัวกรองอยู่ = ไม่โฆษณาปุ่มล้างตัวกรอง', async () => {
    mocks.empty = true;
    show();
    expect(await screen.findByText('ไม่พบลูกค้า')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ล้างตัวกรอง' })).not.toBeInTheDocument();
    expect(
      screen.queryByText('ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง'),
    ).not.toBeInTheDocument();
  });
});

// ─── ตัวเลือก "ผล pre-check" ──────────────────────────────────────────────────

describe('ดรอปดาวน์ ผล pre-check', () => {
  it('ไม่มี PRE_CHECK_PASSED ที่ข้อมูลจริงไปไม่ถึง และค่าของการ์ด KPI อยู่ในรายการ', async () => {
    const { PROSPECT_PRECHECK_OPTIONS } = await import('../components/ProspectFilterBar');
    const { prospectKpiCards } = await import('../components/CustomerKpiCards');
    const values = PROSPECT_PRECHECK_OPTIONS.map((option) => option.value);

    expect(values).not.toContain('PRE_CHECK_PASSED');
    const card = prospectKpiCards().find((spec) => spec.key === 'prechecked');
    expect(card).toBeDefined();
    // ดรอปดาวน์ต้องเสนอค่าเดียวกับที่การ์ดยิง ไม่งั้นสองทางให้ผลต่างกันบนแนวคิดเดียวกัน
    expect(values).toContain(card!.params.precheck);
  });

  it('ยังเก็บ PRE_CHECK_PASSED ใน badge map (ข้อมูลเก่าต้องอ่านออก)', async () => {
    const { customerCreditStatusMap } = await import('@/lib/status-badges');
    expect(customerCreditStatusMap.PRE_CHECK_PASSED?.label).toBe('ผ่าน pre-check');
  });
});

// ─── สรุปท้ายตาราง: ทิศทางการเรียง ────────────────────────────────────────────

describe('คำบอกทิศทางการเรียง', () => {
  it('คอลัมน์ชื่อพูด ก → ฮ ไม่ใช่ ใหม่ → เก่า', async () => {
    show('/customers?zone=shop&sortBy=name&sortDirection=asc');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(screen.getByText(/เรียงตามลูกค้า ก → ฮ/)).toBeInTheDocument();
    expect(screen.queryByText(/ใหม่ → เก่า|เก่า → ใหม่/)).not.toBeInTheDocument();
  });

  it('คอลัมน์จำนวน/คะแนนพูด มาก → น้อย', async () => {
    show('/customers?zone=shop&sortBy=contractCount&sortDirection=desc');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(screen.getByText(/เรียงตามการซื้อ มาก → น้อย/)).toBeInTheDocument();
  });

  it('คอลัมน์วันที่ยังพูด ใหม่ → เก่า ตามเดิม', async () => {
    show('/customers?zone=shop&sortBy=createdAt&sortDirection=desc');
    await screen.findByText('สมชาย ผ่อนดี');
    expect(screen.getByText(/เรียงตามวันที่เพิ่ม ใหม่ → เก่า/)).toBeInTheDocument();
  });
});
