// Field-scale check — what to measure (spec §5 "หน้าที่วัด"): every screen in appendix ก plus the 9 forms
// that embed AddressForm (spec §4.3), as { id, path, appendix, open?, mocks, probes? }.
//   path      string, or (ctx) => string | null (null = the preview has no sample record → cell "skipped")
//   open      clicks that open the dialog / tab / mode to measure — never save, never pick a value that saves
//   mocks     GET endpoints the local preview answers 501/404 for, or answers from data that varies between
//             preview starts: { path: /^\/api-path$/, json(url, ctx) }. path is matched against the request
//             pathname WITHOUT /api or /api/admin; GET only; route mocks after COMMON_MOCKS, first match wins.
//   probes    account-menu clipping check (S2-01 / S2-02): { id, widths, trigger(page) → Locator }
// COMMON_MOCKS apply to every route. ctx = { origin, me (GET /auth/me), customerId, contractPath }.
import { coaByCodes, coaGrouped, coaList, loadCoa } from './coa.mjs';

const COA = loadCoa();
const accountName = (code) => COA.find((r) => r.code === code)?.name ?? null;

// Same paper/document exclusions as the typography audit (apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts:40)
export const COLLECT_EXCLUDE = [
  '.voucher-sheet', '.document-sheet', '.bc-document', '.document-landscape', '.document-print-dialog',
  '.template-paper', '.font-sarabun', '.mobile-receipt', '.sticker', '.print-stickers', '.tiptap',
  '.parcel-label', '.contract-body', 'iframe', 'svg', '[data-sonner-toaster]',
].join(', ');
export const MENU_SEARCH_LABEL = 'ค้นหารหัส หรือ ชื่อบัญชี';
export const viewportFor = (width) => ({ width, height: width <= 430 ? 844 : 900 });

export const mock = (path, json) => ({ path, json: typeof json === 'function' ? json : () => json });

export const ACCOUNTING_PERMISSIONS = [
  'EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL', 'INCOME_POST', 'INCOME_APPROVE', 'INCOME_CANCEL',
];

export const COMMON_MOCKS = [
  mock(/^\/chart-of-accounts\/grouped$/, (url) => coaGrouped(COA, Object.fromEntries(url.searchParams))),
  mock(/^\/chart-of-accounts\/by-codes$/, (url) => coaByCodes(COA, (url.searchParams.get('codes') ?? '').split(','))),
  mock(/^\/chart-of-accounts$/, (url) => coaList(COA, Object.fromEntries(url.searchParams))),
  mock(/^\/accounting-permissions\/me$/, (url, ctx) => ({
    user: { id: ctx.me.id, name: ctx.me.name, role: ctx.me.role, branchId: ctx.me.branchId ?? null },
    permissions: ACCOUNTING_PERMISSIONS,
  })),
  mock(/^\/settings$/, []),
];

const DUNNING_RULES = [
  {
    id: 'preview-dunning-1', name: 'เตือนก่อนครบกำหนด 3 วัน', triggerDay: -3, eventTrigger: null, channel: 'LINE',
    messageTemplate: 'เรียนคุณ {customerName} ค่างวดที่ {installmentNo} ครบกำหนดวันที่ {dueDate}', templateName: null,
    includePaymentLink: true, autoExecute: true, escalateTo: null, isActive: true, sortOrder: 1,
  },
  {
    id: 'preview-dunning-2', name: 'ค้างชำระ 7 วัน โทรติดตาม', triggerDay: 7, eventTrigger: null, channel: 'CALL_TASK',
    messageTemplate: 'โทรติดตามลูกค้าที่ค้างชำระ 7 วัน', templateName: null, includePaymentLink: false,
    autoExecute: false, escalateTo: 'BRANCH_MANAGER', isActive: true, sortOrder: 2,
  },
];

const ROLE_MAP_ROWS = [
  ['payroll_expense', '53-1101', true],
  ['payroll_sso_expense', '53-1102', true],
  ['wht_payroll', '21-3101', false],
].map(([role, accountCode, required], i) => ({
  id: `preview-role-${i + 1}`, role, accountCode, accountName: accountName(accountCode),
  priority: 1, isActive: true, note: null, required,
}));

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 50 };

const PO_SUPPLIER = {
  id: 'preview-supplier-1', name: 'ผู้จัดจำหน่ายตัวอย่าง', contactName: null, phone: '020000000', hasVat: true,
  isActive: true,
  paymentMethods: [
    { paymentMethod: 'BANK_TRANSFER', bankName: 'กสิกรไทย', bankAccountNumber: '0000000000', isDefault: true },
  ],
};

const M = {
  dunningRules: mock(/^\/overdue\/dunning-rules$/, DUNNING_RULES),
  smsTemplates: mock(/^\/sms-templates$/, []),
  otherIncome: [
    mock(/^\/other-income\/maker-checker-enabled$/, { enabled: false }),
    mock(/^\/other-income\/config\/attachment-threshold$/, { threshold: 1000 }),
    mock(/^\/other-income\/templates$/, []),
  ],
  auditStats: mock(/^\/audit\/stats$/, { todayCount: 12, weekCount: 86, totalCount: 1240, recentErrors: 0 }),
  knowledge: [
    mock(/^\/chatbot\/finance\/admin\/knowledge$/, []),
    mock(/^\/chatbot\/finance\/admin\/kb-suggestions$/, { items: [], total: 0, page: 1, limit: 50 }),
  ],
  repossessions: [
    mock(/^\/repossessions$/, { ...EMPTY_PAGE, limit: 200 }),
    mock(/^\/repossessions\/profit-loss$/, {
      summary: { count: 0, totalAppraisal: 0, totalRepairCost: 0, totalResellPrice: 0, totalProfit: 0 },
      data: [],
    }),
    mock(/^\/device-returns\/awaiting-repossession$/, { data: [], total: 0 }),
    // DeviceReturnList.tsx:61-65 — without it the list's QueryBoundary shows its error panel
    mock(/^\/device-returns$/, { data: [], total: 0, page: 1, limit: 100 }),
  ],
  transfers: [
    mock(/^\/products\/transfers\/(pending|in-transit)$/, []),
    mock(/^\/products\/transfers\/history$/, EMPTY_PAGE),
    mock(/^\/branch-receiving\/pending-deliveries$/, []),
    mock(/^\/branch-receiving$/, EMPTY_PAGE),
  ],
  expense: [
    mock(/^\/expense-templates$/, []),
    mock(/^\/employees\/pickable$/, []),
    mock(/^\/sso-config\/effective$/, {
      salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05,
    }),
  ],
  interestConfigs: mock(/^\/interest-configs$/, []),
  suppliers: mock(/^\/suppliers$/, { data: [], total: 0, page: 1, totalPages: 1 }),
  // the one supplier the purchase wizard's draft names (openPurchasePayment)
  poSuppliers: mock(/^\/suppliers$/, { data: [PO_SUPPLIER], total: 1, page: 1, totalPages: 1 }),
  // The preview answers this from its own data and the model select stays disabled until it lands
  // (QuickBuyModal.tsx:188-196,895) — a fixed catalog keeps both selects in the same state every run.
  buybackCatalog: mock(/^\/trade-ins\/quick-buy\/catalog$/, {
    models: [
      { model: 'iPhone 15', storages: [{ storage: '128GB', maxPrice: '14500' }, { storage: '256GB', maxPrice: '16500' }] },
      { model: 'iPhone 15 Pro', storages: [{ storage: '256GB', maxPrice: '21500' }] },
    ],
  }),
  purchaseOrders: mock(/^\/purchase-orders$/, EMPTY_PAGE),
  roleMap: mock(/^\/settings\/role-map$/, ROLE_MAP_ROWS),
  // The preview's GET /branches is a bare findMany without `_count` — BranchesPage.tsx:158 reads
  // b._count.users and the page crashes ("Cannot read properties of undefined (reading 'users')").
  branches: mock(/^\/branches$/, [
    {
      id: 'preview-branch-1', name: 'สาขาตัวอย่าง (คลังหลัก)', location: 'กรุงเทพมหานคร', phone: '020000000',
      isActive: true, isMainWarehouse: true, shopCashAccountCode: 'S11-1101', shopCashFloat: '2000',
      _count: { users: 5, products: 120, contracts: 30 },
    },
    {
      id: 'preview-branch-2', name: 'สาขาตัวอย่าง 2', location: null, phone: null,
      isActive: true, isMainWarehouse: false, shopCashAccountCode: null, shopCashFloat: '0',
      _count: { users: 2, products: 40, contracts: 8 },
    },
  ]),
  // The preview's fixed actor is OWNER, and /todos is not in OWNER's menu (config/menu.ts OWNER_CONFIG) —
  // MainLayout redirects it to "/". Present the actor as BRANCH_MANAGER (whose menu has /todos) to the
  // web app only; the preview API still answers as OWNER.
  branchManagerActor: mock(/^\/auth\/me$/, (url, ctx) => ({ ...ctx.me, role: 'BRANCH_MANAGER' })),
};

const clickButton = (name) => async (page) => {
  await page.getByRole('button', { name, exact: true }).first().click();
};

export const journalTable = (page) =>
  page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'รหัสบัญชี' }) }).first();

// "ปรับรายการเอง" → acknowledge → "เปิดโหมดแก้ไข": local form state only (nothing is saved).
async function openOverrideJournal(page) {
  await page.getByText('ปรับรายการเอง', { exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').click();
  await dialog.getByRole('button', { name: 'เปิดโหมดแก้ไข' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await journalTable(page).waitFor();
  // The "รวม" totals row also lives in <tbody> (EditableJournalTable.tsx) — count only editable lines,
  // i.e. rows whose first cell holds the account-menu trigger.
  if ((await journalTable(page).locator('tbody tr td:first-child button').count()) === 0) {
    await page.getByRole('button', { name: 'เพิ่มบรรทัด' }).click();
  }
}

// S2-08 lives in PaymentSection, which the purchase wizard's summary renders only in "ของถึงแล้ว"
// (receive) mode (StepSummary.tsx:193), and its file / URL row only once the status is a paid one
// (PaymentSection.tsx:77,200). Local wizard state only: the draft is the wizard's own localStorage
// draft (useCreatePoWizard.ts:17,78-105) naming the mocked supplier and one accessory line (no IMEI to
// inspect — direct-receive.util.ts:26, receiving-flow.util.ts:55-75); nothing is submitted.
async function openPurchasePayment(page) {
  await page.evaluate((supplierId) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    localStorage.setItem('bestchoice-po-draft', JSON.stringify({
      step: 0,
      mode: 'receive',
      form: {
        supplierId, orderDate: today, expectedDate: '', notes: '', discount: '', discountAfterVat: '',
        paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
      },
      items: [{
        brand: '', category: 'ACCESSORY', model: 'ฟิล์มกระจก', color: '', storage: '', quantity: '1', unitPrice: '35',
        accessoryType: 'ฟิล์ม', accessoryBrand: 'iStar',
      }],
      savedAt: new Date().toISOString(),
    }));
  }, PO_SUPPLIER.id);
  await clickButton('+ ซื้อสินค้า')(page);
  await clickButton('ถัดไป: ตรวจรับ 1 ชิ้น')(page);
  await page.locator('#group-cash').fill('59');
  await clickButton('ถัดไป: สรุป + จ่ายเงิน')(page);
  await page.locator('#po-payment-status').selectOption('FULLY_PAID');
  // the S2-08 row into view for the screenshot, after the "draft recovered" toast (5 s) has gone
  await page.getByRole('button', { name: '+ เพิ่ม', exact: true }).scrollIntoViewIfNeeded();
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10000 });
}

const ACCOUNT_MENU_ITEMS_CARD = {
  id: 'account-menu-items-card',
  widths: [1440],
  // item #1 defaults to 42-1102 — the trigger shows its name (role-agnostic: R1-2 may add role=combobox)
  trigger: (page) => page.locator('button', { hasText: 'ดอกเบี้ยเงินฝาก' }).first(),
};
const ACCOUNT_MENU_OVERRIDE_JV = {
  id: 'account-menu-override-jv',
  widths: [1440],
  trigger: (page) => journalTable(page).locator('tbody tr').first().locator('td').first().locator('button').first(),
};

export const ADDRESS_FORM_HOSTS = [
  'company-entity-edit', 'customer-create-dialog', 'contract-customer-create', 'contract-customer-edit',
  'customer-edit-dialog', 'supplier-form', 'trade-in-quick-buy', 'branch-create', 'contact-create',
];

export const ROUTES = [
  { id: 'dunning-rule-dialog', path: '/settings/comms/dunning', appendix: ['S1-01'], open: clickButton('เพิ่ม กฎ'),
    mocks: [M.dunningRules, M.smsTemplates] },
  { id: 'sms-template-form', path: '/settings/comms/sms', appendix: ['§4.2 ข้อ 8'], open: clickButton('เพิ่มแม่แบบ'),
    mocks: [M.smsTemplates] },
  { id: 'other-income-items', path: '/other-income/new', appendix: ['S2-01', 'S2-07'], mocks: M.otherIncome,
    probes: [ACCOUNT_MENU_ITEMS_CARD] },
  { id: 'other-income-override', path: '/other-income/new', appendix: ['S2-02'], open: openOverrideJournal,
    mocks: M.otherIncome, probes: [ACCOUNT_MENU_OVERRIDE_JV] },
  { id: 'company-entity-edit', path: '/settings/company/entities', appendix: ['S1-02', 'S3-12'],
    open: clickButton('แก้ไข'), mocks: [] },
  { id: 'company-entity-create', path: '/settings/company/entities', appendix: ['S1-02'],
    open: clickButton('เพิ่มนิติบุคคล'), mocks: [] },
  { id: 'audit-logs', path: '/audit-logs', appendix: ['S1-04'], mocks: [M.auditStats] },
  { id: 'finance-knowledge-form', path: '/chatbot-finance/knowledge', appendix: ['S1-05'],
    open: clickButton('+ เพิ่ม คำถามที่พบบ่อย'), mocks: M.knowledge },
  { id: 'repossessions', path: '/repossessions', appendix: ['S2-03'], mocks: M.repossessions },
  { id: 'stock-transfers-outgoing', path: '/stock/transfers?view=outgoing', appendix: ['S2-04'], mocks: M.transfers },
  { id: 'stock-transfers-incoming', path: '/stock/transfers?view=incoming', appendix: ['S2-04'], mocks: M.transfers },
  { id: 'stock-transfers-history', path: '/stock/transfers?view=history', appendix: ['S2-04'], mocks: M.transfers },
  { id: 'expense-new', path: '/expenses/new', appendix: ['S3-02', 'S3-04', 'S3-05'], mocks: M.expense },
  // S3-07 is the account select of a line's "รายได้พิเศษ" sub-table, rendered only when the line is expanded
  // (PayrollLinesSection.tsx:475,535-540,639-652,808) — local form state, nothing is saved.
  { id: 'payroll-new', path: '/expenses/new?type=PR', appendix: ['S3-07'], mocks: M.expense,
    open: async (page) => {
      await clickButton('เพิ่มพนักงาน')(page);
      await clickButton('ขยาย')(page);
      await clickButton('เพิ่มรายได้พิเศษ')(page);
    } },
  { id: 'recurring-bill-dialog', path: '/expenses/favorites', appendix: ['S3-09'], open: clickButton('+ บิลประจำ'),
    mocks: M.expense },
  { id: 'trade-in-quick-buy', path: '/trade-in', appendix: ['S3-10', 'S3-12'], mocks: [M.buybackCatalog],
    open: async (page) => {
      await clickButton('รับซื้อเครื่อง')(page);
      await page.locator('#quick-buy-model:not([disabled])').waitFor();
    } },
  { id: 'interest-config-form', path: '/settings/finance/interest', appendix: ['S1-03'],
    open: clickButton('+ สร้าง การตั้งค่า'), mocks: [M.interestConfigs] },
  { id: 'branch-create', path: '/branches', appendix: ['S1-06', 'S3-12'], open: clickButton('+ เพิ่มสาขา'),
    mocks: [M.branches] },
  { id: 'todo-form', path: '/todos', appendix: ['S2-05'], open: clickButton('เพิ่มงาน'), mocks: [M.branchManagerActor] },
  { id: 'purchase-order-wizard', path: '/purchase-orders', appendix: ['S2-08'], open: openPurchasePayment,
    mocks: [M.purchaseOrders, M.poSuppliers] },
  { id: 'account-role-edit', path: '/settings/access/account-roles', appendix: ['S3-03'], mocks: [M.roleMap],
    open: async (page) => {
      await page.getByRole('button', { name: /^แก้ไข / }).first().click();
      await page.locator('#ar-coa-trigger').click();
    } },
  { id: 'customer-create-dialog', path: '/customers', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: /^\+ เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่$/ }).first().click();
    } },
  { id: 'customer-edit-dialog', path: (ctx) => (ctx.customerId ? `/customers/${ctx.customerId}` : null),
    appendix: ['S3-12'], open: clickButton('แก้ไขข้อมูล'), mocks: [] },
  // Step 1 (เลือกสินค้า) must have a product before "ถัดไป" reaches the customer step — local wizard state only
  // (useContractCreateData.ts writes only on the final submit).
  { id: 'contract-customer-create', path: '/contracts/create', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.locator('div.cursor-pointer').filter({ hasText: 'สาขา:' }).first().click();
      await clickButton('ถัดไป')(page);
      await clickButton('เพิ่มลูกค้าใหม่')(page);
    } },
  // The customer card's own "แก้ไข" opens CustomerEditModal (ContractDetailPage.tsx:1354-1368,1584); the first
  // "แก้ไข" on the page is the contract card's inline edit, which is not an AddressForm host.
  { id: 'contract-customer-edit', path: (ctx) => ctx.contractPath, appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.locator('div.rounded-xl')
        .filter({ has: page.getByRole('heading', { name: 'ข้อมูลลูกค้า', exact: true }) })
        .getByRole('button', { name: 'แก้ไข', exact: true }).click();
      await page.getByRole('dialog').waitFor();
    } },
  { id: 'supplier-form', path: '/suppliers', appendix: ['S3-12'], open: clickButton('เพิ่มผู้จัดจำหน่าย'),
    mocks: [M.suppliers] },
  // shadcn FormLabel callers whose labels R1-4 moves to style A (SaleDetailsForm renders without a product)
  { id: 'pos-sale-form', path: '/pos', appendix: ['R1-4 FormLabel'], mocks: [] },
  { id: 'contact-create', path: '/contacts', appendix: ['S3-12'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: 'เพิ่มผู้ติดต่อ' }).click();
      await page.getByRole('menuitem', { name: 'เพิ่มลูกค้า' }).click();
    } },
];
