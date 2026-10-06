import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
// Real controllers, DTO validation, private local storage, real case/repair lifecycle. No customer transport.
export async function checkServiceCases(page,origin,output,width) {
 page.setDefaultTimeout(15_000);
 const info=await (await page.request.get(origin+'/api/preview/info')).json();assert.equal(info.isolated,true);
 const post=(path,data={})=>page.request.post(`${origin}/api/${path}`,{data});
 await post('preview/actor/owner');
 const fixtureResponse=await post('preview/service-cases/fixture');assert.equal(fixtureResponse.status(),201,await fixtureResponse.text());const f=await fixtureResponse.json();
 await page.goto(`${origin}/inbox/${f.roomId}?zone=shop`);
 await expect(page.getByRole('textbox',{name:'พิมพ์ข้อความ',exact:true})).toBeVisible();
 if(width<1280)await page.getByRole('button',{name:'ข้อมูลลูกค้า',exact:true}).click();
 await page.getByRole('button',{name:'รับเรื่องหลังการขาย',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'รับเรื่องหลังการขาย',exact:true});
 await dialog.getByLabel('อาการที่ลูกค้าแจ้ง').fill(`หน้าจอสัมผัสไม่ตอบสนอง ${width}`);
 await dialog.getByLabel('ผู้รับผิดชอบ').selectOption(info.previewActors.owner.id);
 await dialog.getByLabel('นัดติดตาม (เวลาไทย)').fill('2026-10-01T10:00');
 await dialog.getByRole('button',{name:'บันทึกรับเรื่อง',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'ติดตามหลังการขาย',exact:true});
 await expect(dialog.getByText('รับเรื่องทางแชทแล้ว ยังไม่ใช่การรับฝากเครื่อง')).toBeVisible();
 await expect(dialog.getByRole('link',{name:'เปิดเคสหลังการขาย'})).toHaveCount(0);
 const list=await (await page.request.get(`${origin}/api/staff-chat/rooms/${f.roomId}/service-requests?company=SHOP`)).json();assert.equal(list.data.length,1);const requestId=list.data[0].id;
 const linked=await page.request.patch(`${origin}/api/staff-chat/rooms/${f.roomId}/customer`,{data:{customerId:f.customerId}});assert.equal(linked.status(),200,await linked.text());
 const target=`${origin}/inbox?zone=shop&serviceRequestId=${requestId}`;
 await page.goto(target);
 dialog=page.getByRole('dialog',{name:'ติดตามหลังการขาย',exact:true});
 await dialog.getByRole('link',{name:'เปิดเคสหลังการขาย'}).click();
 await expect(page.getByText(/รับเรื่องจากแชท/)).toBeVisible();
 await page.getByLabel('เลข IMEI หรือเลขเครื่อง').fill(f.imei);
 await page.getByRole('button',{name:'ค้นหา',exact:true}).click();
 await expect(page.locator('#as-symptom')).toHaveValue(`หน้าจอสัมผัสไม่ตอบสนอง ${width}`);
 // Original physical-receipt validation remains mandatory.
 await page.getByRole('button',{name:'บันทึกและเปิดเคส',exact:true}).click();
 await expect(page.getByText('ต้องมีรูปตอนรับฝากอย่างน้อย 1 รูป')).toBeVisible();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
 await page.locator('input[type=file]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:png});
 if(await page.locator('#as-branch').count())await page.locator('#as-branch').selectOption(f.branchId);
 await page.getByRole('button',{name:'บันทึกและเปิดเคส',exact:true}).click();
 await expect(page).toHaveURL(url=>/^\/after-sales\/[0-9a-f-]{36}$/.test(url.pathname));
 const caseId=new URL(page.url()).pathname.split('/').pop();
 const read=async()=> (await (await page.request.get(`${origin}/api/staff-chat/service-requests/${requestId}?company=SHOP`)).json());
 assert.equal((await read()).linkedCase.id,caseId);
 const send=await post(`after-sales/${caseId}/repair/send`,{repairSupplierId:f.supplierId});assert.equal(send.status(),201,await send.text());
 await page.reload();
 await page.getByRole('button',{name:'บันทึกซ่อมเสร็จ',exact:true}).filter({visible:true}).first().click();
 const repaired=page.getByRole('dialog',{name:'บันทึกซ่อมเสร็จ',exact:true});
 await repaired.getByLabel(/ค่าซ่อมจริง/).fill('0');
 await repaired.getByRole('button',{name:'ยืนยัน',exact:true}).click();
 await expect.poll(async()=> (await read()).linkedCase.stage).toBe('READY_FOR_PICKUP');
 await page.goto(target);dialog=page.getByRole('dialog',{name:'ติดตามหลังการขาย',exact:true});
 await expect(dialog.getByText('สถานะเคส: รอลูกค้ารับ')).toBeVisible();
 assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
 await page.screenshot({path:join(output,`service-case-linked-${width}.png`),animations:'disabled'});
 await dialog.getByRole('link',{name:/AS-/}).click();
 await page.getByRole('button',{name:'ส่งมอบคืนลูกค้า',exact:true}).filter({visible:true}).first().click();
 await page.getByRole('dialog',{name:'ส่งมอบคืนลูกค้า',exact:true}).getByRole('button',{name:/ยืนยัน|ส่งมอบ/}).click();
 await expect.poll(async()=> (await read()).linkedCase.stage).toBe('CLOSED');
 const queue=await (await page.request.get(`${origin}/api/staff-chat/work?company=SHOP&view=OVERDUE&limit=200`)).json();assert.equal(queue.data.some(i=>i.targetId===requestId),false);
 // FINANCE work selection cannot open this SHOP intake, even with a known ID.
 const denied=await page.request.get(`${origin}/api/staff-chat/service-requests/${requestId}?company=FINANCE`);assert.ok([403,404].includes(denied.status()));
 await page.goto(target);dialog=page.getByRole('dialog',{name:'ติดตามหลังการขาย',exact:true});await expect(dialog.getByText('สถานะเคส: ปิดเคส')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'แก้ไขการติดตาม'})).toHaveCount(0);
 await page.screenshot({path:join(output,`service-case-closed-${width}.png`),animations:'disabled'});
 console.log(`PASS service intake → original case → repair → close ${width}px; scoped queue and receipt validation`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const browser=await chromium.launch();try{for(const width of [1440,390]){const page=await browser.newPage({viewport:{width,height:1000}});try{await checkServiceCases(page,process.env.LOCAL_CHAT_ORIGIN||'http://localhost:5217','.tmp/local-preview',width);}catch(e){console.error((await page.locator('body').innerText()).slice(-7000));await page.screenshot({path:'.tmp/local-preview/service-failure.png'});throw e;}finally{await page.close();}}}finally{await browser.close();}
}
