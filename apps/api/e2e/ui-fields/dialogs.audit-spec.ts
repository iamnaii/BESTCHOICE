import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { startDocumentsApp } from '../documents/support/harness';
import { seedDocumentsWorld } from '../documents/support/fixtures';
import { startWeb } from '../documents/support/web';
import { seedSystemUi } from './system-fixtures';

// Unsaved forms: real reads, no posting or messaging. Transaction suites own saves.
describe('Whole-system secondary forms', () => {
  it('checks dialogs, tax/payroll variants and repeated fields', async () => {
    const h = await startDocumentsApp(); const web = await startWeb(h);
    const results: any[] = [];
    const output = join(process.env.DOCS_QA_OUTPUT!, 'dialogs'); mkdirSync(output, { recursive: true });
    try {
      const world = await seedDocumentsWorld(h.prisma); const data = await seedSystemUi(h, world);
      const cases: Array<{ name: string; path: string; buttons?: Array<string | RegExp>; menu?: string; dialog?: boolean }> = [
        { name: 'supplier-create', path: '/suppliers', buttons: ['เพิ่มผู้จัดจำหน่าย'], dialog: true },
        { name: 'supplier-edit', path: '/suppliers', buttons: [/^แก้ไข /], dialog: true },
        { name: 'contact-create', path: '/contacts', buttons: ['เพิ่มผู้ติดต่อ'], menu: 'เพิ่มลูกค้า', dialog: true },
        { name: 'contact-supplier', path: '/contacts', buttons: ['เพิ่มผู้ติดต่อ'], menu: 'เพิ่มผู้จัดจำหน่าย', dialog: true },
        { name: 'contract-customer-create', path: `/contracts/create?productId=${world.contracts.a.productId}`, buttons: ['ถัดไป', 'เพิ่มลูกค้าใหม่'], dialog: true },
        { name: 'supplier-payment-rows', path: '/suppliers', buttons: ['เพิ่มผู้จัดจำหน่าย', '+ เพิ่มวิธีชำระเงิน', '+ เพิ่มวิธีชำระเงิน'], dialog: true },
        { name: 'purchase-wizard', path: '/purchase-orders', buttons: ['+ ซื้อสินค้า'], dialog: true },
        { name: 'stock-adjustment', path: '/stock/adjustments', buttons: ['ขอตัดสินค้า'], dialog: true },
        { name: 'stock-count', path: '/stock/count', buttons: ['+ สร้างรายการตรวจนับ'], dialog: true },
        { name: 'promotion-create', path: '/promotions', buttons: ['สร้างโปรโมชัน'], dialog: true },
        { name: 'bank-account-create', path: '/finance/bank-accounts', buttons: ['เพิ่มบัญชี'], dialog: true },
        { name: 'company-create', path: '/settings/company/entities', buttons: ['เพิ่มนิติบุคคล'], dialog: true },
        { name: 'company-edit', path: '/settings/company/entities', buttons: ['แก้ไข'], dialog: true },
        { name: 'interest-create', path: '/settings/finance/interest', buttons: ['+ สร้าง Config'], dialog: true },
        { name: 'pricing-create', path: '/settings/products/pricing', buttons: ['+ เพิ่มราคาตั้งต้น'], dialog: true },
        { name: 'canned-create', path: '/canned-responses', buttons: ['สร้างชุดข้อความ'], dialog: true },
        { name: 'invite-user', path: '/users', buttons: ['เชิญผู้ใช้ใหม่'], dialog: true },
        { name: 'expense-payroll', path: '/expenses/new?type=PR' },
        { name: 'expense-credit-note', path: '/expenses/new?type=CN' },
        { name: 'expense-settlement', path: '/expenses/new?type=SE' },
        { name: 'expense-accrual', path: '/expenses/new', buttons: [/^ตั้งหนี้/] },
        { name: 'equity-capital', path: '/finance/equity/new' },
        { name: 'equity-increase', path: '/finance/equity/new', buttons: [/^เพิ่มทุน/] },
        { name: 'equity-withdrawal', path: '/finance/equity/new', buttons: [/^กรรมการถอนเงิน/] },
        { name: 'asset-create', path: '/assets/new' },
        { name: 'asset-dispose', path: `/assets/${data.activeAsset.id}/dispose` },
        { name: 'other-income-create', path: '/other-income/new' },
        { name: 'other-income-edit', path: `/other-income/${data.income.id}/edit` },
      ].filter(c => !process.env.FORM_CASES || process.env.FORM_CASES.split(',').includes(c.name));
      for (const width of [1440, 390, 320].filter(w => !process.env.FORM_WIDTHS || process.env.FORM_WIDTHS.split(',').includes(String(w)))) {
        const token = (await h.login(world.users.owner.email, world.password)).token;
        const { page, context, errors } = await web.page({ width, height: 960 });
        await page.addInitScript(t => { localStorage.setItem('access_token', t); localStorage.setItem('bc.sidebar.lastZone', 'shop'); }, token);
        page.setDefaultTimeout(7000);
        for (const c of cases) {
          const item: any = { name: c.name, width, path: c.path, themes: [] }; const start = errors.length;
          try {
            await page.goto(web.origin + c.path, { waitUntil: 'networkidle' });
            await page.locator('.app-shell').waitFor();
            for (const button of c.buttons ?? []) await page.getByRole('button', { name: button, exact: typeof button === 'string' }).first().click();
            if (c.menu) await page.getByRole('menuitem', { name: c.menu, exact: true }).click();
            if (c.dialog) await page.getByRole('dialog').last().waitFor();
            await page.waitForLoadState('networkidle');
            if (process.env.FORM_ROOT_FONT) await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, process.env.FORM_ROOT_FONT);
            for (const theme of ['light', 'dark']) {
              await page.evaluate(async value => {
                document.documentElement.classList.toggle('dark', value === 'dark'); await document.fonts.ready;
                for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
              }, theme);
              const metrics = await page.evaluate(() => {
                const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0' && !e.closest('[aria-hidden=true],[hidden]');
                const dialogs = [...document.querySelectorAll('[role=dialog]')].filter(visible);
                const scope = dialogs.at(-1) || document.querySelector('main') || document.body;
                const fields = [...scope.querySelectorAll<HTMLInputElement>('input,select,textarea,button[role=combobox]')].filter(e => visible(e) && !['checkbox','radio','hidden','file'].includes(e.type)).map(e => {
                  const r = e.getBoundingClientRect(), s = getComputedStyle(e);
                  const name = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || [...e.labels || []].map(l => l.textContent?.trim()).join(' ');
                  return { name, id: e.id, tag: e.tagName, placeholder: e.getAttribute('placeholder'), height: r.height, width: r.width, right: r.right, font: s.fontFamily, size: s.fontSize, disabled: e.disabled, className: e.className };
                });
                const ids = [...scope.querySelectorAll('[id]')].map(e => e.id);
                return { text: (scope as HTMLElement).innerText.slice(0, 600), fields, duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i), overflow: document.documentElement.scrollWidth > innerWidth + 1, horizontal: [...scope.querySelectorAll('*')].filter(e => visible(e) && e.getBoundingClientRect().right > innerWidth + 1).slice(0,12).map(e => ({ tag:e.tagName, text:e.textContent?.slice(0,70),className:e.className })) };
              });
              let accessibility;
              if (process.env.FORM_AXE === '1') {
                if (!await page.evaluate(() => Boolean((window as any).axe))) await page.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
                accessibility = await page.evaluate(async () => {
                  const dialogs = [...document.querySelectorAll('[role=dialog]')];
                  const scope = dialogs.at(-1) || document.querySelector('main') || document.body;
                  const result = await (window as any).axe.run(scope, { runOnly: { type: 'rule', values: ['label', 'select-name', 'button-name', 'aria-input-field-name', 'color-contrast'] } });
                  return { violations: result.violations.map((v:any) => ({ id:v.id, impact:v.impact, nodes:v.nodes.map((n:any) => ({target:n.target,html:n.html,summary:n.failureSummary})) })), incomplete: result.incomplete.map((v:any) => ({id:v.id,nodes:v.nodes.length,details:v.nodes.map((n:any) => ({target:n.target,html:n.html,any:n.any,all:n.all,none:n.none}))})) };
                });
                if (process.env.FORM_CONTRAST_REVIEW === '1') {
                  const selectors = accessibility.incomplete.flatMap((v:any) => v.details.map((n:any) => n.target)).flat().filter((s:any) => typeof s === 'string');
                  accessibility.reviewed = await page.evaluate(async (targets) => {
                    const saved = [...document.querySelectorAll('*')].filter(e => e.scrollTop || e.scrollLeft).map(e => ({ e, top: e.scrollTop, left: e.scrollLeft }));
                    const reviews = [];
                    for (const target of targets) {
                      const element = document.querySelector(target);
                      if (!element) { reviews.push({ target, status: 'MISSING' }); continue; }
                      element.scrollIntoView({ block: 'center', inline: 'nearest' });
                      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                      const run = await (window as any).axe.run(element, { runOnly: { type: 'rule', values: ['color-contrast'] } });
                      const backgrounds = []; let ancestor: Element | null = element;
                      while (ancestor) { const s = getComputedStyle(ancestor); backgrounds.push({ color: s.backgroundColor, opacity: s.opacity, image: s.backgroundImage, before: getComputedStyle(ancestor, '::before').content }); ancestor = ancestor.parentElement; }
                      reviews.push({ target, text: element.textContent?.slice(0, 100), color: getComputedStyle(element).color, backgrounds, violations: run.violations, incomplete: run.incomplete.map((v:any) => ({ id:v.id, nodes:v.nodes.map((n:any) => ({ html:n.html, any:n.any })) })), passed: run.passes.map((v:any) => v.id) });
                    }
                    for (const { e, top, left } of saved) { e.scrollTop = top; e.scrollLeft = left; }
                    return reviews;
                  }, selectors);
                }
              }
              item.themes.push({ theme, ...metrics, accessibility });
              await page.screenshot({ path: join(output, `${c.name}-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
            }
            if (c.dialog) {
              await page.keyboard.press('Tab');
              item.focusTrapped = await page.getByRole('dialog').last().evaluate(e => e.contains(document.activeElement));
              await page.keyboard.press('Escape');
              await page.getByRole('dialog').last().waitFor({state:'hidden',timeout:2000}).catch(() => {});
              item.escapeClosed = await page.getByRole('dialog').count() === 0;
            }
            item.pageErrors = errors.slice(start).filter(e => e.startsWith('pageerror:'));
          } catch (e) { item.error = String(e).slice(0,600); }
          results.push(item); writeFileSync(join(output,'results.json'), JSON.stringify(results,null,2));
          console.log('FORM', c.name, width, item.error || 'captured');
        }
        await context.close();
      }
      expect(results.filter(r => r.error || r.pageErrors?.length || r.focusTrapped === false || r.escapeClosed === false || r.themes.some((t:any) => t.overflow || t.duplicateIds.length || t.fields.some((f:any) => !f.name) || t.accessibility?.violations.length))).toEqual([]);
      expect(h.external.calls).toEqual([]);
    } finally { await web.close(); await h.close(); }
  }, 1_800_000);
});
