import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReceiptIssuanceService } from './receipt-issuance.service';

/**
 * Phase 3 Task 5 — resend routing (POST /receipts/:id/send-line →
 * receipt-issuance.service.ts sendReceiptToCustomer). An auto-issued ใบลดหนี้
 * (Credit Note) must resend over the FINANCE channel via
 * CreditNoteDeliveryService, NOT the SHOP-channel sendPaymentReceipt path
 * used by ordinary receipts.
 */
describe('ReceiptIssuanceService.sendReceiptToCustomer — CN resend routing', () => {
  function buildService(opts: {
    receipt: Record<string, unknown> | null;
    cnDeliverMock?: jest.Mock;
    lineOaSendMock?: jest.Mock;
    withCnDelivery?: boolean;
    withLineOa?: boolean;
  }) {
    const prisma = {
      receipt: {
        findUnique: jest.fn().mockResolvedValue(opts.receipt),
      },
    };
    const lineOaService = opts.withLineOa === false
      ? undefined
      : { sendPaymentReceipt: opts.lineOaSendMock ?? jest.fn().mockResolvedValue(true) };
    const cnDelivery = opts.withCnDelivery === false
      ? undefined
      : { deliver: opts.cnDeliverMock ?? jest.fn().mockResolvedValue({ delivered: true }) };

    const numbers = { generateReceiptNumber: jest.fn() } as never;
    const svc = new ReceiptIssuanceService(prisma as never, lineOaService as never, numbers, cnDelivery as never);
    return { svc, prisma, lineOaService, cnDelivery };
  }

  it('(d) CREDIT_NOTE receipt with cnSource set → routes to CreditNoteDeliveryService.deliver, not sendPaymentReceipt', async () => {
    const { svc, cnDelivery, lineOaService } = buildService({
      receipt: {
        id: 'r1',
        receiptType: 'CREDIT_NOTE',
        cnSource: 'WRITE_OFF',
        deletedAt: null,
        contract: { customerId: 'cust-1' },
      },
    });

    const result = await svc.sendReceiptToCustomer('r1');

    expect(result).toEqual({ success: true });
    expect(cnDelivery!.deliver).toHaveBeenCalledWith('r1');
    expect(lineOaService!.sendPaymentReceipt).not.toHaveBeenCalled();
  });

  it('non-CN receipt (cnSource null) → unchanged, routes to sendPaymentReceipt (SHOP channel)', async () => {
    const { svc, cnDelivery, lineOaService } = buildService({
      receipt: {
        id: 'r2',
        receiptType: 'PAYMENT',
        cnSource: null,
        deletedAt: null,
        contract: { customerId: 'cust-1' },
      },
    });

    const result = await svc.sendReceiptToCustomer('r2');

    expect(result).toEqual({ success: true });
    expect(lineOaService!.sendPaymentReceipt).toHaveBeenCalledWith('cust-1', expect.objectContaining({ id: 'r2' }));
    expect(cnDelivery!.deliver).not.toHaveBeenCalled();
  });

  it('CN receipt but CreditNoteDeliveryService not wired → throws BadRequestException', async () => {
    const { svc } = buildService({
      receipt: { id: 'r3', receiptType: 'CREDIT_NOTE', cnSource: 'REPOSSESSION', deletedAt: null },
      withCnDelivery: false,
    });

    await expect(svc.sendReceiptToCustomer('r3')).rejects.toThrow(BadRequestException);
  });

  it('CN receipt where deliver() resolves { delivered: false } → throws BadRequestException', async () => {
    const { svc } = buildService({
      receipt: { id: 'r4', receiptType: 'CREDIT_NOTE', cnSource: 'WRITE_OFF', deletedAt: null },
      cnDeliverMock: jest.fn().mockResolvedValue({ delivered: false }),
    });

    await expect(svc.sendReceiptToCustomer('r4')).rejects.toThrow(BadRequestException);
  });

  it('unknown receipt id → NotFoundException', async () => {
    const { svc } = buildService({ receipt: null });

    await expect(svc.sendReceiptToCustomer('missing')).rejects.toThrow(NotFoundException);
  });

  it('soft-deleted receipt → NotFoundException', async () => {
    const { svc } = buildService({
      receipt: { id: 'r5', receiptType: 'PAYMENT', cnSource: null, deletedAt: new Date() },
    });

    await expect(svc.sendReceiptToCustomer('r5')).rejects.toThrow(NotFoundException);
  });
});
