import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
const origin='http://localhost:5207';
const out='.tmp/document-handoff';
const evidence='docs/review/2026-09-11-document-handoff';
await mkdir(out,{recursive:true});
const source=await readFile('.tmp/document-style/letter-CONTRACT_TERMINATION_60D-normal.pdf');
const browser=await chromium.launch({headless:true});
const date='2026-09-11T05:00:00Z';
const results=[];
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let failPdf=false, failMark=true;const posts=[];
  const rows=Array.from({length:51},(_,i)=>({id:`letter-${i+1}`,letterNumber:`LTR-TEST-${String(i+1).padStart(3,'0')}`,contractId:`contract-${i+1}`,letterType:'CONTRACT_TERMINATION_60D',status:'PENDING_DISPATCH',triggeredAt:date,pdfUrl:null,contract:{id:`contract-${i+1}`,contractNumber:`CT-TEST-${i+1}`,customer:{id:'customer',name:'ลูกค้า ตัวอย่าง',phone:'0000000000',addressCurrent:'ที่อยู่ทดสอบ'},branch:{id:'branch',name:'สาขาทดสอบ'}}}));
  await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());const path=u.pathname.replace('/api/admin','').replace(/^\/api/,'');
   if(path==='/overdue/letters') {
    const filtered=rows.filter(row=>row.status===u.searchParams.get('status'));
    const pageNumber=Number(u.searchParams.get('page')??1),limit=Number(u.searchParams.get('limit')??50);
    return route.fulfill({json:{data:filtered.slice((pageNumber-1)*limit,pageNumber*limit),total:filtered.length,page:pageNumber,limit}});
   }
   if(path==='/overdue/letters/counts') return route.fulfill({json:Object.fromEntries(['PENDING_DISPATCH','PDF_GENERATED','DISPATCHED','DELIVERED','UNDELIVERABLE','CANCELLED'].map(status=>[status,rows.filter(r=>r.status===status).length]))});
   if(/^\/overdue\/letters\/[^/]+\/pdf$/.test(path)) {
    if(failPdf){failPdf=false;return route.fulfill({status:503,json:{message:'ทดสอบโหลด PDF ไม่สำเร็จ'}});}
    return route.fulfill({contentType:'application/pdf',body:source});
   }
   if(path.endsWith('/pdf-generated')) {
    const id=path.split('/')[3];posts.push(id);
    if(id==='letter-2'&&failMark){failMark=false;return route.fulfill({status:503,json:{message:'ทดสอบบันทึกไม่สำเร็จ'}});}
    rows.find(row=>row.id===id).status='PDF_GENERATED';
    return route.fulfill({json:{id,status:'PDF_GENERATED'}});
   }
   return route.continue();
  });
  await page.goto(origin+'/letters');
  await expect(page.getByText('LTR-TEST-001',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByText('LTR-TEST-051',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'เลือก LTR-TEST-051',exact:true}).click();
  await page.getByRole('button',{name:'พิมพ์รวม',exact:true}).click();
  await expect(page.getByRole('button',{name:'ดาวน์โหลด PDF'})).toBeEnabled();
  const lastPageDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'ดาวน์โหลด PDF'}).click();await lastPageDownload;
  await page.getByRole('button',{name:'ยืนยันพิมพ์แล้ว',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  posts.length=0;failPdf=true;
  await expect(page.getByText('LTR-TEST-001',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'พิมพ์รวม',exact:true})).toHaveCount(0);
  for(const num of ['001','002']) await page.getByRole('checkbox',{name:`เลือก LTR-TEST-${num}`,exact:true}).click();
  await page.getByRole('button',{name:'พิมพ์รวม',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'สร้าง PDF ไม่สำเร็จ'})).toBeVisible();
  await page.screenshot({path:`${evidence}/bulk-error-${width}.png`,animations:'disabled'});
  await page.getByRole('dialog').getByRole('button',{name:'ลองใหม่',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('button',{name:'ดาวน์โหลด PDF'})).toBeEnabled();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'ดาวน์โหลด PDF'}).click();
  const file=await download;await file.saveAs(`${out}/letters-batch-${width}.pdf`);
  assert.equal((await PDFDocument.load(await readFile(`${out}/letters-batch-${width}.pdf`))).getPageCount(),2);
  assert.deepEqual(posts,[]);
  await page.getByRole('button',{name:'ยืนยันพิมพ์แล้ว',exact:true}).click();
  await expect(page.getByRole('button',{name:'ลองบันทึกอีกครั้ง 1 ฉบับ'})).toBeVisible();
  await page.screenshot({path:`${evidence}/bulk-partial-${width}.png`,animations:'disabled'});
  await page.getByRole('button',{name:'ลองบันทึกอีกครั้ง 1 ฉบับ'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(posts,['letter-1','letter-2','letter-2']);
  await page.getByRole('button',{name:/^พิมพ์แล้ว/}).click();
  await expect(page.getByText('LTR-TEST-001',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'ดู PDF LTR-TEST-001'}).click();
  await expect(page.getByRole('dialog').locator('iframe')).toHaveAttribute('src',/^blob:/);
  await page.screenshot({path:`${evidence}/single-preview-${width}.png`,animations:'disabled'});
  await page.keyboard.press('Escape');
  for(const num of ['001','002']) await page.getByRole('checkbox',{name:`เลือก LTR-TEST-${num}`,exact:true}).click();
  await page.getByRole('button',{name:'สร้าง PDF อีกครั้ง',exact:true}).click();
  await expect(page.getByRole('button',{name:'ดาวน์โหลด PDF'})).toBeEnabled();
  await page.getByRole('button',{name:'ดาวน์โหลด PDF'}).click();
  await expect(page.getByRole('button',{name:'ยืนยันพิมพ์แล้ว',exact:true})).toHaveCount(0);
  assert.equal(posts.length,3);
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal viewport overflow');
  assert.deepEqual(errors,[]);
  results.push({width,passed:true,letters:51,lastPageShrink:true,downloadPages:2,markRequests:posts,errors});
  await page.close();
 }
 for(const count of [0,3,8,12,20]) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const data={id:'receiving',grNumber:'GR-TEST-00001',createdAt:date,notes:'ตรวจนับรายการและสภาพสินค้าเรียบร้อยแล้ว',po:{id:'specimen',poNumber:'PO-TEST-00001',supplier:{id:'vendor',name:'ผู้จัดจำหน่าย ตัวอย่าง'}},receivedBy:{id:'actor',name:'ผู้ตรวจรับ ตัวอย่าง'},items:Array.from({length:count},(_,i)=>({id:String(i),status:i%3===2?'REJECT':'PASS',imeiSerial:`0000000000000${String(i).padStart(2,'0')}`,defectReason:i%3===2?'SCREEN':null,rejectReason:i%3===2?'พบตำหนิบนจอภาพ ขอเปลี่ยนสินค้า':null,poItem:{brand:'Apple',model:'iPhone 15',color:'ดำ',storage:'128GB'}}))};
  await page.route('**/api/admin/companies/public*',route=>route.fulfill({json:{shop:{id:'preview-shop',companyCode:'SHOP',nameTh:'บริษัท เบสท์ช้อยส์โฟน จำกัด',nameEn:null,taxId:'0000000000000',address:'123 ถนนตัวอย่าง แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10000',phone:'0000000000',logoUrl:'/logo-bestchoice.png'},finance:null}}));
  let release;const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/admin/purchase-orders/specimen/goods-receivings/receiving*',async route=>{await gate;return route.fulfill({json:data});});
  await page.goto(origin+'/purchase-orders/specimen/goods-receivings/receiving/print');
  const print=page.getByRole('button',{name:'พิมพ์ / Save PDF',exact:true});
  await expect(print).toBeDisabled();release();
  await expect(print).toBeEnabled();await page.locator('table').waitFor();
  await expect(page.locator('.bc-doc-company')).toHaveText('บริษัท เบสท์ช้อยส์โฟน จำกัด');
  await page.locator('.bc-doc-brand img').evaluate(image=>image.decode());
  await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
  await page.pdf({path:`${out}/goods-${count}.pdf`,format:'A4',preferCSSPageSize:true,printBackground:true});
  assert.equal(await page.locator('.bc-paper-relaxed').count(),0);
  if(count===3) {
   await page.pdf({path:`${out}/goods-repeat.pdf`,format:'A4',preferCSSPageSize:true,printBackground:true});
   await page.emulateMedia({media:'screen'});
   await page.screenshot({path:`${evidence}/goods-desktop.png`,fullPage:true});
  }
  await page.close();
 }
 await writeFile(`${evidence}/browser-check.json`,JSON.stringify(results,null,2));
 console.log('PASS letter pagination, PDF retry/reprint, explicit/partial status confirmation at both widths; goods fixtures rendered');
}finally{await browser.close();}
