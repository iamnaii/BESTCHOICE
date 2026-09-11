import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StockProductsPage from './ProductsPage';
import type { StockProduct } from './types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), role: 'OWNER', mobile: false }));
vi.mock('@/lib/api', () => ({
  default: { get: mocks.get },
  getErrorMessage: () => 'โหลดไม่สำเร็จ',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mocks.mobile }));

const config = {
  minDownPct: 0.15,
  commissionPct: 0.1,
  vatPct: 0.07,
  ratePctByMonths: { 6: 0.4, 12: 0.5 },
  allowedMonths: [6, 12],
};

function product(overrides: Partial<StockProduct> = {}): StockProduct {
  return {
    id: 'used-1',
    name: 'iPhone 13',
    brand: 'Apple',
    model: 'iPhone 13',
    imeiSerial: '123456789012345',
    category: 'PHONE_USED',
    costPrice: '10000',
    cashPrice: '15900',
    installmentPrice: '19900',
    status: 'IN_STOCK',
    color: 'Black',
    storage: '128GB',
    batteryHealth: null,
    hasBox: null,
    warrantyExpired: null,
    warrantyExpireDate: null,
    branch: { id: 'branch-1', name: 'สาขาทดสอบ' },
    supplier: null,
    // Old mirror rows must not override the canonical product columns.
    prices: [
      { id: 'cash', label: 'ราคาเงินสด', amount: '9900', isDefault: true },
      { id: 'installment', label: 'ราคาผ่อน BESTCHOICE', amount: '29900', isDefault: false },
    ],
    ...overrides,
  };
}

// เทสชุดเดิมเปิดที่มุมมอง "ทั้งหมด" (ตัวกรองสถานะ + คอลัมน์สถานะอยู่ครบเหมือนก่อนมีสวิตช์) —
// ค่าเริ่มต้นจริงของหน้าคือ "พร้อมขาย" ซึ่งมี describe ของตัวเองด้านล่าง
const ALL_VIEW_PATH = '/stock/products?zone=shop&view=all';
const DEFAULT_VIEW_PATH = '/stock/products?zone=shop';

function showProducts(
  products: StockProduct[],
  failConfig = false,
  resolvedConfig = config,
  groups?: StockProduct[],
  initialPath = ALL_VIEW_PATH,
) {
  mocks.get.mockImplementation(
    async (url: string, options?: { params: Record<string, string> }) => {
      if (url === '/products') {
        const params = options?.params ?? {};
        const source = params.groupAccessories === 'true' && groups ? groups : products;
        // base = ตัวกรองทุกอย่างยกเว้นสถานะ — เหมือน viewCounts ของ API ที่นับทั้งสองฝั่งของสวิตช์
        const base = source.filter(
          (item) =>
            (!params.search ||
              `${item.brand} ${item.model} ${item.imeiSerial}`.includes(params.search)) &&
            (!params.category || item.category === params.category) &&
            (!params.branchId || item.branch.id === params.branchId),
        );
        const matches = base.filter(
          (item) => !params.status || params.status.split(',').includes(item.status),
        );
        const page = Number(params.page ?? 1);
        return {
          data: {
            data: matches.slice((page - 1) * 50, page * 50),
            total: matches.length,
            page,
            totalPages: Math.max(1, Math.ceil(matches.length / 50)),
            viewCounts: {
              ready: base.filter((item) => item.status === 'IN_STOCK').length,
              all: base.length,
            },
          },
        };
      }
      if (url === '/branches') return { data: [{ id: 'branch-1', name: 'สาขาทดสอบ' }] };
      if (url.startsWith('/interest-configs/resolved')) {
        if (failConfig) throw new Error('config unavailable');
        return {
          data: url.endsWith('PHONE_NEW')
            ? { ...config, minDownPct: 0.2, allowedMonths: [6] }
            : resolvedConfig,
        };
      }
      throw new Error(`Unexpected read: ${url}`);
    },
  );
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialPath]}>
        <StockProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.role = 'OWNER';
  mocks.mobile = false;
});

describe('Stock product pricing', () => {
  it('shows cost, cash, starting down and monthly quote without the installment selling price', async () => {
    showProducts([product(), product({ id: 'used-2', model: 'iPhone 14' })]);
    await screen.findAllByText('2,985 ฿');
    for (const label of ['ราคาทุน', 'ราคาเต็มจำนวน', 'ดาวน์', 'ยอดผ่อนต่อเดือน']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    const row = screen.getByRole('row', { name: /iPhone 13/ });
    expect(within(row).getByRole('button', { name: 'iPhone 13' })).toBeInTheDocument();
    for (const value of ['10,000 ฿', '15,900 ฿', '2,985 ฿', '2,413.20 ฿', 'ต่อเดือน · 12 งวด']) {
      expect(within(row).getByText(value)).toBeInTheDocument();
    }
    expect(within(row).queryByText('29,900 ฿')).not.toBeInTheDocument();
    expect(within(row).queryByText('19,900 ฿')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'ขายผ่อน' })).not.toBeInTheDocument();
    expect(
      mocks.get.mock.calls.filter(
        ([url]) => url === '/interest-configs/resolved?category=PHONE_USED',
      ),
    ).toHaveLength(1);
    expect(within(row).getByRole('button', { name: 'จัดการราคา' })).toBeInTheDocument();
  });

  it('uses category-specific terms and falls back to legacy selling price rows', async () => {
    showProducts([
      product(),
      product({ id: 'new-1', model: 'iPhone 16', category: 'PHONE_NEW' }),
      product({ id: 'legacy', model: 'iPhone 12', cashPrice: null, installmentPrice: null }),
    ]);
    await screen.findByText('3,980 ฿');
    expect(
      within(screen.getByRole('row', { name: /iPhone 16/ })).getByText('ต่อเดือน · 6 งวด'),
    ).toBeInTheDocument();
    const legacy = within(screen.getByRole('row', { name: /iPhone 12/ }));
    expect(legacy.getByText('9,900 ฿')).toBeInTheDocument();
    expect(legacy.queryByText('29,900 ฿')).not.toBeInTheDocument();
    expect(legacy.getByText('4,485 ฿')).toBeInTheDocument();
  });

  it('hides cost and price editing for sales staff', async () => {
    mocks.role = 'SALES';
    showProducts([product()]);
    await screen.findByText('2,985 ฿');
    expect(screen.queryByRole('columnheader', { name: 'ราคาทุน' })).not.toBeInTheDocument();
    expect(screen.queryByText('10,000 ฿')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'จัดการราคา' })).not.toBeInTheDocument();
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
  });

  it('preserves zero cost while leaving missing prices and unsupported quotes blank', async () => {
    showProducts([
      product({ costPrice: '0', cashPrice: null, installmentPrice: null, prices: [] }),
      product({ id: 'accessory', model: 'Case', name: 'Case', category: 'ACCESSORY' }),
    ]);
    await screen.findByText('0 ฿');
    const blank = within(screen.getByRole('row', { name: /iPhone 13/ }));
    expect(blank.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText(/ต่อเดือน ·/)).not.toBeInTheDocument();
    expect(mocks.get.mock.calls.some(([url]) => url.startsWith('/interest-configs/'))).toBe(false);
  });

  it('shows a recoverable config error without fabricating down or monthly amounts', async () => {
    showProducts([product()], true);
    await screen.findByRole('alert');
    expect(screen.getByText('โหลดไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.queryByText(/ต่อเดือน ·/)).not.toBeInTheDocument();
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
    mocks.get.mockResolvedValueOnce({ data: config });
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText('2,985 ฿');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('explains when the category has no configured installment plan', async () => {
    showProducts([product()], false, { ...config, allowedMonths: [] });
    await screen.findByText('ยังไม่มีเงื่อนไขผ่อน');
    expect(screen.queryByText(/ต่อเดือน ·/)).not.toBeInTheDocument();
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
  });

  it('does not attach a category config error to a cash-only product', async () => {
    showProducts(
      [
        product(),
        product({ id: 'cash-only', model: 'iPhone SE', installmentPrice: null, prices: [] }),
      ],
      true,
    );
    await screen.findByRole('alert');
    const cashOnly = within(screen.getByRole('row', { name: /iPhone SE/ }));
    expect(cashOnly.queryByText('โหลดไม่สำเร็จ')).not.toBeInTheDocument();
    expect(cashOnly.getByText('15,900 ฿')).toBeInTheDocument();
    expect(cashOnly.getAllByText('—')).toHaveLength(2);
  });
});

describe('New phone stock view', () => {
  it('separates model, specifications, cash total, terms, status and branch in the requested order', async () => {
    showProducts([
      product({ id: 'new', model: 'iPhone 16', category: 'PHONE_NEW' }),
      product({
        id: 'new-missing',
        model: 'iPhone 16 Pro',
        category: 'PHONE_NEW',
        storage: null,
        color: null,
      }),
    ]);
    await screen.findByText('iPhone 16');
    fireEvent.click(screen.getByRole('button', { name: 'มือ 1' }));
    await screen.findByRole('row', { name: /iPhone 16 Pro/ });
    expect(
      screen
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
        .filter(Boolean),
    ).toEqual([
      'รุ่น',
      'ความจุ',
      'สี',
      'ราคาเต็มจำนวน',
      'ดาวน์',
      'ยอดผ่อนต่อเดือน',
      'วันที่รับเข้า',
      'สถานะ',
      'สาขา',
    ]);
    const row = within(screen.getByRole('row', { name: /iPhone 16 123456789012345/ }));
    const cells = row.getAllByRole('cell');
    expect(cells[2]).toHaveTextContent('128GB');
    expect(cells[3]).toHaveTextContent('Black');
    expect(cells[4]).toHaveTextContent('15,900 ฿');
    expect(cells[5]).toHaveTextContent('3,980 ฿');
    expect(cells[6]).toHaveTextContent('ต่อเดือน · 6 งวด');
    expect(cells[7]).toHaveTextContent('ยังไม่ระบุ');
    expect(cells[8]).toHaveTextContent('พร้อมขาย');
    expect(cells[8]).not.toHaveTextContent('สาขาทดสอบ');
    expect(cells[9]).toHaveTextContent('สาขาทดสอบ');
    expect(cells[1]).not.toHaveTextContent('128GB');
    expect(cells[1]).not.toHaveTextContent('Black');
    expect(row.queryByText('19,900 ฿')).not.toBeInTheDocument();
    expect(row.queryByText('29,900 ฿')).not.toBeInTheDocument();
    const missing = within(screen.getByRole('row', { name: /iPhone 16 Pro/ })).getAllByRole('cell');
    expect(missing[2]).toHaveTextContent('—');
    expect(missing[3]).toHaveTextContent('—');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'แบ่งประเภทสินค้า' })).getByRole('button', {
        name: 'ทั้งหมด',
      }),
    );
    await screen.findByRole('columnheader', { name: 'ราคาทุน' });
    expect(screen.getByRole('columnheader', { name: 'ราคาเต็มจำนวน' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'สถานะ' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'สาขา' })).toBeInTheDocument();
  });

  it('keeps new phone specifications and branch visible in mobile cards', async () => {
    mocks.mobile = true;
    showProducts([product({ category: 'PHONE_NEW' })]);
    await screen.findByText('iPhone 13');
    fireEvent.click(screen.getByRole('button', { name: 'มือ 1' }));
    await screen.findByRole('list', { name: 'รายการสินค้า' });
    const card = within(
      within(screen.getByRole('list', { name: 'รายการสินค้า' })).getByRole('listitem'),
    );
    for (const value of [
      'ความจุ',
      '128GB',
      'สี',
      'Black',
      'ราคาเต็มจำนวน',
      '15,900 ฿',
      'ดาวน์',
      '3,980 ฿',
      'ยอดผ่อนต่อเดือน',
      'ต่อเดือน · 6 งวด',
      'พร้อมขาย',
      'สาขาทดสอบ',
    ]) {
      expect(card.getByText(value)).toBeInTheDocument();
    }
    expect(card.queryByText('19,900 ฿')).not.toBeInTheDocument();
  });
});

describe('Used phone stock view', () => {
  it.each([false, true])(
    'shows used-device condition and prices without inventing missing information (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([
        product({
          batteryHealth: 87,
          hasBox: true,
          warrantyExpired: false,
          warrantyExpireDate: '2027-03-12T12:00:00',
        }),
        product({
          id: 'expired',
          model: 'iPhone 14',
          batteryHealth: 0,
          hasBox: false,
          warrantyExpired: true,
          warrantyExpireDate: '2030-01-01T12:00:00',
        }),
        product({ id: 'unknown', model: 'iPhone SE', warrantyExpired: false }),
      ]);
      await screen.findByText('iPhone 13');
      fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
      await screen.findByText('87%');
      if (!mobile) {
        expect(
          screen
            .getAllByRole('columnheader')
            .map((header) => header.textContent)
            .filter(Boolean),
        ).toEqual([
          'รุ่น',
          'ความจุ',
          'สี',
          '%แบตเตอรี่',
          'มีกล่อง',
          'ประกันศูนย์',
          'ราคาเต็มจำนวน',
          'ดาวน์',
          'ยอดผ่อนต่อเดือน',
          'วันที่รับเข้า',
          'สถานะ',
          'สาขา',
        ]);
      }
      const rows = mobile
        ? within(screen.getByRole('list', { name: 'รายการสินค้า' })).getAllByRole('listitem')
        : screen.getAllByRole('row').slice(1);
      const full = within(rows[0]);
      expect(full.getByRole('button', { name: 'iPhone 13' })).toBeInTheDocument();
      for (const value of [
        '128GB',
        'Black',
        '87%',
        'มี',
        'ถึง 12/03/2570',
        '15,900 ฿',
        '2,985 ฿',
        '2,413.20 ฿',
        'ต่อเดือน · 12 งวด',
        'พร้อมขาย',
        'สาขาทดสอบ',
      ]) {
        expect(full.getByText(value)).toBeInTheDocument();
      }
      expect(full.queryByText('19,900 ฿')).not.toBeInTheDocument();
      expect(full.queryByText('29,900 ฿')).not.toBeInTheDocument();
      const expired = within(rows[1]);
      expect(expired.getByText('0%')).toBeInTheDocument();
      expect(expired.getByText('ไม่มี')).toBeInTheDocument();
      expect(expired.getByText('หมดประกันแล้ว')).toBeInTheDocument();
      expect(expired.queryByText('ถึง 01/01/2573')).not.toBeInTheDocument();
      const unknown = within(rows[2]);
      expect(unknown.getByText('—')).toBeInTheDocument();
      expect(unknown.getAllByText('ยังไม่ระบุ')).toHaveLength(3);
      expect(unknown.queryByText('ไม่มี')).not.toBeInTheDocument();
      expect(unknown.queryByText('หมดประกันแล้ว')).not.toBeInTheDocument();
      if (mobile) {
        for (const label of [
          'ความจุ',
          'สี',
          '%แบตเตอรี่',
          'มีกล่อง',
          'ประกันศูนย์',
          'ราคาเต็มจำนวน',
          'ดาวน์',
          'ยอดผ่อนต่อเดือน',
        ]) {
          expect(full.getByText(label)).toBeInTheDocument();
        }
      } else {
        const cells = full.getAllByRole('cell');
        for (const [index, value] of [
          [2, '128GB'],
          [3, 'Black'],
          [4, '87%'],
          [5, 'มี'],
          [6, 'ถึง 12/03/2570'],
          [7, '15,900 ฿'],
          [8, '2,985 ฿'],
          [9, '2,413.20 ฿'],
          [10, 'ยังไม่ระบุ'],
          [11, 'พร้อมขาย'],
          [12, 'สาขาทดสอบ'],
        ] as const) {
          expect(cells[index]).toHaveTextContent(value);
        }
        expect(cells[11]).not.toHaveTextContent('สาขาทดสอบ');
      }
    },
  );
});

describe('New tablet stock view', () => {
  it.each([false, true])(
    'shows tablet specifications, stock entry and installment terms (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([
        product({
          id: 'wifi',
          category: 'TABLET',
          model: 'iPad 10',
          name: 'iPad 10 Wi-Fi 128GB Blue',
        }),
        product({
          id: 'cellular',
          category: 'TABLET',
          model: 'iPad Air Wi-Fi + Cellular',
          name: 'iPad Air',
        }),
        product({
          id: 'unknown',
          category: 'TABLET',
          model: 'iPad mini',
          name: 'iPad mini 4GB RAM',
        }),
        product({
          id: '5g',
          category: 'TABLET',
          brand: 'Samsung',
          model: 'Galaxy Tab S9 5G',
          name: 'Galaxy Tab S9',
        }),
      ]);
      await screen.findByText('iPad 10');
      fireEvent.click(screen.getByRole('button', { name: 'แท็บเล็ต' }));
      await screen.findByText('Wi-Fi');
      if (!mobile) {
        expect(
          screen
            .getAllByRole('columnheader')
            .map((header) => header.textContent)
            .filter(Boolean),
        ).toEqual([
          'รุ่น',
          'ความจุ',
          'สี',
          'การเชื่อมต่อ',
          'ราคาเต็มจำนวน',
          'ดาวน์',
          'ยอดผ่อนต่อเดือน',
          'วันที่รับเข้า',
          'สถานะ',
          'สาขา',
        ]);
      }
      const rows = mobile
        ? within(screen.getByRole('list', { name: 'รายการสินค้า' })).getAllByRole('listitem')
        : screen.getAllByRole('row').slice(1);
      const wifi = within(rows[0]);
      for (const value of [
        '128GB',
        'Black',
        'Wi-Fi',
        '15,900 ฿',
        '2,985 ฿',
        '2,413.20 ฿',
        'ต่อเดือน · 12 งวด',
        'พร้อมขาย',
        'สาขาทดสอบ',
      ]) {
        expect(wifi.getByText(value)).toBeInTheDocument();
      }
      expect(wifi.getByRole('button', { name: 'iPad 10' })).toBeInTheDocument();
      expect(wifi.queryByText('19,900 ฿')).not.toBeInTheDocument();
      expect(wifi.queryByText('29,900 ฿')).not.toBeInTheDocument();
      expect(within(rows[1]).getByText('Wi-Fi + Cellular')).toBeInTheDocument();
      expect(within(rows[2]).getAllByText('ยังไม่ระบุ')).toHaveLength(2);
      expect(within(rows[3]).getByText('Wi-Fi + Cellular')).toBeInTheDocument();
      if (mobile) {
        for (const label of [
          'ความจุ',
          'สี',
          'การเชื่อมต่อ',
          'ราคาเต็มจำนวน',
          'ดาวน์',
          'ยอดผ่อนต่อเดือน',
        ]) {
          expect(wifi.getByText(label)).toBeInTheDocument();
        }
        expect(wifi.queryByText('%แบตเตอรี่')).not.toBeInTheDocument();
        expect(wifi.queryByText('มีกล่อง')).not.toBeInTheDocument();
        expect(wifi.queryByText('ประกันศูนย์')).not.toBeInTheDocument();
      }
      const configReads = mocks.get.mock.calls.filter(([url]) =>
        url.startsWith('/interest-configs/'),
      );
      expect(configReads.length).toBeGreaterThan(0);
      expect(
        configReads.every(([url]) => url === '/interest-configs/resolved?category=TABLET'),
      ).toBe(true);
    },
  );

  it('shows unavailable tablet terms instead of using phone defaults', async () => {
    showProducts([product({ category: 'TABLET', model: 'iPad 10', name: 'iPad 10 WiFi' })], false, {
      ...config,
      allowedMonths: [],
    });
    await screen.findByText('iPad 10');
    fireEvent.click(screen.getByRole('button', { name: 'แท็บเล็ต' }));
    await screen.findByText('ยังไม่มีเงื่อนไขผ่อน');
    expect(screen.getByRole('columnheader', { name: 'ราคาเต็มจำนวน' })).toBeInTheDocument();
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
    expect(screen.queryByText(/ต่อเดือน ·/)).not.toBeInTheDocument();
  });
});

describe('All categories and accessory stock views', () => {
  it.each([false, true])(
    'shows common stock fields across categories (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([
        product(),
        product({ id: 'tablet', model: 'iPad Air', name: 'iPad Air Wi-Fi', category: 'TABLET' }),
        product({
          id: 'case',
          name: 'เคสใส iPhone 16',
          model: 'iPhone 16',
          category: 'ACCESSORY',
          accessoryType: 'เคส',
          legacyProductCode: 'UNIT-001',
          imeiSerial: null,
          storage: null,
          installmentPrice: null,
          prices: [],
          status: 'RESERVED',
        }),
      ]);
      await screen.findAllByText('2,985 ฿');
      if (!mobile) {
        expect(
          screen
            .getAllByRole('columnheader')
            .map((header) => header.textContent)
            .filter(Boolean),
        ).toEqual([
          'ประเภท',
          'ชื่อสินค้า/รุ่น',
          'สเปกย่อ',
          'ราคาทุน',
          'ราคาเต็มจำนวน',
          'ดาวน์',
          'ยอดผ่อนต่อเดือน',
          'วันที่รับเข้า',
          'คงเหลือ',
          'สถานะ',
          'สาขา',
        ]);
      }
      const rows = mobile
        ? within(screen.getByRole('list', { name: 'รายการสินค้า' })).getAllByRole('listitem')
        : screen.getAllByRole('row').slice(1);
      const phone = within(rows[0]);
      for (const value of ['มือถือมือสอง', '128GB · Black', '1 ชิ้น', 'พร้อมขาย', 'สาขาทดสอบ'])
        expect(phone.getByText(value)).toBeInTheDocument();
      expect(within(rows[1]).getByText('Wi-Fi')).toBeInTheDocument();
      const accessory = within(rows[2]);
      for (const value of ['อุปกรณ์เสริม', 'เคสใส iPhone 16', 'UNIT-001', '0 ชิ้น', 'จอง'])
        expect(accessory.getByText(value)).toBeInTheDocument();
      expect(accessory.queryByText(/ต่อเดือน ·/)).not.toBeInTheDocument();
      expect(accessory.getAllByText('—')).toHaveLength(2);
    },
  );

  it.each([false, true])(
    'shows grouped accessory quantities and opens individual units safely (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      const accessory = product({
        id: 'unit-1',
        name: 'เคสใส iPhone 16',
        model: 'iPhone 16',
        category: 'ACCESSORY',
        accessoryType: 'เคส',
        legacyProductCode: 'UNIT-001',
        imeiSerial: null,
        storage: null,
        costPrice: '100',
        cashPrice: '250',
        installmentPrice: null,
        prices: [],
      });
      const units = [
        accessory,
        { ...accessory, id: 'unit-2', legacyProductCode: 'UNIT-002', status: 'RESERVED' },
        {
          ...accessory,
          id: 'unit-3',
          legacyProductCode: 'UNIT-003',
          costPrice: '120',
          cashPrice: '300',
        },
      ];
      const groups: StockProduct[] = [
        {
          ...accessory,
          legacyProductCode: null,
          stockGroup: {
            key: 'case-group',
            unitCount: 3,
            inStockQuantity: 2,
            statuses: ['IN_STOCK', 'RESERVED'],
            costPriceMax: '120',
            cashPriceMax: '300',
            cashPriceMissingCount: 0,
          },
        },
        {
          ...accessory,
          id: 'film',
          name: 'ฟิล์มกระจก iPhone 16',
          accessoryType: 'F1601',
          legacyProductCode: null,
          cashPrice: null,
          color: null,
          branch: { id: 'branch-2', name: 'สาขาสอง' },
          stockGroup: {
            key: 'film-group',
            unitCount: 4,
            inStockQuantity: 0,
            statuses: ['SOLD_CASH'],
            costPriceMax: '100',
            cashPriceMax: null,
            cashPriceMissingCount: 4,
          },
        },
      ];
      showProducts(units, false, config, groups);
      await screen.findByText('เคสใส iPhone 16');
      fireEvent.click(
        within(screen.getByRole('group', { name: 'แบ่งประเภทสินค้า' })).getByRole('button', {
          name: 'อุปกรณ์',
        }),
      );
      await screen.findByText('F1601');
      if (!mobile) {
        expect(
          screen
            .getAllByRole('columnheader')
            .map((header) => header.textContent)
            .filter(Boolean),
        ).toEqual([
          'รหัสสินค้า',
          'ชื่อสินค้า/รุ่น',
          'ประเภท',
          'สี',
          'ราคาทุน',
          'ราคาขาย',
          'คงเหลือ',
          'สถานะ',
          'สาขา',
        ]);
      }
      const rows = mobile
        ? within(screen.getByRole('list', { name: 'รายการสินค้า' })).getAllByRole('listitem')
        : screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      for (const value of ['เคส', 'Black', '100–120 ฿', '250–300 ฿', '2 ชิ้น', 'จอง', 'พร้อมขาย'])
        expect(within(rows[0]).getByText(value)).toBeInTheDocument();
      expect(within(rows[0]).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(rows[0]).queryByRole('button', { name: 'จัดการราคา' })).not.toBeInTheDocument();
      const imported = within(rows[1]);
      for (const value of ['F1601', 'ยังไม่ระบุ', '0 ชิ้น', 'สาขาสอง', 'ยังไม่ตั้ง 4 ชิ้น'])
        expect(imported.getByText(value)).toBeInTheDocument();
      expect(screen.queryByText('ยังไม่ระบุ IMEI / Serial')).not.toBeInTheDocument();
      expect(screen.queryByText('ดาวน์')).not.toBeInTheDocument();
      expect(screen.queryByText('ยอดผ่อนต่อเดือน')).not.toBeInTheDocument();
      fireEvent.click(within(rows[0]).getByRole('button', { name: 'ดู 3 ชิ้น' }));
      await screen.findByText('UNIT-002');
      expect(screen.getByRole('button', { name: 'กลับไปดูแบบรวม' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'จัดการราคา' })).toHaveLength(3);
      fireEvent.click(screen.getByRole('checkbox', { name: 'เลือก iPhone 16 unit-3' }));
      expect(screen.getByRole('region', { name: 'จัดการสินค้าที่เลือก' })).toHaveTextContent(
        'เลือก 1 รายการ',
      );
      fireEvent.click(screen.getByRole('button', { name: 'กลับไปดูแบบรวม' }));
      await screen.findByRole('button', { name: 'ดู 3 ชิ้น' });
      expect(
        screen.queryByRole('region', { name: 'จัดการสินค้าที่เลือก' }),
      ).not.toBeInTheDocument();
      expect(mocks.get.mock.calls.some(([url]) => url.startsWith('/interest-configs/'))).toBe(
        false,
      );
    },
  );

  it.each([false, true])('hides accessory cost from sales staff (mobile: %s)', async (mobile) => {
    mocks.mobile = mobile;
    mocks.role = 'SALES';
    showProducts([
      product({
        category: 'ACCESSORY',
        name: 'สายชาร์จ',
        model: 'สายชาร์จ',
        accessoryType: 'ชุดชาร์จ',
        imeiSerial: null,
      }),
    ]);
    await screen.findByText('สายชาร์จ');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'แบ่งประเภทสินค้า' })).getByRole('button', {
        name: 'อุปกรณ์',
      }),
    );
    await screen.findByText('15,900 ฿');
    expect(screen.queryByText('ราคาทุน')).not.toBeInTheDocument();
    expect(screen.queryByText('10,000 ฿')).not.toBeInTheDocument();
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'จัดการราคา' })).not.toBeInTheDocument();
  });
});

describe('Stock workspace interactions', () => {
  it.each(['OWNER', 'SALES'])('shows readable mobile prices with %s permissions', async (role) => {
    mocks.role = role;
    mocks.mobile = true;
    showProducts([product()]);
    await screen.findByText('2,985 ฿');
    const card = within(
      within(screen.getByRole('list', { name: 'รายการสินค้า' })).getByRole('listitem'),
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    for (const value of [
      'ราคาเต็มจำนวน',
      'ดาวน์',
      'ยอดผ่อนต่อเดือน',
      '15,900 ฿',
      '2,985 ฿',
      '2,413.20 ฿',
      'ต่อเดือน · 12 งวด',
    ]) {
      expect(card.getByText(value)).toBeInTheDocument();
    }
    expect(card.queryByText('19,900 ฿')).not.toBeInTheDocument();
    expect(card.queryByText('29,900 ฿')).not.toBeInTheDocument();
    if (role === 'OWNER') {
      expect(card.getByText('ราคาทุน')).toBeInTheDocument();
      expect(card.getByText('10,000 ฿')).toBeInTheDocument();
      expect(card.getByRole('checkbox')).toBeInTheDocument();
    } else {
      expect(card.queryByText('ราคาทุน')).not.toBeInTheDocument();
      expect(card.queryByText('10,000 ฿')).not.toBeInTheDocument();
      expect(card.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(card.queryByRole('button', { name: 'จัดการราคา' })).not.toBeInTheDocument();
    }
  });

  it.each([false, true])(
    'filters new, used, tablets and accessories while preserving status and branch (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([
        product(),
        product({ id: 'new', model: 'iPhone 16', category: 'PHONE_NEW' }),
        product({
          id: 'reserved',
          model: 'iPhone 16 Reserved',
          category: 'PHONE_NEW',
          status: 'RESERVED',
        }),
        product({ id: 'accessory', model: 'Charger', name: 'Charger', category: 'ACCESSORY' }),
        product({ id: 'tablet', model: 'iPad Air', category: 'TABLET' }),
      ]);
      await screen.findByText('iPhone 13');
      if (mobile) fireEvent.click(screen.getByRole('button', { name: 'ตัวกรอง' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'สถานะ' }), {
        target: { value: 'IN_STOCK' },
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'สาขา' }), {
        target: { value: 'branch-1' },
      });
      await screen.findByText('iPhone 13');
      fireEvent.click(screen.getByRole('checkbox', { name: 'เลือก iPhone 13 123456789012345' }));
      const categories = within(screen.getByRole('group', { name: 'แบ่งประเภทสินค้า' }));
      for (const [category, model, excluded] of [
        ['มือ 1', 'iPhone 16', ['iPhone 13', 'Charger', 'iPad Air', 'iPhone 16 Reserved']],
        ['มือ 2', 'iPhone 13', ['iPhone 16', 'Charger', 'iPad Air']],
        ['แท็บเล็ต', 'iPad Air', ['iPhone 13', 'iPhone 16', 'Charger']],
        ['อุปกรณ์', 'Charger', ['iPhone 13', 'iPhone 16', 'iPad Air']],
      ] as const) {
        fireEvent.click(categories.getByRole('button', { name: category }));
        await screen.findByText(model);
        expect(categories.getByRole('button', { name: category })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
        for (const absent of excluded) expect(screen.queryByText(absent)).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'สถานะ' })).toHaveValue('IN_STOCK');
        expect(screen.getByRole('combobox', { name: 'สาขา' })).toHaveValue('branch-1');
        expect(
          screen.queryByRole('region', { name: 'จัดการสินค้าที่เลือก' }),
        ).not.toBeInTheDocument();
      }
      fireEvent.click(categories.getByRole('button', { name: 'ทั้งหมด' }));
      await screen.findByText('iPhone 13');
      expect(screen.getByText('iPhone 16')).toBeInTheDocument();
      expect(screen.getByText('Charger')).toBeInTheDocument();
      expect(screen.getByText('iPad Air')).toBeInTheDocument();
      expect(screen.queryByText('iPhone 16 Reserved')).not.toBeInTheDocument();
    },
  );

  it.each([false, true])(
    'offers each filter once and excludes the category tab from the mobile filter count (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([product()]);
      await screen.findByText('iPhone 13');
      fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
      await screen.findByText('iPhone 13');
      expect(screen.queryByRole('combobox', { name: 'ประเภทสินค้า' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^ลบ ประเภท:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ล้างทั้งหมด' })).not.toBeInTheDocument();
      if (mobile) {
        const toggle = screen.getByRole('button', { name: 'ตัวกรอง' });
        expect(toggle).not.toHaveTextContent('1');
        fireEvent.click(toggle);
      }
      expect(screen.getAllByRole('textbox', { name: 'ค้นหาสินค้า' })).toHaveLength(1);
      expect(screen.getAllByRole('combobox', { name: 'สถานะ' })).toHaveLength(1);
      expect(screen.getAllByRole('combobox', { name: 'สาขา' })).toHaveLength(1);
      fireEvent.change(screen.getByRole('combobox', { name: 'สถานะ' }), {
        target: { value: 'IN_STOCK' },
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'สาขา' }), {
        target: { value: 'branch-1' },
      });
      await screen.findByText('iPhone 13');
      expect(screen.queryByRole('button', { name: /^ลบ สถานะ:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^ลบ สาขา:/ })).not.toBeInTheDocument();
      if (mobile) expect(screen.getByRole('button', { name: 'ตัวกรอง' })).toHaveTextContent('2');
      else
        expect(screen.getByRole('region', { name: 'เลื่อนตารางรายการสินค้า' })).toHaveAttribute(
          'tabindex',
          '0',
        );
      fireEvent.click(screen.getByRole('button', { name: 'ล้างทั้งหมด' }));
      await screen.findByText('iPhone 13');
      expect(screen.getByRole('button', { name: 'ทั้งหมด' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('combobox', { name: 'สถานะ' })).toHaveValue('');
      expect(screen.getByRole('combobox', { name: 'สาขา' })).toHaveValue('');
    },
  );

  it('keeps mobile filters open after results refresh and keeps search focused', async () => {
    mocks.mobile = true;
    showProducts([product(), product({ id: 'new-1', model: 'iPhone 16', category: 'PHONE_NEW' })]);
    await screen.findByText('iPhone 13');
    expect(screen.queryByRole('combobox', { name: 'ประเภทสินค้า' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ตัวกรอง' }));
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    await screen.findByText('iPhone 13');
    expect(screen.queryByText('iPhone 16')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ตัวกรอง' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'มือ 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'สถานะ' })).toBeVisible();
    const search = screen.getByRole('textbox', { name: 'ค้นหาสินค้า' });
    search.focus();
    fireEvent.change(search, { target: { value: 'missing' } });
    await screen.findByText('ไม่พบสินค้าที่ตรงกับตัวกรอง');
    expect(search).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    await screen.findByText('iPhone 16');
  });

  it('clears search, status, category and branch together', async () => {
    showProducts([product(), product({ id: 'new-1', model: 'iPhone 16', category: 'PHONE_NEW' })]);
    await screen.findByText('iPhone 13');
    fireEvent.change(screen.getByRole('textbox', { name: 'ค้นหาสินค้า' }), {
      target: { value: 'iPhone 13' },
    });
    await waitFor(() => expect(screen.queryByText('iPhone 16')).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะ' }), {
      target: { value: 'IN_STOCK' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'สาขา' }), {
      target: { value: 'branch-1' },
    });
    await screen.findByText('iPhone 13');
    fireEvent.click(screen.getByRole('button', { name: 'ล้างทั้งหมด' }));
    await screen.findByText('iPhone 16');
    expect(screen.getByRole('textbox', { name: 'ค้นหาสินค้า' })).toHaveValue('');
    for (const name of ['สถานะ', 'สาขา']) {
      expect(screen.getByRole('combobox', { name })).toHaveValue('');
    }
    expect(screen.queryByRole('button', { name: 'ล้างทั้งหมด' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ทั้งหมด' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([false, true])('clears selections on page change (mobile: %s)', async (mobile) => {
    mocks.mobile = mobile;
    showProducts(
      Array.from({ length: 51 }, (_, index) =>
        product({ id: `product-${index}`, model: `Phone ${index}` }),
      ),
    );
    await screen.findByText('Phone 0');
    fireEvent.click(screen.getByRole('checkbox', { name: 'เลือก Phone 0 123456789012345' }));
    expect(screen.getByRole('region', { name: 'จัดการสินค้าที่เลือก' })).toHaveTextContent(
      'เลือก 1 รายการ',
    );
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await screen.findByText('Phone 50');
    expect(screen.queryByRole('region', { name: 'จัดการสินค้าที่เลือก' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'เลือก Phone 50 123456789012345' }),
    ).not.toBeChecked();
  });
});

describe('Stock table server sorting', () => {
  const lastProductQuery = () => {
    const calls = mocks.get.mock.calls.filter(([url]) => url === '/products');
    return calls[calls.length - 1]?.[1]?.params;
  };

  it('cycles ascending, descending and default while retaining filters', async () => {
    showProducts([product()]);
    await screen.findByText('15,900 ฿');
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเต็มจำนวน' }));
    await waitFor(() =>
      expect(lastProductQuery()).toMatchObject({
        page: '1',
        sortBy: 'cashPrice',
        sortDirection: 'asc',
      }),
    );
    expect(screen.getByRole('columnheader', { name: 'ราคาเต็มจำนวน' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'สถานะ' }), {
      target: { value: 'IN_STOCK' },
    });
    await waitFor(() =>
      expect(lastProductQuery()).toMatchObject({
        status: 'IN_STOCK',
        sortBy: 'cashPrice',
        sortDirection: 'asc',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเต็มจำนวน' }));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'ราคาเต็มจำนวน' })).toHaveAttribute(
        'aria-sort',
        'descending',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเต็มจำนวน' }));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'ราคาเต็มจำนวน' })).toHaveAttribute(
        'aria-sort',
        'none',
      ),
    );
    const calls = mocks.get.mock.calls.filter(([url]) => url === '/products');
    expect(calls[calls.length - 1]?.[1].params).not.toHaveProperty('sortBy');
    expect(calls[calls.length - 1]?.[1].params).toHaveProperty('status', 'IN_STOCK');
    expect(screen.queryByRole('button', { name: 'เรียงตามselect' })).not.toBeInTheDocument();
  });

  it('returns to the first page when sorting a paginated result', async () => {
    showProducts(
      Array.from({ length: 51 }, (_, index) =>
        product({ id: `item-${index}`, model: `iPhone ${index}` }),
      ),
    );
    await screen.findByRole('button', { name: 'iPhone 0' });
    fireEvent.click(screen.getByRole('button', { name: 'ถัดไป' }));
    await screen.findByRole('button', { name: 'iPhone 50' });
    expect(mocks.get).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({ params: expect.objectContaining({ page: '2' }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเต็มจำนวน' }));
    await screen.findByRole('button', { name: 'iPhone 0' });
    expect(lastProductQuery()).toMatchObject({
      page: '1',
      sortBy: 'cashPrice',
      sortDirection: 'asc',
    });
  });

  it('offers the same sorting on mobile and clears hidden sorts when switching category', async () => {
    mocks.mobile = true;
    showProducts([product()]);
    await screen.findByText('15,900 ฿');
    fireEvent.change(screen.getByRole('combobox', { name: 'เรียงตาม' }), {
      target: { value: 'monthlyPayment' },
    });
    await waitFor(() =>
      expect(lastProductQuery()).toMatchObject({ sortBy: 'monthlyPayment', sortDirection: 'asc' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'สลับทิศทางการเรียง' }));
    await waitFor(() =>
      expect(lastProductQuery()).toMatchObject({ sortBy: 'monthlyPayment', sortDirection: 'desc' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'มือ 2' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'เรียงตาม' })).toHaveValue(''));
  });

  it('keeps the focused sort button and horizontal scroll while the next result is loading', async () => {
    showProducts([product()]);
    await screen.findByText('15,900 ฿');
    const initialGet = mocks.get.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    mocks.get.mockImplementation((url, options) =>
      url === '/products' && options?.params.sortBy
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : initialGet(url, options),
    );
    const region = screen.getByRole('region', { name: 'เลื่อนตารางรายการสินค้า' });
    region.scrollLeft = 220;
    const button = screen.getByRole('button', { name: 'สาขา' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.getByRole('button', { name: 'สาขา' })).toBe(button);
    expect(button).toHaveFocus();
    expect(region.scrollLeft).toBe(220);
    expect(screen.queryByRole('button', { name: 'จัดการราคา' })).not.toBeInTheDocument();
    finish({ data: { data: [product()], total: 1, page: 1, totalPages: 1 } });
    await screen.findByText('15,900 ฿');
    expect(button).toHaveFocus();
    expect(region.scrollLeft).toBe(220);
  });
});

describe('Stock received dates', () => {
  beforeEach(() =>
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-09T08:00:00+07:00').getTime()),
  );
  afterEach(() => vi.restoreAllMocks());
  for (const mobile of [false, true]) {
    it.each([
      ['PHONE_NEW', 'มือ 1'],
      ['PHONE_USED', 'มือ 2'],
      ['TABLET', 'แท็บเล็ต'],
    ])(`shows and sorts received dates for %s (mobile=${mobile})`, async (category, tab) => {
      mocks.mobile = mobile;
      showProducts([product({ category, stockInDate: '2026-08-20T10:00:00+07:00' })]);
      await screen.findByText('iPhone 13');
      fireEvent.click(screen.getByRole('button', { name: tab }));
      await screen.findByText('20/08/2569');
      const container = mobile
        ? within(screen.getByRole('list', { name: 'รายการสินค้า' })).getByRole('listitem')
        : screen.getByRole('row', { name: /iPhone 13/ });
      expect(within(container).getByText(/ในสต็อก [\d,]+ วัน/)).toBeInTheDocument();
      if (mobile) {
        expect(within(container).getByText('วันที่รับเข้า')).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'เรียงตาม' }), {
          target: { value: 'stockInDate' },
        });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'วันที่รับเข้า' }));
        expect(screen.getByRole('columnheader', { name: 'วันที่รับเข้า' })).toHaveAttribute(
          'aria-sort',
          'ascending',
        );
      }
      await waitFor(() =>
        expect(mocks.get).toHaveBeenCalledWith(
          '/products',
          expect.objectContaining({
            params: expect.objectContaining({
              category,
              sortBy: 'stockInDate',
              sortDirection: 'asc',
            }),
          }),
        ),
      );
    });
  }

  // เจ้าของขอ 2026-09-11: "เพิ่ม วันที่รับเข้า ในหน้าทั้งหมดให้ด้วย" — แท็บ "ทั้งหมด" รวมทุกหมวด
  // เครื่องแสดงวันที่ตามปกติ ส่วนแถวกลุ่มอุปกรณ์เว้นว่าง (วันที่ของกลุ่มไม่มีความหมายเดียว)
  it.each([false, true])(
    'shows received dates in the all-categories tab too — devices dated, accessory groups blank (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      const device = product({ stockInDate: '2026-08-20T10:00:00+07:00' });
      const accessoryGroup: StockProduct = {
        ...product({
          id: 'case-unit',
          name: 'เคสใส iPhone 16',
          model: 'iPhone 16',
          category: 'ACCESSORY',
          accessoryType: 'เคส',
          imeiSerial: null,
          storage: null,
          costPrice: '100',
          cashPrice: '250',
          installmentPrice: null,
          prices: [],
          stockInDate: '2026-08-01T10:00:00+07:00',
        }),
        legacyProductCode: null,
        stockGroup: {
          key: 'case-group',
          unitCount: 2,
          inStockQuantity: 2,
          statuses: ['IN_STOCK'],
          costPriceMax: '100',
          cashPriceMax: '250',
          cashPriceMissingCount: 0,
        },
      };
      showProducts([device], false, config, [device, accessoryGroup]);
      await screen.findByText('20/08/2569');
      expect(screen.queryByText('01/08/2569')).not.toBeInTheDocument();
      if (mobile) {
        const items = within(screen.getByRole('list', { name: 'รายการสินค้า' })).getAllByRole(
          'listitem',
        );
        expect(within(items[0]).getByText('วันที่รับเข้า')).toBeInTheDocument();
        expect(within(items[0]).getByText(/ในสต็อก [\d,]+ วัน/)).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'เรียงตาม' }), {
          target: { value: 'stockInDate' },
        });
      } else {
        // อยู่หลังยอดผ่อนต่อเดือน ก่อนคงเหลือ (index 8 นับจากคอลัมน์เลือกของผู้จัดการ)
        const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
        expect(headers[7]).toBe('ยอดผ่อนต่อเดือน');
        expect(headers[8]).toBe('วันที่รับเข้า');
        expect(headers[9]).toBe('คงเหลือ');
        const deviceCells = within(screen.getByRole('row', { name: /iPhone 13/ })).getAllByRole('cell');
        expect(deviceCells[8]).toHaveTextContent('20/08/2569');
        const groupCells = within(screen.getByRole('row', { name: /เคสใส iPhone 16/ })).getAllByRole(
          'cell',
        );
        expect(groupCells[8]).toHaveTextContent('—');
        fireEvent.click(screen.getByRole('button', { name: 'วันที่รับเข้า' }));
      }
      await waitFor(() =>
        expect(mocks.get).toHaveBeenCalledWith(
          '/products',
          expect.objectContaining({
            params: expect.objectContaining({ sortBy: 'stockInDate', sortDirection: 'asc' }),
          }),
        ),
      );
      const listCalls = mocks.get.mock.calls.filter(([url]) => url === '/products');
      expect(listCalls[listCalls.length - 1]?.[1]?.params.category).toBeUndefined();
    },
  );
});

// คำขอเจ้าของ 2026-09-11: แบ่ง "สินค้าทั้งหมด" กับ "สินค้าในสต๊อกพร้อมขาย" — mockup canvas 54e6c624 เคาะแล้ว
describe('Stock view switch — พร้อมขาย | ทั้งหมด', () => {
  const ready = () => product();
  const reserved = () =>
    product({ id: 'reserved-1', model: 'iPhone 14', imeiSerial: '999999999999999', status: 'RESERVED' });
  const openDefault = () =>
    showProducts([ready(), reserved()], false, config, undefined, DEFAULT_VIEW_PATH);
  // แท็บหมวด "ทั้งหมด" ก็เป็นปุ่ม — เจาะจงที่กลุ่มสวิตช์เท่านั้น
  const viewSwitch = () => within(screen.getByRole('group', { name: 'แสดงสินค้า' }));

  it('opens on the ready view: only IN_STOCK is requested, both counts show, status filter and column are hidden', async () => {
    openDefault();
    await screen.findByRole('row', { name: /iPhone 13/ });
    expect(screen.queryByRole('row', { name: /iPhone 14/ })).not.toBeInTheDocument();
    const listCalls = mocks.get.mock.calls.filter(([url]) => url === '/products');
    const lastList = listCalls[listCalls.length - 1];
    expect(lastList?.[1]?.params.status).toBe('IN_STOCK');

    const readyButton = viewSwitch().getByRole('button', { name: /พร้อมขาย/ });
    const allButton = viewSwitch().getByRole('button', { name: /^ทั้งหมด/ });
    expect(readyButton).toHaveAttribute('aria-pressed', 'true');
    expect(allButton).toHaveAttribute('aria-pressed', 'false');
    expect(readyButton).toHaveTextContent('1');
    expect(allButton).toHaveTextContent('2');

    expect(screen.queryByLabelText('สถานะ')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'สถานะ' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/พร้อมขาย 1 รายการ · อีก 1 รายการอยู่ในสถานะอื่น/),
    ).toBeInTheDocument();
  });

  it('switching to ทั้งหมด drops the status param and brings back the status filter and column', async () => {
    openDefault();
    await screen.findByRole('row', { name: /iPhone 13/ });
    fireEvent.click(viewSwitch().getByRole('button', { name: /^ทั้งหมด/ }));
    await screen.findByRole('row', { name: /iPhone 14/ });
    const listCalls = mocks.get.mock.calls.filter(([url]) => url === '/products');
    const lastList = listCalls[listCalls.length - 1];
    expect(lastList?.[1]?.params.status).toBeUndefined();
    expect(viewSwitch().getByRole('button', { name: /^ทั้งหมด/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('สถานะ')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'สถานะ' })).toBeInTheDocument();
    expect(screen.getByText(/ทั้งหมด 2 รายการ · พร้อมขาย 1/)).toBeInTheDocument();
  });

  it('the summary line offers ดูทั้งหมด which switches views, and the status filter narrows only the all view', async () => {
    openDefault();
    await screen.findByRole('row', { name: /iPhone 13/ });
    fireEvent.click(screen.getByRole('button', { name: 'ดูทั้งหมด' }));
    await screen.findByRole('row', { name: /iPhone 14/ });
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'RESERVED' } });
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /iPhone 13/ })).not.toBeInTheDocument(),
    );
    // กลับไป "พร้อมขาย" แล้วตัวกรองสถานะที่เลือกไว้ต้องถูกล้าง (ไม่งั้นกลับมาโหมด ทั้งหมด จะกรองค้าง)
    fireEvent.click(viewSwitch().getByRole('button', { name: /พร้อมขาย/ }));
    await screen.findByRole('row', { name: /iPhone 13/ });
    fireEvent.click(viewSwitch().getByRole('button', { name: /^ทั้งหมด/ }));
    await screen.findByRole('row', { name: /iPhone 14/ });
    expect((screen.getByLabelText('สถานะ') as HTMLSelectElement).value).toBe('');
  });
});
