/* Read-only form regression checks against the disposable full API harness.
 * Run through tools/docs-integration.sh; never against an application database. */
import {writeFileSync,mkdirSync} from 'fs';
import {join} from 'path';
import {expect as browserExpect} from '@playwright/test';
import {startDocumentsApp} from '../documents/support/harness';
import {seedDocumentsWorld} from '../documents/support/fixtures';
import {startWeb} from '../documents/support/web';

describe('Field audit across other admin pages',()=>{
 it('records populated full API pages and unsaved forms at desktop/mobile sizes',async()=>{
  const h=await startDocumentsApp();let web:any;
  const output=join(process.env.DOCS_QA_OUTPUT!,'fields');mkdirSync(output,{recursive:true});
  const results:any[]=[];
  try{
   const world=await seedDocumentsWorld(h.prisma);web=await startWeb(h);
   const token=(await h.login(world.users.owner.email,world.password)).token;
   const cases:any[]=[
    {path:'/customers',name:'customers-list'},
    {path:'/customers',name:'customers-create',open:/เพิ่มลูกค้าใหม่/},
    {path:'/customers',name:'customers-create-expanded',open:/เพิ่มลูกค้าใหม่/,expand:true},
    {path:`/customers/${world.customer.id}`,name:'customer-detail'},
    {path:'/bookings',name:'bookings-list'},
    {path:'/bookings',name:'bookings-create',open:'สร้างใบจอง'},
    {path:'/credit-checks',name:'credit-checks'},
    {path:'/contracts',name:'contracts-list'},
    {path:'/contracts/create',name:'contracts-create'},
    {path:'/payments',name:'payments'},
    {path:'/expenses',name:'expenses-list'},
    {path:'/expenses/new',name:'expenses-create'},
    {path:'/products/create',name:'products-create'},
    {path:'/products/create',name:'products-used',category:'PHONE_USED'},
    {path:'/products/create',name:'products-accessory',category:'ACCESSORY'},
    {path:'/stock/products',name:'products-list'},
    {path:'/pos',name:'pos'},
    {path:'/branches',name:'branches-list'},
    {path:'/branches',name:'branches-create',open:/เพิ่มสาขา/},
    {path:'/users/new',name:'users-create'},
    {path:'/users/new',name:'users-personal',tab:'ข้อมูลบุคคล'},
    {path:'/users/new',name:'users-hr',tab:'HR / เงินเดือน',hr:true},
    {path:'/trade-in',name:'trade-in'},
    {path:'/contacts',name:'contacts'},
    {path:'/after-sales/new',name:'after-sales-create'},
   ];
   for(const width of [1440,768,390,320]){
    const opened=await web.page({width,height:1000}),p=opened.page;
    await opened.context.tracing.start({screenshots:true,snapshots:true});
    await p.addInitScript((t:string)=>{localStorage.setItem('access_token',t);localStorage.setItem('bc.sidebar.lastZone','shop')},token);
    await p.route('**/*',(route:any)=>{const u=new URL(route.request().url());if(route.request().isNavigationRequest()&&!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();return route.continue()});
    await p.goto(web.origin+'/landing');
    for(const c of cases){
     const entry:any={name:c.name,path:c.path,width,observations:[]};const before=opened.errors.length;
     try{
      await p.goto(web.origin+c.path,{waitUntil:'networkidle'});
      await p.locator('.app-shell').waitFor({state:'visible',timeout:15000});
      await p.waitForFunction(()=>{const root=document.querySelector('main')||document.body;return root.textContent?.trim()&&![...root.querySelectorAll('[data-slot=skeleton]')].some(e=>e.getClientRects().length>0)},{},{timeout:15000});
      if(c.open){await p.getByRole('button',{name:c.open}).first().click();await p.waitForLoadState('networkidle',{timeout:3000}).catch(()=>{});}
      expect(new URL(p.url()).pathname).toBe(c.path);
      const headings: Record<string,string> = {
       'customers-list':'ลูกค้า', 'customers-create':'เพิ่มลูกค้าใหม่', 'customers-create-expanded':'เพิ่มลูกค้าใหม่',
       'customer-detail':world.customer.name, 'bookings-list':'การจอง / มัดจำ', 'bookings-create':'สร้างใบจอง',
       'credit-checks':'ตรวจเครดิต', 'contracts-list':'สัญญาผ่อนชำระ', 'contracts-create':'สร้างสัญญาผ่อนชำระ',
       'payments':'ชำระเงิน', 'expenses-list':'ค่าใช้จ่าย', 'products-create':'เพิ่มสินค้าใหม่',
       'products-used':'เพิ่มสินค้าใหม่', 'products-accessory':'เพิ่มสินค้าใหม่', 'products-list':'รายการสินค้า',
       'pos':'POS - ขายสินค้า', 'branches-list':'จัดการสาขา', 'branches-create':'เพิ่มสาขาใหม่',
       'trade-in':'รับซื้อเครื่อง', 'contacts':'รายชื่อผู้ติดต่อ', 'after-sales-create':'แจ้งปัญหาเครื่อง',
      };
      if(c.name==='expenses-create') await browserExpect(p.getByRole('combobox',{name:/ผู้ขาย/}).first()).toBeVisible();
      else if(c.name.startsWith('users-')) {
       await browserExpect(p.getByRole('heading',{name:'เพิ่มผู้ใช้ใหม่',exact:true})).toBeVisible();
       await browserExpect(p.getByLabel(/อีเมล \(เข้าสู่ระบบ\)/)).toBeEnabled();
      }
      else await browserExpect(p.getByRole('heading',{name:headings[c.name],exact:true}).first()).toBeVisible();
      if(c.tab)await p.getByRole('tab',{name:c.tab,exact:true}).click();
      if(c.hr)await p.getByRole('button',{name:'+ เพิ่มข้อมูล HR / เงินเดือน',exact:true}).click();
      if(c.category)await p.getByLabel('ประเภท *',{exact:true}).selectOption(c.category);
      if(c.expand){
       const dialog=p.getByRole('dialog');
       for(const summary of await dialog.locator('details > summary').all()){
        await summary.click();
        await browserExpect(summary.locator('..')).toHaveAttribute('open','');
       }
      }
      await p.evaluate(()=>document.fonts.ready);
      for(const dark of [false,true]){
       await p.evaluate((dark:boolean)=>{document.documentElement.classList.toggle('dark',dark);for(const a of document.getAnimations())if(Number.isFinite(a.effect?.getComputedTiming().endTime))a.finish()},dark);
       const observation=await p.evaluate(()=>{
        const visible=(e:Element)=>e.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});
        const dialogs=[...document.querySelectorAll('[role=dialog]')].filter(visible);
        const scope=dialogs.at(-1)||document.querySelector('main')||document.body;
        const controls=[...scope.querySelectorAll('input,select,textarea,button[role=combobox],[data-slot=select-trigger]')].filter(visible).filter(e=>!['checkbox','radio','hidden','file','range','color'].includes(e.getAttribute('type')||''));
        const fields=controls.map((e:any)=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();const label=e.getAttribute('aria-label')||(e.getAttribute('aria-labelledby')||'').split(' ').map((id:string)=>document.getElementById(id)?.textContent||'').join(' ')||[...e.labels||[]].map((l:any)=>l.textContent?.trim()).join(' ')||'';return {tag:e.tagName,type:e.type,id:e.id,label:label.slice(0,100),placeholder:e.placeholder,value:e.value?.slice(0,80),text:e.tagName==='BUTTON'?e.textContent?.trim().slice(0,80):undefined,x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight,border:s.borderColor,disabled:e.disabled,readonly:e.readOnly,classes:e.className,parent:e.parentElement?.className};});
        // Off-screen table/tab buttons are valid only inside a bounded horizontal
        // scroller. The browser must then scroll to and hit-test each one below.
        const buttons=[...scope.querySelectorAll('button')];
        const outsideButtons=buttons.map((e,index)=>{
         const box=e.getBoundingClientRect();
         if(!visible(e)||(box.x>=-1&&box.right<=innerWidth+1))return null;
         let parent=e.parentElement;
         while(parent&&parent!==document.body){
          const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
          if(/auto|scroll/.test(style.overflowX)&&parent.scrollWidth>parent.clientWidth&&bounds.x>=-1&&bounds.right<=innerWidth+1)return {index,text:e.textContent?.trim(),scrollable:true};
          parent=parent.parentElement;
         }
         return {index,text:e.textContent?.trim(),scrollable:false};
        }).filter((entry):entry is NonNullable<typeof entry>=>entry!==null);
        const overflowingButtons=outsideButtons.filter(entry=>!entry.scrollable).map(entry=>entry.text);
        const scrollableButtons=outsideButtons.filter(entry=>entry.scrollable);
        return {overflowingButtons,scrollableButtons,title:scope.querySelector('h1,h2')?.textContent,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,fields,controls:fields.length,unlabelled:fields.filter(f=>!f.label).length,wrongFont:fields.filter(f=>!f.font.includes('Noto Sans Thai Looped')).length,horizontalFieldOverflow:fields.filter(f=>f.x< -1||f.x+f.width>innerWidth+1),shortMobileFields:innerWidth<1024?fields.filter(f=>f.height<43.9):[],bodyText:scope.textContent?.trim().slice(0,300)};
       });
       const file=`${c.name}-${width}-${dark?'dark':'light'}.png`;
       await p.screenshot({path:join(output,file),fullPage:true,animations:'disabled'});
       entry.observations.push({theme:dark?'dark':'light',...observation,file});
       if(observation.scrollableButtons.length){
        const positions=await p.evaluate(()=>[...document.querySelectorAll('*')].map(e=>({left:e.scrollLeft,top:e.scrollTop})));
        const scope=await p.getByRole('dialog').count()?p.getByRole('dialog').last():p.locator('main');
        try{
         for(const button of observation.scrollableButtons)await scope.locator('button').nth(button.index).click({trial:true});
        }finally{
         await p.evaluate(positions=>[...document.querySelectorAll('*')].forEach((e,i)=>{if(positions[i]){e.scrollLeft=positions[i].left;e.scrollTop=positions[i].top}}),positions);
        }
       }
      }
      entry.finalPath=new URL(p.url()).pathname;entry.status='OBSERVED';
     }catch(error){entry.status='BLOCKED';entry.error=String(error);await p.screenshot({path:join(output,`${c.name}-${width}-blocked.png`)}).catch(()=>{});}
     entry.errors=opened.errors.slice(before).filter((e:string)=>e.startsWith('pageerror:'));
     results.push(entry);writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));console.log('FIELD_AUDIT',c.name,width,entry.status,entry.observations[0]?.fields.map((f:any)=>`${f.label||f.placeholder||f.id||f.tag}:${f.height}px`).join(' | '));
     // Close unsaved modal by navigating; no business form is submitted.
     if(c.open)await p.keyboard.press('Escape').catch(()=>{});
    }
    await opened.context.tracing.stop({path:join(output,`trace-${width}.zip`)});
    await opened.context.close();
   }
   // Every configured route must have rendered the intended page, not an error/redirect.
   expect(results.every(entry => entry.status === 'OBSERVED')).toBe(true);
   expect(results.filter(entry => entry.name === 'expenses-create').every(entry => entry.finalPath === '/expenses/new')).toBe(true);
   const fullSizeForms = new Set(['customers-create', 'customers-create-expanded', 'bookings-create', 'products-create', 'products-used', 'products-accessory', 'branches-create', 'expenses-create', 'users-create', 'users-personal', 'users-hr']);
   for (const entry of results) for (const observation of entry.observations) {
    expect({page:entry.name,width:entry.width,theme:observation.theme,overflow:observation.bodyOverflow,wrongFont:observation.wrongFont,unlabelled:observation.unlabelled,outside:observation.horizontalFieldOverflow,shortMobile:observation.shortMobileFields})
      .toEqual({page:entry.name,width:entry.width,theme:observation.theme,overflow:false,wrongFont:0,unlabelled:0,outside:[],shortMobile:[]});
    if(fullSizeForms.has(entry.name)) for(const field of observation.fields.filter((f:any)=>f.tag!=='TEXTAREA')) {
      expect({page:entry.name,label:field.label,height:field.height}).toEqual({page:entry.name,label:field.label,height:44});
      if(entry.width<=390) expect({page:entry.name,label:field.label,wideEnough:field.width>=140}).toEqual({page:entry.name,label:field.label,wideEnough:true});
    }
    if(!['customer-detail','bookings-list','branches-list'].includes(entry.name)) expect(observation.fields.length).toBeGreaterThan(0);
    expect({page:entry.name,width:entry.width,buttons:observation.overflowingButtons}).toEqual({page:entry.name,width:entry.width,buttons:[]});
    expect(entry.errors).toEqual([]);
   }

   // Exercise input/selection/clear/reset paths without saving any business records.
   const opened = await web.page({width:390,height:844}), p = opened.page;
   await p.addInitScript((t:string)=>localStorage.setItem('access_token',t),token);
   try {
    await p.goto(web.origin+'/customers',{waitUntil:'networkidle'});
    await p.getByRole('button',{name:/เพิ่มลูกค้าใหม่/}).first().click();
    const dialog=p.getByRole('dialog');
    await dialog.getByRole('button',{name:'บันทึก',exact:true}).click();
    const name=dialog.locator('input[name="firstName"]');
    await browserExpect(name).toHaveAttribute('aria-invalid','true');
    await dialog.locator('label').filter({hasText:/^ชื่อ \*$/}).click();
    await browserExpect(name).toBeFocused();
    await name.fill('ทดสอบ');
    await browserExpect(name).toHaveValue('ทดสอบ');
    await name.clear();
    await browserExpect(name).toHaveValue('');
    await dialog.locator('summary').filter({hasText:'ที่อยู่'}).click();
    const province=dialog.getByRole('combobox',{name:'จังหวัด *',exact:true}).first();
    const district=dialog.getByRole('combobox',{name:'อำเภอ/เขต *',exact:true}).first();
    const subdistrict=dialog.getByRole('combobox',{name:'ตำบล/แขวง *',exact:true}).first();
    const postal=dialog.getByLabel('รหัสไปรษณีย์',{exact:true}).first();
    await browserExpect(district).toBeDisabled();
    await province.click(); await province.fill('กรุงเทพ');
    await province.press('ArrowDown'); await province.press('Enter');
    await browserExpect(province).toHaveValue('กรุงเทพมหานคร');
    await district.click(); await district.fill('พระนคร');
    await district.press('ArrowDown'); await district.press('Enter');
    await subdistrict.click(); await subdistrict.press('ArrowDown'); await subdistrict.press('Enter');
    await browserExpect(postal).not.toHaveValue('');
    // Pointer selection must reopen on the same focused input; changing province resets dependents.
    await province.click(); await province.fill('เชียงใหม่');
    await dialog.getByRole('option',{name:'เชียงใหม่',exact:true}).click();
    await browserExpect(district).toHaveValue('');
    await browserExpect(subdistrict).toBeDisabled();
    await browserExpect(postal).toHaveValue('');
    await province.click(); await browserExpect(province).toHaveAttribute('aria-expanded','true');
    await province.press('Escape'); await browserExpect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'ยกเลิก',exact:true}).click();
    await p.getByRole('button',{name:/เพิ่มลูกค้าใหม่/}).first().click();
    await browserExpect(p.locator('input[name="firstName"]')).toHaveValue('');

    await p.goto(web.origin+'/products/create',{waitUntil:'networkidle'});
    await p.getByLabel('ยี่ห้อ *',{exact:true}).selectOption({label:'Apple'});
    await browserExpect(p.getByLabel('รุ่น *',{exact:true})).toBeEnabled();
    const model=p.getByLabel('รุ่น *',{exact:true});
    const modelValue=await model.locator('option').nth(1).getAttribute('value');
    expect(modelValue).toBeTruthy(); await model.selectOption(modelValue!);
    await p.getByLabel('ประเภท *',{exact:true}).selectOption('ACCESSORY');
    await p.getByLabel('ประเภทอุปกรณ์ *',{exact:true}).selectOption('ชุดชาร์จ');
    await p.getByLabel('ชนิด *',{exact:true}).selectOption('Type-C');
    await p.getByLabel('ยี่ห้ออุปกรณ์',{exact:true}).fill('อุปกรณ์ทดสอบ');
    await browserExpect(p.getByText(/ชื่อสินค้าอัตโนมัติ:/)).toContainText('Type-C');
    await p.getByLabel('ประเภท *',{exact:true}).selectOption('PHONE_USED');
    await browserExpect(p.getByLabel('วันหมดประกันศูนย์')).toBeVisible();
    await p.getByLabel('หมดประกันแล้ว',{exact:true}).check();
    await browserExpect(p.getByLabel('วันหมดประกันศูนย์')).toHaveCount(0);

    await p.goto(web.origin+'/expenses/new',{waitUntil:'networkidle'});
    await browserExpect(p.getByLabel('ประเภทผู้ขาย',{exact:true})).toBeVisible();
    await p.getByLabel('เลขใบกำกับ',{exact:true}).fill('TEST-UNSAVED');
    await p.getByLabel('เลขใบกำกับ',{exact:true}).clear();
    await p.getByLabel('จำนวน',{exact:true}).first().fill('2');
    await p.getByLabel('ราคา/หน่วย',{exact:true}).first().fill('1250.50');
    await p.getByRole('button',{name:'เพิ่มบัญชี',exact:true}).click();
    await browserExpect(p.getByLabel('ราคา/หน่วย',{exact:true})).toHaveCount(2);
    const ids=await p.getByLabel('ราคา/หน่วย',{exact:true}).evaluateAll((nodes:any[])=>nodes.map(n=>n.id));
    expect(new Set(ids).size).toBe(2);
    await p.getByRole('button',{name:'ลบรายการ',exact:true}).last().click();
    await browserExpect(p.getByLabel('ราคา/หน่วย',{exact:true})).toHaveCount(1);
    await browserExpect(p.getByLabel('ราคา/หน่วย',{exact:true})).toHaveValue('1250.50');
    await p.getByRole('button',{name:'เพิ่มแบบ manual',exact:true}).click();
    await browserExpect(p.getByLabel('Dr/Cr',{exact:true})).toBeVisible();
    await p.getByRole('button',{name:'ลบบัญชีปรับ #1',exact:true}).scrollIntoViewIfNeeded();
    const deleteBox=await p.getByRole('button',{name:'ลบบัญชีปรับ #1',exact:true}).boundingBox();
    expect(deleteBox!.x+deleteBox!.width).toBeLessThanOrEqual(390);
    await p.screenshot({path:join(output,'expense-interaction-mobile.png'),fullPage:true});

    await p.goto(web.origin+'/after-sales/new',{waitUntil:'networkidle'});
    const imei=p.getByRole('textbox',{name:'เลข IMEI หรือเลขเครื่อง'});
    await imei.fill('000000000000001');
    await browserExpect(p.getByRole('button',{name:'ค้นหา',exact:true})).toBeEnabled();
    await imei.clear();
    await browserExpect(p.getByRole('button',{name:'ค้นหา',exact:true})).toBeDisabled();
    expect(opened.errors.filter((e:string)=>e.startsWith('pageerror:'))).toEqual([]);
   } finally { await opened.context.close(); }
   expect(h.external.calls).toEqual([]);
  }finally{await web?.close();await h.close();}
 },600000);
});
