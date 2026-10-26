import{chromium,webkit,expect}from'@playwright/test';
import{writeFileSync}from'node:fs';
const origin='http://localhost:5206';
const get=async path=>{const r=await fetch(origin+'/api/admin'+path);if(!r.ok)throw new Error('GET failed '+path);const j=await r.json();return j.data??j;};
const info=await get('/preview/info');expect(info.isolated).toBe(true);expect(info.repoRoot).toBe(process.cwd());
const options=await get('/store-appointments/options');
const rows=await get('/store-appointments?customerId='+info.appointmentFixture.customers[0].id);
const fixture={...rows.at(-1),status:'BOOKED'};
const secondStaff={...options.staff[0],id:'fixture-reassign-ui-only',name:'พนักงานรับแทนชื่อยาวสำหรับตรวจข้อความและตำแหน่งลูกศร'};
const results=[];
for(const[engine,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch();try{
  for(const[width,rootSize]of[[1440,16],[320,20]]){
   const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});const mutations=[];
   page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/store-appointments'))mutations.push(r.url());});
   await page.route('**/store-appointments/options*',r=>r.fulfill({json:{...options,staff:[...options.staff,secondStaff]}}));
   await page.route(/\/store-appointments\?/,r=>r.fulfill({json:[fixture]}));
   await page.goto(origin+'/appointments?zone=shop&branchId='+fixture.branch.id);
   await page.getByRole('button',{name:'จัดพนักงานใหม่',exact:true}).click();
   const field=page.getByLabel('พนักงานรับแทน',{exact:true});await expect(field).toBeVisible();
   await page.addStyleTag({content:`html{font-size:${rootSize}px!important}`});
   await field.selectOption(secondStaff.id);await expect(field).toHaveValue(secondStaff.id);
   await expect(page.getByRole('button',{name:'ยืนยันเปลี่ยนพนักงาน',exact:true})).toBeEnabled();
   await field.focus();await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish();});
   const geometry=await field.evaluate(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e),a=e.parentElement.querySelector('svg').getBoundingClientRect();return{height:b.height,appearance:s.appearance,inset:b.right-a.right-parseFloat(s.borderRightWidth),center:a.y+a.height/2-b.y-b.height/2};});
   expect(geometry.appearance).toBe('none');expect(geometry.height).toBeCloseTo(rootSize*2.75,0);expect(geometry.inset).toBeCloseTo(rootSize*.75,0);expect(geometry.center).toBeCloseTo(0,0);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({path:`.tmp/appointment-select-fix/reassign-${engine}-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'กลับ',exact:true}).click();await expect(field).toHaveCount(0);expect(mutations).toEqual([]);
   results.push({engine,width,rootSize,geometry,chooseAndCancel:true,mutations:0});await page.close();
  }
 }finally{await browser.close();}
}
writeFileSync('.tmp/appointment-select-fix/reassign.json',JSON.stringify({status:'PASS',scope:'UI fixture with synthetic staff and booked row; no reassignment submitted',results},null,2));console.log('Reassignment field UI: PASS',results.length);
