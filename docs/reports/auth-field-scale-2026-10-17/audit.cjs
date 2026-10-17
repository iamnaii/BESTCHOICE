const {chromium,webkit}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const rows=[];const routes=[['login','/login',2],['forgot','/forgot-password',1],['reset','/reset-password?token=auth-layout-synthetic',2],['invite','/register?token=auth-layout-synthetic',5]];
 for(const [engine,type] of Object.entries({chromium,webkit})){
  const browser=await type.launch();try{
   for(const [width,root] of [[320,16],[390,16],[1440,16],[320,20]])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme});
    await context.addInitScript(({theme,root})=>{localStorage.setItem('theme',theme);addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${root}px`;document.documentElement.classList.toggle('dark',theme==='dark');});},{theme,root});
    const page=await context.newPage();const errors=[];const mutations=[];const anonymousCleanup=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',async route=>{const req=route.request();const u=new URL(req.url());if(!u.pathname.startsWith('/api/'))return route.continue();const pathname=u.pathname.replace('/api/admin','').replace('/api','');
     if(pathname==='/auth/refresh'||pathname==='/auth/me')return route.fulfill({status:401,json:{success:false,message:'Synthetic unauthenticated session'}});
     if(pathname==='/auth/logout'&&req.method()==='POST'){anonymousCleanup.push('POST /auth/logout');return route.fulfill({json:{success:true,data:{}}});}
     if(req.method()!=='GET'){mutations.push(`${req.method()} ${pathname}`);return route.fulfill({status:400,json:{success:false,message:'Audit never submits auth writes'}});}
     if(pathname==='/invite/verify')return route.fulfill({json:{success:true,data:{valid:true,email:'longaddresswithoutbreaksfortestingmobilelayout@example.invalid',role:'BRANCH_MANAGER',branchName:'ทดสอบระบบ สาขาที่มีชื่อยาวสำหรับตรวจหน้าจอมือถือ'}}});
     return route.fulfill({json:{success:true,data:{}}});
    });
    for(const [name,url,count] of routes){
     await page.goto(`http://127.0.0.1:53171${url}`,{waitUntil:'networkidle'});
     await page.locator('form input').first().waitFor({state:'visible'});
     await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const fields=await page.locator('form input').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),label=el.labels?.[0],lr=label?.getBoundingClientRect();return{id:el.id,type:el.type,height:r.height,width:r.width,left:r.left,right:r.right,font:parseFloat(s.fontSize),fontFamily:s.fontFamily,label:label?.textContent.trim(),labelGap:lr?r.top-lr.bottom:null,disabled:el.disabled}}));
     assert.equal(fields.length,count,`${name} form not rendered`);
     for(const f of fields){assert.ok(f.height>=44*root/16-0.1,`${name}/${f.id} height ${f.height}`);assert.ok(f.font>=(width<1024?16:14)*root/16-0.1,`${name}/${f.id} font ${f.font}`);assert.ok(f.label&&f.labelGap>=8,`${name}/${f.id} label spacing ${f.labelGap}`);assert.ok(f.left>=0&&f.right<=width+1,`${name}/${f.id} horizontal bounds`);assert.ok(f.fontFamily.includes('Noto Sans Thai Looped'));}
     const doc=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,theme:document.documentElement.classList.contains('dark')?'dark':'light',root:parseFloat(getComputedStyle(document.documentElement).fontSize),fontLoaded:document.fonts.check('16px "Noto Sans Thai Looped"','ทดสอบระบบ')}));assert.ok(doc.width<=width+1,`${name} document overflow`);assert.ok(doc.fontLoaded);assert.equal(doc.theme,theme);assert.equal(doc.root,root);
     const submit=page.locator('form button[type="submit"]');await submit.scrollIntoViewIfNeeded();const box=await submit.boundingBox();assert.ok(box.height>=44*root/16-0.1);
     await submit.click();assert.equal(await page.locator('form input:invalid').count()>0,true,`${name} required validation`);
     for(const f of fields){const input=page.locator(`#${f.id}`);await input.fill(f.type==='email'?'layout-check@example.invalid':f.type==='password'?'Synthetic-Layout-42':f.id==='phone'?'0980000000':'ทดสอบระบบ');await input.focus();assert.equal(await input.evaluate(el=>el===document.activeElement),true);}
     await page.locator('form input').first().focus();await page.keyboard.press('Tab');if(count>1)assert.equal(await page.locator('form input').nth(1).evaluate(el=>el===document.activeElement),true);
     await page.evaluate(()=>scrollTo(0,0));const file=`${name}-${engine}-${width}-${root}-${theme}.png`;await page.screenshot({path:path.join(__dirname,file),fullPage:true});
     rows.push({name,engine,width,root,theme,fields,submitHeight:box.height,document:doc,screenshot:file,anonymousCleanup:[...anonymousCleanup]});console.log(`PASS ${name} ${engine} ${width}/${root} ${theme}`);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(mutations,[]);await context.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(path.join(__dirname,'results.json'),JSON.stringify({status:'PASS',pages:rows.length,scope:'Real public auth components; anonymous auth and valid invite metadata mocked; anonymous logout cleanup intercepted; no login, email, password reset or account registration requests sent.',rows},null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1});
