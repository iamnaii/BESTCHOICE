import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { SalesController } from './sales.controller';
import { SalesReceiptPublicController } from './sales-receipt-public.controller';
import { SalesService } from './sales.service';
import { SaleVoidService } from './services/sale-void.service';
import { SaleReceiptLineService } from './services/sale-receipt-line.service';
import { SaleReceiptPdfService } from './services/sale-receipt-pdf.service';
import { SaleReceiptTokenService } from './services/sale-receipt-token.service';

/**
 * ใบเสร็จขายสด — route ของพนักงาน (PDF / แชร์ / LINE) และ route สาธารณะผ่าน token.
 */
const owner = { id: 'u1', role: 'OWNER', branchId: null };

function mockRes() {
  const res = { set: jest.fn(), send: jest.fn() };
  return res as unknown as Response & { set: jest.Mock; send: jest.Mock };
}

describe('SalesController — receipt routes', () => {
  let salesService: { findOne: jest.Mock };
  let receiptPdf: { generate: jest.Mock };
  let receiptTokens: { ensureToken: jest.Mock; publicUrl: jest.Mock; findSaleIdByToken: jest.Mock };
  let receiptLine: { send: jest.Mock };
  let controller: SalesController;

  beforeEach(() => {
    salesService = { findOne: jest.fn() };
    receiptPdf = { generate: jest.fn() };
    receiptTokens = {
      ensureToken: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: new Date('2026-11-22T00:00:00Z') }),
      publicUrl: jest.fn((t: string) => `https://app.example.com/r/${t}`),
      findSaleIdByToken: jest.fn(),
    };
    receiptLine = { send: jest.fn().mockResolvedValue({ delivered: true }) };
    controller = new SalesController(
      salesService as unknown as SalesService,
      {} as SaleVoidService,
      receiptPdf as unknown as SaleReceiptPdfService,
      receiptTokens as unknown as SaleReceiptTokenService,
      receiptLine as unknown as SaleReceiptLineService,
    );
  });

  it('GET :id/receipt.pdf streams the PDF inline with a Thai filename and no-store cache', async () => {
    receiptPdf.generate.mockResolvedValue({ pdf: Buffer.from('%PDF'), saleNumber: 'SL-1', voided: false });
    const res = mockRes();

    await controller.getReceiptPdf('s1', owner, res);

    expect(receiptPdf.generate).toHaveBeenCalledWith('s1', owner);
    const headers = res.set.mock.calls[0][0];
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toBe(`inline; filename="${encodeURIComponent('ใบเสร็จ-SL-1')}.pdf"`);
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });

  it('POST :id/receipt/share checks the sale through findOne first, then returns the public url', async () => {
    salesService.findOne.mockResolvedValue({ id: 's1', saleType: 'CASH', deletedAt: null });

    const result = await controller.shareReceipt('s1', owner);

    expect(salesService.findOne).toHaveBeenCalledWith('s1', owner);
    expect(receiptTokens.ensureToken).toHaveBeenCalledWith('s1');
    expect(result).toEqual({ url: 'https://app.example.com/r/tok', expiresAt: new Date('2026-11-22T00:00:00Z') });
  });

  it('POST :id/receipt/share refuses voided and installment sales without minting a token', async () => {
    salesService.findOne.mockResolvedValue({ id: 's1', saleType: 'CASH', deletedAt: new Date() });
    await expect(controller.shareReceipt('s1', owner)).rejects.toBeInstanceOf(BadRequestException);

    salesService.findOne.mockResolvedValue({ id: 's1', saleType: 'INSTALLMENT', deletedAt: null });
    await expect(controller.shareReceipt('s1', owner)).rejects.toBeInstanceOf(BadRequestException);

    expect(receiptTokens.ensureToken).not.toHaveBeenCalled();
  });

  it('POST :id/receipt/line delegates to the LINE service with the actor', async () => {
    await expect(controller.sendReceiptLine('s1', owner)).resolves.toEqual({ delivered: true });
    expect(receiptLine.send).toHaveBeenCalledWith('s1', owner);
  });
});

describe('SalesReceiptPublicController', () => {
  let receiptPdf: { generate: jest.Mock };
  let receiptTokens: { findSaleIdByToken: jest.Mock };
  let controller: SalesReceiptPublicController;

  beforeEach(() => {
    receiptPdf = { generate: jest.fn() };
    receiptTokens = { findSaleIdByToken: jest.fn() };
    controller = new SalesReceiptPublicController(
      receiptTokens as unknown as SaleReceiptTokenService,
      receiptPdf as unknown as SaleReceiptPdfService,
    );
  });

  it('answers unknown / expired / voided tokens with one generic 404', async () => {
    receiptTokens.findSaleIdByToken.mockResolvedValue(null);
    await expect(controller.getPublicPdf('nope', mockRes())).rejects.toMatchObject({
      constructor: NotFoundException,
      message: 'ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว',
    });
    expect(receiptPdf.generate).not.toHaveBeenCalled();
  });

  it('renders through the public path (no actor) when the token resolves', async () => {
    receiptTokens.findSaleIdByToken.mockResolvedValue('s1');
    receiptPdf.generate.mockResolvedValue({ pdf: Buffer.from('%PDF'), saleNumber: 'SL-1', voided: false });
    const res = mockRes();

    await controller.getPublicPdf('tok', res);

    expect(receiptPdf.generate).toHaveBeenCalledWith('s1', null);
    expect(res.set.mock.calls[0][0]['Content-Type']).toBe('application/pdf');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });
});
