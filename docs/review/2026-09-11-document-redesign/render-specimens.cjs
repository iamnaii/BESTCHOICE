/** Synthetic data only; no DB/client is constructed. Run with TS_NODE_PROJECT=apps/api/tsconfig.json node -r ts-node/register/transpile-only this-file. */
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const api = f => require(path.join(root, 'apps/api/src', f));
const { Prisma } = require('@prisma/client');
const D = n => new Prisma.Decimal(n);
const puppeteer = require('puppeteer');
const out = path.join(root, '.tmp/document-style');
fs.mkdirSync(out, { recursive: true });
process.env.PUPPETEER_EXECUTABLE_PATH ||= puppeteer.executablePath();
const { embeddedDocumentFonts } = api('assets/fonts/document-fonts');
const { DocumentRenderingService } = api('modules/contracts/services/document-rendering.service');
const { ContractTemplateService } = api('modules/contracts/services/contract-template.service');
const { VoucherHtmlBuilder } = api('modules/trade-in/services/voucher/voucher-html.builder');
const { LetterPdfService } = api('modules/overdue/letter-pdf.service');
const { ReceiptPdfService } = api('modules/receipts/services/receipt-pdf.service');
const { OtherIncomeReceiptPdfService } = api('modules/other-income/services/receipt-pdf.service');
const { ExpenseVoucherPdfService } = api('modules/expense-documents/services/expense-voucher-pdf.service');
const { AssetReceiptPdfService } = api('modules/asset/services/asset-receipt-pdf.service');
const { ETaxService } = api('modules/e-tax/e-tax.service');
const { PdfReportService } = api('modules/reporting/pdf-report.service');
const date = new Date('2026-09-11T05:00:00Z');
const company = { nameTh:'บริษัท เบสท์ช้อยส์โฟน จำกัด', taxId:'0000000000000', address:'123 ถนนตัวอย่าง แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10000',phone:'0000000000', directorName:'ผู้ลงนาม ตัวอย่าง', directorPosition:'กรรมการผู้มีอำนาจ' };
const actor = { name:'เจ้าหน้าที่ ทดสอบ',email:'example@example.invalid' };
const base = { id:'specimen',createdBy:actor,approvedBy:actor,postedBy:actor,status:'POSTED',branch:{name:'สาขาทดสอบ'},documentDate:date,paidAt:date,issueDate:date,purchaseDate:date,paymentDate:date,number:'EXP-202609-00001',docNo:'AST-202609-00001',docNumber:'OI-202609-00001',receiptNo:'RT-202609-00001',vendorName:'ผู้ขาย ตัวอย่าง',counterpartyName:'ลูกค้า ตัวอย่าง',supplierName:'ผู้จำหน่าย ทดสอบ',subtotal:D(1000),incomeGross:D(1000),vatAmount:D(70),whtAmount:D(30),withholdingTax:D(30),totalAmount:D(1070),netPayment:D(1040),amountReceived:D(1070),basePrice:D(1000),shippingCost:D(0),installationCost:D(0),otherCapitalized:D(0),purchaseCost:D(1000),usefulLifeMonths:36,hasVat:true,name:'คอมพิวเตอร์สำนักงาน รุ่นตัวอย่าง',assetCode:'FA-2026-001',category:'EQUIPMENT',paymentMethod:'TRANSFER',paymentAccountCode:'111100',expenseDetail:{lines:[]},items:[] };
const builder = new VoucherHtmlBuilder();
const rendering = new DocumentRenderingService(null,null,null);
const templates = new ContractTemplateService(null);
const report = [];
(async()=>{
 const browser = await puppeteer.launch({headless:true,args:['--no-sandbox']});
 async function htmlPdf(name,html) {
  const page=await browser.newPage();
  try {
   await page.emulateMediaType('print');
   await page.setContent(html.replace('</head>',`<style>${embeddedDocumentFonts()}</style></head>`),{waitUntil:'domcontentloaded'});
   await page.evaluate('document.fonts.ready');
   const metrics=await page.evaluate(()=>{
    const body=document.body.getBoundingClientRect();
    const text=[...document.querySelectorAll('p,td,th,h1,h2,.doc-title,.party-name')].filter(e=>e.textContent?.trim());
    return {fonts:[...new Set(text.map(e=>getComputedStyle(e).fontFamily))],sizes:[...new Set(text.map(e=>getComputedStyle(e).fontSize))],overflow:text.filter(e=>e.getBoundingClientRect().right>body.right+1||e.scrollWidth>e.clientWidth+2).slice(0,10).map(e=>e.textContent.slice(0,80))};
   });
   fs.writeFileSync(path.join(out,`${name}.html`),html);
   await page.pdf({path:path.join(out,`${name}.pdf`),format:'A4',preferCSSPageSize:true,printBackground:true});
   report.push({name,...metrics});
  } finally {await page.close();}
 }
 try {
 for(const long of [false,true]) {
  const suffix=long?'long':'normal';
  const address=long?company.address.repeat(5):company.address;
  const co={...company,address};
  const description=long?'รายละเอียดรายการและเงื่อนไขการรับสินค้าเพื่อทดสอบการตัดบรรทัด '.repeat(3):'รายละเอียดรายการทดสอบ';
  const rows=Array.from({length:long?16:2},(_,i)=>({quantity:D(1),unitAmount:D(500),unitPrice:D(500),discount:D(0),discountAmount:D(0),vatPct:D(7),amountBeforeVat:D(500),accountName:`รายการทดสอบ ${i+1}`,accountCode:'400100',category:'ค่าใช้จ่าย',description}));
  await htmlPdf(`other-income-${suffix}`,await new OtherIncomeReceiptPdfService(null).renderHtml({...base,items:rows,counterpartyAddress:address},co,{name:'ธนาคารตัวอย่าง'}));
  await htmlPdf(`expense-${suffix}`,await new ExpenseVoucherPdfService(null).renderHtml({...base,expenseDetail:{lines:rows},description},co));
  await htmlPdf(`asset-${suffix}`,await new AssetReceiptPdfService(null).renderHtml({...base,note:description},co));
  for (const method of ['CASH', 'TRADE_IN_CREDIT']) await htmlPdf(`trade-in-${method}-${suffix}`,builder.buildHtml({voucherNumber:'EXP-20260900001',voucherDate:date,isReprint:long,company:co,sellerName:'ผู้ขาย ตัวอย่าง',sellerAddress:address,sellerPhone:'0000000000',sellerIdCard:'0000000000000',issuerName:actor.name,deviceLabel:'Apple iPhone 15\nสีดำ IMEI 000000000000001\nSerial Number BC-SN-000001',amount:18500.25,amountText:builder.numberToThaiBahtText(18500.25),paymentMethod:method,sellerDeclarationText:method==='TRADE_IN_CREDIT'?require('@installment/shared').TRADE_IN_DECLARATION_TEXT:undefined}));
  let pdpa=templates.getDefaultTemplate('PDPA_CONSENT');
  const vars={customer_name:'ลูกค้า ตัวอย่าง',national_id:'0000000000000',customer_address:address,contract_number:'CT-202609-00001',contract_date:'11 กันยายน 2569',customer_phone:'0000000000',branch_name:'สาขาทดสอบ',branch_phone:'0000000000',pdpa_signature:'........................',staff_signature:'........................',pdpa_consent_date:'11 กันยายน 2569',salesperson_name:actor.name};
  pdpa=pdpa.replace(/\{(\w+)\}/g,(_,key)=>vars[key]||key);
  await htmlPdf(`pdpa-${suffix}`,rendering.wrapWithA4Styles(pdpa));
  for(const type of ['RETURN_DEVICE_45D','CONTRACT_TERMINATION_60D']) {
   const data={letterType:type,letterNumber:'LTR-202609-00001',letterDate:'11 กันยายน 2569',company:co,customer:{name:'ลูกค้า ตัวอย่าง'},contract:{contractNumber:'CT-202609-00001',contractDateThai:'1 มกราคม 2569',totalMonths:12,monthlyPayment:1000,paymentDueDay:1,firstDueDateThai:'1 กุมภาพันธ์ 2569'},product:{brand:'Apple',model:'iPhone 15',storage:'128GB',color:'ดำ',imei:'000000000000001'},overdue:{firstMonth:'มิถุนายน 2569',monthsJoined:long?'มิถุนายน 2569, กรกฎาคม 2569, สิงหาคม 2569':'มิถุนายน 2569',installments:3,principal:3000,lateFee:150,total:3150,totalWords:'สามพันหนึ่งร้อยห้าสิบบาทถ้วน'},coordinator:{name:actor.name,phone:'0000000000'}};
   await htmlPdf(`letter-${type}-${suffix}`,new LetterPdfService(null,null).renderHtml(data));
   fs.writeFileSync(path.join(out,`letter-data-${suffix}.json`),JSON.stringify(data));
  }
  const payment={id:'00000000-0000-0000-0000-000000000001',paidDate:date,installmentNo:1,contract:{contractNumber:'CT-202609-00001',customer:{name:'ลูกค้า ตัวอย่าง',nationalId:'0000000000000',addressIdCard:address}}};
  fs.writeFileSync(path.join(out,`e-tax-${suffix}.pdf`),new ETaxService(null).buildInvoicePdf({payment,issuer:co,base:D(1000),vat:D(70),total:D(1070)}));
  for(const type of ['PAYMENT','DOWN_PAYMENT','CREDIT_NOTE','EARLY_PAYOFF','RESCHEDULE_FEE']) {
   const receipt={id:'specimen',receiptNumber:'RT-202609-00001',receiptType:type,payerName:'ลูกค้า ตัวอย่าง',receiverName:co.nameTh,payerAddress:address,payerTaxId:'0000000000000',amount:D(1070),amountBeforeVat:D(1000),vatAmount:D(70),installmentNo:1,paymentId:null,voidedReceiptId:null,paidDate:date,isVoided:false,paymentMethod:'CASH',transactionRef:null,remainingBalance:null,remainingMonths:null,paymentStatus:'PAID',priorReceiptCount:0,voidedRef:null,payment:null,issuer:actor,company:co,contract:{contractNumber:'CT-202609-00001',totalMonths:12,financedAmount:D(10000),storeCommission:D(1000),interestTotal:D(6000),vatAmount:D(1190),customer:{name:'ลูกค้า ตัวอย่าง',phone:'0000000000'},branch:null,product:null}};
   fs.writeFileSync(path.join(out,`receipt-${type}-${suffix}.pdf`),await new ReceiptPdfService({getReceipt:async()=>receipt}).generatePDF('specimen'));
  }
 }
 const analytics={weeklyCollectionRate:[{dueCount:5,paidCount:4}],promiseKeptTrend:[{weekStart:'2026-09-01',kept:7,broken:2}],dunningActionVolume:[{sent:11,failed:1}],letterDispatchByType:[{type:'RETURN_DEVICE_45D',month:'2026-09',count:3}]};
 fs.writeFileSync(path.join(out,'report.pdf'),await new PdfReportService(null,{getAnalytics:async()=>analytics},{getAgingBuckets:async()=>[{bucket:'8-30',count:5,outstanding:12000}]},{getLeaderboard:async()=>[{name:'เจ้าหน้าที่ทดสอบภาษาไทย',contractsHandled:12,amountCollected:'34000'}]},{getRecoveryByChannel:async()=>[{channel:'LINE',sent:10,recovered:7,rate:0.7}]},{getStuckContracts:async()=>Array.from({length:20},(_,i)=>({contractNumber:`CT-202609-${i}`,daysStuck:14,customerName:'ลูกค้าชื่อยาว ทดสอบการแบ่งหน้ารายงาน',status:'OVERDUE'}))}).generate({from:date,to:date}));
 fs.writeFileSync(path.join(out,'html-metrics.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.map(r=>({name:r.name,overflow:r.overflow})),null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
