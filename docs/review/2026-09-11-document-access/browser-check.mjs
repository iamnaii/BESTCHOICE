import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const origin='http://localhost:5207';const evidence='docs/review/2026-09-11-document-access';
const pdf=await readFile('.tmp/document-handoff/goods-3.pdf');
const date='2026-09-11T05:00:00Z';
const receipt={id:'receipt-test',receiptNumber:'RC-TEST-001',contractId:'contract-test',paymentId:'pay-test',receiptType:'INSTALLMENT',payerName:'ลูกค้าทดสอบ',receiverName:'พนักงานทดสอบ',amount:1000,paidDate:date,isVoided:false,createdAt:date,contract:{contractNumber:'CT-TEST-001',customer:{name:'ลูกค้าทดสอบ'}}};
const expense={id:'doc-test',number:'EXP-TEST-001',documentType:'EXPENSE',status:'POSTED',documentDate:date,vendorName:'ผู้ขาย ตัวอย่าง',vendorTaxId:'0000000000000',description:'รายการทดสอบ',subtotal:'1000',vatAmount:'0',withholdingTax:'0',totalAmount:'1000',netPayment:'1000',createdBy:{id:'synthetic',name:'พนักงาน ตัวอย่าง'},expenseDetail:{lines:[{category:'OFFICE',description:'วัสดุสำนักงาน',amountBeforeVat:'1000',vatAmount:'0',whtAmount:'0'}]}};
const other={id:'doc-test',docNumber:'OI-TEST-001',status:'POSTED',issueDate:date,customerId:'customer-test',counterpartyName:'ลูกค้า ตัวอย่าง',items:[{id:'item1',accountCode:'S42-1101',description:'รายได้ทดสอบ',amountBeforeVat:'1000'}],adjustments:[],attachments:[],subtotal:'1000',vatAmount:'0',whtAmount:'0',netReceived:'1000',amountReceived:'1000',paymentAccountCode:'11-1101',createdBy:{id:'synthetic',name:'พนักงาน ตัวอย่าง'}};
const asset={id:'doc-test',assetCode:'AS-TEST-001',docNo:'ASDOC-TEST-001',name:'คอมพิวเตอร์ทดสอบ',category:'COMPUTER',status:'POSTED',purchaseDate:date,purchaseCost:'1000',vatAmount:'0',whtAmount:'0',dailyDepr:'1',monthlyDepr:'30',accumulatedDepr:'0',netBookValue:'1000',usefulLifeMonths:36,transferHistory:[]};
const results=[];const browser=await chromium.launch({headless:true});
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}});
  await page.addInitScript(() => localStorage.setItem('access_token', 'synthetic-document-test-token'));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let gate=null,fail=false;let pdfCount=0;const requests=[];
  await page.route('**/api/**',async route=>{
   const req=route.request();const u=new URL(req.url());const path=u.pathname.replace(/^\/api\/admin/,'');
   if((/\/(voucher\.pdf|receipt\.pdf)$/.test(path))||path==='/receipts/receipt-test/pdf'||path==='/e-tax/invoices/pay-test/pdf'||path==='/reporting/pdf') {
    pdfCount++;requests.push({path,method:req.method(),company:u.searchParams.get('company'),hasBearer:/^Bearer /.test(req.headers().authorization||'')});
    if(gate) await gate;
    if(fail) {fail=false;return route.fulfill({status:403,json:{message:'ไม่มีสิทธิ์เปิดเอกสารทดสอบนี้'}});}
    return route.fulfill({contentType:'application/pdf',body:pdf});
   }
   if(path==='/receipts')return route.fulfill({json:{data:[receipt],total:1,page:1,limit:20}});
   if(path==='/expense-documents/doc-test')return route.fulfill({json:expense});
   if(path==='/other-income/doc-test')return route.fulfill({json:other});
   if(path==='/assets/doc-test')return route.fulfill({json:asset});
   if(['/expense-documents/doc-test/audit','/other-income/doc-test/audit','/assets/doc-test/audit'].includes(path))return route.fulfill({json:[]});
   if(path==='/companies')return route.fulfill({json:[{id:'finance-test',nameTh:'บริษัท ตัวอย่าง จำกัด',companyCode:'FINANCE'}]});
   if(path==='/e-tax/invoices')return route.fulfill({json:{data:[{paymentId:'pay-test',paidDate:date,installmentNo:1,contractNumber:'CT-TEST-001',customerName:'ลูกค้า ตัวอย่าง',amountBeforeVat:'1000',vatAmount:'70',total:'1070'}],total:1,page:1,limit:200}});
   if(path==='/e-tax-xml')return route.fulfill({json:{data:[{id:'xml-test',paymentId:'pay-test',status:'ACCEPTED'}]}});
   if(path.startsWith('/other-income/settings/'))return route.fulfill({json:{enabled:false}});
   if(path.startsWith('/overdue/'))return route.fulfill({status:503,json:{message:'ข้อมูลวิเคราะห์จำลองยังไม่พร้อม'}});
   return route.continue();
  });
  // Receipt download: duplicate and JSON-Blob failure recovery.
  await page.goto(origin+'/receipts');
  let release;gate=new Promise(r=>{release=r;});
  const download=page.getByTitle('ดาวน์โหลดใบเสร็จ PDF');await download.click();
  await expect(download).toBeDisabled();await expect(download).toHaveAttribute('aria-busy','true');
  await download.evaluate(b=>b.click());assert.equal(pdfCount,1);
  await page.screenshot({path:`${evidence}/receipt-loading-${width}.png`});
  fail=true;release();gate=null;
  await expect(page.getByText('ไม่มีสิทธิ์เปิดเอกสารทดสอบนี้',{exact:true})).toBeVisible();
  await expect(download).toBeEnabled();
  const filePromise=page.waitForEvent('download');await download.click();const file=await filePromise;
  assert.equal(file.suggestedFilename(),'RC-TEST-001.pdf');assert.deepEqual(await readFile(await file.path()),pdf);
  // Three accounting pages: same preview, error/retry, no popup, Escape restores focus.
  for(const item of [
   {path:'/expenses/doc-test',label:'พิมพ์ใบสำคัญจ่าย',name:'expense',filename:'EXP-TEST-001.pdf'},
   {path:'/other-income/doc-test',label:'พิมพ์ใบเสร็จ',name:'income',filename:'OI-TEST-001.pdf'},
   {path:'/assets/doc-test',label:'พิมพ์ใบรับสินทรัพย์',name:'asset',filename:'AS-TEST-001.pdf'},
  ]) {
   await page.goto(origin+item.path);const opener=page.getByRole('button',{name:item.label,exact:true}).last();await expect(opener).toBeVisible();
   gate=new Promise(r=>{release=r;});await opener.click();
   const dialog=page.getByRole('dialog');await expect(dialog.getByRole('status')).toHaveText('กำลังเตรียมเอกสาร…');
   await expect(dialog.getByRole('link')).toHaveCount(0);assert.equal(page.context().pages().length,1);
   fail=item.name==='expense';release();gate=null;
   if(fail||item.name==='expense') {
    await expect(dialog.getByRole('alert')).toContainText('ไม่มีสิทธิ์เปิดเอกสารทดสอบนี้');
    await page.screenshot({path:`${evidence}/preview-error-${width}.png`});
    await dialog.getByRole('button',{name:'ลองใหม่'}).click();
   }
   const link=dialog.getByRole('link',{name:'ดาวน์โหลด PDF'});await expect(link).toBeVisible();
   const saved=page.waitForEvent('download');await link.click();const savedFile=await saved;
   assert.equal(savedFile.suggestedFilename(),item.filename);assert.deepEqual(await readFile(await savedFile.path()),pdf);
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   const close=dialog.getByRole('button',{name:'ปิดตัวอย่าง'});const closeBounds=await close.boundingBox();assert.ok(closeBounds.width>=44&&closeBounds.height>=44);
   await page.screenshot({path:`${evidence}/${item.name}-preview-${width}.png`});
   await close.focus();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(opener).toBeFocused();
   // Closing during load must abort and must not spawn/reopen a preview later.
   gate=new Promise(r=>{release=r;});await opener.click();await expect(page.getByRole('dialog').getByRole('status')).toBeVisible();
   await page.getByRole('button',{name:'ปิดตัวอย่าง'}).click();release();gate=null;await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  // Active tax page uses authenticated transport, without changing ACCEPTED gating.
  await page.goto(origin+'/finance/e-tax');await page.locator('select').selectOption('finance-test');
  const invoice=page.getByRole('button',{name:'ดาวน์โหลด PDF CT-TEST-001 งวด 1'});await expect(invoice).toBeVisible();
  const invoiceFile=page.waitForEvent('download');await invoice.click();assert.deepEqual(await readFile(await (await invoiceFile).path()),pdf);
  // Report export: cancel in flight, reopen, then download the same binary response.
  await page.goto(origin+'/overdue');await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'วิเคราะห์',exact:true}).click();
  const reportButton=page.getByRole('button',{name:'ส่งออกรายงาน PDF'});await reportButton.click();
  gate=new Promise(r=>{release=r;});const beforeReport=pdfCount;
  await page.getByRole('dialog',{name:'ส่งออกรายงาน PDF',exact:true}).getByRole('button',{name:'ดาวน์โหลด',exact:true}).click();
  await expect.poll(()=>pdfCount).toBe(beforeReport+1);
  await expect(page.getByRole('dialog',{name:'ส่งออกรายงาน PDF',exact:true}).getByRole('button',{name:'ดาวน์โหลด',exact:true})).toBeDisabled();
  await page.screenshot({path:`${evidence}/report-loading-${width}.png`});
  await page.getByRole('dialog',{name:'ส่งออกรายงาน PDF',exact:true}).getByRole('button',{name:'ยกเลิก',exact:true}).click();release();gate=null;
  await reportButton.click();await expect(page.getByRole('dialog',{name:'ส่งออกรายงาน PDF',exact:true}).getByRole('button',{name:'ดาวน์โหลด',exact:true})).toBeEnabled();
  const reportFile=page.waitForEvent('download');await page.getByRole('dialog',{name:'ส่งออกรายงาน PDF',exact:true}).getByRole('button',{name:'ดาวน์โหลด',exact:true}).click();
  assert.deepEqual(await readFile(await (await reportFile).path()),pdf);await expect(page.getByRole('dialog',{name:'ส่งออกรายงาน PDF',exact:true})).toHaveCount(0);
  assert.equal(requests.at(-1).method,'POST');
  assert.ok(requests.every(r=>r.hasBearer));assert.ok(requests.every(r=>r.company));
  assert.deepEqual(errors,[]);results.push({width,passed:true,requests,errors});await page.close();
 }
 await writeFile(`${evidence}/browser-check.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
