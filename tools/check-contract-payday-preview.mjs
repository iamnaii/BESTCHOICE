import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

// Mount the real form component against the isolated Vite preview; no contract writes.
const origin = 'http://localhost:5187';
const response = await fetch(`${origin}/api/admin/preview/info`);
assert.equal(response.status, 200, 'Start tools/preview-chat-credit.sh first');
assert.equal((await response.json()).isolated, true);
// Reuse Vite's versioned URLs so the harness and form share one React instance.
const entrySource = await (await fetch(`${origin}/src/main.tsx`)).text();
const reactUrl = entrySource.match(/from "([^"\n]*\/react\.js\?[^"\n]+)"/)?.[1];
const reactDomUrl = entrySource.match(/from "([^"\n]*\/react-dom_client\.js\?[^"\n]+)"/)?.[1];
assert.ok(reactUrl);
assert.ok(reactDomUrl);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  const errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error(error.message);
  });
  page.on('requestfailed', request => console.error(request.url(), request.failure()?.errorText));
  await page.route(`${origin}/__payday-check`, route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><div id="root"></div>
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { default: React } = await import(${JSON.stringify(reactUrl)});
        const { default: ReactDOM } = await import(${JSON.stringify(reactDomUrl)});
        const { PlanDetailsStep } = await import('/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx');
        const { contractPlanSchema } = await import('/src/lib/schemas.ts');
        await import('/src/index.css');
        const noop = () => {};
        window.acceptsPayday = day => contractPlanSchema.safeParse({ downPayment: 3000, totalMonths: 6, paymentDueDay: day }).success;
        function Preview() {
          const [day, setDay] = React.useState(31);
          window.selectedPayday = day;
          return React.createElement(PlanDetailsStep, {
            selectedProduct: null, interestConfig: null,
            selectedCustomer: { id: 'synthetic', name: 'ลูกค้าทดสอบ', salaryPayDay: 31 },
            sellingPrice: 15000, downPayment: 3000, totalMonths: 6, notes: '',
            minDownPct: 0.2, minMonths: 3, maxMonths: 12, paymentDueDay: day,
            interestRate: 0, storeCommPct: 0, vatPct: 0, principal: 12000,
            storeCommission: 0, interestTotal: 0, vatAmount: 0,
            financedAmount: 12000, monthlyPayment: 2000, monthOptions: [6, 12],
            setDownPayment: noop, setDownPaymentTouched: noop, setTotalMonths: noop,
            setNotes: noop, setPaymentDueDay: setDay,
          });
        }
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Preview));
      </script></body></html>`,
  }));
  await page.goto(`${origin}/__payday-check`);
  const select = page.getByRole('combobox', { name: /วันที่ครบกำหนดชำระ/ });
  await expect(select).toHaveValue('31');
  for (const day of [25, 29, 30, 31]) {
    await select.selectOption(String(day));
    await expect(select).toHaveValue(String(day));
    await expect(select).toHaveAttribute('aria-invalid', 'false');
    assert.equal(await page.evaluate(() => window.selectedPayday), day);
    assert.equal(await page.evaluate(day => window.acceptsPayday(day), day), true);
  }
  for (const day of [0, 32, 25.5]) {
    assert.equal(await page.evaluate(day => window.acceptsPayday(day), day), false);
  }
  await page.screenshot({ path: 'docs/review/2026-09-07-contract-payday.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: real contract form selects 25/29/30/end-of-month and validates integer days 1–31 in Chromium');
} finally {
  await browser.close();
}
