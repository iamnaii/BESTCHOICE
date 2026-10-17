import { chromium, webkit, expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
const access=JSON.parse(readFileSync('.tmp/system-uxui-execution-20261017/full-preview/review-access.json'));
const results=[];
for(const [engine,type] of Object.entries({chromium,webkit}).filter(([e])=>!process.env.ENGINE||process.env.ENGINE===e)){
 const browser=await type.launch();
 try{
  for(const [width,rootSize,theme]of[[1440,16,'light'],[390,16,'light'],[320,20,'dark']].filter(c=>!process.env.WIDTH||+process.env.WIDTH===c[0])){
   const context=await browser.newContext({viewport:{width,height:1000},locale:'th-TH',reducedMotion:'reduce'});
   await context.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
   page.on('request',r=>{if(r.url().includes('store-appointments'))requests.push(r.url());});
   try{
    await page.goto(access.origin+'/login');await page.locator('#email').fill(access.email);await page.locator('#password').fill(access.password);
    await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();await page.waitForURL(u=>!u.pathname.startsWith('/login'));
    await page.evaluate(()=>{history.pushState({},'','/appointments?zone=shop');dispatchEvent(new PopStateEvent('popstate',{state:{}}));});
    const upper=page.getByLabel('สาขาที่ดู',{exact:true}),form=page.getByLabel('สาขา',{exact:true});await form.waitFor();await expect(page.locator('[data-sonner-toast]')).toHaveCount(0,{timeout:15000});
    await page.addStyleTag({content:`html{font-size:${rootSize}px!important}`});
    const branches=await upper.locator('option').evaluateAll(es=>es.map(e=>e.value));expect(branches).toHaveLength(2);
    await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
    await upper.click();await page.keyboard.press('Escape');await upper.focus();await expect(upper).toBeFocused();
    await page.keyboard.press('Tab');await expect(page.getByLabel('วันที่ดู',{exact:true})).toBeFocused();
    await upper.selectOption(branches[1]);await expect(upper).toHaveValue(branches[1]);await expect(form).toHaveValue(branches[1]);
    await expect.poll(()=>new URL(page.url()).searchParams.get('branchId')).toBe(branches[1]);
    await expect.poll(()=>requests.some(u=>u.includes('branchId='+branches[1]))).toBe(true);
    await form.click();await page.keyboard.press('Escape');await form.selectOption(branches[0]);await expect(upper).toHaveValue(branches[0]);
    const geometry=await page.locator('main select').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e),a=e.parentElement.querySelector('svg').getBoundingClientRect();return{label:e.getAttribute('aria-label'),height:b.height,appearance:s.appearance,inset:b.right-a.right-parseFloat(s.borderRightWidth),center:a.y+a.height/2-b.y-b.height/2,textGap:a.left-(b.right-parseFloat(s.borderRightWidth)-parseFloat(s.paddingRight))};}));
    for(const g of geometry){expect(g.appearance).toBe('none');expect(g.height).toBeCloseTo(rootSize*2.75,0);expect(g.inset).toBeCloseTo(rootSize*.75,0);expect(g.center).toBeCloseTo(0,0);expect(g.textGap).toBeGreaterThanOrEqual(rootSize*.5-1);}
    await form.focus();await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
    await page.screenshot({path:`.tmp/appointment-select-fix/actual-${engine}-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'ตารางพนักงาน',exact:true}).click();const staff=page.getByLabel('พนักงานรับนัด');await staff.waitFor();
    const employee=await staff.locator('option').evaluateAll(es=>es.filter(e=>e.value).map(e=>e.value));expect(employee.length).toBeGreaterThan(0);
    await staff.selectOption(employee[0]);await expect(staff).toHaveValue(employee[0]);
    await page.getByRole('button',{name:'ปฏิทิน',exact:true}).click();await expect(upper).toHaveValue(branches[0]);
    await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)){await page.screenshot({path:`.tmp/appointment-select-fix/overflow-${engine}-${width}.png`,fullPage:true});console.log('METRICS',await page.evaluate(()=>({innerWidth,visual:visualViewport.width,html:document.documentElement.scrollWidth,body:document.body.scrollWidth,wide:[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+2).slice(0,30).map(e=>({tag:e.tagName,cl:e.className,sw:e.scrollWidth,cw:e.clientWidth,overflow:getComputedStyle(e).overflow,text:e.textContent.slice(0,30)}))})));console.log('OVERFLOW',await page.locator('body *').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(e=>({tag:e.tagName,text:e.textContent.slice(0,80),cl:e.className,rect:e.getBoundingClientRect().toJSON()}))));}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
    results.push({engine,width,rootSize,theme,geometry,branchSwitchBothWays:true,keyboardFocusAndTab:true,staffSelection:true,calendarBranchRetained:true,errors});
    console.log('PASS',engine,width,rootSize);
   }finally{await context.close();}
  }
 }finally{await browser.close();}
}
writeFileSync('.tmp/appointment-select-fix/actual-api.json',JSON.stringify({status:'PASS',origin:access.origin,scope:'real API with disposable DB; selection only, no booking changes',results},null,2));
