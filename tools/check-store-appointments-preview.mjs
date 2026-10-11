import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
const origin=process.env.APPOINTMENT_PREVIEW_URL||'http://localhost:5198';
const output='.tmp/local-preview/appointments';mkdirSync(output,{recursive:true});
const api=async(path,body,method)=>{
 const r=await fetch(`${origin}/api/admin${path}`,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status} ${JSON.stringify(data)}`);return data.data??data;
};
const info=await api('/preview/info');assert.equal(info.isolated,true);assert.equal(info.repoRoot,process.cwd());
const {branchId,staffId,customers}=info.appointmentFixture;
const day=new Date(Date.now()+86400000+7*3600000).toISOString().slice(0,10);
// Clean only this isolated fixture's prior acceptance bookings/windows, making reruns deterministic.
for(const c of customers){for(const a of await api(`/store-appointments?customerId=${c.id}&open=true`))await api(`/store-appointments/${a.id}/status`,{status:'CANCELED',version:a.version,requestId:crypto.randomUUID(),reason:'Reset synthetic acceptance run'});}
for(const w of await api(`/store-appointments/windows?branchId=${branchId}&day=${day}`))if(new Date(w.startsAt).getUTCHours()===11)await api(`/store-appointments/windows/${w.id}`,{version:w.version},'DELETE');
const browser=await chromium.launch({headless:true});const errors=[];
const staff=await browser.newPage({viewport:{width:1440,height:1000}});staff.setDefaultTimeout(15000);staff.on('pageerror',e=>errors.push(e.message));
let mobile;
try{
 // Use real controllers and DB from this checkout; only login and unrelated shell are preview fixtures.
 await staff.goto(`${origin}/appointments?customerId=${customers[0].id}`);
 await staff.getByLabel('สาขาที่ดู',{exact:true}).selectOption(branchId);
 await staff.getByLabel('วันที่ดู',{exact:true}).fill(day);
 await staff.getByRole('button',{name:'ตารางพนักงาน',exact:true}).click();
 await staff.getByLabel('พนักงานรับนัด').selectOption(staffId);
 await staff.getByLabel('เริ่มรับนัด').fill('18:00');await staff.getByLabel('สิ้นสุดรับนัด').fill('18:45');
 await staff.getByRole('button',{name:'เพิ่มช่วงเวลา',exact:true}).click();await expect(staff.getByText('18:00–18:45')).toBeVisible();
 await staff.getByRole('button',{name:'นัดหมาย',exact:true}).click();
 await staff.getByRole('button',{name:'10:00',exact:true}).click();await staff.getByRole('button',{name:'ยืนยันนัดหมาย',exact:true}).click();
 const card=staff.locator('article').filter({hasText:customers[0].name}).filter({has:staff.getByText('นัดแล้ว',{exact:true})});await expect(card.getByText('นัดแล้ว',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'ลิงก์ดูนัด'}).click();const manageUrl=await staff.getByLabel('ลิงก์นัดหมาย',{exact:true}).inputValue();
 mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true});mobile.setDefaultTimeout(15000);mobile.on('pageerror',e=>errors.push(e.message));
 await mobile.goto(manageUrl);await expect(mobile.getByRole('heading',{name:'แล้วพบกันที่ร้านครับ'})).toBeVisible();assert.equal(new URL(mobile.url()).hash,'');
 await mobile.getByRole('button',{name:'เลื่อนนัด',exact:true}).click();await mobile.getByRole('button',{name:'10:45',exact:true}).click();await mobile.getByRole('button',{name:'ตรวจสอบนัดหมาย'}).click();await mobile.getByRole('button',{name:'ยืนยันเลื่อนนัด'}).click();await expect(mobile.getByText('10:45 – 11:30')).toBeVisible();
 await mobile.getByRole('button',{name:'ยกเลิกนัด',exact:true}).click();await mobile.getByRole('button',{name:'ยืนยันยกเลิกนัด'}).click();await expect(mobile.getByText('ยกเลิกแล้ว',{exact:true})).toBeVisible();
 await mobile.close();
 // Customer self-books. A staff member takes the selected slot immediately before confirmation.
 await staff.goto(`${origin}/appointments?customerId=${customers[1].id}`);await staff.getByLabel('สาขาที่ดู',{exact:true}).selectOption(branchId);
 await staff.getByRole('button',{name:'สร้างลิงก์ให้ลูกค้าเลือกเวลา'}).click();const bookUrl=await staff.getByLabel('ลิงก์นัดหมาย',{exact:true}).inputValue();
 mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true});mobile.setDefaultTimeout(15000);mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(bookUrl);
 await mobile.getByLabel('วันที่นัด',{exact:true}).fill(day);await mobile.getByRole('button',{name:'10:00',exact:true}).click();
 await mobile.screenshot({path:`${output}/customer-selection.png`,fullPage:true});
 await mobile.getByRole('button',{name:'ตรวจสอบนัดหมาย'}).click();
 const competitor=await api('/store-appointments',{customerId:customers[2].id,branchId,startsAt:`${day}T10:00:00+07:00`,requestId:crypto.randomUUID()});
 await mobile.getByRole('button',{name:'ยืนยันนัดหมาย',exact:true}).click();await expect(mobile.getByRole('alert').filter({hasText:'เต็มแล้ว'})).toBeVisible();
 await mobile.getByRole('button',{name:'10:45',exact:true}).click();await mobile.getByRole('button',{name:'ตรวจสอบนัดหมาย'}).click();await mobile.getByRole('button',{name:'ยืนยันนัดหมาย',exact:true}).click();await expect(mobile.getByRole('heading',{name:'แล้วพบกันที่ร้านครับ'})).toBeVisible();
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await mobile.screenshot({path:`${output}/customer-confirmed.png`,fullPage:true});
 const publicReference=(await mobile.locator('p').filter({hasText:/^เลขนัด /}).innerText()).replace('เลขนัด ','');
 await staff.reload();const selfCard=staff.locator('article').filter({hasText:publicReference});await expect(selfCard.getByText('นัดแล้ว',{exact:true})).toBeVisible();
 await selfCard.getByRole('button',{name:'ลูกค้ามาถึงแล้ว'}).click();await selfCard.getByRole('button',{name:'เริ่มบริการ'}).click();await selfCard.getByRole('button',{name:'เสร็จสิ้น',exact:true}).click();await expect(selfCard.locator('span').filter({hasText:/^เสร็จสิ้น$/})).toBeVisible();
 await staff.screenshot({path:`${output}/staff-appointments.png`,fullPage:true});
 // Prior links remain revocable after navigation/reload.
 await staff.getByText('ลิงก์ที่เคยออกให้ลูกค้า',{exact:true}).click();await staff.getByRole('button',{name:'ยกเลิกสิทธิ์ลิงก์'}).first().click();await expect(staff.locator('details').getByText('ยกเลิกแล้ว',{exact:true}).first()).toBeVisible();
 await api(`/store-appointments/${competitor.id}/status`,{status:'CANCELED',version:competitor.version,requestId:crypto.randomUUID()});
 assert.deepEqual(errors,[]);
 writeFileSync(`${output}/check.json`,JSON.stringify({status:'PASS',at:new Date().toISOString(),origin,repo:info.repoRoot,checks:['manager schedule','staff booking','private management link','mobile reschedule/cancel','self booking','last-slot conflict recovery','check-in/service/complete','prior link revocation','390px no overflow'],browserErrors:errors},null,2));
 console.log('Appointment browser acceptance: PASS');
}finally{await browser.close();}
