// Field-scale check — what to measure (spec §5 "หน้าที่วัด"): every screen in appendix ก plus the 9 forms
// that embed AddressForm (spec §4.3), as { id, path, appendix, open?, mocks, probes?, blockWrites? }; Round 2
// adds R2_ROUTES (ids r2-<screen>) for every screen the Round 2 plan converts.
//   path      string, or (ctx) => string | null (null = the preview has no sample record → cell "skipped")
//   open      clicks that open the dialog / tab / mode to measure — never save, never pick a value that saves
//   mocks     GET endpoints the local preview answers 501/404 for, or answers from data that varies between
//             preview starts: { path: /^\/api-path$/, json(url, ctx), method? }. path is matched against the
//             request pathname WITHOUT /api or /api/admin; route mocks after COMMON_MOCKS, first match wins.
//             GET only — except quoteMock(): a POST that prices a quote and stores nothing (path ends in /preview).
//   blockWrites  true = every other non-GET /api request the page makes is aborted and listed in the cell
//             (screens that write just by being open — an inbox room marks itself read and asks for suggestions)
//   probes    menu clipping check (rule MENU): { id, widths, trigger(page) → Locator, menu? }. menu 'controls' =
//             the menu is the element the trigger's aria-controls names (Radix Popover / Select, the Round 2
//             Combobox); default = the Round 1 account menu, found by its search box MENU_SEARCH_LABEL.
// COMMON_MOCKS apply to every route. ctx = { origin, me (GET /auth/me), customerId, contractPath, shopRoomId }.
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
// A POST that only prices a quote: the one non-GET a mock may answer (check.test.mjs pins the /preview path).
export const quoteMock = (path, json) => ({ ...mock(path, json), method: 'POST' });

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

// menu 'controls' (Round 2 Task 1): the menu is found through the trigger's aria-controls, not the search box's
// aria-label, so R2-3a's AccountCombobox may name its search box through cmdk's <Command label> instead.
const ACCOUNT_MENU_ITEMS_CARD = {
  id: 'account-menu-items-card',
  widths: [1440],
  menu: 'controls',
  // item #1 defaults to 42-1102 — the trigger shows its name (role-agnostic: R1-2 may add role=combobox)
  trigger: (page) => page.locator('button', { hasText: 'ดอกเบี้ยเงินฝาก' }).first(),
};
const ACCOUNT_MENU_OVERRIDE_JV = {
  id: 'account-menu-override-jv',
  widths: [1440],
  menu: 'controls',
  trigger: (page) => journalTable(page).locator('tbody tr').first().locator('td').first().locator('button').first(),
};

// Round 2 (Task 1): a portalled Radix Select inside QuickBuyModal (a Radix Dialog); R2-4b keeps id="quick-buy-model"
// (the route's open step waits for it)
const QUICK_BUY_MODEL_MENU = {
  id: 'quick-buy-model-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.locator('#quick-buy-model'),
};

// The route of each of the 9 AddressForm hosts (spec §4.3) whose open step leaves the address fields on screen.
// Not 'company-entity-edit' (EditCompanyDialog's ที่อยู่ is a textarea — AddCompanyDialog is the host), not
// 'customer-create-dialog' (the address <details> stays closed) and not 'trade-in-quick-buy' (step 1 — the
// address is on step 3): the r2- routes below open those.
export const ADDRESS_FORM_HOSTS = [
  'company-entity-create', 'r2-customer-create-address', 'contract-customer-create', 'contract-customer-edit',
  'customer-edit-dialog', 'supplier-form', 'r2-trade-in-quick-buy-address', 'branch-create', 'contact-create',
];

const R1_ROUTES = [
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
    }, probes: [QUICK_BUY_MODEL_MENU] },
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

// ---- Round 2 (plan 2026-11-16, spec §7 R2-2 … R2-4d + owner 2026-11-16) --------------------------------------
// One route per screen Tasks 5–15 convert, opened until the converted field is on screen. Every list a picker
// shows comes from a mock below (or the CPA chart in COMMON_MOCKS), so two runs measure the same options.

const PREVIEW_STAFF = [
  { id: 'preview-staff-1', name: 'พนักงานตัวอย่าง หนึ่ง', role: 'SALES', branch: 'สาขาตัวอย่าง (คลังหลัก)' },
  { id: 'preview-staff-2', name: 'พนักงานตัวอย่างที่มีชื่อยาวมากเป็นพิเศษ สอง', role: 'BRANCH_MANAGER', branch: 'สาขาตัวอย่าง 2' },
];
const roomStaff = PREVIEW_STAFF.map((s) => ({
  id: s.id, name: s.name, nickname: null, role: s.role, detail: [s.branch, s.role, s.id.slice(-6)].join(' · '),
}));

const serviceRequest = (ctx) => ({
  id: 'preview-service-request-1', roomId: ctx.shopRoomId, symptom: 'จอกระพริบหลังใช้งานสองสัปดาห์', revision: 1,
  status: 'OPEN',
  todo: {
    id: 'preview-service-todo-1', status: 'TODO', assigneeId: PREVIEW_STAFF[0].id,
    assignee: { name: PREVIEW_STAFF[0].name }, dueDate: '2026-12-01T03:00:00.000Z',
  },
  sourceMessages: [], currentCustomerId: null, canOpenCase: false, canLinkCase: false, linkedCase: null,
});

const FB_THREAD_ID = 'preview-fb-thread-1';
const FB_RECORD = { authorName: 'ลูกค้า Facebook ตัวอย่าง', text: 'รุ่นนี้ผ่อนได้ไหมครับ', deletedAt: null };
const FB_THREAD = {
  id: FB_THREAD_ID, revision: 1, status: 'OPEN', rootDeleted: false, needsReconciliation: false, assigneeId: null,
  customerId: null, roomId: null, permalink: 'https://www.facebook.com/preview/posts/1',
  capabilities: { publicReply: true, privateReply: false, reason: null },
  records: [{ id: 'preview-fb-record-1', commentId: 'preview-comment-1', parentCommentId: null, ...FB_RECORD }],
  replies: [], recordsTotal: 1, repliesTotal: 0, unresolvedReply: null,
};

const BUYBACK_QUESTIONS = {
  bonusPct: '0',
  questions: [{
    id: 'preview-question-1', key: 'screen', title: 'สภาพหน้าจอ', helpText: null, selectType: 'SINGLE',
    choices: [{ id: 'preview-choice-1', label: 'ไม่มีรอย', deductType: 'PERCENT', deductValue: '0', isNoneChoice: true }],
  }],
};
const BUYBACK_QUOTE = {
  available: true, previewToken: 'preview-token', grade: 'A', model: 'iPhone 15', storage: '128GB', price: '14500',
  maxPrice: '14500', cashPrice: '14500', exchangePrice: '15000', bonusPct: '0',
};
// The questionnaire tab's reference catalog: 3 model/storage pairs, one profile.
const BUYBACK_REFERENCE = {
  questions: [],
  reference: {
    source: 'https://www.applehouseth.com/', capturedAt: '2026-11-01T00:00:00.000Z',
    assignments: [
      { model: 'iPhone 15', storage: '128GB', profileId: 'preview-profile-1' },
      { model: 'iPhone 15', storage: '256GB', profileId: 'preview-profile-1' },
      { model: 'iPhone 15 Pro Max', storage: '1TB', profileId: 'preview-profile-1' },
    ],
    profiles: { 'preview-profile-1': { questions: [], eligibilityText: 'เครื่องเปิดติด ไม่ติดล็อก iCloud' } },
  },
};

const CANNED_TEMPLATES = [
  { id: 'preview-canned-1', shortcut: '/ผ่อน', title: 'ตอบเรื่องผ่อนชำระ', content: 'ผ่อนได้สูงสุด 12 งวดค่ะ', category: 'ทักทาย',
    sortOrder: 0, isActive: true, createdAt: '2026-11-01T00:00:00.000Z' },
  { id: 'preview-canned-2', shortcut: '/โปร', title: 'โปรโมชันเดือนนี้', content: 'โปรประจำเดือน', category: 'ทักทาย',
    sortOrder: 1, isActive: true, createdAt: '2026-11-01T00:00:00.000Z' },
];
const QUICK_REPLIES = [
  { id: 'preview-quick-reply-1', cannedResponseId: 'preview-canned-1', label: 'ดูโปรผ่อน', type: 'POSTBACK',
    payload: 'TEMPLATE:preview-canned-2', url: null, message: null, sortOrder: 0, createdAt: '2026-11-01T00:00:00.000Z' },
];

// A purchase-wizard draft (useCreatePoWizard.ts:17) on step 0 with one case line: StepSupplier's supplier picker and
// AccessoryItemRow's "สำหรับรุ่น" (เคส) are both on screen. Local storage only — nothing is submitted.
async function openPurchaseItems(page) {
  await page.evaluate((supplierId) => {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    localStorage.setItem('bestchoice-po-draft', JSON.stringify({
      step: 0,
      mode: 'po',
      form: {
        supplierId, orderDate: today, expectedDate: '', notes: '', discount: '', discountAfterVat: '',
        paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '',
      },
      items: [{
        brand: '', category: 'ACCESSORY', model: '', color: '', storage: '', quantity: '1', unitPrice: '120',
        accessoryType: 'เคส', accessoryBrand: '',
      }],
      savedAt: new Date().toISOString(),
    }));
  }, PO_SUPPLIER.id);
  await clickButton('+ ซื้อสินค้า')(page);
  await page.getByRole('combobox', { name: 'สำหรับรุ่น' }).first().waitFor();
  // the "draft recovered" toast (5 s) can sit over the row at 390
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10000 });
}

const pickRadixOption = async (page, id, option) => {
  await page.locator(`#${id}`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

// QuickBuyModal step 1 → 2 → 3 (AddressForm "ที่อยู่ตามบัตร" + the seller picker). Every value is wizard state; the
// one POST is the price quote (quoteMock) — nothing is bought (step 4 "ยืนยัน" is never reached).
async function openQuickBuyAddress(page) {
  await clickButton('รับซื้อเครื่อง')(page);
  await page.locator('#quick-buy-model:not([disabled])').waitFor();
  await pickRadixOption(page, 'quick-buy-model', 'iPhone 15');
  await pickRadixOption(page, 'quick-buy-storage', '128GB');
  await page.locator('#quick-buy-imei').fill('356000000000005');
  await page.locator('#quick-buy-serial').fill('PREVIEWSERIAL01');
  await clickButton('ถัดไป')(page);
  await page.getByText('ไม่มีรอย', { exact: true }).click();
  await page.locator('button:not([disabled])', { hasText: 'ถัดไป' }).waitFor();
  await clickButton('ถัดไป')(page);
  await page.getByText('ที่อยู่ตามบัตร', { exact: true }).waitFor();
}

// The inbox room's customer panel is a column at ≥1280 and a sheet below (UnifiedInboxPage/index.tsx:518-519).
async function openRoomDossier(page) {
  if (page.viewportSize().width >= 1280) return;
  await page.getByRole('button', { name: /^(เปิด)?ข้อมูลลูกค้า$/ }).first().click();
  await page.getByRole('dialog').first().waitFor();
}

const R2 = {
  roomStaff: mock(/^\/staff-chat\/rooms\/[^/]+\/eligible-staff$/, roomStaff),
  onlineStaff: mock(/^\/staff-chat\/staff\/online$/, PREVIEW_STAFF.map((s) => ({
    id: s.id, name: s.name, email: `${s.id}@preview.invalid`, activeCount: 0,
  }))),
  users: mock(/^\/users$/, {
    data: PREVIEW_STAFF.map((s) => ({ id: s.id, name: s.name, role: s.role, isActive: true })),
    total: PREVIEW_STAFF.length, page: 1, limit: 50,
  }),
  serviceRequests: [
    mock(/^\/staff-chat\/rooms\/[^/]+\/service-requests$/, (url, ctx) => ({ data: [serviceRequest(ctx)], total: 1 })),
    mock(/^\/staff-chat\/service-requests\/preview-service-request-1$/, (url, ctx) => serviceRequest(ctx)),
    // the dialog's customer/case picker (ChatServiceRequestDialog.tsx:46-52) — empty, the same on every start
    mock(/^\/staff-chat\/rooms\/[^/]+\/service-intake-options$/, { data: [], total: 0 }),
  ],
  // one supplier whose address is the AddressForm JSON, so the edit dialog opens with every picker filled
  // (create mode leaves อำเภอ / ตำบล disabled)
  supplierEdit: mock(/^\/suppliers$/, {
    data: [{
      id: 'preview-supplier-edit-1', type: 'JURISTIC', name: 'ผู้จัดจำหน่ายตัวอย่าง', titleName: null,
      contactName: 'ผู้ติดต่อตัวอย่าง', contactPhone: '020000001', contactPosition: null, nickname: null,
      branchCode: '00000', phone: '020000000', phoneSecondary: null, lineId: null,
      address: JSON.stringify({
        houseNo: '12', moo: '', village: '', soi: '', road: 'ราชดำเนินใน', province: 'กรุงเทพมหานคร',
        district: 'เขตพระนคร', subdistrict: 'แขวงพระบรมมหาราชวัง', postalCode: '10200',
      }),
      taxId: '0105500000000', hasVat: true, paymentMethods: [], notes: null, isActive: true,
      createdAt: '2026-11-01T00:00:00.000Z', _count: { products: 0, purchaseOrders: 0 },
    }],
    total: 1, page: 1, totalPages: 1,
  }),
  sellConfig: mock(/^\/trade-ins\/sell-config$/, { exchangeBonusPct: 10 }),
  facebookComments: [
    mock(/^\/staff-chat\/facebook-comments$/, {
      data: [{ id: FB_THREAD_ID, rootDeleted: false, records: [FB_RECORD] }], total: 1,
    }),
    mock(/^\/staff-chat\/work-targets\/FACEBOOK_COMMENT\/preview-fb-thread-1$/, {
      targetType: 'FACEBOOK_COMMENT', targetId: FB_THREAD_ID, roomId: null, title: 'คอมเมนต์ใต้โพสต์ Facebook',
    }),
    mock(/^\/staff-chat\/facebook-comments\/preview-fb-thread-1$/, FB_THREAD),
    mock(/^\/staff-chat\/facebook-comments\/preview-fb-thread-1\/eligible-staff$/,
      PREVIEW_STAFF.map(({ id, name, role }) => ({ id, name, role }))),
  ],
  expensesList: [
    mock(/^\/expense-documents$/, { data: [], total: 0, page: 1, limit: 20 }),
    mock(/^\/expense-documents\/summary$/, {
      totalCount: 0, byStatus: {}, accrualUnpaidCount: 0, accrualUnpaidTotal: '0.00',
    }),
    mock(/^\/expenses\/periods\/reopened$/, []),
  ],
  // the "วิเคราะห์" tab (CollectionsPage/tabs/AnalyticsTab.tsx) and every card on it — empty except the one
  // stuck contract the reassign dialog needs
  collections: [
    mock(/^\/overdue\/analytics$/, {
      range: '30d', weeklyCollectionRate: [], promiseKeptTrend: [], dunningActionVolume: [], letterDispatchByType: [],
      mdmLockVolume: [],
    }),
    mock(/^\/overdue\/analytics\/(aging|leaderboard|recovery)$/, []),
    // WorkloadGrid on the same tab reads the whole queue (the default tab reads it too, before the switch)
    mock(/^\/overdue\/queue$/, { data: [], total: 0, page: 1, limit: 500, truncated: false }),
    mock(/^\/overdue\/analytics\/stuck$/, [{
      contractId: 'preview-stuck-1', contractNumber: 'CT-PREVIEW-0001', customerName: 'ลูกค้าตัวอย่าง',
      customerPhone: null, branchName: 'สาขาตัวอย่าง (คลังหลัก)', assignedToId: null, assignedToName: null,
      daysIdle: 21, outstanding: 4500,
    }]),
    mock(/^\/reporting\/compliance\/dunning-frequency$/, { threshold: 5, rows: [] }),
    mock(/^\/reporting\/compliance\/legal-pipeline$/, { windows: [], rows: [] }),
    mock(/^\/reporting\/compliance\/audit-summary$/, (url) => ({
      period: url.searchParams.get('period') === 'month' ? 'month' : 'week', since: '2026-11-09T00:00:00.000Z',
      actionsByUser: [], actionsByType: [], anomalyCount: 0,
    })),
    mock(/^\/reporting\/compliance\/voice-memo-retention$/, {
      hotDays: 30, deleteDays: 365, eligibleForGlacier: { count: 0, sample: [] }, eligibleForDelete: { count: 0, sample: [] },
    }),
  ],
  stockAlerts: [
    mock(/^\/reorder-points\/low-stock$/, { totalLowStock: 0, items: [] }),
    mock(/^\/reorder-points$/, []),
    mock(/^\/reorder-points\/alerts$/, { data: [], total: 0 }),
  ],
  purchaseOrdersSummary: mock(/^\/purchase-orders\/summary$/, {}),
  quickBuy: [
    mock(/^\/trade-ins\/quick-buy\/questions$/, BUYBACK_QUESTIONS),
    quoteMock(/^\/trade-ins\/quick-buy\/preview$/, BUYBACK_QUOTE),
    mock(/^\/trade-ins\/check-imei\/\d+$/, { result: 'ok', occurrences: [] }),
  ],
  buybackReference: mock(/^\/trade-ins\/buyback-questions$/, BUYBACK_REFERENCE),
  canned: [
    mock(/^\/staff-chat\/canned-responses$/, CANNED_TEMPLATES),
    mock(/^\/staff-chat\/canned-responses\/preview-canned-1\/quick-replies$/, QUICK_REPLIES),
    mock(/^\/staff-chat\/canned-responses\/[^/]+\/bubbles$/, []),
  ],
  // the staff option label ends with the id's last 6 characters (ChatAnalyticsPage.tsx:280-283) — preview ids change
  // on every preview start, so the list is fixed here
  chatAnalyticsOptions: mock(/^\/chat-analytics\/v2\/filter-options$/, {
    branches: [{ id: 'preview-branch-1', name: 'สาขาตัวอย่าง (คลังหลัก)' }, { id: 'preview-branch-2', name: 'สาขาตัวอย่าง 2' }],
    staff: PREVIEW_STAFF.map(({ id, name }) => ({ id, name })),
  }),
  salespersons: mock(/^\/sales\/salespersons$/, PREVIEW_STAFF.map(({ id, name }) => ({ id, name }))),
  yeastar: mock(/^\/yeastar\/extensions$/, [
    { number: '101', name: 'หน้าร้าน สาขาตัวอย่าง', status: 'Registered' },
    { number: '102', name: 'ฝ่ายการเงิน', status: 'Unavailable' },
  ]),
  assetCode: mock(/^\/assets\/generate-code$/, { assetCode: 'AST-PREVIEW-0001' }),
  afterSalesWalkIn: mock(/^\/after-sales\/lookup$/, {
    found: false, source: 'WALK_IN', lineLinked: false, product: null, customer: null, contract: null, sale: null,
    warranty: {
      status: 'WALK_IN', daysRemainingIn7Day: 0, purchasedAt: null, shopWarrantyEndDate: null,
      manufacturerWarrantyEndDate: null, checkedAt: '2026-11-16T00:00:00.000Z',
    },
    purchasePhotos: null, openCase: null,
    outcomes: [{ outcome: 'REPAIR', enabled: true, implemented: true, payerDefault: 'CUSTOMER' }],
  }),
  // total 1 keeps the page off its first-use empty state, so the header's "สร้างใบจอง" is the way in
  bookings: [
    mock(/^\/bookings\/summary$/, {
      total: 1, open: 0, pendingDeposit: 0, paid: 0, paidDepositHeld: '0.00', expiringWithin3Days: 0,
      closed: { converted: 1, canceled: 0, expired: 0, total: 1 }, forfeitedThisMonth: '0.00',
    }),
    mock(/^\/bookings$/, { data: [], total: 0, page: 1, limit: 20 }),
  ],
};

// Menu probes (rule MENU) on triggers that are portalled Radix menus today and stay one after their task
// (located by role + accessible name the converting task keeps; the menu is found through aria-controls).
const ACCOUNT_MENU_GL = {
  id: 'account-menu-gl', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.locator('#main button[role=combobox]').first(),
};
const ACCOUNT_MENU_PETTY_CASH = {
  id: 'account-menu-petty-cash', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'บัญชี', exact: true }).first(),
};
const BOOKING_CUSTOMER_MENU = {
  id: 'booking-customer-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'ลูกค้า', exact: true }),
};
const INBOX_OWNER_MENU = {
  id: 'inbox-owner-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('dialog', { name: 'ตัวกรองแชท' }).getByRole('combobox', { name: 'ผู้ดูแล', exact: true }),
};
// 130 px trigger, 256 px list (Task 11); below 1024 the filters are a sheet (the route's open step opens it)
const PROSPECT_OWNER_MENU = {
  id: 'prospect-owner-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'ผู้ดูแล', exact: true }),
};
const PROFILE_EXTENSION_MENU = {
  id: 'profile-extension-menu', widths: [1440, 390], menu: 'controls',
  trigger: (page) => page.getByRole('combobox', { name: 'Extension Yeastar (โทรศัพท์)', exact: true }),
};

// Probes on fields that are native <select>s today: a native select has no aria-controls, so on baseline-r2 the
// probe would fail ("menu not found") and a MENU failure blocks every compare. The task that converts the field
// attaches the probe to its route (`probes: [X]`) and deletes the entry here — the probe then PASSes.
export const PENDING_PROBES = {
  'r2-expenses-list': [{ // Task 13
    id: 'account-menu-expense-filter', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'ประเภทค่าใช้จ่าย' }),
  }],
  'expense-new': [{ // Task 13
    id: 'account-menu-expense-line', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }).first(),
  }],
  'recurring-bill-dialog': [{ // Task 13
    id: 'account-menu-recurring-bill', widths: [1440], menu: 'controls',
    trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'บัญชีค่าใช้จ่าย' }),
  }],
  'r2-stock-alert-create': [{ // Task 12 (menu inside a Radix Dialog)
    id: 'stock-alert-model-menu', widths: [1440, 390], menu: 'controls',
    trigger: (page) => page.getByRole('dialog').getByRole('combobox', { name: 'รุ่น', exact: true }),
  }],
  'r2-po-wizard-items': [{ // Task 12 (overflow-x-auto table; vaul Drawer below 1024)
    id: 'po-accessory-model-menu', widths: [1440, 390], menu: 'controls',
    trigger: (page) => page.getByRole('combobox', { name: 'สำหรับรุ่น' }).first(),
  }],
};

const room = (ctx) => (ctx.shopRoomId ? `/inbox/${ctx.shopRoomId}?zone=shop` : null);

export const R2_ROUTES = [
  // R2-2 AddressForm hosts the Round 1 routes left closed
  { id: 'r2-customer-create-address', path: '/customers', appendix: ['R2-2 AddressForm'], mocks: [],
    open: async (page) => {
      await page.getByRole('button', { name: /^\+ เพิ่ม(ลูกค้า|ผู้สนใจ)ใหม่$/ }).first().click();
      const dialog = page.getByRole('dialog', { name: 'เพิ่มลูกค้าใหม่' });
      await dialog.locator('summary').filter({ hasText: 'ที่อยู่' }).first().click();
      await dialog.locator('summary').filter({ hasText: 'ข้อมูลที่ทำงาน' }).first().click();
    } },
  { id: 'r2-trade-in-quick-buy-address', path: '/trade-in', appendix: ['R2-2 AddressForm', 'R2-3b ContactCombobox'],
    mocks: [M.buybackCatalog, ...R2.quickBuy], open: openQuickBuyAddress },
  // SupplierForm in edit mode (supplier-form is the create mode: อำเภอ / ตำบล disabled until a province is picked)
  { id: 'r2-supplier-edit', path: '/suppliers', appendix: ['R2-2 AddressForm'], mocks: [R2.supplierEdit],
    open: async (page) => {
      await page.getByRole('button', { name: /^แก้ไข / }).first().click();
      await page.getByRole('dialog', { name: 'แก้ไขผู้จัดจำหน่าย' }).waitFor();
    } },
  // R2-3a account pickers the Round 1 routes do not show
  { id: 'r2-general-ledger', path: '/finance/general-ledger', appendix: ['R2-3a GL'], mocks: [],
    probes: [ACCOUNT_MENU_GL] },
  { id: 'r2-account-role-dialog', path: '/settings/access/account-roles', appendix: ['R2-3a AccountRoles'],
    mocks: [M.roleMap], open: async (page) => {
      await page.getByRole('button', { name: /^แก้ไข / }).first().click();
      await page.getByRole('dialog').waitFor();
    } },
  // AdjustmentTable shows once the amount received differs from the lines (OtherIncomeEntryPage.tsx:1015);
  // its "เพิ่มผลต่างที่เหลือ …" button adds one adjustment row (with its account picker). Form state only.
  { id: 'r2-other-income-adjustment', path: '/other-income/new', appendix: ['R2-3a AdjustmentTable'],
    mocks: M.otherIncome, open: async (page) => {
      await page.getByLabel(/^จำนวนเงินที่ได้รับจริง/).fill('100');
      await page.getByRole('button', { name: /^เพิ่มผลต่างที่เหลือ/ }).click();
      await page.getByRole('textbox', { name: 'หมายเหตุผลต่างรายการ 1' }).waitFor();
    } },
  { id: 'r2-petty-cash-lines', path: '/expenses/new', appendix: ['R2-3a PettyCash', 'R2-3b VendorCombobox'],
    mocks: M.expense, open: async (page) => {
      await page.getByRole('button', { name: /^เงินสดย่อย/ }).click();
    }, probes: [ACCOUNT_MENU_PETTY_CASH] },
  // R2-4c expense account fields (+ the credit-note copy of ItemLinesSection)
  { id: 'r2-expenses-list', path: '/expenses', appendix: ['R2-4c ExpensesPage'], mocks: R2.expensesList },
  { id: 'r2-credit-note-lines', path: '/expenses/new?type=CN', appendix: ['R2-4c ItemLinesSection'], mocks: M.expense,
    open: async (page) => {
      await page.getByRole('button', { name: /^ไม่มีเอกสารต้นทาง/ }).click();
    } },
  // R2-3b ContactCombobox / EmployeeCombobox / CustomerCombobox hosts the Round 1 routes do not show
  // SettlementLinesSection lists the branch's open ACCRUAL bills (GET /expense-documents) — none here
  { id: 'r2-settlement-new', path: '/expenses/new?type=SE', appendix: ['R2-3b VendorCombobox'],
    mocks: [...M.expense, R2.expensesList[0]] },
  { id: 'r2-asset-new', path: '/assets/new', appendix: ['R2-3b ContactCombobox'], mocks: [R2.assetCode] },
  { id: 'r2-after-sales-walk-in', path: '/after-sales/new?imei=356000000000005', appendix: ['R2-3b ContactCombobox'],
    mocks: [R2.afterSalesWalkIn] },
  { id: 'r2-po-wizard-items', path: '/purchase-orders', appendix: ['R2-3b ContactCombobox', 'R2-4b AccessoryItemRow'],
    mocks: [M.purchaseOrders, M.poSuppliers, R2.purchaseOrdersSummary], open: openPurchaseItems },
  { id: 'r2-booking-create', path: '/bookings', appendix: ['R2-3b CustomerCombobox'], mocks: R2.bookings,
    open: clickButton('สร้างใบจอง'), probes: [BOOKING_CUSTOMER_MENU] },
  { id: 'r2-store-appointments', path: '/appointments', appendix: ['R2-3b CustomerCombobox'], mocks: [] },
  // R2-4a staff fields
  { id: 'r2-inbox-filter', path: '/inbox?zone=shop', appendix: ['R2-4a ChannelFilter'], mocks: [R2.onlineStaff],
    open: clickButton('ตัวกรองแชท'), probes: [INBOX_OWNER_MENU] },
  { id: 'r2-inbox-follow-up', path: room, appendix: ['R2-4a ChatFollowUpDialog'], mocks: [R2.roomStaff],
    blockWrites: true, open: async (page) => {
      await openRoomDossier(page);
      await clickButton('ตั้งนัดติดตาม')(page);
      await page.getByRole('dialog').getByText('ผู้รับผิดชอบงาน').waitFor();
    } },
  { id: 'r2-inbox-service-request', path: room, appendix: ['R2-4a ChatServiceRequestDialog'],
    mocks: [R2.roomStaff, ...R2.serviceRequests], blockWrites: true, open: async (page) => {
      await openRoomDossier(page);
      await clickButton('บริการหลังการขาย')(page);
      await clickButton('รับเรื่องหลังการขาย')(page);
      await page.getByRole('dialog').getByText('ผู้รับผิดชอบ').waitFor();
    } },
  { id: 'r2-inbox-service-request-edit', path: room, appendix: ['R2-4a ChatServiceRequestCard'],
    mocks: [R2.roomStaff, ...R2.serviceRequests], blockWrites: true, open: async (page) => {
      await openRoomDossier(page);
      await clickButton('บริการหลังการขาย')(page);
      await page.getByRole('button', { name: /จอกระพริบหลังใช้งานสองสัปดาห์/ }).click();
      await clickButton('แก้ไขการติดตาม')(page);
    } },
  { id: 'r2-inbox-facebook-comment', path: '/inbox?zone=shop', appendix: ['R2-4a FacebookCommentPanel'],
    mocks: R2.facebookComments, open: async (page) => {
      await clickButton('คอมเมนต์')(page);
      await page.getByRole('button', { name: /ลูกค้า Facebook ตัวอย่าง/ }).click();
      await page.getByText('ผู้รับผิดชอบคอมเมนต์', { exact: true }).waitFor();
    } },
  // TodoFilters is on the page; todo-form (above) covers TodoForm in its dialog
  { id: 'r2-todos-list', path: '/todos', appendix: ['R2-4a TodoFilters'], mocks: [M.branchManagerActor] },
  { id: 'r2-collections-stuck-reassign', path: '/collections', appendix: ['R2-4a StuckContractsSection'],
    mocks: [...R2.collections, R2.users], open: async (page) => {
      await page.getByRole('button', { name: /^วิเคราะห์/ }).click();
      await page.getByRole('checkbox', { name: 'เลือก CT-PREVIEW-0001' }).click();
      await page.getByRole('button', { name: /^มอบหมายใหม่/ }).click();
      await page.getByRole('dialog').waitFor();
    } },
  // ProspectFilterBar is a sheet below 1024 (ResponsiveFilterPanel)
  { id: 'r2-prospect-filters', path: '/customers?view=prospects', appendix: ['R2-4a ProspectFilterBar'],
    mocks: [R2.users], open: async (page) => {
      if (page.viewportSize().width < 1024) await page.getByRole('button', { name: 'เปิดตัวกรอง' }).click();
    }, probes: [PROSPECT_OWNER_MENU] },
  // R2-4b models + suppliers (QuickBuyModal's model field: trade-in-quick-buy above)
  // ยี่ห้อ Apple enables รุ่น (local form state only)
  { id: 'r2-product-create', path: '/products/create', appendix: ['R2-4b ProductInfoCard', 'R2-4b BranchSupplierCard'],
    mocks: [M.poSuppliers, M.branches], open: async (page) => {
      await page.getByLabel('ยี่ห้อ *', { exact: true }).selectOption('Apple');
    } },
  { id: 'r2-stock-alert-create', path: '/stock/alerts', appendix: ['R2-4b StockAlertsPage'],
    mocks: [...R2.stockAlerts, M.branches], open: async (page) => {
      await clickButton('+ จุดสั่งซื้อซ้ำ')(page);
      await page.getByRole('dialog').getByLabel('แบรนด์', { exact: true }).selectOption('Apple');
    } },
  { id: 'r2-trade-in-questions', path: '/trade-in', appendix: ['R2-4b ReferenceQuestionnaire'],
    mocks: [R2.buybackReference, R2.sellConfig], open: async (page) => {
      await page.getByRole('radio', { name: 'แบบตรวจสภาพ', exact: true }).click();
      await page.getByText('รุ่นและความจุ', { exact: true }).waitFor();
    } },
  { id: 'r2-purchase-orders-list', path: '/purchase-orders', appendix: ['R2-4b POListTab'],
    mocks: [M.purchaseOrders, M.poSuppliers, R2.purchaseOrdersSummary] },
  // R2-4d others
  { id: 'r2-chat-analytics', path: '/chat-analytics', appendix: ['R2-4d ChatAnalyticsPage'], mocks: [R2.chatAnalyticsOptions] },
  { id: 'r2-sales-history', path: '/sales', appendix: ['R2-4d SalesHistoryPage'], mocks: [R2.salespersons] },
  { id: 'r2-canned-quick-reply', path: '/canned-responses', appendix: ['R2-4d QuickReplyEditor'], mocks: R2.canned,
    open: async (page) => {
      await page.getByRole('button', { name: 'ขยาย', exact: true }).first().click();
      await page.getByText('ตอบเรื่องผ่อนชำระ', { exact: true }).click();
      await page.getByText('เมื่อกด:', { exact: true }).waitFor();
    } },
  { id: 'r2-profile-yeastar', path: '/profile', appendix: ['R2-4d UserProfilePage'], mocks: [R2.yeastar],
    probes: [PROFILE_EXTENSION_MENU] },
];

export const ROUTES = [...R1_ROUTES, ...R2_ROUTES];
