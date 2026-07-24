import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReceiptsPublicController } from './receipts-public.controller';
import { ReceiptsService } from './receipts.service';

/**
 * Token-gated public CN PDF endpoint — NO JwtAuthGuard/RolesGuard/BranchGuard
 * on this controller (see class-doc comment on ReceiptsPublicController for
 * why it had to be a separate controller). Every negative case must collapse
 * to the SAME 404 message so the response never confirms whether a given
 * token ever existed (no oracle for token-guessing / enumeration).
 */
describe('ReceiptsPublicController', () => {
  let controller: ReceiptsPublicController;
  let receiptsService: { findByPublicToken: jest.Mock; generatePDF: jest.Mock };

  const NOT_FOUND_MSG = 'ไม่พบเอกสาร หรือลิงก์หมดอายุแล้ว';
  const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const buildRes = () => {
    const headers: Record<string, string> = {};
    return {
      set: jest.fn((h: Record<string, string>) => Object.assign(headers, h)),
      send: jest.fn(),
      __headers: headers,
    };
  };

  beforeEach(async () => {
    receiptsService = {
      findByPublicToken: jest.fn(),
      generatePDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ReceiptsPublicController],
      providers: [{ provide: ReceiptsService, useValue: receiptsService }],
    }).compile();

    controller = moduleRef.get(ReceiptsPublicController);
  });

  it('valid, non-expired token → 200 pdf buffer + correct headers', async () => {
    receiptsService.findByPublicToken.mockResolvedValue({
      id: 'rcpt-cn-1',
      receiptNumber: 'RT-202607-00099',
      publicTokenExpiresAt: FUTURE,
    });
    const res = buildRes();

    await controller.getPublicCreditNotePdf('good-token', res as never);

    expect(receiptsService.findByPublicToken).toHaveBeenCalledWith('good-token');
    expect(receiptsService.generatePDF).toHaveBeenCalledWith('rcpt-cn-1');
    expect(res.__headers['Content-Type']).toBe('application/pdf');
    expect(res.__headers['Content-Disposition']).toContain('inline; filename=');
    expect(res.__headers['Content-Disposition']).toContain(
      encodeURIComponent('ใบลดหนี้-RT-202607-00099.pdf'),
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-fake'));
  });

  it('expired token → 404 with the generic no-leak message', async () => {
    receiptsService.findByPublicToken.mockResolvedValue({
      id: 'rcpt-cn-1',
      receiptNumber: 'RT-202607-00099',
      publicTokenExpiresAt: PAST,
    });
    const res = buildRes();

    await expect(
      controller.getPublicCreditNotePdf('expired-token', res as never),
    ).rejects.toThrow(NotFoundException);
    await expect(
      controller.getPublicCreditNotePdf('expired-token', res as never),
    ).rejects.toThrow(NOT_FOUND_MSG);
    expect(receiptsService.generatePDF).not.toHaveBeenCalled();
  });

  it('unknown token → 404 with the generic no-leak message', async () => {
    receiptsService.findByPublicToken.mockResolvedValue(null);
    const res = buildRes();

    await expect(
      controller.getPublicCreditNotePdf('bogus-token', res as never),
    ).rejects.toThrow(NotFoundException);
    await expect(
      controller.getPublicCreditNotePdf('bogus-token', res as never),
    ).rejects.toThrow(NOT_FOUND_MSG);
    expect(receiptsService.generatePDF).not.toHaveBeenCalled();
  });

  it('non-CN receipt (cnSource null) → 404 — findByPublicToken already filters it out to null', async () => {
    // ReceiptQueryService.findByPublicToken scopes the lookup to cnSource != null;
    // an ordinary receipt (which never even carries a publicToken in practice)
    // resolves to null exactly like an unknown token — the controller has no
    // way to distinguish the two, which is the point (no oracle).
    receiptsService.findByPublicToken.mockResolvedValue(null);
    const res = buildRes();

    await expect(
      controller.getPublicCreditNotePdf('non-cn-token', res as never),
    ).rejects.toThrow(NotFoundException);
    await expect(
      controller.getPublicCreditNotePdf('non-cn-token', res as never),
    ).rejects.toThrow(NOT_FOUND_MSG);
  });

  it('never logs the raw token — only the resolved receipt id after lookup', async () => {
    receiptsService.findByPublicToken.mockResolvedValue({
      id: 'rcpt-cn-2',
      receiptNumber: 'RT-202607-00100',
      publicTokenExpiresAt: FUTURE,
    });
    const res = buildRes();
    const logSpy = jest
      .spyOn((controller as unknown as { logger: { log: (msg: string) => void } }).logger, 'log')
      .mockImplementation(() => undefined);

    await controller.getPublicCreditNotePdf('super-secret-token-value', res as never);

    expect(logSpy).toHaveBeenCalled();
    const loggedMessages = logSpy.mock.calls.map((c) => String(c[0]));
    expect(loggedMessages.some((m) => m.includes('rcpt-cn-2'))).toBe(true);
    expect(loggedMessages.some((m) => m.includes('super-secret-token-value'))).toBe(false);
  });
});
