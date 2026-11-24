import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { checkEmployeeAccessApi } from './check-local-employee-access.mjs';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(repo, '.tmp/local-preview');

export async function checkEmployeeAccessUi(origin) {
  // This verifies both the disposable identity and checkout before any mutation.
  const api = await checkEmployeeAccessApi(origin);
  const browser = await chromium.launch({ headless: true });
  const result = { api, viewports: [] };
  mkdirSync(output, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const fixtureResponse = await page.request.post(`${origin}/api/preview/employee-access-fixture`);
      assert.equal(fixtureResponse.status(), 201);
      const fixture = await fixtureResponse.json();
      const code = `UI_ACCESS_${width}_${Date.now()}`;
      const name = `ทดสอบหน้าจอสิทธิ์ ${width} ${Date.now()}`;
      const dialog = () => page.getByRole('dialog');
      const tab = name => page.getByRole('tab', { name, exact: true });
      const review = () => page.getByRole('button', { name: 'ตรวจสอบผลกระทบ', exact: true }).click();
      const save = async (method, suffix) => {
        const response = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname.endsWith(suffix));
        await page.getByRole('button', { name: 'ยืนยันบันทึก', exact: true }).click();
        const saved = await response;
        assert.ok(saved.ok(), `${method} ${suffix}: ${await saved.text()}`);
        const submitted = saved.request().postDataJSON();
        if (method === 'PUT') {
          assert.match(submitted.expectedLegacyGrantsFingerprint, /^[a-f0-9]{64}$/,
            'Console must bind the save to the reviewed personal overrides');
          assert.ok(submitted.assignments.every(a => Number.isInteger(a.expectedPositionRevision)),
            'Console must bind each assignment to the reviewed position revision');
        }
        if (method === 'PATCH') {
          assert.ok(Number.isInteger(submitted.expectedAffectedEmployeeCount),
            'Console must bind position changes to the reviewed affected employee count');
        }
        const data = await saved.json();
        await expect(dialog()).toHaveCount(0);
        return data.data ?? data;
      };
      await page.goto(`${origin}/settings/access/employee-permissions?zone=settings`);
      await expect(page.getByRole('heading', { name: 'พนักงานและสิทธิ์', exact: true })).toBeVisible();
      await tab('ตำแหน่งและสิทธิ์').click();
      await expect(page.getByRole('button', { name: 'สร้างตำแหน่ง', exact: true })).toBeEnabled();
      const seed = page.getByRole('button', { name: 'เพิ่มตำแหน่งจากแม่แบบ', exact: true });
      if (width === 1440 && await seed.isEnabled()) {
        await seed.click();
        const initialized = await save('POST', '/employee-access/positions/seed-templates');
        assert.ok(Number.isInteger(initialized.createdCount));
        assert.equal(initialized.affectedEmployeeCount, 0, 'Seeding must not assign employees');
      }
      await page.getByRole('button', { name: 'สร้างตำแหน่ง', exact: true }).click();
      await page.getByRole('textbox', { name: 'รหัสตำแหน่ง', exact: true }).fill(code);
      await page.getByRole('textbox', { name: 'ชื่อตำแหน่ง', exact: true }).fill(name);
      const permissionSearch = () => page.getByRole('searchbox', { name: 'ค้นหาสิทธิ์' });
      await permissionSearch().fill('sales.read');
      await dialog().getByRole('checkbox', { name: /ดูการขาย/ }).check();
      await permissionSearch().fill('positions.manage');
      await expect(dialog().getByRole('checkbox', { name: /จัดการตำแหน่งและสิทธิ์/ })).toBeDisabled();
      await permissionSearch().fill('sales.create');
      await dialog().getByRole('checkbox', { name: /สร้างการขาย/ }).check();
      await review();
      await expect(page.getByRole('region', { name: 'สิทธิ์ที่เพิ่ม' }).getByText('ดูการขาย', { exact: true })).toBeVisible();
      const position = await save('POST', '/employee-access/positions');

      const cloneName = `${name} สำเนา`;
      await page.getByRole('button', { name: `คัดลอก ${name}`, exact: true }).click();
      await page.getByRole('textbox', { name: 'รหัสตำแหน่ง', exact: true }).fill(`${code}_COPY`);
      await page.getByRole('textbox', { name: 'ชื่อตำแหน่ง', exact: true }).fill(cloneName);
      await permissionSearch().fill('sales.read');
      await expect(dialog().getByRole('checkbox', { name: /ดูการขาย/ })).toBeChecked();
      await review();
      const clone = await save('POST', '/employee-access/positions');
      assert.notEqual(clone.id, position.id);
      await page.getByRole('button', { name: `ปิดใช้งาน ${cloneName}`, exact: true }).click();
      const disabled = await save('PATCH', `/employee-access/positions/${clone.id}`);
      assert.equal(disabled.isActive, false);

      await tab('พนักงาน').click();
      await page.getByRole('button', { name: new RegExp(fixture.employee.name) }).click();
      await expect(page.getByText(/ยังไม่ได้คำนวณสิทธิ์เดิมทั้งหมด/)).toBeVisible();
      await page.getByRole('button', { name: 'แก้ไขการมอบหมาย' }).click();
      await page.getByRole('button', { name: 'เพิ่มตำแหน่งที่มอบหมาย' }).click();
      await dialog().getByRole('combobox', { name: 'ตำแหน่ง', exact: true }).selectOption(position.id);
      await dialog().getByRole('combobox', { name: 'ส่วนงาน', exact: true }).selectOption('SHOP');
      await dialog().getByRole('combobox', { name: 'ขอบเขต', exact: true }).selectOption('BRANCHES');
      await dialog().getByRole('checkbox', { name: /สาขาทดสอบสิทธิ์ A/ }).check();
      await review();
      await expect(dialog().getByText(/ลบสิทธิ์รายบุคคลเดิม/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'ยืนยันบันทึก' })).toBeDisabled();
      await dialog().getByRole('checkbox', { name: /รับทราบ/ }).check();
      const changed = await save('PUT', `/employee-access/employees/${fixture.employee.id}/assignments`);
      assert.equal(changed.managed, true);
      assert.deepEqual(changed.grants[0].branchIds, [fixture.branchIds[0]]);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15000 });
      await page.screenshot({ path: join(output, `employee-access-employees-${width}.png`), fullPage: true });

      await tab('ตำแหน่งและสิทธิ์').click();
      await page.getByRole('button', { name: `แก้ไข ${name}`, exact: true }).click();
      await permissionSearch().fill('sales.create');
      await dialog().getByRole('checkbox', { name: /สร้างการขาย/ }).uncheck();
      await review();
      await expect(dialog().getByText(/พนักงานที่ได้รับมอบหมาย 1 คน/)).toBeVisible();
      await save('PATCH', `/employee-access/positions/${position.id}`);
      const snapshotResponse = await page.request.get(`${origin}/api/employee-access/employees/${fixture.employee.id}/effective-access`);
      assert.equal(snapshotResponse.status(), 200);
      const snapshot = await snapshotResponse.json();
      assert.equal(snapshot.grants.some(g => g.permissions.includes('sales.create')), false);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15000 });
      await page.screenshot({ path: join(output, `employee-access-positions-${width}.png`), fullPage: true });

      await tab('ประวัติการเปลี่ยนแปลง').click();
      await page.getByText('ดูรายละเอียด', { exact: true }).first().click();
      await expect(page.getByRole('region', { name: 'ก่อนเปลี่ยน' }).getByText('สร้างการขาย', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'หลังเปลี่ยน' }).getByText('ดูการขาย', { exact: true })).toBeVisible();
      await page.screenshot({ path: join(output, `employee-access-history-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows horizontally');
      assert.deepEqual(errors, [], 'Unexpected browser runtime errors');
      result.viewports.push({ width, positionId: position.id, employeeId: fixture.employee.id, status: 'PASS' });
      await context.close();
    }
    writeFileSync(join(output, 'employee-access-check.json'), JSON.stringify({ ...result, checkedAt: new Date().toISOString() }, null, 2));
    return result;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkEmployeeAccessUi(process.argv[2] || 'http://localhost:5216'), null, 2));
}
