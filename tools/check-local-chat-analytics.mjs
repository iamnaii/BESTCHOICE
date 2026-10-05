import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
export async function checkChatAnalytics(page,origin,output,width){
 page.setDefaultTimeout(15000);
 const info=await (await page.request.get(`${origin}/api/preview/info`)).json();assert.equal(info.isolated,true);
 const post=async(path,data={})=>{const r=await page.request.post(`${origin}/api/${path}`,{data});assert.ok(r.ok(),await r.text());return r.json();};
 await post('preview/actor/owner');
 const day=new Date(Date.now()+7*3600000).toISOString().slice(0,10);const end=new Date(Date.now()+7*3600000+86400000).toISOString().slice(0,10);
 const params=new URLSearchParams({company:'SHOP',from:`${day}T00:00:00+07:00`,to:`${end}T00:00:00+07:00`,limit:'200'});
 const get=async(path,extra={})=>{const q=new URLSearchParams(params);Object.entries(extra).forEach(([k,v])=>q.set(k,v));const r=await page.request.get(`${origin}/api/chat-analytics/v2/${path}?${q}`);assert.equal(r.status(),200,await r.text());return r.json();};
 const before=await get('sales');
 const f=await post('preview/analytics/fixture');await post(`preview/analytics/${f.roomId}/bot`);
 await post(`preview/chat-work/${f.roomId}/fail-next`);
 const draft={text:'คำตอบคนที่ยืนยันการส่ง',clientMessageId:randomUUID()};
 const failed=await post(`staff-chat/rooms/${f.roomId}/messages`,draft);assert.equal(failed.success,false);
 let cycles=(await get('cycles')).data.filter(r=>r.roomId===f.roomId);assert.equal(cycles.length,1);assert.equal(cycles[0].firstHumanSentAt,null);assert.ok(cycles[0].firstBotSentAt);
 const sent=await post(`staff-chat/rooms/${f.roomId}/messages`,draft);assert.equal(sent.success,true);
 const sold=await post(`preview/analytics/${f.roomId}/sales`);
 cycles=(await get('cycles')).data.filter(r=>r.roomId===f.roomId);assert.equal(cycles[0].staffId,info.previewActors.owner.id);
 const sales=await get('sales');assert.equal(sales.documentCount-before.documentCount,2);assert.equal(BigInt(sales.amount.replace('.',''))-BigInt(before.amount.replace('.','')),30030n);
 const source=sales.data.filter(r=>sold.saleIds.includes(r.id));assert.equal(source.length,2);assert.ok(source.every(r=>r.salespersonId===sold.salespersonId&&r.customerId===f.customerId));assert.equal(new Set(source.map(r=>r.businessSaleKey)).size,2);
 const overview=await get('overview');const work=await get('open-work');assert.equal(work.total,overview.openWorkNow.totalItems);
 const exported=await get('sales/export');assert.equal(exported.total,sales.documentCount);
 const funnel=await get('funnel');assert.ok(funnel.steps.find(s=>s.stage==='PURCHASED').reached>=1);
 await page.goto(`${origin}/chat-analytics?zone=shop&start=${day}&end=${day}`);
 await expect(page.getByRole('heading',{name:'ภาพรวมงานแชท',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'ความเร็วตอบของคนกับบอท'})).toBeVisible();
 await page.getByRole('button',{name:/ห้องรอคนตอบ/}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'ห้องรอคนตอบ',exact:true})).toBeVisible();await expect(dialog.getByText(`${overview.openWorkNow.roomWaits} รายการ`,{exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'ดูเอกสารขาย',exact:true}).click();await expect(page.getByRole('dialog')).toContainText(source[0].number);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'ตั้งค่างานแชท',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('เตือนผู้ดูแลเมื่อรอ (นาที)')).toBeVisible();await page.keyboard.press('Escape');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Analytics overflow');await page.screenshot({path:join(output,`chat-analytics-${width}.png`),fullPage:true,animations:'disabled'});
 await page.goto(`${origin}/chat-analytics?zone=fin&start=${day}&end=${day}`);await expect(page.getByText('งานการเงิน · FINANCE · หลักฐานการตอบ งานทีม และการขาย')).toBeVisible();await expect(page.getByRole('heading',{name:'ความเร็วตอบของคนกับบอท'})).toBeVisible();
 await page.goto(`${origin}/inbox?zone=shop`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const browser=await chromium.launch({headless:true});try{for(const width of [1440,390]){const context=await browser.newContext({viewport:{width,height:1000}});await context.routeWebSocket('**/socket.io/**',s=>s.close());const page=await context.newPage();await checkChatAnalytics(page,process.env.LOCAL_CHAT_ORIGIN||'http://localhost:5217','.tmp/local-preview',width);await context.close();}console.log('PASS: acknowledged human/bot, actual responder vs sales owner, Decimal sale-contract dedupe, scoped dashboard drilldowns 1440/390');}finally{await browser.close();}
}
