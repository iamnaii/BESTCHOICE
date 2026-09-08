/** Synthetic-only integrated browser check. Start preview-chat-credit.sh first. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.CREDIT_PREVIEW_ORIGIN || 'http://localhost:5187';
const output = process.env.STAFF_OFFER_EVIDENCE || '/tmp/bestchoice-ai-native/offer';
const info = await (await fetch(`${origin}/api/admin/preview/info`)).json();
assert.equal(info.isolated, true);
assert.equal(info.ocr, 'mock');
assert.equal(info.storage, 'local-files');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { scope: 'Synthetic OCR/intent; real local HTTP, PostgreSQL stock, calculator, credit UI and contract draft', runs: [] };
try {
  for (const [name, viewport] of [['desktop', { width: 1500, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const fixture = await (await fetch(`${origin}/api/admin/preview/fixture`, { method: 'POST' })).json();
    const linked = await fetch(`${origin}/api/admin/staff-chat/rooms/${fixture.roomId}/customer`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: fixture.customerId }),
    });
    assert.equal(linked.status, 200);
    const context = await browser.newContext({ viewport });
    // Keep Vite HMR connected; only business sockets are disabled in this preview.
    await context.routeWebSocket('**/socket.io/**', (socket) => socket.close());
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (req) => { if (req.method() === 'POST') writes.push(new URL(req.url()).pathname); });
    await page.goto(`${origin}/inbox/${fixture.roomId}`);
    await page.getByRole('button', { name: 'เตรียมข้อเสนอ', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    assert.ok(!writes.some((path) => path.endsWith('/prepare-offer')));
    await page.getByRole('button', { name: 'สรุปและค้นข้อเสนอ', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('ร่างข้อเสนอ · ยังไม่ได้ส่งหรือบันทึกการขาย')).toBeVisible();
    const article = dialog.locator('article').first();
    const contractPath = await article.getByRole('link', { name: 'ตรวจเครดิตและทำสัญญา' }).getAttribute('href');
    const params = new URL(contractPath, origin).searchParams;
    assert.equal(params.get('customerId'), fixture.customerId);
    assert.equal(params.get('fromRoom'), fixture.roomId);
    await page.screenshot({ path: `${output}/${name}-offer.png`, fullPage: true });
    await article.getByRole('button', { name: 'แทรกร่างในช่องพิมพ์' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('textarea').first()).toHaveValue(/ราคาเงินสด.*10,000/);
    assert.ok(!writes.some((path) => /\/(messages|send|contracts)$/.test(path)), 'Draft must not send messages or create contracts');

    // Use the actual returned target, with a deliberately non-rounded down payment.
    const next = new URL(contractPath, origin);
    next.searchParams.set('downAmount', '3000.25');
    next.searchParams.set('months', '10');
    await page.goto(next.href);
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(page.getByText(fixture.customerName, { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'ไปตรวจเครดิต', exact: true }).click();
    await expect(page.getByRole('tab', { name: /เครดิต/ })).toHaveAttribute('data-state', 'active');
    const returnLink = page.getByRole('link', { name: 'กลับไปทำสัญญาต่อ' });
    await expect(returnLink).toBeVisible();
    const returning = new URL(await returnLink.getAttribute('href'), origin);
    assert.equal(returning.searchParams.get('resume'), '1');
    await page.screenshot({ path: `${output}/${name}-credit-return.png`, fullPage: true });
    await returnLink.click();
    // The unapproved customer stays at the credit gate; the saved plan is intact.
    await expect(page.getByText(fixture.customerName, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('bestchoice-contract-draft:')))));
    assert.equal(saved.downPayment, 3000.25);
    assert.equal(saved.totalMonths, 10);
    assert.equal(saved.customerId, fixture.customerId);
    assert.equal(saved.productId, params.get('productId'));
    assert.equal(saved.fromRoom, fixture.roomId);
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
    assert.ok(dimensions.width <= dimensions.viewport + 1, `${name}: horizontal overflow`);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${name}-resumed-plan.png`, fullPage: true });
    report.runs.push({ name, viewport, dimensions, status: 'PASS', checks: ['Explicit preparation', 'Real stock and calculator draft', 'No automatic send/sale', 'Customer/product/room handoff', 'Credit return preserves down/months', 'Unapproved customer stays at credit gate'] });
    await context.close();
  }
  console.log('PASS: desktop/mobile offer → composer draft → credit → resumed contract; no automatic send or sale');
} finally {
  await browser.close();
  await writeFile(`${output}/browser-report.json`, `${JSON.stringify(report, null, 2)}\n`);
}
