// Exercise the real local document controllers, PDF renderer and private local file storage.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { fingerprint } from '../../../tools/local-preview.mjs';
const origin = process.env.SALES_PREVIEW_URL ?? 'http://localhost:5207';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname));
const info = await (await fetch(`${origin}/api/admin/preview/info`)).json();
assert.equal(info.isolated, true);
assert.equal(info.storage, 'local-files');
assert.equal(info.repoRoot, process.cwd());
assert.equal(info.sourceFingerprint, fingerprint());
const contractId = new URL(info.documentUrl).pathname.split('/').pop();
const generated = await fetch(`${origin}/api/admin/contracts/${contractId}/generate-signed-documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(generated.status, 201);
const result = await generated.json();
assert.equal(result.errors, undefined);
const evidence = [];
await mkdir('.tmp/document-style', { recursive: true });
for (const doc of [result.contract, result.pdpa]) {
  assert.equal(doc.pdfGenerated, true);
  const response = await fetch(`${origin}/api/admin/documents/${doc.id}/download`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), doc.fileHash);
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.ok(pages > 0);
  await writeFile(`.tmp/document-style/preview-${doc.documentType}.pdf`, bytes);
  evidence.push({ type: doc.documentType, bytes: bytes.length, pages, hashMatches: true });
}
const output = 'docs/review/2026-09-11-document-spacing/preview';
await mkdir(output, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto(info.documentUrl);
    await expect(page.getByText('อัปโหลดเอกสารที่จำเป็น', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${output}/summary-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: /^เอกสาร/ }).click();
    await expect(page.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ดาวน์โหลด', exact: true }).first().click();
    const saved = await download;
    assert.match(saved.suggestedFilename(), /\.pdf$/);
    const stream = await saved.createReadStream(); const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).subarray(0, 5).toString(), '%PDF-');
    const fileName = `LOCAL-preview-${width}-${Date.now()}.png`;
    await page.getByLabel('แนบ รูปถ่ายสินค้า', { exact: true }).setInputFiles({ name: fileName, mimeType: 'image/png', buffer: png });
    const thumbnail = page.getByRole('img', { name: fileName, exact: true });
    await expect(thumbnail).toBeVisible();
    const attachments = await (await fetch(`${origin}/api/admin/contracts/${contractId}/documents`)).json();
    const attachment = attachments.data.find(row => row.fileName === fileName || row.originalName === fileName);
    assert.ok(attachment);
    const content = await fetch(`${origin}/api/admin/contracts/${contractId}/documents/${attachment.id}/content`);
    assert.equal(content.status, 200);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), png);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByText('อัปโหลดเอกสารสำเร็จ', { exact: true }).waitFor({ state: 'hidden' });
    await page.getByText('อัปโหลดเอกสาร', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/documents-${width}.png`, animations: 'disabled' });
    await thumbnail.locator('..').getByRole('button', { name: 'ดูเอกสาร', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('img', { name: fileName, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ปิดเอกสาร', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`${output}/check.json`, JSON.stringify({ passed: true, sourceFingerprint: info.sourceFingerprint, documentUrl: info.documentUrl, widths: [1440, 390], pdfs: evidence, storage: info.storage, notifications: 'not sent; synthetic customer has no recipient', checkedAt: new Date().toISOString() }, null, 2));
  console.log('PASS real local PDF/hash/page parsing, authenticated downloads and attachment bytes at 1440 and 390');
} finally { await browser.close(); }
