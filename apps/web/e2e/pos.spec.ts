import { test, expect, Page } from '@playwright/test';
import { loginWithMock } from './helpers/mock-auth';

// ============================================================================
// BESTCHOICE POS (Point of Sale) Page
// Route: /pos
//
// Tests:
//   - Page load & header
//   - Sale type selection (CASH / EXTERNAL_FINANCE)
//   - Product search & selection
//   - Bundle/freebie section
//   - Customer search & selection
//   - Sale details (price, discount, payment method)
//   - Summary sidebar
//   - External finance fields
//   - Form validation (submit button disabled)
//   - Clear form
//   - Link to contract creation
// ============================================================================

const MOCK_PRODUCTS = [
  {
    id: 'prod-1', name: 'iPhone 15 Pro', brand: 'Apple', model: 'iPhone 15 Pro',
    imeiSerial: '123456789012345', category: 'PHONE_NEW', status: 'IN_STOCK',
    costPrice: '25000', branchId: 'branch-1',
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    prices: [
      { id: 'price-1', label: 'ราคาสด', amount: '35000', isDefault: true },
      { id: 'price-2', label: 'ราคาพิเศษ', amount: '33000', isDefault: false },
    ],
  },
  {
    id: 'prod-2', name: 'Samsung Galaxy S24', brand: 'Samsung', model: 'Galaxy S24',
    imeiSerial: '987654321098765', category: 'PHONE_NEW', status: 'IN_STOCK',
    costPrice: '20000', branchId: 'branch-1',
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    prices: [
      { id: 'price-3', label: 'ราคาสด', amount: '28000', isDefault: true },
    ],
  },
];

const MOCK_BUNDLE_PRODUCTS = [
  {
    id: 'acc-1', name: 'เคสใส iPhone 15 Pro', brand: 'Generic', model: 'Clear Case',
    imeiSerial: null, category: 'ACCESSORY', status: 'IN_STOCK',
    costPrice: '150', branchId: 'branch-1',
    branch: { id: 'branch-1', name: 'สาขาหลัก' },
    prices: [],
  },
];

const MOCK_CUSTOMERS = [
  { id: 'cust-1', name: 'สมชาย ใจดี', phone: '0812345678', nationalId: '1234567890123', _count: { contracts: 2 } },
  { id: 'cust-2', name: 'สมหญิง รักดี', phone: '0898765432', nationalId: '9876543210987', _count: { contracts: 0 } },
];

const MOCK_TOP_PRODUCTS = [
  { id: 'prod-1', name: 'iPhone 15 Pro', brand: 'Apple', model: 'iPhone 15 Pro', count: 15 },
  { id: 'prod-2', name: 'Samsung Galaxy S24', brand: 'Samsung', model: 'Galaxy S24', count: 10 },
  { id: 'prod-3', name: 'OPPO A78', brand: 'OPPO', model: 'A78', count: 8 },
];

const MOCK_POS_CONFIG = {
  interestRate: 0.08,
  minDownPaymentPct: 0.15,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
};

async function mockPosApis(page: Page) {
  // Product search
  await page.route('**/api/products?*', async (route) => {
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const allProducts = [...MOCK_PRODUCTS, ...MOCK_BUNDLE_PRODUCTS];
    const filtered = search
      ? allProducts.filter(p =>
          p.brand.toLowerCase().includes(search) ||
          p.model.toLowerCase().includes(search) ||
          p.name.toLowerCase().includes(search) ||
          (p.imeiSerial && p.imeiSerial.includes(search))
        )
      : allProducts;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: filtered, total: filtered.length }),
    });
  });

  // Customer search
  await page.route('**/api/customers/search?*', async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const filtered = q
      ? MOCK_CUSTOMERS.filter(c => c.name.includes(q) || c.phone.includes(q) || c.nationalId.includes(q))
      : MOCK_CUSTOMERS;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(filtered),
    });
  });

  // POS config
  await page.route('**/api/sales/config', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_POS_CONFIG),
    });
  });

  // Top products
  await page.route('**/api/sales/top-products', async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_TOP_PRODUCTS),
    });
  });

  // Create sale
  await page.route('**/api/sales', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ id: 'sale-1', saleNumber: 'SALE-20260322-001' }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
  });
}

async function setupPosPage(page: Page) {
  await loginWithMock(page);
  await mockPosApis(page);
  await page.goto('/pos', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
}

/** Select the first product (iPhone 15 Pro) */
async function selectProduct(page: Page) {
  const productInput = page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...');
  await productInput.fill('iphone');
  // Wait for debounce search dropdown to appear
  const dropdown = page.locator('.absolute.z-50');
  await dropdown.locator('button').filter({ hasText: 'Apple iPhone 15 Pro' }).first().waitFor({ state: 'visible' });
  await dropdown.locator('button').filter({ hasText: 'Apple iPhone 15 Pro' }).first().click();
}

/** Select the first customer (สมชาย ใจดี) */
async function selectCustomer(page: Page) {
  const customerInput = page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร...');
  await customerInput.fill('สมชาย');
  // Wait for debounce search dropdown to appear
  const dropdown = page.locator('.absolute.z-50');
  await dropdown.locator('button').filter({ hasText: 'สมชาย ใจดี' }).first().waitFor({ state: 'visible' });
  await dropdown.locator('button').filter({ hasText: 'สมชาย ใจดี' }).first().click();
}

// ---------- Page Load & Header ----------

test.describe('POS Page - Load & Header', () => {
  test('should display POS page header', async ({ page }) => {
    await setupPosPage(page);
    await expect(page).toHaveURL('/pos');
    await expect(page.getByText('POS - ขายสินค้า')).toBeVisible();
    await expect(page.getByText('ระบบขายหน้าร้าน')).toBeVisible();
  });

  test('should display sale type selector', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('ประเภทการขาย')).toBeVisible();
    // Use role-based selector to avoid strict mode
    await expect(page.getByRole('button', { name: 'เงินสด' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ผ่อนไฟแนนซ์' })).toBeVisible();
  });

  test('should show main form sections', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('สินค้าหลัก')).toBeVisible();
    await expect(page.getByText('ของแถม / อุปกรณ์เสริม')).toBeVisible();
    await expect(page.getByText('เลือกลูกค้า')).toBeVisible();
    await expect(page.getByText('รายละเอียดการขาย')).toBeVisible();
  });

  test('should show summary sidebar', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('สรุปรายการ')).toBeVisible();
    await expect(page.getByText('ยอดสุทธิ')).toBeVisible();
  });
});

// ---------- Sale Type Selection ----------

test.describe('POS Page - Sale Type Selection', () => {
  test('should default to CASH sale type badge in summary', async ({ page }) => {
    await setupPosPage(page);
    const summary = page.locator('.sticky');
    // The badge with เงินสด in summary
    await expect(summary.locator('.rounded-full').filter({ hasText: 'เงินสด' })).toBeVisible();
  });

  test('should switch to EXTERNAL_FINANCE and update summary badge', async ({ page }) => {
    await setupPosPage(page);
    await page.getByRole('button', { name: 'ผ่อนไฟแนนซ์' }).click();
    const summary = page.locator('.sticky');
    await expect(summary.locator('.rounded-full').filter({ hasText: 'ผ่อนไฟแนนซ์' })).toBeVisible();
  });

  test('should show link to contract creation for installments', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('ต้องการผ่อนกับ BESTCHOICE?')).toBeVisible();
  });
});

// ---------- Quick Picks ----------

test.describe('POS Page - Quick Picks', () => {
  test('should show top selling products when no product selected', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('สินค้าขายดี')).toBeVisible();
    await expect(page.getByText('ขายแล้ว 15 เครื่อง')).toBeVisible();
  });
});

// ---------- Product Search & Selection ----------

test.describe('POS Page - Product Search', () => {
  test('should search for products with 2+ characters', async ({ page }) => {
    await setupPosPage(page);
    const productInput = page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...');
    await productInput.fill('iphone');
    // Wait for debounce search dropdown to appear
    const dropdown = page.locator('.absolute.z-50');
    await expect(dropdown.getByText('Apple iPhone 15 Pro').first()).toBeVisible();
  });

  test('should select a product and show IMEI', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    await expect(page.getByText('IMEI: 123456789012345')).toBeVisible();
    await expect(page.getByText('เปลี่ยน').first()).toBeVisible();
  });

  test('should auto-fill selling price from default price', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    // readOnly input with selling price
    const sellingPriceInput = page.locator('input[readonly]');
    await expect(sellingPriceInput).toHaveValue('35000');
  });

  test('should show price picker buttons after product selection', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    // Price picker buttons show label + (ค่าเริ่มต้น) for default
    await expect(page.getByText('เลือกราคาขาย (จากระบบ) *')).toBeVisible();
    await expect(page.getByText('ราคาสด (ค่าเริ่มต้น)')).toBeVisible();
    await expect(page.getByText('ราคาพิเศษ', { exact: true })).toBeVisible();
  });

  test('should hide quick picks after product selection', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('สินค้าขายดี')).toBeVisible();
    await selectProduct(page);
    await expect(page.getByText('สินค้าขายดี')).not.toBeVisible();
  });

  test('should allow changing product', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    await page.getByText('เปลี่ยน').first().click();
    await expect(page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...')).toBeVisible();
  });
});

// ---------- Customer Search & Selection ----------

test.describe('POS Page - Customer Search', () => {
  test('should search for customers', async ({ page }) => {
    await setupPosPage(page);
    const customerInput = page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร...');
    await customerInput.fill('สมชาย');
    // Wait for debounce search dropdown to appear
    const dropdown = page.locator('.absolute.z-50');
    await expect(dropdown.getByText('สมชาย ใจดี').first()).toBeVisible();
  });

  test('should select a customer and show contract count', async ({ page }) => {
    await setupPosPage(page);
    await selectCustomer(page);
    await expect(page.getByText('สัญญา 2 รายการ')).toBeVisible();
  });

  test('should show customer in summary sidebar', async ({ page }) => {
    await setupPosPage(page);
    await selectCustomer(page);
    const summary = page.locator('.sticky');
    await expect(summary.getByText('สมชาย ใจดี')).toBeVisible();
    await expect(summary.getByText('0812345678')).toBeVisible();
  });
});

// ---------- Sale Details - CASH ----------

test.describe('POS Page - Cash Sale Details', () => {
  test('should show payment method and amount received for CASH', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('วิธีชำระเงิน')).toBeVisible();
    await expect(page.getByText('เงินที่รับ')).toBeVisible();
  });

  test('should show discount shortcuts after product selection', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    await expect(page.getByRole('button', { name: '0%', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '5%', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '10%', exact: true })).toBeVisible();
  });

  test('should calculate net amount in summary', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    const summary = page.locator('.sticky');
    // Net amount row: ยอดสุทธิ 35,000 ฿
    await expect(summary.locator('.font-bold').filter({ hasText: '35,000' })).toBeVisible();
  });

  test('should show notes field', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByPlaceholder('หมายเหตุเพิ่มเติม (ถ้ามี)')).toBeVisible();
  });
});

// ---------- Sale Details - EXTERNAL_FINANCE ----------

test.describe('POS Page - External Finance Details', () => {
  test('should show finance-specific fields when EXTERNAL_FINANCE selected', async ({ page }) => {
    await setupPosPage(page);
    await page.getByRole('button', { name: 'ผ่อนไฟแนนซ์' }).click();
    await expect(page.getByPlaceholder('ชื่อบริษัทไฟแนนซ์')).toBeVisible();
    await expect(page.getByPlaceholder('เลขที่สัญญาไฟแนนซ์')).toBeVisible();
    await expect(page.getByText('เงินดาวน์', { exact: true })).toBeVisible();
    await expect(page.getByText('รับเงินดาวน์โดย')).toBeVisible();
  });

  test('should show finance summary in sidebar', async ({ page }) => {
    await setupPosPage(page);
    await page.getByRole('button', { name: 'ผ่อนไฟแนนซ์' }).click();
    const summary = page.locator('.sticky');
    await expect(summary.getByText('สรุปไฟแนนซ์')).toBeVisible();
    await expect(summary.getByText('ยอดที่ไฟแนนซ์ต้องโอน')).toBeVisible();
  });

  test('should hide CASH-specific fields when EXTERNAL_FINANCE selected', async ({ page }) => {
    await setupPosPage(page);
    await page.getByRole('button', { name: 'ผ่อนไฟแนนซ์' }).click();
    await expect(page.getByText('เงินที่รับ')).not.toBeVisible();
  });
});

// ---------- Bundle / Freebie ----------

test.describe('POS Page - Bundle Products', () => {
  test('should show bundle search input', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByPlaceholder('ค้นหาของแถม เช่น ฟิล์ม, เคส, ชุดชาร์จ...')).toBeVisible();
  });

  test('should show bundle info text', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByText('ตัดสต๊อกให้ลูกค้า (ราคา 0 บาท)')).toBeVisible();
  });
});

// ---------- Submit & Validation ----------

test.describe('POS Page - Submit & Validation', () => {
  test('should disable submit button when form is incomplete', async ({ page }) => {
    await setupPosPage(page);
    const submitButton = page.getByRole('button', { name: 'บันทึกการขาย' });
    await expect(submitButton).toBeDisabled();
  });

  test('should enable submit button when product, customer, and price are set', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    await selectCustomer(page);
    const submitButton = page.getByRole('button', { name: 'บันทึกการขาย' });
    await expect(submitButton).toBeEnabled();
  });

  test('should show clear form button', async ({ page }) => {
    await setupPosPage(page);
    await expect(page.getByRole('button', { name: 'ล้างข้อมูล' })).toBeVisible();
  });

  test('should clear form when ล้างข้อมูล clicked', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    await expect(page.getByText('IMEI: 123456789012345')).toBeVisible();
    await page.getByRole('button', { name: 'ล้างข้อมูล' }).click();
    await expect(page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...')).toBeVisible();
    await expect(page.getByText('IMEI: 123456789012345')).not.toBeVisible();
  });
});

// ---------- Summary Sidebar ----------

test.describe('POS Page - Summary Sidebar', () => {
  test('should show product info in summary after selection', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    const summary = page.locator('.sticky');
    await expect(summary.getByText('สินค้าหลัก')).toBeVisible();
    await expect(summary.getByText('Apple iPhone 15 Pro')).toBeVisible();
    await expect(summary.getByText('123456789012345')).toBeVisible();
  });

  test('should show price in summary after selection', async ({ page }) => {
    await setupPosPage(page);
    await selectProduct(page);
    const summary = page.locator('.sticky');
    await expect(summary.locator('.font-bold').filter({ hasText: '35,000' })).toBeVisible();
  });
});
