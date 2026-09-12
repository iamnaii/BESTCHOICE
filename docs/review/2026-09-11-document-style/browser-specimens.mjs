import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const origin='http://localhost:5207';
const out='.tmp/document-style';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const date='2026-09-11T05:00:00Z';
const company={id:'preview-finance',companyCode:'FINANCE',nameTh:'บริษัท เบสท์ช้อยส์โฟน จำกัด',taxId:'0000000000000',address:'123 ถนนตัวอย่าง แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10000',phone:'0000000000',directorName:'ผู้ลงนาม ตัวอย่าง'};
const base={id:'specimen',number:'EXP-202609-00001',documentType:'EXPENSE',documentDate:date,vendorName:'ผู้จำหน่าย ตัวอย่าง',vendorTaxId:'0000000000000',subtotal:'1000',vatAmount:'70',withholdingTax:'30',whtFormType:'PND3',totalAmount:'1070',netPayment:'1040',status:'POSTED',expenseDetail:{lines:[]},journalLines:[]};
const rows=Array.from({length:16},(_,i)=>({lineNo:i+1,category:'ค่าใช้จ่าย',description:'รายละเอียดทดสอบการตัดบรรทัดในรายการเอกสาร',quantity:'1',unitPrice:'500',amountBeforeVat:'500',vatAmount:'35',whtAmount:'15',whtPercent:'3',supplierName:'ผู้จำหน่าย ตัวอย่าง'}));
const metrics=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`${origin}/contracts/9e8babd3-c27e-4ece-b451-10fcb242706a`);
 // Real client PDF generators, with fetches served by this checkout's Vite.
 const fonts='**/fonts/THSarabunPSK-Regular.ttf';
 await page.route(fonts,r=>r.fulfill({status:404,body:'missing'}));
 assert.equal(await page.evaluate(async()=>{
  const {generatePDF}=await import('/src/components/template-editor/pdf/pdfGenerator.ts');
  const {DEFAULT_SETTINGS}=await import('/src/types/template.ts');
  try{await generatePDF({blocks:[],settings:DEFAULT_SETTINGS});return false;}catch{return true;}
 }),true);
 await page.unroute(fonts);
 for(const long of (process.env.PRINT_ONLY ? [] : [false,true])) {
  const blobs=await page.evaluate(async ({long,company,date})=>{
   const {generatePDF}=await import('/src/components/template-editor/pdf/pdfGenerator.ts');
   const {DEFAULT_SETTINGS}=await import('/src/types/template.ts');
   const {renderLetterPdf}=await import('/src/pages/CollectionsPage/utils/letterPdfRenderer.ts');
   const template={id:'fixture',name:'ตัวอย่างทดสอบ',blocks:[{id:'h',type:'heading',content:'ตัวอย่างเอกสารมาตรฐาน'}, {id:'p',type:'paragraph',content:'เนื้อหาเอกสารสำหรับทดสอบขนาดตัวอักษรและการแบ่งหน้า '.repeat(long?450:12)},{id:'t',type:'payment-table',content:''}],settings:{...DEFAULT_SETTINGS,letterhead:'bestchoice'}};
   const result={template:await generatePDF(template)};
   for(const letterType of ['RETURN_DEVICE_45D','CONTRACT_TERMINATION_60D']) {
    result[letterType]=await renderLetterPdf({letterType,letterNumber:'LTR-202609-00001',letterDate:new Date(date),company:{...company,address:company.address.repeat(long?5:1)},customer:{name:'ลูกค้า ตัวอย่าง'},contract:{contractNumber:'CT-202609-00001',contractDate:new Date(date),outstanding:3150,daysOverdue:60},product:{brand:'Apple',model:'iPhone 15',storage:'128GB',color:'ดำ',imei:'000000000000001'},paymentSchedule:{totalMonths:12,monthlyPayment:1000,paymentDueDay:1,firstDueDate:new Date(date)},overdueDetail:{overdueMonths:['มิถุนายน 2569','กรกฎาคม 2569','สิงหาคม 2569'],overdueInstallments:3,principalAmount:3000,lateFeeAmount:150},coordinator:{name:'เจ้าหน้าที่ ทดสอบ',phone:'0000000000'}});
   }
   return Object.fromEntries(await Promise.all(Object.entries(result).map(async([k,blob])=>[k,Array.from(new Uint8Array(await blob.arrayBuffer()))])));
  },{long,company,date});
  for(const [key,bytes] of Object.entries(blobs))await writeFile(`${out}/browser-${key}-${long?'long':'normal'}.pdf`,Buffer.from(bytes));
 }
 await page.close();
 const fixtures=[
  ...['EXPENSE','PETTY_CASH_REIMBURSEMENT','PAYROLL'].map(type=>({name:`voucher-${type}`,url:'/expenses/specimen/voucher',api:'/expense-documents/specimen',data:{...base,documentType:type,expenseDetail:{lines:rows.slice(0,2)},payroll:{payrollPeriod:'2026-09',lines:[{id:'employee',employeeName:'พนักงาน ตัวอย่าง',employeeTaxId:'0000000000000',baseSalary:'20000',ssoEmployee:'750',whtAmount:'200',netPaid:'19050'}]}}})),
  {name:'voucher-long',url:'/expenses/specimen/voucher',api:'/expense-documents/specimen',data:{...base,expenseDetail:{lines:rows}}},
  {name:'goods-receipt',url:'/purchase-orders/specimen/goods-receivings/receiving/print',api:'/purchase-orders/specimen/goods-receivings/receiving',data:{id:'receiving',grNumber:'GR-202609-00001',createdAt:date,notes:'เอกสารทดสอบ',po:{id:'specimen',poNumber:'PO-202609-00001',supplier:{id:'vendor',name:'ผู้จำหน่าย ตัวอย่าง'}},receivedBy:{id:'actor',name:'ผู้ตรวจรับ ตัวอย่าง'},items:rows.slice(0,3).map((_,i)=>({id:String(i),status:'PASS',imeiSerial:`00000000000000${i}`,serialNumber:`BC-SN-000${i}`,poItem:{brand:'Apple',model:'iPhone 15',color:'ดำ',storage:'128GB'}}))}},
  {name:'expense-daily',url:'/expenses/daily-summary?branchId=preview',api:'/expense-documents/daily-summary',data:{date,branchId:'preview',branchName:'สาขาทดสอบ',documents:rows.map((_,i)=>({...base,id:String(i),number:`EXP-202609-${i}`,paymentMethod:'CASH'})),grandTotal:'17120',byType:{EXPENSE:{count:16,total:'17120'}},byPaymentMethod:{CASH:{count:16,total:'17120'}},byCategory:{'ค่าใช้จ่าย':{count:16,total:'17120'}},cashMovement:{'เงินสด':{out:'17120',count:16}}}},
  {name:'other-income-daily',url:'/other-income/daily-sheet',api:'/other-income/daily-sheet',data:{startDate:date,endDate:date,summary:{incomeGross:'16000',vat:'1120',wht:'480',netReceived:'17120',docCount:16},docs:rows.map((_,i)=>({...base,id:String(i),docNumber:`OI-202609-${i}`,receiptNo:`RT-202609-${i}`,issueDate:date,incomeGross:'1000',amountReceived:'1070',whtAmount:'30',counterpartyName:'ลูกค้า ตัวอย่าง',items:[{accountCode:'400100'}]})),byAccount:[{code:'400100',name:'รายได้อื่น',total:'16000',count:16}],byPayment:[{code:'111100',name:'เงินสด',total:'17120',count:16}]}},
  {name:'asset-register',url:'/assets/register',api:'/assets/register',data:{data:rows.map((_,i)=>({id:String(i),assetCode:`FA-202609-${i}`,name:'คอมพิวเตอร์สำนักงาน รุ่นทดสอบ',category:'EQUIPMENT',purchaseDate:date,purchaseCost:'20000',accumulatedDeprAt:'2000',netBookValueAt:'18000',remainingMonths:32,custodian:'ผู้ดูแล ตัวอย่าง',status:'ACTIVE'})),total:16,page:1,limit:50,asOfDate:date,summary:{count:16,totalPurchaseCost:'320000',totalAccumulatedDepr:'32000',totalNbv:'288000'}}},
  {name:'wht-annual',url:'/finance/wht-annual',api:'/tax/pnd1-annual-preview',data:{year:2026,items:[{employeeName:'พนักงาน ตัวอย่าง',employeeTaxId:'0000000000000',monthsPaid:12,grossTotal:'240000',whtTotal:'2400',ssoTotal:'9000'}],count:1,grossTotal:'240000',whtTotal:'2400',annualWageTotal:'240000'},certificate:true},
  {name:'dividend-register',url:'/finance/dividend-register',api:'/equity/dividend-register',data:{year:2026,rows:[{shareholderId:'holder',name:'ผู้ถือหุ้น ตัวอย่าง',taxId:'0000000000000',type:'INDIVIDUAL',payCount:1,gross:'10000',wht:'1000',net:'9000',docNumbers:['DV-202609-00001']}],totals:{gross:'10000',wht:'1000',net:'9000'}},certificate:true},
 ];
 for(const fixture of fixtures){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname.replace('/api/admin','').replace(/^\/api/,'');
   if(path===fixture.api)return route.fulfill({json:fixture.data});
   if(path==='/company')return route.fulfill({json:[company]});
   return route.continue();
  });
  await page.goto(origin+fixture.url);await page.locator('table').first().waitFor({timeout:30000});
  await page.evaluate('document.fonts.ready');
  await page.screenshot({path:`${out}/screen-${fixture.name}.png`,fullPage:true});
  await page.emulateMedia({media:'print'});
  await page.evaluate('document.fonts.ready');
  await page.pdf({path:`${out}/print-${fixture.name}.pdf`,format:'A4',preferCSSPageSize:true,printBackground:true});
  const sizes=await page.locator('td').evaluateAll(cells=>[...new Set(cells.map(c=>getComputedStyle(c).fontSize))]);
  metrics.push({name:fixture.name,errors,sizes});
  if(fixture.certificate){
   await page.emulateMedia({media:'screen'});
   await page.getByRole('button',{name:/50 ทวิ|หนังสือรับรอง/}).first().click();
   await page.locator('.document-sheet').waitFor();
   await page.screenshot({path:`${out}/screen-${fixture.name}-certificate.png`,fullPage:true});
   await page.emulateMedia({media:'print'});
  await page.evaluate('document.fonts.ready');
   await page.pdf({path:`${out}/print-${fixture.name}-certificate.pdf`,format:'A4',preferCSSPageSize:true,printBackground:true});
  }
  assert.deepEqual(errors,[]);assert.ok(sizes.every(size=>size==='21.3333px'));
  await page.close();
 }
 // Thermal labels use the same face while retaining their 50 x 30 mm type scale.
 const sticker=await browser.newPage();
 await sticker.route('**/api/admin/sticker-templates/products/data?*',r=>r.fulfill({json:[{productId:'specimen',brand:'Apple',model:'iPhone 15 Pro Max',color:'สีดำ',storage:'256GB',batteryHealth:95,warrantyExpireDate:'2027-09-11',imei:'000000000000001',cashPrice:32900,rate1:{downPayment:9900,monthlyPrice:2500,termMonths:12},rate2:{downPayment:5900,monthlyPrice:2900,termMonths:12},shopLogoUrl:null}]}));
 await sticker.goto(origin+'/stickers?productIds=specimen');
 await sticker.locator('.sticker').first().waitFor();
 await sticker.emulateMedia({media:'print'});
 await sticker.evaluate('document.fonts.ready');
 await sticker.pdf({path:`${out}/print-sticker.pdf`,preferCSSPageSize:true,printBackground:true});
 const labelFont=await sticker.locator('.print-stickers .st-model').evaluate(e=>getComputedStyle(e).fontFamily);
 assert.match(labelFont,/TH Sarabun PSK/);
 await sticker.close();
 await writeFile(`${out}/browser-metrics.json`,JSON.stringify(metrics,null,2));
 console.log(JSON.stringify(metrics));
} finally {await browser.close();}
