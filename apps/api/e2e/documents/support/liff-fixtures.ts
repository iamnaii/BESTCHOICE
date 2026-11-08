import type { Page, Route } from '@playwright/test';

/**
 * Customer LINE (LIFF) pages for the uxui route inventory — used ONLY by the opt-in typography audit
 * (`UXUI_TYPOGRAPHY=1`, apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts). CI never loads it.
 *
 * Without a LINE identity every `/liff/*` page renders its "ไม่สามารถเข้าสู่ระบบ LINE ได้" error card, so the
 * audit would measure an error card instead of the page. Two pieces give the pages a synthetic customer:
 *
 * 1. `seedLiffSession(page)` writes the session cache `useLiffInit` reads before it would start the LIFF SDK /
 *    LINE Login (apps/web/src/hooks/useLiffInit.ts — key `bcp_liff_session_v1`, `{ lineId, idToken, profile,
 *    cachedAt }`, all truthy, 50-minute TTL). The harness changes routes with `history.pushState`, so an
 *    `addInitScript` would never run again — call this with `page.evaluate` right before EVERY pushState to a
 *    `/liff*` path (a `?login_error=true` route such as `/pay/:token` clears the cache in between).
 * 2. `routeLiffApi(page)` answers every LIFF API call the pages make on load (`<API_URL>/line-oa/liff/*` and
 *    `<API_URL>/chatbot/finance/liff/*`; API_URL is `/api/admin` in the harness) with synthetic data in the
 *    production envelope. Register it AFTER the harness catch-all `page.route('**\/*')`: Playwright runs the
 *    most recently registered matching handler first. A request that reached the real API would carry the fake
 *    id_token into `LiffTokenGuard`, which verifies it with api.line.me — so unknown paths and methods are
 *    answered here with 404 instead of falling through.
 *
 * Every value is synthetic (the repository is public): no real customer, phone, IMEI or LINE account.
 */

/** = `SESSION_CACHE_KEY` in apps/web/src/hooks/useLiffInit.ts */
export const LIFF_SESSION_KEY = 'bcp_liff_session_v1';

const LINE_ID = `U${'0'.repeat(32)}`;
const ID_TOKEN = 'uxui-synthetic-liff-id-token';
const CUSTOMER_NAME = 'ลูกค้า ทดสอบระบบ';

/** Seeds the LIFF session cache in the current tab (same origin as every `/liff*` route). */
export async function seedLiffSession(page: Page): Promise<void> {
  await page.evaluate(({ key, session }) => {
    sessionStorage.setItem(key, JSON.stringify({ ...session, cachedAt: Date.now() }));
  }, {
    key: LIFF_SESSION_KEY,
    // No pictureUrl: an avatar URL would make the browser fetch an image from a real host.
    session: { lineId: LINE_ID, idToken: ID_TOKEN, profile: { userId: LINE_ID, displayName: CUSTOMER_NAME } },
  });
}

const LIFF_API_URL = /\/api(?:\/admin)?\/(?:line-oa\/liff|chatbot\/finance\/liff)\//;

/** Answers the LIFF API with synthetic data (see file header for the registration order). */
export async function routeLiffApi(page: Page): Promise<void> {
  const responses = liffResponses(Date.now());
  await page.route(LIFF_API_URL, async (route: Route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api(?:\/admin)?\//, '');
    const data = responses[`${request.method()} ${endpoint}`];
    if (data === undefined) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, statusCode: 404, message: `uxui LIFF fixture has no synthetic response for ${request.method()} ${endpoint}` }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  });
}

/**
 * Response bodies (unwrapped `data`) per `METHOD path`. Shapes follow the page code and
 * packages/shared/src/liff-types.ts. Dates are relative to `now` so the contract always reads as "next
 * installment due in 5 days" rather than drifting into overdue as the calendar moves.
 */
function liffResponses(now: number): Record<string, unknown> {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (days: number) => new Date(now + days * DAY).toISOString();
  const contractId = '00000000-0000-4000-8000-00000000c001';
  const contractNumber = 'UXUI-LIFF-0001';
  const product = 'iPhone 15 128GB สีดำ (ทดสอบระบบ)';
  const monthly = 1515.83;
  const totalMonths = 12;
  const paidMonths = 4;
  const methods = ['PROMPTPAY', 'BANK_TRANSFER', 'CASH', 'PROMPTPAY'];
  const payments = Array.from({ length: totalMonths }, (_, index) => {
    const installmentNo = index + 1;
    const paid = installmentNo <= paidMonths;
    return {
      installmentNo,
      dueDate: at((installmentNo - paidMonths - 1) * 30 + 5),
      amountDue: monthly,
      amountPaid: paid ? monthly : 0,
      lateFee: 0,
      status: paid ? 'PAID' : 'PENDING',
      paidDate: paid ? at((installmentNo - paidMonths - 1) * 30 + 2) : null,
      paymentMethod: paid ? methods[index] : null,
    };
  });
  const totalOutstanding = Math.round(monthly * (totalMonths - paidMonths) * 100) / 100;
  const contracts = {
    customer: { name: CUSTOMER_NAME },
    contracts: [{
      id: contractId,
      contractNumber,
      status: 'ACTIVE',
      product,
      sellingPrice: 22900,
      downPayment: 5900,
      monthlyPayment: monthly,
      totalMonths,
      paidInstallments: paidMonths,
      totalOutstanding,
      createdAt: at(-125),
      payments,
    }],
  };
  return {
    'GET line-oa/liff/consent': { consent: true, consentAt: at(-125) },
    'GET line-oa/liff/contracts': contracts,
    'GET line-oa/liff/history': {
      customer: { name: CUSTOMER_NAME },
      payments: payments.filter((p) => p.status === 'PAID').reverse().map((p) => ({
        contractNumber,
        installmentNo: p.installmentNo,
        amountPaid: p.amountPaid,
        paidDate: p.paidDate,
        paymentMethod: p.paymentMethod,
        lateFee: 0,
        receiptId: `00000000-0000-4000-8000-0000000e000${p.installmentNo}`,
      })),
    },
    'GET line-oa/liff/profile': {
      name: CUSTOMER_NAME,
      phone: '080-000-0000',
      lineDisplayName: CUSTOMER_NAME,
      contractCount: 1,
      totalPoints: 120,
    },
    'GET line-oa/liff/early-payoff-quote': {
      remainingMonths: totalMonths - paidMonths,
      dueMonths: 0,
      discountPct: 50,
      remainingPrincipal: 9333.28,
      remainingInterest: 2793.36,
      discount: 1396.68,
      partiallyPaidCredit: 0,
      unpaidLateFees: 0,
      totalPayoff: 10729.96,
      contractNumber,
      customerName: CUSTOMER_NAME,
    },
    'GET line-oa/liff/branches': {
      branches: [
        { id: '00000000-0000-4000-8000-0000000b0001', name: 'สาขาทดสอบระบบ A', location: 'ที่อยู่ทดสอบระบบ — ลบได้', phone: '02-000-0000', isPrimary: true },
        { id: '00000000-0000-4000-8000-0000000b0002', name: 'สาขาทดสอบระบบ B', location: null, phone: '02-000-0001', isPrimary: false },
      ],
    },
    'GET line-oa/liff/receipts': [
      ...payments.filter((p) => p.status === 'PAID').reverse().map((p) => ({
        id: `00000000-0000-4000-8000-0000000e000${p.installmentNo}`,
        receiptNumber: `RT-UXUI-0000${p.installmentNo}`,
        receiptType: 'INSTALLMENT',
        amount: p.amountPaid,
        paidDate: p.paidDate,
        paymentMethod: p.paymentMethod,
        installmentNo: p.installmentNo,
        contractNumber,
        hasFile: true,
      })),
      { id: '00000000-0000-4000-8000-0000000e0000', receiptNumber: 'RT-UXUI-00000', receiptType: 'DOWN_PAYMENT', amount: 5900, paidDate: at(-125), paymentMethod: 'CASH', installmentNo: null, contractNumber, hasFile: false },
    ],
    'GET line-oa/liff/my-warranties': {
      linked: true,
      customerName: CUSTOMER_NAME,
      devices: [{
        title: product,
        imeiSerial: '000000000000000',
        purchasedAt: at(-125),
        shopWarrantyEndDate: at(60),
        shopWarrantyDaysLeft: 60,
        manufacturerWarrantyEndDate: at(240),
        manufacturerWarrantyDaysLeft: 240,
        status: 'IN_SHOP_WARRANTY',
      }],
    },
    'GET line-oa/liff/my-after-sales-cases': {
      linked: true,
      cases: [{
        caseNumber: 'AS-UXUI-0001',
        outcome: 'REPAIR',
        stageLabel: 'กำลังซ่อม',
        deviceName: product,
        branchName: 'สาขาทดสอบระบบ A',
        steps: [
          { title: 'รับเครื่องเข้าระบบ', state: 'done', hint: null },
          { title: 'ส่งศูนย์ซ่อม', state: 'now', hint: 'ร้านจะแจ้งทาง LINE เมื่อซ่อมเสร็จ' },
          { title: 'รับเครื่องคืน', state: 'idle', hint: null },
        ],
        updatedAt: at(-1),
        costLine: 'ไม่มีค่าใช้จ่าย (อยู่ในประกันร้าน)',
      }],
    },
    'GET line-oa/liff/notification-preferences': { paymentReminder: true, overdueNotice: true, receiptNotification: false },
    // linked:false → the phone + consent form (the page's main state) instead of the short "already linked" card.
    'GET chatbot/finance/liff/status': { linked: false },
  };
}
