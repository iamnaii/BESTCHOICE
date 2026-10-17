import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit, expect } from '@playwright/test';

const origin = process.env.APPOINTMENT_PREVIEW_URL || 'http://localhost:5198';
const infoResponse = await fetch(`${origin}/api/admin/preview/info`);
const infoJson = await infoResponse.json();
const info = infoJson.data ?? infoJson;
assert.equal(info.isolated, true, 'Only run against the isolated local preview');
assert.equal(info.repoRoot, process.cwd());
const engine = process.env.APPOINTMENT_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
const output = `.tmp/local-preview/appointment-fields-${engine}`;
mkdirSync(output, { recursive: true });
const day = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10);
const url = `${origin}/appointments?zone=shop&branchId=${info.appointmentFixture.branchId}&day=${day}`;
const browser = await (engine === 'webkit' ? webkit : chromium).launch();
const closeTo = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`);
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  for (const animation of document.getAnimations()) {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const checkArrows = async (page, rootSize) => {
  const selects = page.locator('main select');
  const arrows = [];
  for (const select of await selects.all()) {
    await select.scrollIntoViewIfNeeded();
    await select.evaluate(e => e.blur());
    await settle(page);
    const beforeFocus = await select.evaluate(e => { const s = getComputedStyle(e); return { shadow: s.boxShadow, outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, border: s.borderColor }; });
    await select.focus();
    await expect(select).toBeFocused();
    await settle(page);
    const data = await select.evaluate(e => {
      const s = getComputedStyle(e), b = e.getBoundingClientRect();
      const arrow = e.parentElement.querySelector('svg');
      const a = arrow?.getBoundingClientRect();
      const label = e.closest('label')?.querySelector('span')?.getBoundingClientRect();
      return { label: e.getAttribute('aria-label'), appearance: s.appearance, padding: parseFloat(s.paddingRight),
        arrowWidth: a?.width, inset: a ? b.right - a.right - parseFloat(s.borderRightWidth) : null,
        center: a ? a.y + a.height / 2 - b.y - b.height / 2 : null,
        textGap: a ? a.left - (b.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight)) : null,
        labelGap: label ? b.top - label.bottom : null,
        focusVisible: e.matches(':focus-visible'), outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`, shadow: s.boxShadow, border: s.borderColor,
        interactiveArrow: arrow ? getComputedStyle(arrow).pointerEvents : null };
    });
    assert.equal(data.appearance, 'none', `${data.label}: native arrow must be replaced`);
    closeTo(data.arrowWidth, rootSize, `${data.label}: arrow size`);
    closeTo(data.inset, rootSize * .75, `${data.label}: arrow inset inside border`);
    closeTo(data.center, 0, `${data.label}: arrow vertical centering`);
    assert.ok(data.textGap >= rootSize * .5 - 1, `${data.label}: text must not touch arrow`);
    assert.ok(data.labelGap >= rootSize * .5 - 1, `${data.label}: label/focus clearance`);
    assert.ok(data.focusVisible && (data.outline !== beforeFocus.outline || data.shadow !== beforeFocus.shadow), `${data.label}: visible keyboard focus`);
    assert.equal(data.interactiveArrow, 'none');
    arrows.push(data);
  }
  return arrows;
};
const results = [];
const errors = [];
try {
  for (const [width, height, rootSize] of [[320, 812, 16], [390, 844, 16], [768, 1024, 16], [1024, 768, 16], [1440, 1000, 16], [1280, 1000, 20], [320, 1000, 20]]) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      if (width === 320 && rootSize === 20) {
        await page.route('**/store-appointments/options*', async route => {
          const response = await route.fetch();
          const json = await response.json();
          const data = json.data ?? json;
          data.branches = data.branches.map(branch => ({ ...branch, name: `${branch.name} สาขาชื่อยาวสำหรับตรวจบนหน้าจอขนาดเล็ก` }));
          data.staff = data.staff.map(staff => ({ ...staff, name: `${staff.name} พนักงานชื่อยาวสำหรับทดสอบ` }));
          await route.fulfill({ response, json });
        });
      }
      try {
        await page.goto(url);
        await expect(page.getByRole('region', { name: 'ฟอร์มนัดหมาย' })).toBeVisible();
        if (rootSize !== 16) await page.addStyleTag({ content: `html { font-size: ${rootSize}px !important; }` });
        await settle(page);
        assert.equal(await page.locator('html').evaluate(e => e.classList.contains('dark')), theme === 'dark', 'Rendered theme');
        for (const tab of ['นัดหมาย', 'ตารางพนักงาน', 'ปฏิทิน']) {
          await page.getByRole('button', { name: tab, exact: true }).click();
          await expect(page.getByRole('button', { name: tab, exact: true })).toHaveAttribute('aria-pressed', 'true');
          await settle(page);
          const fields = await page.locator('main select, main input, main button[role="combobox"]').evaluateAll(elements => elements.map(e => {
            const box = e.getBoundingClientRect(), style = getComputedStyle(e);
            return { label: e.getAttribute('aria-label'), x: box.x, y: box.y, width: box.width, height: box.height, size: style.fontSize, font: style.fontFamily };
          }));
          assert.ok(fields.length >= 2);
          for (const field of fields) {
            closeTo(field.height, rootSize * 2.75, `${tab}/${width}: ${field.label} height`);
            assert.match(field.font, /Noto Sans Thai Looped/);
            assert.equal(field.size, `${rootSize * (width < 1024 ? 1 : .875)}px`, `${tab}/${width}: ${field.label} font size`);
            assert.ok(field.x >= 0 && field.x + field.width <= width + 1, `${field.label} fits viewport`);
          }
          if (width >= 640) {
            closeTo(fields[0].y, fields[1].y, 'Toolbar controls align');
            closeTo(fields[0].width, fields[1].width, 'Toolbar field widths match');
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${tab}/${width}: no horizontal overflow`);
          const expectedSelects = tab === 'นัดหมาย' ? ['สาขาที่ดู', 'สาขา'] : tab === 'ตารางพนักงาน' ? ['สาขาที่ดู', 'พนักงานรับนัด'] : ['สาขาที่ดู'];
          assert.deepEqual(await page.locator('main select').evaluateAll(es => es.map(e => e.getAttribute('aria-label'))), expectedSelects);
          const arrows = await checkArrows(page, rootSize);
          if ([320, 1440].includes(width)) await page.screenshot({ path: `${output}/${width}-${rootSize}-${theme}-${tab}.png`, fullPage: true });
          results.push({ width, rootSize, theme, tab, fields, arrows });
        }
      } finally { await context.close(); }
    }
  }
  // Model the production no-branch condition without changing production data.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let empty = true;
  await page.route('**/store-appointments/options*', async route => {
    if (!empty) return route.continue();
    await route.fulfill({ json: { branches: [], staff: [], canManage: true } });
  });
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'ยังไม่มีสาขาที่ใช้รับนัดได้' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ยืนยันนัดหมาย' })).toHaveCount(0);
  await expect(page.getByText('ยังไม่มีนัดหมาย', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${output}/no-branches.png`, fullPage: true });
  empty = false;
  await page.getByRole('button', { name: 'โหลดสาขาอีกครั้ง' }).click();
  await expect(page.getByRole('region', { name: 'ฟอร์มนัดหมาย' })).toBeVisible();
  // Selection still synchronizes across filters and clears a stale time after changing date.
  const slot = page.getByRole('region', { name: 'ฟอร์มนัดหมาย' }).getByRole('button', { name: '10:00', exact: true });
  await expect(slot).toBeEnabled();
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  const later = new Date(Date.now() + 2 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
  await page.getByLabel('วันที่ดู', { exact: true }).fill(later);
  await expect(page.getByLabel('วันที่นัด', { exact: true })).toHaveValue(later);
  await expect(page.getByRole('region', { name: 'ฟอร์มนัดหมาย' }).locator('[aria-pressed="true"]')).toHaveCount(0);
  await page.goto(`${origin}/appointments?zone=shop&customerId=${info.appointmentFixture.customers[0].id}`);
  const customer = page.getByRole('combobox', { name: 'ลูกค้า', exact: true });
  await expect(customer).toContainText(info.appointmentFixture.customers[0].name);
  await page.getByRole('button', { name: 'ล้างลูกค้า', exact: true }).click();
  await expect(customer).toContainText('ค้นหาชื่อหรือเบอร์โทรลูกค้า');
  await expect(page.getByRole('heading', { name: 'นัดประจำวัน' })).toBeVisible();
  await page.close();
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/check.json`, JSON.stringify({ status: 'PASS', engine, origin, repo: info.repoRoot, results, emptyStateRecovery: true, dateSelection: true, linkedCustomerClear: true, errors }, null, 2));
  console.log(`Appointment fields: PASS (${results.length} viewport/theme/tab states, empty-state recovery, date selection, linked customer clear)`);
} finally { await browser.close(); }
