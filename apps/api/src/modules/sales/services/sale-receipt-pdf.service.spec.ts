import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_RECEIPT_WARRANTY_TERMS } from '@installment/shared';
import * as puppeteer from 'puppeteer';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaleReceiptPdfService } from './sale-receipt-pdf.service';
import { SaleReceiptTokenService } from './sale-receipt-token.service';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../../../assets/fonts/document-fonts', () => ({ embeddedDocumentFonts: () => '/* fonts */' }));

/**
 * PDF ใบเสร็จขายสด — ขอบเขตสาขาตามผู้เรียก, ใบยกเลิกดูได้เฉพาะพนักงาน (ลายน้ำ), ผ่อนชำระไม่เข้า,
 * ข้อความประกันจากตั้งค่า, token ต่ออายุทุกครั้งที่ออกเอกสาร.
 */
describe('SaleReceiptPdfService.generate', () => {
  const D = (v: string) => new Prisma.Decimal(v);
  const baseSale = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    saleNumber: 'SL-20261022-0001',
    saleType: 'CASH',
    createdAt: new Date('2026-10-22T07:32:00Z'),
    sellingPrice: D('9000'), discount: D('0'), netAmount: D('9000'), paymentMethod: 'CASH', amountReceived: D('9000'),
    financeCompany: null, financeRefNumber: null, financeAmount: null, downPaymentAmount: null,
    bundleProductIds: [], shopWarrantyStartDate: null, shopWarrantyEndDate: null,
    productDisclosure: null, tradeInCreditSnapshot: null, deletedAt: null, voidReason: null,
    customer: { name: 'ลูกค้า', phone: '0', legacyMemberCode: null },
    product: { name: 'iPhone', brand: 'Apple', model: 'iPhone', storage: null, imeiSerial: '1', serialNumber: null, category: 'PHONE_NEW' },
    branch: { name: 'ลพบุรี' },
    salesperson: { name: 'สมชาย' },
    shopTenders: [],
    booking: null,
    ...overrides,
  });

  let setContent: jest.Mock;
  let prisma: {
    sale: { findFirst: jest.Mock };
    product: { findMany: jest.Mock };
    companyInfo: { findFirst: jest.Mock };
    systemConfig: { findUnique: jest.Mock };
  };
  let tokens: { ensureToken: jest.Mock; publicUrl: jest.Mock };
  let service: SaleReceiptPdfService;

  beforeEach(() => {
    setContent = jest.fn();
    (puppeteer.launch as jest.Mock).mockResolvedValue({
      newPage: async () => ({ setContent, evaluate: jest.fn(), pdf: async () => Buffer.from('%PDF-1.4 test') }),
      close: jest.fn(),
    });
    prisma = {
      sale: { findFirst: jest.fn() },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      companyInfo: { findFirst: jest.fn().mockResolvedValue({ nameTh: 'บริษัท เบสท์ช้อยส์โฟน จำกัด', address: 'ลพบุรี', taxId: '0165568000050', phone: '036-411-999' }) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    tokens = {
      ensureToken: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: new Date(Date.now() + 1000) }),
      publicUrl: jest.fn((t: string) => `http://localhost:5173/r/${t}`),
    };
    service = new SaleReceiptPdfService(prisma as unknown as PrismaService, tokens as unknown as SaleReceiptTokenService);
  });

  const owner = { id: 'u1', role: 'OWNER', branchId: null };

  it('rejects installment sales — those use the contract receipt', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale({ saleType: 'INSTALLMENT' }));
    await expect(service.generate('s1', owner)).rejects.toBeInstanceOf(BadRequestException);
    expect(tokens.ensureToken).not.toHaveBeenCalled();
  });

  it('scopes a SALES actor to their own branch and returns 404 when the sale is elsewhere', async () => {
    prisma.sale.findFirst.mockResolvedValue(null);
    await expect(service.generate('s1', { id: 'u2', role: 'SALES', branchId: 'A' })).rejects.toBeInstanceOf(NotFoundException);
    const where = prisma.sale.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"branchId":"A"');
  });

  it('public path (no actor) never serves a voided sale', async () => {
    prisma.sale.findFirst.mockResolvedValue(null);
    await expect(service.generate('s1', null)).rejects.toBeInstanceOf(NotFoundException);
    const where = prisma.sale.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"deletedAt":null');
    expect(JSON.stringify(where)).not.toContain('branchId');
  });

  it('staff path renders a voided sale with the watermark, keeps the old token and never mints a new one', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale({ deletedAt: new Date('2026-10-23T01:00:00Z'), voidReason: 'คีย์ผิด', receiptToken: 'old-token' }));
    tokens.ensureToken.mockRejectedValue(new NotFoundException('ไม่พบใบขาย')); // ของจริง: ensureToken กรอง deletedAt
    const result = await service.generate('s1', owner);
    expect(result.voided).toBe(true);
    expect(result.saleNumber).toBe('SL-20261022-0001');
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(setContent.mock.calls[0][0]).toContain('ยกเลิกเมื่อ');
    expect(tokens.ensureToken).not.toHaveBeenCalled();
    expect(tokens.publicUrl).toHaveBeenCalledWith('old-token');
  });

  it('staff path on a voided sale that never had a token prints no QR block', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale({ deletedAt: new Date('2026-10-23T01:00:00Z'), voidReason: 'คีย์ผิด', receiptToken: null }));
    tokens.ensureToken.mockRejectedValue(new NotFoundException('ไม่พบใบขาย'));
    const result = await service.generate('s1', owner);
    expect(result.voided).toBe(true);
    expect(tokens.ensureToken).not.toHaveBeenCalled();
    expect(setContent.mock.calls[0][0]).not.toContain('สแกนเพื่อเปิดใบเสร็จ');
  });

  it('public path reads the existing token and does not extend its expiry', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale({ receiptToken: 'live-token', receiptTokenExpiresAt: new Date(Date.now() + 86_400_000) }));
    const result = await service.generate('s1', null);
    expect(result.voided).toBe(false);
    expect(tokens.ensureToken).not.toHaveBeenCalled();
    expect(tokens.publicUrl).toHaveBeenCalledWith('live-token');
    expect(setContent.mock.calls[0][0]).toContain('สแกนเพื่อเปิดใบเสร็จ');
  });

  it('reads the SHOP company, default warranty terms and refreshes the public token once', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    const result = await service.generate('s1', owner);
    expect(result.voided).toBe(false);
    expect(prisma.companyInfo.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyCode: 'SHOP' }) }));
    expect(tokens.ensureToken).toHaveBeenCalledTimes(1);
    expect(tokens.ensureToken).toHaveBeenCalledWith('s1');
    const html = setContent.mock.calls[0][0] as string;
    expect(html).toContain(DEFAULT_RECEIPT_WARRANTY_TERMS);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('/* fonts */');
  });

  it('uses the configured warranty terms when the setting row exists', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale());
    prisma.systemConfig.findUnique.mockResolvedValue({ key: 'receipt_shop_warranty_terms', value: ' ประกันร้านตามใบรับประกันแนบ ' });
    await service.generate('s1', owner);
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'receipt_shop_warranty_terms' } }));
    const html = setContent.mock.calls[0][0] as string;
    expect(html).toContain('ประกันร้านตามใบรับประกันแนบ');
    expect(html).not.toContain(DEFAULT_RECEIPT_WARRANTY_TERMS);
  });

  it('loads bundle products for the freebie rows', async () => {
    prisma.sale.findFirst.mockResolvedValue(baseSale({ bundleProductIds: ['b1'] }));
    prisma.product.findMany.mockResolvedValue([{ id: 'b1', name: 'เคสใส', imeiSerial: null, legacyProductCode: 'ACC-1' }]);
    await service.generate('s1', owner);
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ['b1'] } }) }));
    expect(setContent.mock.calls[0][0]).toContain('เคสใส');
  });
});
