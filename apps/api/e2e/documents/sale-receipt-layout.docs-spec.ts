import { Prisma } from '@prisma/client';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { embeddedDocumentFonts } from '../../src/assets/fonts/document-fonts';
import { DEFAULT_RECEIPT_WARRANTY_TERMS, formatDefaultWarrantyTerms } from '@installment/shared';
import { buildSaleReceiptHtml, toSaleReceiptModel, type SaleForReceipt } from '../../src/modules/sales/services/sale-receipt-html';

/**
 * ใบเสร็จขายสด (ก้อน 4) — ตัวแปลง Sale → model และตัวสร้าง HTML เป็นฟังก์ชันบริสุทธิ์
 * ตรวจด้วยสตริงตาม mockup `Receipt.dc.html` ที่เจ้าของเคาะ 2026-10-22.
 */
const D = (v: number | string) => new Prisma.Decimal(v);

const company = {
  nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด',
  address: '456/21 ถนนนารายณ์มหาราช ลพบุรี 15000',
  taxId: '0165568000050',
  phone: '036-411-999',
};

function cashSale(overrides: Partial<SaleForReceipt> = {}): SaleForReceipt {
  return {
    id: 's1',
    saleNumber: 'SL-20261022-0001',
    saleType: 'CASH',
    createdAt: new Date('2026-10-22T07:32:00Z'),
    // ตามโค้ดขายจริง: netAmount = sellingPrice − discount (ยังไม่หัก base เทิร์น) · cashDue = net − base = 22,900
    sellingPrice: D('31900'),
    discount: D('1000'),
    netAmount: D('30900'),
    paymentMethod: 'CASH',
    amountReceived: D('22900'),
    financeCompany: null,
    financeRefNumber: null,
    financeAmount: null,
    downPaymentAmount: null,
    bundleProductIds: ['b1', 'b2'],
    shopWarrantyStartDate: new Date('2026-10-22T00:00:00Z'),
    shopWarrantyEndDate: new Date('2026-10-29T00:00:00Z'),
    productDisclosure: {
      version: 1,
      deviceOrigin: 'THAI',
      shopWarrantyDays: 7,
      warrantyTerms: null,
    },
    tradeInCreditSnapshot: {
      version: 1,
      redemptionId: 'r1',
      tradeInId: 'ti1',
      voucherNumber: 'TI-20261022-0003',
      baseAmount: '8000.00',
      bonusAmount: '0.00',
      cashDownAmount: '22900.00',
      totalDownAmount: '30900.00',
    },
    deletedAt: null,
    voidReason: null,
    customer: { name: 'คุณสมหญิง ใจดี', phone: '089-999-9999', legacyMemberCode: 'C-00412' },
    product: {
      name: 'Apple iPhone 15 Pro Max 256GB ดำ',
      brand: 'Apple',
      model: 'iPhone 15 Pro Max',
      storage: '256GB',
      imeiSerial: '357200606382344',
      serialNumber: null,
      category: 'PHONE_USED',
    },
    branch: { name: 'ลพบุรี' },
    salesperson: { name: 'สมชาย ใจดี' },
    shopTenders: [
      { method: 'CASH', amount: D('5000'), reference: null, seq: 1 },
      { method: 'BANK_TRANSFER', amount: D('17900'), reference: '2510221432', seq: 2 },
    ],
    bundleProducts: [
      { name: 'เคสใส iPhone 15 Pro Max', imeiSerial: null, legacyProductCode: 'ACC-001' },
      { name: 'ฟิล์มกระจก', imeiSerial: null, legacyProductCode: null },
    ],
    receiptBreakdown: null,
    ...overrides,
  };
}

function financeSale(): SaleForReceipt {
  return cashSale({
    saleNumber: 'SL-20261022-0002',
    saleType: 'EXTERNAL_FINANCE',
    sellingPrice: D('41900'),
    discount: D('0'),
    netAmount: D('41900'),
    paymentMethod: 'BANK_TRANSFER',
    amountReceived: D('5000'),
    financeCompany: 'GFIN',
    financeRefNumber: 'GF-7781',
    financeAmount: D('36900'),
    downPaymentAmount: D('5000'),
    bundleProductIds: [],
    bundleProducts: [],
    tradeInCreditSnapshot: null,
    shopWarrantyStartDate: null,
    shopWarrantyEndDate: null,
    productDisclosure: {
      version: 1,
      deviceOrigin: 'THAI',
      shopWarrantyDays: 0,
      warrantyTerms: null,
    },
    product: {
      name: 'Samsung Galaxy S24 Ultra 512GB',
      brand: 'Samsung',
      model: 'Galaxy S24 Ultra',
      storage: '512GB',
      imeiSerial: '352099001761481',
      serialNumber: null,
      category: 'PHONE_NEW',
    },
    customer: { name: 'นายสมชาย รักดี', phone: '082-222-2222', legacyMemberCode: null },
    shopTenders: [{ method: 'BANK_TRANSFER', amount: D('5000'), reference: '2510221510', seq: 1 }],
  });
}

const ctx = {
  company,
  terms: DEFAULT_RECEIPT_WARRANTY_TERMS,
  qrDataUrl: 'data:image/png;base64,QR',
};

describe('sale receipt A4 rendering', () => {
  it('keeps six warranty clauses, bundled items, QR and signature on one A4 page at 16 pt', async () => {
    const used = cashSale({
      shopWarrantyEndDate: new Date('2026-12-21T00:00:00Z'),
      productDisclosure: {
        version: 1,
        deviceOrigin: 'THAI',
        shopWarrantyDays: 60,
        warrantyTerms: formatDefaultWarrantyTerms(DEFAULT_RECEIPT_WARRANTY_TERMS, 60),
      },
    });
    const qrDataUrl = await QRCode.toDataURL('https://example.invalid/receipt/synthetic');
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      for (const sale of [
        used,
        financeSale(),
        { ...used, deletedAt: new Date('2026-11-24'), voidReason: 'ตัวอย่างยกเลิก' },
      ]) {
        const page = await browser.newPage();
        const html = buildSaleReceiptHtml(
          toSaleReceiptModel(sale, { ...ctx, qrDataUrl }),
          embeddedDocumentFonts(),
        );
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.evaluate('document.fonts.ready');
        expect(
          await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize)),
        ).toBeCloseTo((16 * 96) / 72, 2);
        const pdf = await PDFDocument.load(
          await page.pdf({
            format: 'A4',
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            printBackground: true,
          }),
        );
        expect({
          variant: sale.deletedAt ? 'voided' : sale.saleType,
          pages: pdf.getPageCount(),
        }).toEqual({ variant: sale.deletedAt ? 'voided' : sale.saleType, pages: 1 });
        const { width, height } = pdf.getPage(0).getSize();
        expect(Math.abs(width - (210 * 72) / 25.4)).toBeLessThan(1);
        expect(Math.abs(height - (297 * 72) / 25.4)).toBeLessThan(1);
        const text = await page.evaluate(() => document.body.innerText);
        expect(text).not.toContain('ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม');
        expect(text).not.toContain('ไม่ใช่ใบกำกับภาษี');
        expect(text).not.toContain('ส่วนที่เหลือ');
        expect(text).not.toContain('ตามสัญญาของบริษัทไฟแนนซ์');
        expect(text).toContain('ออกโดยระบบ BESTCHOICE');
        expect(text).toContain('LINE @BESTCHOICE');
        expect(text).toContain('โทร 095-567-8887');
        expect(await page.$eval('.receipt-contact a', (link) => link.getAttribute('href'))).toBe(
          'https://line.me/R/ti/p/@bestchoice',
        );
        if (sale.product.category === 'PHONE_USED') {
          expect(text).toContain('1. ระยะเวลารับประกัน 60 วัน');
          expect(text).toContain('6. ระยะเวลาซ่อม 3–7 วันทำการ');
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 30000);
});
