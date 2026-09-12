import { test, expect, type Page, type Download } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const evidence = path.resolve('..', '..', 'docs/review/2026-09-11-sales/remediation-evidence');
type Row = Record<string, any>;
async function fixture(page: Page, role = 'OWNER') {
  const actor = { id: 'ux-actor', name: 'พนักงานตัวอย่าง UX', email: 'ux@example.invalid', role, branchId: 'ux-branch', accessibleCompanies: role === 'SALES' ? ['SHOP'] : ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' };
  const branch = { id: 'ux-branch', name: 'สาขาตัวอย่าง', shopCashAccountCode: 'S11-1101' };
  const customers: Row[] = Array.from({ length: 201 }, (_, i) => ({ id: `c${String(i).padStart(3, '0')}`, name: `ลูกค้าตัวอย่าง ${String(i).padStart(3, '0')}`, phone: '0800000000', nationalId: '',
    birthDate: '1990-01-01', salary: '30000', salaryPayDay: 31, _count: { contracts: 0 }, activeContracts: 0, overdueContracts: 0,
    latestCreditStatus: null, latestCreditScore: null, tier: 'GOLD', createdAt: '2026-09-01T00:00:00Z', contracts: [], documents: [], references: [] }));
  const product = { id: 'ux-product', name: 'เครื่องตัวอย่าง', brand: 'TEST', model: 'PHONE', category: 'PHONE_NEW', branchId: branch.id, branch,
    status: 'IN_STOCK', cashPrice: '9000', installmentPrice: '10000', costPrice: '6000', imeiSerial: null, serialNumber: 'UX-SERIAL',
    prices: [{ id: 'cash', label: 'ราคาเงินสด', amount: '9000', isDefault: true }, { id: 'loan', label: 'ราคาผ่อน BESTCHOICE', amount: '10000' }] };
  const checklist = ['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2', 'GUARDIAN'].map(type => ({ type, label: type === 'GUARDIAN' ? 'ผู้ปกครอง' : type, signed: type !== 'GUARDIAN' }));
  const contracts: Row[] = Array.from({ length: 201 }, (_, i) => ({ id: `hp${i}`, contractNumber: `HP-UX-${String(i).padStart(3, '0')}`, status: 'DRAFT', workflowStatus: 'APPROVED',
    customerId: customers[i].id, customer: customers[i], product, branch, branchId: branch.id, salesperson: actor, salespersonId: actor.id,
    sellingPrice: '10000', downPayment: '2000', financedAmount: '8000', monthlyPayment: '1546.66', totalMonths: 6, paymentDueDay: 31,
    interestRate: '0.01', planType: 'STORE_DIRECT', createdAt: '2026-09-01T00:00:00Z', signatures: checklist.filter(row => row.signed).map((row, i) => ({ id: `sig${i}`, signerType: row.type, signedAt: '2026-09-01' })),
    signatureRequirements: { complete: false, checklist }, _count: { payments: 6, contractDocuments: 0 }, payments: [], contractDocuments: [], eDocuments: [], pdpaConsentId: 'consent' }));
  const credits = Array.from({ length: 51 }, (_, i) => ({ id: `credit${i}`, status: 'MANUAL_REVIEW', checkType: 'FULL', aiScore: null, customer: customers[i],
    aiSummary: 'รอผู้จัดการตรวจ', createdAt: '2026-09-01T00:00:00Z', approvals: [], statementFiles: [], statementMonths: 0 }));
  const bookings: Row[] = Array.from({ length: 151 }, (_, i) => ({ id: `bk${i}`, bookingNumber: `BK-UX-${String(i).padStart(3, '0')}`, status: 'PAID',
    customer: customers[i], branch, createdBy: actor, totalAmount: '10000', depositAmount: '1000', depositMethod: 'CASH',
    depositPaidAt: '2026-09-01T00:00:00Z', expireDate: '2099-09-11T17:00:00Z', createdAt: '2026-09-01T00:00:00Z',
    items: [{ id: `item${i}`, productId: product.id, description: product.name, quantity: 1, unitPrice: '10000', amount: '10000' }] }));
  const sales: Row[] = Array.from({ length: 201 }, (_, i) => ({ id: `sale${i}`, saleNumber: `SALE-UX-${String(i).padStart(3, '0')}`, saleType: 'CASH', sellingPrice: '10000', discount: '0', netAmount: '10000', costPriceSnapshot: '6000',
    amountReceived: '10000', paymentMethod: 'CASH', customer: customers[i], product, branch, salesperson: actor, createdAt: '2026-09-01T00:00:00Z', deletedAt: null, contract: null }));
  const state = { attachments: [] as Row[], generated: [] as Row[], uploadCount: 0, failUploadAt: 0, customers, credits, bookings, contracts, sales, failPath: '', holdPath: '', holdPage: '', hold: null as Promise<void> | null, emptyPath: '', missingCash: false, requests: [] as Row[] };
  const paged = (rows: Row[], query: URLSearchParams) => {
    const page = Number(query.get('page') || 1), limit = Number(query.get('limit') || 50);
    return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit, totalPages: Math.ceil(rows.length / limit) };
  };
  await page.routeWebSocket('**/socket.io/**', socket => socket.close());
  await page.route('**/api/admin/**', async route => {
    const request = route.request(), url = new URL(request.url()), rawPath = url.pathname.replace('/api/admin', '');
    const isExport = rawPath.endsWith('/export'), routePath = rawPath.replace(/\/export$/, '');
    const exportOrPage = (rows: Row[], query: URLSearchParams) => isExport ? { data: rows, total: rows.length, asOf: '2026-09-11T03:00:00.000Z' } : paged(rows, query);
    const query = url.searchParams;
    state.requests.push({ path: rawPath, query: Object.fromEntries(query), method: request.method(), body: request.method() === 'GET' ? null : request.postDataJSON() });
    if (state.holdPath === rawPath && state.hold && (!state.holdPage || query.get('page') === state.holdPage)) await state.hold;
    if (state.failPath === routePath) return route.fulfill({ status: 503, json: { message: 'บริการตัวอย่างไม่พร้อม กรุณาลองใหม่' } });
    if (request.method() !== 'GET') {
      if (routePath === '/contracts/hp0/documents' && request.method() === 'POST') {
        state.uploadCount++;
        if (state.uploadCount === state.failUploadAt) return route.fulfill({ status: 503, json: { message: 'Synthetic upload failure' } });
        const body = request.postDataJSON();
        const doc = { ...body, id: `attachment-${state.uploadCount}`, createdAt: '2026-09-11T00:00:00Z', uploadedBy: actor };
        state.attachments.push(doc);
        return route.fulfill({ json: doc });
      }

      if (/^\/sales\/sale\d+\/void$/.test(routePath)) {
        const id = routePath.split('/')[2], sale = state.sales.find(row => row.id === id)!;
        state.sales = state.sales.filter(row => row.id !== id);
        return route.fulfill({ json: { saleNumber: sale.saleNumber, restoredProductIds: [product.id] } });
      }
      if (routePath === '/bookings') return route.fulfill({ json: { id: 'new-booking' } });
      if (routePath === '/contracts/quote') {
        return route.fulfill({ status: 503, json: { message: 'ผลคำนวณตัวอย่างไม่พร้อม' } });
      }
      return route.fulfill({ status: 501, json: { message: 'Synthetic fixture: unsupported writes disabled' } });
    }
    if (routePath === '/auth/me') return route.fulfill({ json: actor });
    if (routePath === '/settings/ui-flags') return route.fulfill({ status: 503, json: { message: 'Use application defaults in this isolated UI fixture' } });
    if (routePath === '/branches') return route.fulfill({ json: [branch] });
    if (routePath === '/sales/salespersons') return route.fulfill({ json: [actor] });
    if (routePath === '/sales/top-products' || routePath === '/external-finance-companies') return route.fulfill({ json: [] });
    if (routePath === '/sales/config' || routePath.startsWith('/interest-configs')) return route.fulfill({ json: { id: 'config', interestRate: 0.01, minDownPaymentPct: 0.15, minInstallmentMonths: 6, maxInstallmentMonths: 12, storeCommissionPct: 0.1, vatPct: 0.07 } });
    if (routePath === '/products' || routePath === '/products/ux-product') {
      const row = state.missingCash ? { ...product, cashPrice: null, prices: product.prices.slice(1) } : product;
      return route.fulfill({ json: routePath === '/products' ? { data: [row], total: 1 } : row });
    }
    if (routePath === '/customers/search') return route.fulfill({ json: state.customers.filter(row => row.name.includes(query.get('q') || '')) });
    if (routePath === '/customers') {
      let rows = state.emptyPath === routePath ? [] : state.customers;
      if (query.get('search')) rows = rows.filter(row => row.name.includes(query.get('search')!));
      if (query.get('tier')) rows = rows.filter(row => row.tier === query.get('tier'));
      if (query.get('sortBy') === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name) * (query.get('sortOrder') === 'desc' ? -1 : 1));
      return route.fulfill({ json: { ...exportOrPage(rows, query), summary: { totalCustomers: rows.length, withActiveContract: 0, withOverdue: 0, newThisMonth: 0 } } });
    }
    if (/^\/customers\/c\d+$/.test(routePath)) return route.fulfill({ json: state.customers.find(row => row.id === routePath.split('/')[2]) });
    if (/^\/customers\/c\d+\/risk-flag/.test(routePath)) return route.fulfill({ json: { hasRisk: false, overdueContracts: [] } });
    if (/^\/customers\/c\d+\/tier/.test(routePath)) return route.fulfill({ json: { tier: 'NEW', reasons: [], history: { totalContracts: 0, closedContracts: 0, activeContracts: 0, onTimePaymentPct: 0, maxOverdueDays: 0, currentOutstanding: 0 } } });
    if (routePath.endsWith('/credit-check/latest')) return route.fulfill({ json: { id: 'approved', status: 'APPROVED', checkType: 'FULL', approvals: [{ id: 'approval', approvedMonthlyPayment: '2000', salaryPayDay: 31 }] } });
    if (routePath.endsWith('/credit-check') || routePath.includes('/trade-ins/credits')) return route.fulfill({ json: [] });
    if (routePath.endsWith('/points')) return route.fulfill({ json: { balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, referralCount: 0 } });
    if (routePath.includes('/loyalty/') || routePath === '/audit/logs') return route.fulfill({ json: { data: [], total: 0 } });
    if (routePath === '/credit-checks') {
      const rows = state.emptyPath === routePath ? [] : state.credits;
      return route.fulfill({ json: { ...exportOrPage(rows, query), summary: { totalCount: rows.length, pendingCount: rows.length, approvedCount: 0, rejectedCount: 0, avgScore: null } } });
    }
    if (routePath === '/bookings') return route.fulfill({ json: paged(state.emptyPath === routePath ? [] : state.bookings, query) });
    if (/^\/bookings\/bk\d+$/.test(routePath)) return route.fulfill({ json: state.bookings.find(row => row.id === routePath.split('/')[2]) });
    if (routePath === '/contracts') {
      let rows = state.emptyPath === routePath ? [] : state.contracts;
      for (const field of ['status', 'workflowStatus', 'branchId', 'salespersonId']) {
        if (query.get(field)) rows = rows.filter(row => row[field] === query.get(field));
      }
      if (query.get('search')) rows = rows.filter(row => row.contractNumber.includes(query.get('search')));
      if (query.get('startDate')) rows = rows.filter(row => new Date(row.createdAt) >= new Date(`${query.get('startDate')}T00:00:00+07:00`));
      if (query.get('endDate')) rows = rows.filter(row => row.createdAt.slice(0, 10) <= query.get('endDate')!);
      return route.fulfill({ json: { ...exportOrPage(rows, query), summary: { totalContracts: rows.length, activeContracts: 0, overdueContracts: 0, portfolioValue: rows.length * 10000 } } });
    }
    if (routePath === '/contracts/hp0/e-documents') return route.fulfill({ json: paged(state.generated, query) });
    if (routePath === '/contracts/hp0/documents') return route.fulfill({ json: paged(state.attachments, query) });
    if (routePath === '/contracts/hp0/documents/checklist') return route.fulfill({ json: { checklist: [
      { type: 'SIGNED_CONTRACT', autoGenerate: true, present: false },
      ...['ID_CARD_COPY', 'KYC_SELFIE', 'DEVICE_PHOTO', 'GUARDIAN_DOC'].map(type => ({ type, autoGenerate: false, present: state.attachments.some(doc => doc.documentType === type) })),
    ] } });
    if (routePath === '/contracts/hp0/preview') return route.fulfill({ json: { html: '<html><body>ตัวอย่างสัญญาสำหรับทดสอบ</body></html>' } });
    if (/^\/documents\/generated-\d+\/download$/.test(routePath) || /^\/contracts\/hp0\/documents\/attachment-\d+\/content$/.test(routePath)) return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%SYNTHETIC-DOCUMENT-CONTENT\n%%EOF' });
    if (routePath === '/contracts/hp0/download-pdf') return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%Synthetic download transport fixture\n%%EOF' });
    if (/^\/contracts\/hp\d+$/.test(routePath)) return route.fulfill({ json: state.contracts.find(row => row.id === routePath.split('/')[2]) });
    if (routePath === '/sales') {
      let rows = state.emptyPath === routePath ? [] : state.sales;
      for (const field of ['saleType', 'paymentMethod']) {
        if (query.get(field)) rows = rows.filter(row => row[field] === query.get(field));
      }
      if (query.get('branchId')) rows = rows.filter(row => row.branch.id === query.get('branchId'));
      if (query.get('salespersonId')) rows = rows.filter(row => row.salesperson.id === query.get('salespersonId'));
      if (query.get('search')) rows = rows.filter(row => row.saleNumber.includes(query.get('search')));
      if (query.get('startDate')) rows = rows.filter(row => new Date(row.createdAt) >= new Date(`${query.get('startDate')}T00:00:00+07:00`));
      if (query.get('endDate')) rows = rows.filter(row => row.createdAt.slice(0, 10) <= query.get('endDate')!);
      if (query.get('includeVoided') !== 'true') rows = rows.filter(row => !row.deletedAt);
      return route.fulfill({ json: { ...exportOrPage(rows, query), summary: { totalAmount: rows.length * 10000, totalDiscount: 0, totalProfit: rows.length * 4000, cashCount: rows.length, cashAmount: rows.length * 10000, installmentCount: 0, installmentAmount: 0, financeCount: 0, financeAmount: 0 } } });
    }
    if (/^\/sales\/sale\d+$/.test(routePath)) return route.fulfill({ json: state.sales.find(row => row.id === routePath.split('/')[2]) });
    return route.fulfill({ status: 501, json: { message: `Synthetic fixture: unsupported read ${routePath}` } });
  });
  return state;
}
async function snapshot(page: Page, name: string, width: number) {
  // Radix correctly hides the background from accessibility while a modal is open.
  await expect(page.locator('main')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  const modal = page.getByRole('dialog');
  const hasModal = await modal.count() > 0;
  if (hasModal) await expect.poll(() => modal.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
  })).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, `${name}-${width}.png`), fullPage: !hasModal, animations: 'disabled' });
}
async function readDownload(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  return workbook.worksheets[0];
}
async function openFilters(page: Page, width: number) {
  if (width === 390) await page.getByRole('button', { name: 'เปิดตัวกรอง' }).click();
}
async function closeFilters(page: Page, width: number) {
  if (width === 390) {
    await page.getByRole('button', { name: 'ดูรายการ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'เปิดตัวกรอง' })).toBeFocused();
  }
}

for (const width of [1440, 390]) {
  test.describe(`six Sales menus / ${width}px / synthetic UI`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const errors: string[] = [];
    test.beforeEach(async ({ page }) => { errors.length = 0; page.on('pageerror', error => errors.push(error.message)); await page.clock.setFixedTime(new Date('2026-09-11T04:00:00Z')); });
    test.afterEach(() => expect(errors).toEqual([]));

    test('customers: second page + tier/sort exports201 rows and returns mobile filter focus', async ({ page }) => {
      const state = await fixture(page);
      await page.goto('/customers');
      await expect(page.getByText('ลูกค้าตัวอย่าง 000', { exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(page.getByText('ลูกค้าตัวอย่าง 050', { exact: true }).first()).toBeVisible();
      await openFilters(page, width);
      await page.getByRole('combobox', { name: 'ระดับลูกค้า' }).click();
      await page.getByRole('option', { name: 'VIP (Gold)', exact: true }).click();
      await page.getByRole('combobox', { name: 'เรียงลูกค้าโดย' }).click();
      await page.getByRole('option', { name: 'ชื่อ', exact: true }).click();
      await closeFilters(page, width);
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(page.getByText('ลูกค้าตัวอย่าง 050', { exact: true }).first()).toBeVisible();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: /ส่งออก Excel/ }).click();
      const sheet = await readDownload(await download);
      expect(sheet.rowCount).toBe(202);
      expect(sheet.getRow(202).getCell(1).value).toBe('ลูกค้าตัวอย่าง 200');
      const calls = state.requests.filter(row => row.path === '/customers/export');
      expect(calls.map(row => [row.query.page, row.query.tier, row.query.sortBy, row.query.sortOrder])).toEqual([['1', 'GOLD', 'name', 'asc']]);
      await snapshot(page, 'customers-filtered-page2', width);
    });

    test('customer detail: SALES can start credit/upload, cannot edit master; every tab fits', async ({ page }) => {
      await fixture(page, 'SALES');
      await page.goto('/customers/c000');
      const tabs = ['ข้อมูลส่วนตัว', 'ติดต่อ & ที่อยู่', 'งาน & อ้างอิง', 'เครดิต', 'สัญญา', 'การซื้อ', 'แต้ม'];
      await expect(page.getByRole('tab', { name: /ข้อมูลส่วนตัว/ })).toBeVisible();
      for (const title of tabs) {
        const tab = page.getByRole('tab').filter({ hasText: title }).first();
        await tab.scrollIntoViewIfNeeded(); await tab.click();
        await snapshot(page, `customer-detail-${tabs.indexOf(title)}`, width);
      }
      await page.getByRole('tab', { name: /^เครดิต/ }).click();
      await expect(page.getByRole('button', { name: '+ ตรวจเครดิตใหม่', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true })).toHaveCount(0);
      await page.getByRole('tab', { name: /^งาน & อ้างอิง/ }).click();
      await expect(page.locator('input[type="file"]')).toBeVisible();
    });

    test('credit queue: page51, no score, pending/error preserve filter focus and retry', async ({ page }) => {
      const state = await fixture(page);
      await page.goto('/credit-checks');
      await expect(page.getByText('ยังไม่มีคะแนน', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText('ลูกค้าตัวอย่าง 050', { exact: true }).first()).toBeVisible();
      await openFilters(page, width);
      state.holdPath = '/credit-checks'; let release!: () => void;
      state.hold = new Promise<void>(resolve => { release = resolve; });
      await page.getByRole('combobox', { name: '', exact: true }).click();
      await page.getByRole('option', { name: 'ทั้งหมด', exact: true }).click();
      await expect.poll(() => state.requests.filter(row => row.path === '/credit-checks' && !row.query.status).length).toBeGreaterThan(0);
      if (width === 390) await expect(page.getByRole('dialog')).toBeVisible();
      release(); state.hold = null; state.holdPath = '';
      await closeFilters(page, width);
      state.failPath = '/credit-checks';
      await page.getByRole('textbox', { name: 'ค้นหารายการตรวจเครดิต' }).fill('ตัวอย่าง');
      await expect(page.getByRole('button', { name: 'ลองใหม่', exact: true })).toBeVisible();
      await expect(page.getByRole('alert').getByText(/ระบบขัดข้องชั่วคราว/)).toBeVisible();
      await expect(page.getByText(/Request failed with status code/)).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'ค้นหารายการตรวจเครดิต' })).toBeFocused();
      await snapshot(page, 'credit-error-filters-retained', width);
      state.failPath = ''; state.emptyPath = '/credit-checks';
      await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
      await expect(page.getByText('ไม่พบรายการตรวจเครดิต', { exact: true })).toBeVisible();
    });

    test('POS: cash/external price, selected IDs and disclosure survive handoff', async ({ page }) => {
      await fixture(page, 'SALES');
      await page.goto('/pos');
      await page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...').fill('TEST');
      await page.getByRole('button').filter({ hasText: 'TEST PHONE' }).first().click();
      await expect(page.getByLabel(/ราคาขาย/)).toHaveValue('9000');
      await page.getByRole('button', { name: 'ผ่อนไฟแนนซ์', exact: true }).click();
      await expect(page.getByLabel(/ราคาขาย/)).toHaveValue('10000');
      await page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น ชื่อ, เบอร์โทร, เลขบัตร...').fill('ลูกค้าตัวอย่าง 000');
      await page.getByRole('button', { name: 'ลูกค้าตัวอย่าง 000 0800000000', exact: true }).click();
      await page.getByRole('button', { name: /ต้องการผ่อนกับ BESTCHOICE/ }).click();
      await expect(page.getByRole('dialog')).toContainText('ลูกค้า: ลูกค้าตัวอย่าง 000');
      await expect(page.getByRole('dialog')).toContainText('เครื่อง: เครื่องตัวอย่าง');
      await expect(page.getByText(/ราคา ส่วนลด ของแถม เครดิตเทิร์น/)).toBeVisible();
      await snapshot(page, 'pos-handoff-review', width);
      await page.getByRole('button', { name: 'ไปสร้างสัญญาด้วยข้อมูลนี้' }).click();
      await expect(page).toHaveURL(/contracts\/create\?customerId=c000&productId=ux-product/);
      await expect(page.getByText('ลูกค้าตัวอย่าง 000', { exact: true }).first()).toBeVisible();
    });

    test('bookings: bookmark size200 reaches all151, page controls and detail states', async ({ page }) => {
      const state = await fixture(page);
      await page.goto('/bookings?size=200');
      await expect(page.getByText('BK-UX-150', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      expect(state.requests.some(row => row.path === '/bookings' && row.query.limit === '200')).toBe(true);
      await page.getByRole('combobox', { name: 'แสดงต่อหน้า' }).selectOption('50');
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText('BK-UX-050', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'เปิด', exact: true }).first().click();
      await expect(page.getByRole('button', { name: 'รับส่วนต่างและขาย', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'แก้หมายเหตุ / วันหมดอายุ', exact: true })).toBeVisible();
      await snapshot(page, 'bookings-page2-paid', width);
    });

    test('contracts: guardian count, kanban pagination, all201/current page exports', async ({ page }) => {
      const state = await fixture(page);
      state.contracts.push({ ...state.contracts[0], id: 'excluded', contractNumber: 'OUTSIDE-FILTER', status: 'ACTIVE', branchId: 'another-branch' });
      await page.goto('/contracts?q=HP-UX&status=DRAFT&workflow=APPROVED&branchId=ux-branch&startDate=2026-09-01&endDate=2026-09-30');
      await expect(page.getByText('ลงนามแล้ว 4/5', { exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByRole('link', { name: 'HP-UX-050', exact: true })).toBeVisible();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
      expect((await readDownload(await download)).rowCount).toBe(202);
      expect(state.requests.filter(row => row.path === '/contracts/export').map(row => row.query.page)).toEqual(['1']);
      for (const row of state.requests.filter(row => row.path === '/contracts/export')) {
        expect(row.query).toMatchObject({ search: 'HP-UX', status: 'DRAFT', workflowStatus: 'APPROVED', branchId: 'ux-branch', startDate: '2026-09-01', endDate: '2026-09-30', company: 'shop' });
      }
      await page.getByRole('combobox', { name: 'ขอบเขตการส่งออก' }).selectOption('page');
      const current = page.waitForEvent('download');
      await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
      expect((await readDownload(await current)).rowCount).toBe(51);
      await page.getByRole('button', { name: 'มุมมอง Kanban', exact: true }).click();
      await expect(page.getByText('จำนวนในแต่ละคอลัมน์เป็นรายการในหน้านี้', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText('HP-UX-100', { exact: true })).toBeVisible();
      await snapshot(page, 'contracts-kanban-page3', width);
    });

    test('sales: page2 export201, detail deep link and focus, last row void returns valid page', async ({ page }) => {
      const state = await fixture(page);
      state.sales[20].amountReceived = null;
      state.sales[200].deletedAt = '2026-09-02T00:00:00Z';
      state.sales.push({ ...state.sales[0], id: 'excluded', saleNumber: 'OUTSIDE-FILTER', saleType: 'EXTERNAL_FINANCE', branch: { id: 'another-branch', name: 'สาขาอื่น' } });
      await page.goto('/sales');
      await page.getByRole('combobox', { name: 'ประเภทการขาย', exact: true }).selectOption('CASH');
      await page.getByRole('combobox', { name: 'วิธีชำระ', exact: true }).selectOption('CASH');
      await page.getByRole('combobox', { name: 'สาขา', exact: true }).selectOption('ux-branch');
      await page.getByRole('combobox', { name: 'พนักงานขาย', exact: true }).selectOption('ux-actor');
      await page.getByRole('button', { name: 'เดือนนี้', exact: true }).click();
      await page.getByRole('switch', { name: 'แสดงใบที่ยกเลิกแล้ว', exact: true }).check();
      await page.getByRole('textbox', { name: 'ค้นหารายการขาย', exact: true }).fill('SALE-UX');
      await expect.poll(() => state.requests.some(row => row.path === '/sales' && row.query.search === 'SALE-UX')).toBe(true);
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      const opener = page.getByRole('link', { name: 'SALE-UX-020', exact: true });
      await opener.click();
      await expect(page).toHaveURL(/saleId=sale20/);
      await expect(page.getByRole('dialog').getByText('UX-SERIAL', { exact: true })).toBeVisible();
      await expect(page.getByText('ต้นทุนเครื่อง ณ วันขาย', { exact: true })).toBeVisible();
      await expect(page.locator('dl > div').filter({ hasText: 'รับก่อนทอน' }).getByText('ยังไม่ระบุ', { exact: true })).toBeVisible();
      await snapshot(page, 'sales-detail-deep-link', width);
      await expect(page.getByRole('dialog').getByText('ยังไม่ระบุ', { exact: true })).toBeInViewport();
      await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
      expect((await readDownload(await download)).rowCount).toBe(202);
      expect(state.requests.filter(row => row.path === '/sales/export').map(row => row.query.page)).toEqual(['1']);
      for (const row of state.requests.filter(row => row.path === '/sales/export')) {
        expect(row.query).toMatchObject({ search: 'SALE-UX', saleType: 'CASH', paymentMethod: 'CASH', branchId: 'ux-branch', salespersonId: 'ux-actor', startDate: '2026-09-01', endDate: '2026-09-30', includeVoided: 'true', company: 'shop' });
      }
      state.sales = state.sales.slice(0, 21); state.sales[0].amountReceived = '0';
      await page.goto('/sales?saleId=sale0');
      await expect(page.locator('dl > div').filter({ hasText: 'รับก่อนทอน' }).getByText('0.00 บาท', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await page.getByRole('button', { name: 'ยกเลิกใบขาย', exact: true }).click();
      await page.getByRole('textbox', { name: /เหตุผลในการยกเลิก/ }).fill('ข้อมูลสมมติสำหรับตรวจการกลับหน้าหลังยกเลิก');
      await page.getByRole('button', { name: 'ยืนยันยกเลิกใบขาย', exact: true }).click();
      await expect(page.getByRole('link', { name: 'SALE-UX-000', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toHaveCount(0);
      expect(state.sales).toHaveLength(20);
    });

    for (const kind of ['mixed', 'prepaid', 'legacy'] as const) test(`booking sale receipt: ${kind}`, async ({ page }) => {
      const state = await fixture(page);
      state.bookings[0].status = 'CONVERTED';
      state.sales[0].receiptBreakdown = { bookingId: 'bk0', bookingNumber: 'BK-UX-000',
        depositAmount: kind === 'legacy' ? null : kind === 'prepaid' ? '10000.00' : '1000.00', depositMethod: kind === 'legacy' ? null : 'CASH',
        depositPaidAt: '2026-09-01T00:00:00Z', convertedAt: '2026-09-02T00:00:00Z',
        additionalAmount: kind === 'legacy' ? null : kind === 'prepaid' ? '0.00' : '9000.00',
        additionalMethod: kind === 'mixed' ? 'BANK_TRANSFER' : null, totalReceived: kind === 'legacy' ? null : '10000.00', needsReview: kind === 'legacy' };
      await page.goto('/sales?saleId=sale0');
      const receipt = page.getByRole('region', { name: 'การรับเงินจากใบจอง' });
      await expect(receipt.getByText('รับเพิ่มเมื่อขาย', { exact: true })).toBeVisible();
      if (kind === 'mixed') { await expect(receipt.getByText('9,000.00 บาท', { exact: true })).toBeVisible(); await expect(receipt.getByText(/โอนเงิน/)).toBeVisible(); }
      if (kind === 'prepaid') await expect(receipt.getByText('ชำระครบตั้งแต่ใบจอง')).toBeVisible();
      if (kind === 'legacy') await expect(receipt.getByText(/หลักฐานรับเงินเดิมไม่ครบ/)).toBeVisible();
      await expect(page.getByRole('dialog').getByText('รับก่อนทอน', { exact: true })).toHaveCount(0);
      await snapshot(page, `sales-booking-${kind}`, width);
      await receipt.getByRole('link', { name: 'เปิดใบจอง BK-UX-000' }).click();
      await expect(page).toHaveURL(/bookings\?bookingId=bk0/);
      await expect(page.getByRole('dialog').getByText('BK-UX-000', { exact: true }).first()).toBeVisible();
    });

    test('export: switching work company while the snapshot waits prevents any download', async ({ page }) => {
      const state = await fixture(page);
      const downloads: Download[] = [];
      page.on('download', download => downloads.push(download));
      await page.goto('/contracts');
      await expect(page.getByRole('link', { name: 'HP-UX-000', exact: true })).toBeVisible();
      state.holdPath = '/contracts/export'; state.holdPage = '1';
      let release!: () => void;
      state.hold = new Promise<void>(resolve => { release = resolve; });
      await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
      await expect.poll(() => state.requests.some(row => row.path === '/contracts/export' && row.query.page === '1')).toBe(true);
      if (width === 390) await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
      await page.getByRole('button', { name: /งานการเงิน/ }).or(page.getByRole('tab', { name: /งานการเงิน/ })).click();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('bc-entity-scope'))).toBe('FINANCE');
      release(); state.hold = null; state.holdPath = ''; state.holdPage = '';
      await expect(page.getByText('เปลี่ยนบริษัทระหว่างส่งออก กรุณาส่งออกใหม่จากบริษัทที่ต้องการ', { exact: true })).toBeVisible();
      expect(downloads).toHaveLength(0);
    });

    test('documents: generated list error retry, pagination and authenticated download', async ({ page }) => {
      const state = await fixture(page);
      state.generated = Array.from({ length: 21 }, (_, i) => ({ id: `generated-${i}`, documentType: 'CONTRACT', fileUrl: `private/${i}.pdf`, createdAt: '2026-09-11T00:00:00Z' }));
      state.failPath = '/contracts/hp0/e-documents';
      await page.goto('/contracts/hp0');
      await expect(page.getByRole('alert').getByText('โหลดเอกสารที่ระบบสร้างไม่สำเร็จ')).toBeVisible();
      state.failPath = '';
      await page.getByRole('alert').getByRole('button', { name: 'ลองใหม่' }).click();
      await expect(page.getByRole('button', { name: 'ดาวน์โหลด', exact: true })).toHaveCount(20);
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(page.getByRole('button', { name: 'ดาวน์โหลด', exact: true })).toHaveCount(1);
      const saved = page.waitForEvent('download');
      await page.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).click();
      expect((await saved).suggestedFilename()).toBe('CONTRACT_generated-20.pdf');
      expect(state.requests.some(row => row.path === '/documents/generated-20/download')).toBe(true);
      state.failPath = '/contracts/hp0/preview';
      await page.getByRole('button', { name: 'ดูสัญญา', exact: true }).click();
      await expect(page.getByRole('alert').getByText('โหลดตัวอย่างสัญญาไม่สำเร็จ')).toBeVisible();
      await snapshot(page, 'documents-preview-error', width);
      state.failPath = '';
      await page.getByRole('alert').getByRole('button', { name: 'ลองใหม่' }).click();
      await expect(page.locator('iframe[title="contract-preview"]')).toBeVisible();
    });

    test('documents: duplicate files never complete the required-type workflow step', async ({ page }) => {
      const state = await fixture(page, 'SALES');
      state.attachments = [1, 2, 3].map(n => ({ id: `duplicate-${n}`, documentType: 'DEVICE_PHOTO', fileName: `${n}.pdf`, fileUrl: 'fixture.pdf', createdAt: '2026-09-11T00:00:00Z' }));
      state.contracts[0].contractDocuments = state.attachments;
      await page.goto('/contracts/hp0');
      await expect(page.getByText('อัปโหลดเอกสารที่จำเป็น', { exact: true })).toBeVisible();
      state.attachments.push(...['ID_CARD_COPY', 'KYC_SELFIE', 'GUARDIAN_DOC'].map(type => ({ id: type, documentType: type, fileName: `${type}.pdf`, fileUrl: 'fixture.pdf', createdAt: '2026-09-11T00:00:00Z' })));
      await page.reload();
      await expect(page.getByText('ให้ลูกค้ายินยอม PDPA และลงนามสัญญา', { exact: true })).toBeVisible();
    });

    test('documents: partial upload remains visible, guardian input and protected preview', async ({ page }) => {
      const state = await fixture(page, 'SALES');
      state.failUploadAt = 2;
      await page.goto('/contracts/hp0');
      await page.getByRole('button', { name: 'เอกสาร', exact: true }).click();
      await expect(page.getByText('เอกสารที่ต้องแนบครบ 0/4 ประเภท', { exact: false })).toBeVisible();
      await page.getByLabel('แนบ เอกสารผู้ปกครอง', { exact: true }).setInputFiles([
        { name: 'guardian-1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
        { name: 'guardian-2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
      ]);
      await expect.poll(() => state.uploadCount).toBe(2);
      await expect(page.getByText('guardian-1.pdf', { exact: true })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: 'ระบบขัดข้องชั่วคราว' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'ลบเอกสาร', exact: true })).toHaveCount(0);
      const open = page.getByRole('button', { name: 'ดูเอกสาร', exact: true });
      await open.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(state.requests.some(row => row.path === '/contracts/hp0/documents/attachment-1/content')).toBe(true);
      await snapshot(page, 'documents-protected-preview', width);
      await page.keyboard.press('Escape');
      await expect(open).toBeFocused();
    });

    test('role states: finance manager cannot create contracts or sign; active downloads PDF fixture', async ({ page }) => {
      const state = await fixture(page, 'FINANCE_MANAGER');
      await page.goto('/contracts');
      await expect(page.getByRole('button', { name: 'สร้างสัญญา', exact: true })).toHaveCount(0);
      await page.goto('/contracts/hp0');
      await expect(page.getByRole('button', { name: 'ลงนามสัญญา', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'เปิดใช้งานสัญญา', exact: true })).toBeDisabled();
      state.contracts[0].status = 'ACTIVE'; await page.reload();
      await expect(page.getByRole('button', { name: 'ลงนามสัญญา', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'ดาวน์โหลด PDF', exact: true })).toBeVisible();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'ดาวน์โหลด PDF', exact: true }).click();
      expect((await download).suggestedFilename()).toBe('HP-UX-000.pdf');
      expect(state.requests.some(row => row.path === '/contracts/hp0/download-pdf')).toBe(true);
      await snapshot(page, 'contracts-finance-read-actions', width);
    });
  });
}
