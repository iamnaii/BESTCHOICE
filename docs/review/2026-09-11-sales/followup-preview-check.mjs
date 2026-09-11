// Read real local query/export routes; no API response interception or real provider calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { fingerprint } from '../../../tools/local-preview.mjs';
const origin = process.env.SALES_PREVIEW_URL ?? 'http://localhost:5207';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
const info = await (await fetch(`${origin}/api/admin/preview/info`)).json();
assert.equal(info.isolated, true); assert.equal(info.repoRoot, process.cwd()); assert.equal(info.sourceFingerprint, fingerprint());
const saleId = new URL(info.saleUrl).searchParams.get('saleId');
const detail = await (await fetch(`${origin}/api/admin/sales/${saleId}`)).json();
assert.deepEqual([detail.receiptBreakdown.depositAmount, detail.receiptBreakdown.additionalAmount, detail.receiptBreakdown.totalReceived], ['1000.00', '9000.00', '10000.00']);
assert.equal(Number(detail.costPriceSnapshot), 6000);
for (const entity of ['customers', 'contracts', 'sales']) {
  const response = await fetch(`${origin}/api/admin/${entity}/export`);
  assert.equal(response.status, 200);
  const report = await response.json(); assert.equal(report.data.length, report.total); assert.ok(Date.parse(report.asOf));
}
const output = 'docs/review/2026-09-11-sales/followup-preview';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto(info.saleUrl);
    const receipt = page.getByRole('region', { name: 'การรับเงินจากใบจอง' });
    await expect(receipt.getByText('9,000.00 บาท', { exact: true })).toBeVisible();
    await expect(receipt.getByText(/โอนเงิน/)).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/receipt-${width}.png`, animations: 'disabled' });
    await receipt.getByRole('link').click();
    await expect(page).toHaveURL(/bookings\?bookingId=/);
    await expect(page.getByRole('dialog').getByText(detail.receiptBreakdown.bookingNumber, { exact: true }).first()).toBeVisible();
    await page.goto(`${origin}/sales`);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
    const file = await download; const stream = await file.createReadStream(); const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.concat(chunks));
    const sheet = workbook.worksheets[0];
    const headers = sheet.getRow(1).values;
    const row = sheet.getRows(2, sheet.rowCount - 1).find(row => row.getCell(headers.indexOf('เลขที่ขาย')).value === detail.saleNumber);
    assert.ok(row); assert.equal(row.getCell(headers.indexOf('มัดจำที่รับไว้แล้ว')).value, 1000);
    assert.equal(row.getCell(headers.indexOf('รับเพิ่มเมื่อขาย')).value, 9000);
    assert.equal(row.getCell(headers.indexOf('ต้นทุนเครื่อง ณ วันขาย')).value, 6000);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${output}/check.json`, JSON.stringify({ passed: true, sourceFingerprint: info.sourceFingerprint, saleUrl: info.saleUrl, bookingUrl: info.bookingUrl, widths: [1440, 390], exports: ['customers', 'contracts', 'sales'], checkedAt: new Date().toISOString() }, null, 2));
  console.log('PASS real local reads/export/receipt deep links at 1440 and 390');
} finally { await browser.close(); }
