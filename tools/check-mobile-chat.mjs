import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { previewStatus } from './local-preview.mjs';
import { chooseComposerMode } from './chat-ui.mjs';
const status = await previewStatus();
assert.ok(status.current && status.running, 'Refresh the same checkout first');
const origin = `http://localhost:${status.state.port}`;
const output = '.tmp/mobile-chat-final';
mkdirSync(output, { recursive: true });
const fixture = await fetch(`${origin}/api/admin/preview/fixture`, { method: 'POST' });
assert.equal(fixture.status, 201);
const { roomId: room } = await fixture.json();
const browser = await chromium.launch();
const results = [];
try {
  for (const [width, height] of [[320,568],[375,667],[390,844],[430,932],[375,440],[844,390],[768,1024],[1440,900]]) {
    for (const theme of ['light','dark']) {
      const context = await browser.newContext({viewport:{width,height}, hasTouch:width<1024, reducedMotion:'reduce'});
      await context.addInitScript(theme => localStorage.setItem('theme',theme), theme);
      await context.routeWebSocket('**/socket.io/**', ws => ws.close());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}/inbox/${room}?zone=shop`);
      const input = page.getByRole('textbox',{name:'พิมพ์ข้อความ',exact:true});
      await expect(input).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      const fit = async () => {
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth+1),'Horizontal overflow');
        const composer = await page.locator('.inbox-composer').boundingBox();
        assert.ok(composer.x >= 0 && composer.x+composer.width <= width+1 && composer.y+composer.height <= height+1,'Composer outside viewport');
      };
      await fit();
      const log = await page.getByRole('log').boundingBox();
      const composer = await page.locator('.inbox-composer').boundingBox();
      if (width<1024) {
        assert.ok(log.height >= height-230, `History too short: ${log.height}`);
        assert.ok(composer.height<=110,`Idle composer too tall: ${composer.height}`);
        await expect(page.locator('.inbox-workspace-header')).toBeHidden();
        await expect(input).toHaveCSS('font-size','16px');
        const small = await page.locator('.inbox-mobile-room-header button,.inbox-composer button:visible').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.width<43.9||r.height<43.9)}).map(e=>e.getAttribute('aria-label')||e.textContent));
        assert.deepEqual(small,[],'Small main touch targets');
      }
      await page.screenshot({path:`${output}/room-${width}-${height}-${theme}.png`});
      await input.fill('ฉบับร่างลูกค้า');
      await chooseComposerMode(page,'note');
      const note=page.getByRole('textbox',{name:'พิมพ์โน้ตภายใน',exact:true});
      await note.fill('ฉบับร่างเฉพาะทีม');
      await chooseComposerMode(page,'chat');
      await expect(input).toHaveValue('ฉบับร่างลูกค้า');
      if(width<1024){
        await page.getByRole('button',{name:'กลับ',exact:true}).click();
        await expect(page.locator('.inbox-workspace-header')).toBeVisible();
        await page.screenshot({path:`${output}/list-${width}-${height}-${theme}.png`});
        await page.goBack();
        await expect(input).toHaveValue('ฉบับร่างลูกค้า');
        await chooseComposerMode(page,'note');
        await expect(note).toHaveValue('ฉบับร่างเฉพาะทีม');
        await chooseComposerMode(page,'chat');
        await input.press('End'); await input.press('Enter');
        await expect(input).toHaveValue('ฉบับร่างลูกค้า\n');
        const uploads=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/upload'))uploads.push(r.url())});
        await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'draft.png',mimeType:'image/png',buffer:Buffer.from('preview')});
        await expect(page.getByRole('list',{name:'ไฟล์ที่รอส่ง'})).toContainText('draft.png');
        assert.equal(uploads.length,0,'Selecting file must not send');
        await chooseComposerMode(page,'note');await expect(page.getByRole('list',{name:'ไฟล์ที่รอส่ง'})).toBeHidden();
        await chooseComposerMode(page,'chat');
        await page.getByRole('button',{name:'นำไฟล์ draft.png ออก',exact:true}).click();
        await page.getByRole('button',{name:'เครื่องมือแชท',exact:true}).click();
        await fit();
        await page.screenshot({path:`${output}/tools-${width}-${height}-${theme}.png`});
        await page.getByRole('button',{name:'เครื่องมือแชท',exact:true}).click();
      }
      await page.getByRole('button',{name:'ข้อความสำเร็จรูป',exact:true}).click();
      const quick = page.getByRole('dialog',{name:'ตอบด่วน',exact:true});
      await expect(quick).toBeVisible();
      const box=await quick.boundingBox();
      assert.ok(box.x>=-1 && box.y>=-1 && box.x+box.width<=width+1 && box.y+box.height<=height+1,`Quick replies outside viewport ${JSON.stringify(box)}`);
      await quick.getByRole('textbox',{name:'ค้นหาข้อความสำเร็จรูป'}).fill('ขอบคุณ (ตัวอย่าง)');
      await quick.getByText('ขอบคุณ (ตัวอย่าง)',{exact:true}).click();
      await expect(quick.getByRole('button',{name:'ใส่ข้อความ',exact:true})).toBeEnabled();
      await page.screenshot({path:`${output}/quick-${width}-${height}-${theme}.png`});
      await quick.getByRole('button',{name:'ใส่ข้อความ',exact:true}).click();
      await expect(input).toHaveValue(/ขอบคุณที่สนใจ BESTCHOICE ครับ/);
      await fit();
      assert.deepEqual(errors,[]);
      results.push({width,height,theme,history:log.height,composer:composer.height,status:'PASS'});
      console.log('PASS',width,height,theme);
      await context.close();
    }
  }
} finally {
  writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));
  await browser.close();
}
