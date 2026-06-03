import { Test } from '@nestjs/testing';
import { AssetController } from '../asset.controller';
import { AssetService } from '../asset.service';
import { AssetTransferService } from '../asset-transfer.service';
import { AssetReceiptPdfService } from '../services/asset-receipt-pdf.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { BranchGuard } from '../../auth/guards/branch.guard';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * ใบรับสินทรัพย์ (Asset Goods-Receipt Voucher) PDF — controller delegation test.
 * Mirrors the expense voucher controller spec: asserts the endpoint forwards to
 * AssetReceiptPdfService.generate() and sets the PDF response headers. No real
 * puppeteer is launched (the service is fully mocked).
 */
describe('AssetController — receipt PDF', () => {
  let controller: AssetController;
  let receiptPdf: { generate: jest.Mock };

  beforeEach(async () => {
    receiptPdf = { generate: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AssetController],
      providers: [
        { provide: AssetService, useValue: {} },
        { provide: AssetTransferService, useValue: {} },
        { provide: AssetReceiptPdfService, useValue: receiptPdf },
        // ReversePermissionGuard (method-level on reverse/reverseDispose) needs
        // PrismaService — provide a minimal stub so the module compiles.
        { provide: PrismaService, useValue: { systemConfig: { findFirst: jest.fn() } } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BranchGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AssetController);
  });

  it('GET /:id/receipt.pdf delegates to AssetReceiptPdfService + sets PDF headers', async () => {
    const headers: Record<string, string> = {};
    const res = {
      set: jest.fn((h: Record<string, string>) => {
        Object.assign(headers, h);
      }),
      send: jest.fn(),
    };
    await controller.getReceiptPdf('asset-1', res as never);
    expect(receiptPdf.generate).toHaveBeenCalledWith('asset-1');
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toBe('inline; filename="asset-receipt-asset-1.pdf"');
    expect(headers['Content-Length']).toBe(Buffer.from('%PDF-fake').length.toString());
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-fake'));
  });
});
