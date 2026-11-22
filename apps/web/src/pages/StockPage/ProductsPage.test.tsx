import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
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

function LocationCapture() {
  return <output data-testid="stock-location">{useLocation().search}</output>;
}

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
      if (url === '/gfin-config/settings')
        return {
          data: {
            minDownPct: 25,
            maxDownPct: 80,
            downStepPct: 5,
            contractFee: 100,
            commissionPctByCategory: { PHONE: 15, TABLET: 5 },
          },
        };
      if (url.startsWith('/gfin-config/')) return { data: [] };
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
        <LocationCapture />
        <StockProductsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function showColumn(label: string) {
  if (screen.queryByRole('columnheader', { name: label })) return;
  fireEvent.click(screen.getByRole('button', { name: /คอลัมน์/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.role = 'OWNER';
  mocks.mobile = false;
});

describe('Stock product pricing', () => {
  it('shows cost, cash, starting down and monthly quote without the installment selling price', async () => {
    showProducts([product(), product({ id: 'used-2', model: 'iPhone 14' })]);
    await screen.findAllByText('3,000 ฿');
    showColumn('ราคาทุน');
    for (const label of ['ราคาทุน', 'ราคาเงินสด', 'BESTCHOICE', 'GFIN']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
    const row = screen.getByRole('row', { name: /iPhone 13/ });
    expect(within(row).getByRole('button', { name: 'iPhone 13' })).toBeInTheDocument();
    for (const value of ['10,000 ฿', '15,900 ฿', '3,000 ฿', '2,411.06 ฿', '× 12 งวด']) {
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
    await screen.findByText('4,000 ฿');
    expect(
      within(screen.getByRole('row', { name: /iPhone 16/ })).getByText('× 6 งวด'),
    ).toBeInTheDocument();
    const legacy = within(screen.getByRole('row', { name: /iPhone 12/ }));
    expect(legacy.getByText('9,900 ฿')).toBeInTheDocument();
    expect(legacy.queryByText('29,900 ฿')).not.toBeInTheDocument();
    expect(legacy.getByText('4,500 ฿')).toBeInTheDocument();
  });

  it('hides cost and price editing for sales staff', async () => {
    mocks.role = 'SALES';
    showProducts([product()]);
    await screen.findByText('3,000 ฿');
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
    await screen.findByText('iPhone 13');
    showColumn('ราคาทุน');
    await screen.findByText('0 ฿');
    const blank = within(screen.getByRole('row', { name: /iPhone 13/ }));
    expect(blank.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/× \d+ งวด/)).not.toBeInTheDocument();
    expect(mocks.get.mock.calls.some(([url]) => url.startsWith('/interest-configs/'))).toBe(false);
  });

  it('shows a recoverable config error without fabricating down or monthly amounts', async () => {
    showProducts([product()], true);
    await screen.findByRole('alert');
    expect(screen.getByText('โหลดไม่สำเร็จ')).toBeInTheDocument();
    expect(screen.queryByText(/× \d+ งวด/)).not.toBeInTheDocument();
    expect(screen.getByText('15,900 ฿')).toBeInTheDocument();
    mocks.get.mockResolvedValueOnce({ data: config });
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    await screen.findByText('3,000 ฿');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('explains when the category has no configured installment plan', async () => {
    showProducts([product()], false, { ...config, allowedMonths: [] });
    await screen.findByText('ยังไม่มีเงื่อนไขผ่อน');
    expect(screen.queryByText(/× \d+ งวด/)).not.toBeInTheDocument();
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
    expect(cashOnly.getAllByText('—')).toHaveLength(4);
  });
});

describe('Device comparison layout', () => {
  it.each([false, true])(
    'separates full IMEI, capacity and color with both providers (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts(
        [product({ batteryHealth: 87, hasBox: true, warrantyExpireDate: '2027-03-12T12:00:00' })],
        false,
        config,
        undefined,
        '/stock/products?inventoryScope=devices&zone=shop',
      );
      await screen.findByText('3,000 ฿');
      const row = mobile
        ? within(screen.getByRole('list')).getByRole('listitem')
        : screen.getByRole('row', { name: /iPhone 13/ });
      const content = within(row);
      for (const text of [
        '123456789012345',
        '128GB',
        'Black',
        '87%',
        'มี',
        'ถึง 12/03/2570',
        '15,900 ฿',
        '3,000 ฿',
        '2,411.06 ฿',
        '× 12 งวด',
      ])
        expect(content.getByText(text)).toBeInTheDocument();
      expect(content.getByRole('button', { name: 'คัดลอก IMEI/Serial' })).toBeInTheDocument();
      expect(content.queryByText('19,900 ฿')).not.toBeInTheDocument();
      if (!mobile) {
        for (const label of [
          'รุ่นสินค้า',
          'ความจุ',
          'สี',
          'IMEI / Serial',
          'แบต %',
          'ประกันศูนย์',
          'กล่อง',
          'ราคาเงินสด',
          'BESTCHOICE',
          'GFIN',
        ])
          expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'ราคาทุน' })).not.toBeInTheDocument();
        showColumn('ราคาทุน');
        expect(content.getByText('10,000 ฿')).toBeInTheDocument();
        showColumn('สาขา');
        expect(content.getByText('สาขาทดสอบ')).toBeInTheDocument();
      }
    },
  );
  it.each([false, true])(
    'distinguishes zero battery, no box, expired and unknown warranty (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([
        product({
          batteryHealth: 0,
          hasBox: false,
          warrantyExpired: true,
          warrantyExpireDate: '2030-01-01T12:00:00',
        }),
        product({ id: 'unknown', model: 'iPhone SE' }),
      ]);
      await screen.findByText('หมดประกันแล้ว');
      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(screen.getByText('ไม่มี')).toBeInTheDocument();
      expect(screen.queryByText('ถึง 01/01/2573')).not.toBeInTheDocument();
      const unknown = mobile
        ? within(screen.getByRole('list')).getAllByRole('listitem')[1]
        : screen.getByRole('row', { name: /iPhone SE/ });
      expect(within(unknown).queryByText('ไม่มี')).not.toBeInTheDocument();
      expect(within(unknown).getAllByText('ยังไม่ระบุ').length).toBeGreaterThan(0);
    },
  );
  it.each([false, true])(
    'retains tablet connectivity without inferring it from IMEI (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([
        product({ category: 'TABLET', model: 'iPad 10', name: 'iPad 10 Wi-Fi' }),
        product({ id: 'cellular', category: 'TABLET', model: 'iPad Air 5G' }),
        product({ id: 'ram', category: 'TABLET', model: 'iPad mini', name: 'iPad mini 4GB RAM' }),
      ]);
      await screen.findByText('iPad 10');
      fireEvent.click(screen.getByRole('button', { name: 'แท็บเล็ต' }));
      await screen.findByText('Wi-Fi');
      expect(screen.getByText('Wi-Fi')).toBeInTheDocument();
      expect(screen.getByText('Wi-Fi + Cellular')).toBeInTheDocument();
      const rows = mobile
        ? within(screen.getByRole('list')).getAllByRole('listitem')
        : screen.getAllByRole('row').slice(1);
      expect(within(rows[2]).queryByText('Wi-Fi + Cellular')).not.toBeInTheDocument();
      await screen.findAllByText('× 12 งวด');
      expect(
        mocks.get.mock.calls
          .filter(([url]) => url.startsWith('/interest-configs/'))
          .every(([url]) => url.endsWith('TABLET')),
      ).toBe(true);
    },
  );
  it('leaves unconfigured tablet quotes unavailable instead of using phone defaults', async () => {
    showProducts([product({ category: 'TABLET', model: 'iPad 10' })], false, {
      ...config,
      allowedMonths: [],
    });
    await screen.findByText('ยังไม่มีเงื่อนไขผ่อน');
    expect(screen.queryByText('3,000 ฿')).not.toBeInTheDocument();
  });
  it('keeps device fields available in the mixed view while accessory payment cells are blank', async () => {
    showProducts([
      product(),
      product({
        id: 'case',
        category: 'ACCESSORY',
        name: 'เคสใส',
        model: 'เคสใส',
        imeiSerial: null,
        storage: null,
        installmentPrice: null,
        prices: [],
      }),
    ]);
    await screen.findByText('3,000 ฿');
    const accessory = within(screen.getByRole('row', { name: /เคสใส/ }));
    expect(accessory.getByText('อุปกรณ์เสริม')).toBeInTheDocument();
    expect(accessory.queryByText(/× \d+ งวด/)).not.toBeInTheDocument();
  });
});

describe('All categories and accessory stock views', () => {
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
          name: 'อุปกรณ์เสริม',
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
          'สินค้า / รุ่น',
          'SKU / รหัสสินค้า',
          'ประเภท',
          'สี',
          'ราคาทุน',
          'ราคาขาย',
          'กำไร / ชิ้น',
          'พร้อมขาย',
          'สถานะ',
          'สาขา',
        ]);
      }
      const rows = mobile
        ? within(screen.getByRole('list', { name: 'รายการสินค้า' })).getAllByRole('listitem')
        : screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      for (const value of ['เคส', 'Black', '100–120 ฿', '250–300 ฿', '2 ชิ้น', 'จอง', 'พร้อมขาย'])
        expect(within(rows[0]).getAllByText(value).length).toBeGreaterThan(0);
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
        name: 'อุปกรณ์เสริม',
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
    await screen.findByText('3,000 ฿');
    const card = within(
      within(screen.getByRole('list', { name: 'รายการสินค้า' })).getByRole('listitem'),
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    for (const value of [
      'ราคาเงินสด',
      'ดาวน์',
      'BESTCHOICE',
      '15,900 ฿',
      '3,000 ฿',
      '2,411.06 ฿',
      '× 12 งวด',
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
        ['มือถือมือ 1', 'iPhone 16', ['iPhone 13', 'Charger', 'iPad Air', 'iPhone 16 Reserved']],
        ['มือถือมือ 2', 'iPhone 13', ['iPhone 16', 'Charger', 'iPad Air']],
        ['แท็บเล็ต', 'iPad Air', ['iPhone 13', 'iPhone 16', 'Charger']],
        ['อุปกรณ์เสริม', 'Charger', ['iPhone 13', 'iPhone 16', 'iPad Air']],
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
      fireEvent.click(categories.getByRole('button', { name: 'ทุกประเภท' }));
      await screen.findByText('iPhone 13');
      expect(screen.getByText('iPhone 16')).toBeInTheDocument();
      expect(screen.getByText('Charger')).toBeInTheDocument();
      expect(screen.getByText('iPad Air')).toBeInTheDocument();
      expect(screen.queryByText('iPhone 16 Reserved')).not.toBeInTheDocument();
    },
  );

  it.each([false, true])(
    'shows one status selector and removable active filters (mobile: %s)',
    async (mobile) => {
      mocks.mobile = mobile;
      showProducts([product()]);
      await screen.findByText('iPhone 13');
      fireEvent.click(screen.getByRole('button', { name: 'มือถือมือ 2' }));
      expect(screen.getAllByRole('textbox', { name: 'ค้นหาสินค้า' })).toHaveLength(1);
      expect(screen.getAllByRole('combobox', { name: 'สถานะ' })).toHaveLength(1);
      expect(screen.getAllByRole('combobox', { name: 'สาขา' })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'ตัวกรอง' })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'IN_STOCK' } });
      fireEvent.change(screen.getByLabelText('สาขา'), { target: { value: 'branch-1' } });
      await screen.findByText('iPhone 13');
      const chips = within(screen.getByRole('group', { name: 'ตัวกรองที่ใช้' }));
      expect(chips.getByRole('button', { name: /^ลบ ประเภท:/ })).toBeVisible();
      expect(chips.getByRole('button', { name: /^ลบ สถานะ:/ })).toBeVisible();
      fireEvent.click(chips.getByRole('button', { name: /^ลบ สาขา:/ }));
      expect(screen.getByLabelText('สาขา')).toHaveValue('');
      expect(screen.getByLabelText('สถานะ')).toHaveValue('IN_STOCK');
      expect(screen.getByRole('button', { name: 'มือถือมือ 2' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
      expect(screen.getByLabelText('สถานะ')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'ทุกประเภท' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.queryByRole('group', { name: 'ตัวกรองที่ใช้' })).not.toBeInTheDocument();
    },
  );

  it('keeps mobile filters open after results refresh and keeps search focused', async () => {
    mocks.mobile = true;
    showProducts([product(), product({ id: 'new-1', model: 'iPhone 16', category: 'PHONE_NEW' })]);
    await screen.findByText('iPhone 13');
    expect(screen.queryByRole('combobox', { name: 'ประเภทสินค้า' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'มือถือมือ 2' }));
    await screen.findByText('iPhone 13');
    expect(screen.queryByText('iPhone 16')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'มือถือมือ 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'มือถือมือ 2' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'สาขา' }), {
      target: { value: 'branch-1' },
    });
    await screen.findByText('iPhone 13');
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    await screen.findByText('iPhone 16');
    expect(screen.getByRole('textbox', { name: 'ค้นหาสินค้า' })).toHaveValue('');
    for (const name of ['สถานะ', 'สาขา']) {
      expect(screen.getByRole('combobox', { name })).toHaveValue('');
    }
    expect(screen.queryByRole('button', { name: 'ล้างตัวกรอง' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ทุกประเภท' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเงินสด' }));
    await waitFor(() =>
      expect(lastProductQuery()).toMatchObject({
        page: '1',
        sortBy: 'cashPrice',
        sortDirection: 'asc',
      }),
    );
    expect(screen.getByRole('columnheader', { name: 'ราคาเงินสด' })).toHaveAttribute(
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
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเงินสด' }));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'ราคาเงินสด' })).toHaveAttribute(
        'aria-sort',
        'descending',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเงินสด' }));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: 'ราคาเงินสด' })).toHaveAttribute(
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
    fireEvent.click(screen.getByRole('button', { name: 'ราคาเงินสด' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'มือถือมือ 2' }));
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
    showColumn('สาขา');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 0));
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
      ['PHONE_NEW', 'มือถือมือ 1'],
      ['PHONE_USED', 'มือถือมือ 2'],
      ['TABLET', 'แท็บเล็ต'],
    ])(`shows and sorts received dates for %s (mobile=${mobile})`, async (category, tab) => {
      mocks.mobile = mobile;
      showProducts([product({ category, stockInDate: '2026-08-20T10:00:00+07:00' })]);
      await screen.findByText('iPhone 13');
      fireEvent.click(screen.getByRole('button', { name: tab }));
      if (!mobile) showColumn('วันที่รับเข้า');
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
      if (!mobile) showColumn('วันที่รับเข้า');
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
        const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
        const dateIndex = headers.indexOf('วันที่รับเข้า');
        expect(dateIndex).toBeGreaterThan(-1);
        const deviceCells = within(screen.getByRole('row', { name: /iPhone 13/ })).getAllByRole(
          'cell',
        );
        const groupCells = within(
          screen.getByRole('row', { name: /เคสใส iPhone 16/ }),
        ).getAllByRole('cell');
        expect(deviceCells[dateIndex]).toHaveTextContent('20/08/2569');
        expect(groupCells[dateIndex]).toHaveTextContent('—');
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

describe('Stock unified status filter', () => {
  const ready = () => product();
  const reserved = () =>
    product({
      id: 'reserved-1',
      model: 'iPhone 14',
      imeiSerial: '999999999999999',
      status: 'RESERVED',
    });
  const openDefault = () =>
    showProducts([ready(), reserved()], false, config, undefined, DEFAULT_VIEW_PATH);

  it('keeps ready as the default and makes its active status visible', async () => {
    openDefault();
    await screen.findByRole('row', { name: /iPhone 13/ });
    expect(screen.queryByRole('row', { name: /iPhone 14/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('สถานะ')).toHaveValue('IN_STOCK');
    expect(screen.getByRole('button', { name: 'ลบ สถานะ: พร้อมขาย' })).toBeVisible();
    expect(screen.queryByRole('group', { name: 'แสดงสินค้า' })).not.toBeInTheDocument();
    expect(
      mocks.get.mock.calls.filter(([url]) => url === '/products').at(-1)?.[1]?.params.status,
    ).toBe('IN_STOCK');
  });

  it('removing the ready chip really includes every status without changing the category', async () => {
    openDefault();
    await screen.findByRole('row', { name: /iPhone 13/ });
    fireEvent.click(screen.getByRole('button', { name: 'มือถือมือ 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'ลบ สถานะ: พร้อมขาย' }));
    await screen.findByRole('row', { name: /iPhone 14/ });
    expect(screen.getByLabelText('สถานะ')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'มือถือมือ 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      mocks.get.mock.calls.filter(([url]) => url === '/products').at(-1)?.[1]?.params.status,
    ).toBeUndefined();
  });

  it('switches directly between reserved, ready and all without a stale hidden status', async () => {
    openDefault();
    await screen.findByRole('row', { name: /iPhone 13/ });
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'RESERVED' } });
    await screen.findByRole('row', { name: /iPhone 14/ });
    expect(screen.queryByRole('row', { name: /iPhone 13/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: 'IN_STOCK' } });
    await screen.findByRole('row', { name: /iPhone 13/ });
    expect(screen.queryByRole('row', { name: /iPhone 14/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('สถานะ'), { target: { value: '' } });
    await screen.findByRole('row', { name: /iPhone 14/ });
    expect(screen.getByRole('row', { name: /iPhone 13/ })).toBeInTheDocument();
  });
});

it('preserves inventory scope and aging from the overview, then clears page and category on scope change', async () => {
  showProducts(
    [product()],
    false,
    config,
    undefined,
    '/stock/products?zone=shop&view=ready&inventoryScope=devices&aging=over90&category=PHONE_USED&page=2',
  );
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        params: expect.objectContaining({
          inventoryScope: 'devices',
          aging: 'over90',
          status: 'IN_STOCK',
        }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole('radio', { name: 'อุปกรณ์เสริม' }));
  await waitFor(() =>
    expect(mocks.get).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({
        params: expect.objectContaining({ inventoryScope: 'accessories', page: '1' }),
      }),
    ),
  );
  const requests = mocks.get.mock.calls.filter(([url]) => url === '/products');
  expect(requests.at(-1)?.[1].params.category).toBeUndefined();
});

it('preserves finance zone when returning to the overview', async () => {
  showProducts(
    [product()],
    false,
    config,
    undefined,
    '/stock/products?zone=finance&inventoryScope=devices&branchId=branch-1&view=all',
  );
  await screen.findByText('iPhone 13');
  fireEvent.keyDown(screen.getByRole('button', { name: 'เครื่องมือ' }), {
    key: 'Enter',
    code: 'Enter',
  });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'ดูภาพรวมคลัง' }));
  expect(screen.getByTestId('stock-location')).toHaveTextContent('zone=finance');
  expect(screen.getByTestId('stock-location')).toHaveTextContent('inventoryScope=devices');
  expect(screen.getByTestId('stock-location')).toHaveTextContent('branchId=branch-1');
});

describe('Accessory-specific comparison behavior', () => {
  it.each(['scope', 'category'])(
    'clears device-origin constraints when switching by %s',
    async (mode) => {
      showProducts(
        [product()],
        false,
        config,
        undefined,
        '/stock/products?zone=shop&deviceOrigin=THAI',
      );
      await screen.findByText('iPhone 13');
      if (mode === 'scope') fireEvent.click(screen.getByRole('radio', { name: 'อุปกรณ์เสริม' }));
      else
        fireEvent.click(
          within(screen.getByRole('group', { name: 'แบ่งประเภทสินค้า' })).getByRole('button', {
            name: 'อุปกรณ์เสริม',
          }),
        );
      await waitFor(() =>
        expect(screen.getByTestId('stock-location').textContent).not.toContain('deviceOrigin'),
      );
      expect(
        screen.queryByRole('combobox', { name: 'เครื่องไทย / เครื่องนอก' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'ตัวกรอง' })).not.toBeInTheDocument();
    },
  );
  it('shows compatibility and exact per-unit margin, preserving zero costs', async () => {
    showProducts(
      [
        product({
          category: 'ACCESSORY',
          name: 'เคสใส MagSafe',
          model: 'iPhone 16 Pro',
          costPrice: '0',
          cashPrice: '290',
          imeiSerial: null,
        }),
      ],
      false,
      config,
      undefined,
      '/stock/products?zone=shop&inventoryScope=accessories',
    );
    await screen.findByText('เคสใส MagSafe');
    const row = screen.getByRole('row', { name: /เคสใส MagSafe/ });
    expect(within(row).getByText('iPhone 16 Pro')).toBeInTheDocument();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(within(row).getAllByRole('cell')[headers.indexOf('กำไร / ชิ้น')]).toHaveTextContent(
      '290 ฿',
    );
    expect(screen.queryByRole('columnheader', { name: 'IMEI / Serial' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'GFIN' })).not.toBeInTheDocument();
  });
  it('does not subtract minima across different units in a grouped margin', async () => {
    const p = product({
      category: 'ACCESSORY',
      name: 'เคส',
      model: 'iPhone 16',
      costPrice: '100',
      cashPrice: '250',
      imeiSerial: null,
      stockGroup: {
        key: 'g',
        unitCount: 2,
        inStockQuantity: 2,
        statuses: ['IN_STOCK'],
        costPriceMax: '200',
        cashPriceMax: '300',
        cashPriceMissingCount: 0,
      },
    });
    showProducts([p], false, config, [p], '/stock/products?zone=shop&inventoryScope=accessories');
    await screen.findByText('ดูแยกรายชิ้น');
    expect(screen.queryByText('150 ฿')).not.toBeInTheDocument();
  });
});

it('keeps an incompatible category from an old accessory link visible and removable', async () => {
  showProducts(
    [product({ category: 'ACCESSORY', model: 'Case', name: 'Case' })],
    false,
    config,
    undefined,
    '/stock/products?zone=shop&inventoryScope=accessories&view=all&category=PHONE_NEW',
  );
  const chip = await screen.findByRole('button', { name: 'ลบ ประเภท: มือถือมือ 1' });
  expect(screen.queryByRole('group', { name: 'แบ่งประเภทสินค้า' })).not.toBeInTheDocument();
  fireEvent.click(chip);
  await screen.findByText('Case');
  expect(screen.getByTestId('stock-location').textContent).not.toContain('category=');
  expect(screen.getByTestId('stock-location').textContent).toContain('inventoryScope=accessories');
});
