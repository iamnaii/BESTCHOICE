// Typography audit (TYPOGRAPHY_AUDIT=1) — synthetic storefront API + customer session.
//
// Every value is invented (the repo is public): products are catalogue model names, the customer,
// address, order and buy-back are obviously fake. routeShopApi answers every same-origin /api/** GET
// the storefront makes (endpoints grepped from apps/web-shop/src — catalogue, product detail, related,
// installment preview, promotions, public config, orders, addresses, buy-back) plus POST /track. A
// request this table does not know is answered {} and recorded in `unmatched` ("METHOD /path") so the
// audit can report what it did not fake.
//
// AuthContext (apps/web-shop/src/contexts/AuthContext.tsx) calls no endpoint: it restores the customer
// from sessionStorage (shop_auth_token + shop_auth_customer). seedCustomerSession writes those two
// keys before any page script runs, on every navigation of the page.
import type { Page } from '@playwright/test';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

export const AUDIT_CUSTOMER = {
  id: 'cust-typo-0001',
  name: 'ลูกค้าทดสอบ ระบบ',
  phone: '0800000000',
  lineId: null,
  loyaltyBalance: 120,
};

export async function seedCustomerSession(page: Page): Promise<void> {
  await page.addInitScript((customer) => {
    sessionStorage.setItem('shop_auth_token', 'typography-audit-token');
    sessionStorage.setItem('shop_auth_customer', customer);
  }, JSON.stringify(AUDIT_CUSTOMER));
}

// ── catalogue ────────────────────────────────────────────────────────────────────────────────────
const stock = (display: string, tone: string) => ({ display, tone });

const GROUPS = [
  {
    kind: 'GROUP', id: 'new-16pm', brand: 'Apple', model: 'iPhone 16 Pro Max', storage: '256GB',
    condition: 'NEW', deviceOrigin: 'THAI', minPrice: 48900, stockCount: 4, images: [],
    monthlyPaymentFrom: 4580, downAmount: 7335, installmentMonths: 12, stock: stock('มีของ 4 เครื่อง', 'ok'),
  },
  {
    kind: 'UNIT', id: 'phone-1', displayNo: '#0001', brand: 'Apple', model: 'iPhone 15', storage: '128GB',
    color: 'Blue', condition: 'USED', deviceOrigin: 'IMPORTED', conditionGrade: 'A', batteryHealth: 91,
    minPrice: 15900, stockCount: 1, images: [], monthlyPaymentFrom: 1590, downAmount: 2385,
    installmentMonths: 12, tags: ['แบต 91%', 'ประกันร้าน 60 วัน'], stock: stock('เครื่องนี้มีตัวเดียว', 'unique'),
  },
  {
    kind: 'UNIT', id: 'phone-2', displayNo: '#0002', brand: 'Apple', model: 'iPhone 14 Pro', storage: '256GB',
    color: 'Deep Purple', condition: 'USED', deviceOrigin: 'THAI', conditionGrade: 'B', batteryHealth: 86,
    minPrice: 18500, stockCount: 1, images: [], monthlyPaymentFrom: 1850, downAmount: 2775,
    installmentMonths: 12, tags: ['แบต 86%'], stock: stock('เครื่องนี้มีตัวเดียว', 'unique'),
  },
  {
    kind: 'UNIT', id: 'phone-3', displayNo: '#0003', brand: 'Apple', model: 'iPhone 13', storage: '128GB',
    color: 'Midnight', condition: 'USED', deviceOrigin: null, conditionGrade: 'C', batteryHealth: 80,
    minPrice: 9900, stockCount: 1, images: [], monthlyPaymentFrom: null, stock: stock('เครื่องนี้มีตัวเดียว', 'unique'),
  },
  {
    kind: 'GROUP', id: 'new-16', brand: 'Apple', model: 'iPhone 16', storage: '128GB', condition: 'NEW',
    deviceOrigin: 'THAI', minPrice: 29900, stockCount: 2, images: [], monthlyPaymentFrom: 2890,
    downAmount: 4485, installmentMonths: 12, stock: stock('เหลือ 2 เครื่อง', 'low'),
  },
  {
    kind: 'UNIT', id: 'phone-4', displayNo: '#0004', brand: 'Apple', model: 'iPhone 12 mini', storage: '64GB',
    color: 'White', condition: 'USED', deviceOrigin: 'IMPORTED', conditionGrade: 'B', batteryHealth: 84,
    minPrice: 6500, stockCount: 1, images: [], monthlyPaymentFrom: 790, downAmount: 975, installmentMonths: 10,
    tags: ['กล่องครบ'], stock: stock('เครื่องนี้มีตัวเดียว', 'unique'),
  },
];

function catalogue(url: URL) {
  const limit = Number(url.searchParams.get('limit')) || 24;
  const page = Number(url.searchParams.get('page')) || 1;
  const data = GROUPS.slice((page - 1) * limit, page * limit);
  return { data, total: GROUPS.length, page, limit, minDownPct: 15, monthsOptions: [3, 4, 5, 6, 7, 8, 10, 12] };
}

const unit = (id: string, grade: string, cashPrice: number, extra: Record<string, unknown> = {}) => ({
  id, conditionGrade: grade, cashPrice, installmentPrice: Math.round(cashPrice * 1.2), deviceOrigin: 'IMPORTED',
  gallery: [], gallery360: [], color: 'Blue', batteryHealth: 90, hasBox: true, shopWarrantyDays: 60,
  warrantyTerms: 'รับประกันโดยร้าน 60 วัน\nไม่รวมความเสียหายจากน้ำหรือการตกกระแทก',
  imeiPartial: '****0000', branchName: 'สาขาทดสอบ', accessories: ['สายชาร์จ', 'กล่อง'],
  cosmeticNotes: 'มีรอยขนแมวเล็กน้อยที่ขอบเครื่อง',
  qcChecklist: [
    { item: 'หน้าจอและทัชสกรีน', passed: true },
    { item: 'กล้องหน้า/หลัง', passed: true },
    { item: 'Face ID', passed: true },
  ],
  ...extra,
});

// Any id renders (/products/phone-1 and /apply/test-1 → /products/test-1); the requested id is the
// grade-A unit so the page opens on THAT device, like a real second-hand card link.
function productDetail(id: string) {
  return {
    id, brand: 'Apple', model: 'iPhone 15', storage: '128GB', color: 'Blue', category: 'PHONE_USED',
    condition: 'USED', deviceOrigin: 'IMPORTED', shopWarrantyDays: 60,
    warrantyTerms: 'รับประกันโดยร้าน 60 วัน', description: 'iPhone 15 มือสอง ตรวจเช็ก 30 จุดก่อนวางขาย',
    gallery: [], gallery360: [], cashPrice: 15900, installmentPrice: 19080,
    tiers: {
      A: { minPrice: 15900, maxPrice: 15900, units: [unit(id, 'A', 15900, { batteryHealth: 91 })] },
      B: { minPrice: 14500, maxPrice: 14500, units: [unit(`${id}-b`, 'B', 14500, { shopWarrantyDays: 30, batteryHealth: 86 })] },
      C: { minPrice: 12900, maxPrice: 12900, units: [unit(`${id}-c`, 'C', 12900, { shopWarrantyDays: undefined, warrantyTerms: undefined })] },
    },
  };
}

function installmentPreview(url: URL) {
  const months = Number(url.searchParams.get('months')) || 12;
  const gfin = url.searchParams.get('provider') === 'GFIN';
  const total = gfin ? 21600 : 19080;
  const down = Math.round(total * 0.15);
  return {
    available: true, months, downAmount: down, financedAmount: total - down,
    monthlyPayment: Math.round(((total - down) * 1.07) / months), totalWithVat: Math.round((total - down) * 1.07),
    minDownPct: 15, ...(gfin ? { gfinSubmitPrice: total } : {}),
  };
}

// ── promotions / config ──────────────────────────────────────────────────────────────────────────
const PROMOTIONS = [
  {
    id: 'promo-1', name: 'ลดทันทีเมื่อผ่อนครบ 12 งวด', description: 'เฉพาะเครื่องมือสองเกรด A ที่ร่วมรายการ',
    type: 'FIXED_DISCOUNT', discountValue: '500', specialInterestRate: null, conditions: { minPurchase: 10000 },
    startDate: '2026-11-01T00:00:00+07:00', endDate: '2026-12-31T23:59:59+07:00',
  },
  {
    id: 'promo-2', name: 'แถมฟิล์มกระจกและเคส', description: null, type: 'FREE_ACCESSORY',
    discountValue: null, specialInterestRate: null, conditions: null,
    startDate: '2026-11-01T00:00:00+07:00', endDate: '2026-11-30T23:59:59+07:00',
  },
  {
    id: 'promo-3', name: 'ดอกเบี้ยพิเศษ iPhone 16', description: 'ผ่อน 10 งวดขึ้นไป', type: 'SPECIAL_RATE',
    discountValue: null, specialInterestRate: '0.015', conditions: { categories: ['PHONE_NEW'] },
    startDate: '2026-11-01T00:00:00+07:00', endDate: '2026-12-15T23:59:59+07:00',
  },
];

// ── customer data ────────────────────────────────────────────────────────────────────────────────
const ADDRESS = {
  recipientName: 'ลูกค้าทดสอบ ระบบ', phone: '0800000000', line1: '99/9 หมู่ 9 ถนนทดสอบ', line2: 'อาคารทดสอบ ชั้น 1',
  subDistrict: 'ตำบลทดสอบ', district: 'อำเภอทดสอบ', province: 'ลพบุรี', postalCode: '15000',
};

const ORDERS = [
  { id: 'order-1', orderNumber: 'BC-TEST-0001', status: 'SHIPPED', totalAmount: '15900', product: { name: 'iPhone 15 128GB', gallery: [] } },
  { id: 'order-2', orderNumber: 'BC-TEST-0002', status: 'COMPLETED', totalAmount: '6500', product: { name: 'iPhone 12 mini 64GB', gallery: [] } },
];

const orderDetail = (orderNumber: string) => ({
  id: 'order-1', orderNumber, status: 'SHIPPED', createdAt: '2026-11-01T10:00:00+07:00',
  product: { name: 'iPhone 15 128GB', gallery: [] }, productPrice: '16400', shippingMethod: 'KERRY',
  shippingFee: '0', promoCode: 'TEST500', promoDiscount: '500', loyaltyPointsUsed: 0, loyaltyDiscount: '0',
  totalAmount: '15900', shippingAddress: ADDRESS, paymentChannel: 'PROMPTPAY',
  paidAt: '2026-11-01T10:05:00+07:00', trackingNumber: 'TEST0000000000TH',
});

// ── buy-back ─────────────────────────────────────────────────────────────────────────────────────
const BUYBACK_CATALOG = {
  models: [
    { model: 'iPhone 15', storages: [{ storage: '128GB', maxPrice: '14000' }, { storage: '256GB', maxPrice: '16000' }] },
    { model: 'iPhone 13', storages: [{ storage: '128GB', maxPrice: '8500' }] },
  ],
};

const BUYBACK_QUESTIONS = {
  bonusPct: '5', pricingMode: 'SUM_PERCENT_FLOOR10', eligibilityRequired: false,
  questions: [
    {
      id: 'q1', key: 'screen', title: 'สภาพหน้าจอ', helpText: null, selectType: 'SINGLE',
      choices: [
        { id: 'q1a', label: 'ไม่มีรอย', deductType: 'PERCENT', deductValue: '0', isNoneChoice: true },
        { id: 'q1b', label: 'มีรอยขนแมว', deductType: 'PERCENT', deductValue: '5' },
      ],
    },
  ],
};

const buyback = (id: string) => ({
  id, status: 'APPRAISED', flow: 'BUYBACK', deviceBrand: 'Apple', deviceModel: 'iPhone 13',
  deviceStorage: '128GB', deviceCondition: 'B', batteryHealth: 88, notes: null, photoUrls: [],
  estimatedValue: '7650', offeredPrice: '7650', agreedPrice: null, preferredVisitDate: '2026-11-10',
  createdAt: '2026-11-01T10:00:00+07:00',
  quoteBreakdown: {
    maxPrice: '8500', fixedTotal: '0', pctTotal: '10', price: '7650',
    lines: [
      { label: 'มีรอยขนแมวที่หน้าจอ', deductType: 'PERCENT', deductValue: '5', amount: '425', applied: true },
      { label: 'แบตเตอรี่ต่ำกว่า 90%', deductType: 'PERCENT', deductValue: '5', amount: '425', applied: true },
    ],
  },
});

// ── router ───────────────────────────────────────────────────────────────────────────────────────
type Handler = (match: RegExpExecArray, url: URL) => unknown;
const API: Array<[string, RegExp, Handler]> = [
  ['GET', /^\/api\/shop\/products$/, (_, url) => catalogue(url)],
  ['GET', /^\/api\/shop\/models$/, () => [
    { model: 'iPhone 16 Pro Max', count: 4 }, { model: 'iPhone 15', count: 1 }, { model: 'iPhone 14 Pro', count: 1 },
    { model: 'iPhone 13', count: 1 }, { model: 'iPhone 12 mini', count: 1 },
  ]],
  ['GET', /^\/api\/shop\/products\/([^/]+)\/related$/, () => GROUPS.slice(1, 5)],
  ['GET', /^\/api\/shop\/products\/([^/]+)$/, (m) => productDetail(decodeURIComponent(m[1]))],
  ['GET', /^\/api\/shop\/installment-preview$/, (_, url) => installmentPreview(url)],
  ['GET', /^\/api\/shop\/promotions$/, () => PROMOTIONS],
  ['GET', /^\/api\/shop\/public-config\/analytics$/, () => ({ ga4MeasurementId: null, fbPixelId: null })],
  ['GET', /^\/api\/shop\/public-config\/shop$/, () => ({ facebookPageHandle: 'example.shop.test' })],
  ['GET', /^\/api\/shop\/public-config\/auth$/, () => ({
    lineLoginEnabled: true, lineLoginChannelId: '0000000000',
    lineLoginRedirectUri: 'http://127.0.0.1:5281/auth/line-callback',
  })],
  ['POST', /^\/api\/shop\/track$/, () => ({ ok: true })],
  ['GET', /^\/api\/shop\/orders$/, () => ORDERS],
  ['GET', /^\/api\/shop\/orders\/([^/]+)$/, (m) => orderDetail(decodeURIComponent(m[1]))],
  ['GET', /^\/api\/shop\/me\/addresses$/, () => [ADDRESS]],
  ['GET', /^\/api\/shop\/buyback\/catalog$/, () => BUYBACK_CATALOG],
  ['GET', /^\/api\/shop\/buyback\/questions$/, () => BUYBACK_QUESTIONS],
  ['GET', /^\/api\/shop\/buyback\/([^/]+)$/, (m) => buyback(decodeURIComponent(m[1]))],
];

export interface ShopApiFixture {
  /** "METHOD /path" of every same-origin /api request answered {} because no handler knew it */
  unmatched: string[];
}

export async function routeShopApi(page: Page): Promise<ShopApiFixture> {
  const fixture: ShopApiFixture = { unmatched: [] };
  await page.route(
    (url) => LOCAL_HOSTS.has(url.hostname) && (url.pathname === '/api' || url.pathname.startsWith('/api/')),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      for (const [method, pattern, handle] of API) {
        const match = request.method() === method ? pattern.exec(url.pathname) : null;
        if (match) return route.fulfill({ json: handle(match, url) });
      }
      const key = `${request.method()} ${url.pathname}`;
      if (!fixture.unmatched.includes(key)) fixture.unmatched.push(key);
      return route.fulfill({ json: {} });
    },
  );
  return fixture;
}
