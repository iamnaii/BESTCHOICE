import { Reflector } from '@nestjs/core';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

/**
 * Phase 3 CN Task 5 — manual CN issue endpoint controller tests.
 *
 * 1. @Roles metadata on the new `issueCreditNote` handler (Reflector — no DB,
 *    no HTTP bootstrap needed; same lightweight pattern as
 *    dashboard.controller.spec.ts / other-income.controller.spec.ts).
 * 2. Delegation — the controller is a thin pass-through to
 *    `ReceiptsService.issueCreditNoteManually`, threading `dto.contractId`,
 *    `dto.source`, and the authenticated `user.id` (NOT a client-supplied
 *    actor id) into the call.
 */
describe('ReceiptsController — POST /receipts/credit-note/issue', () => {
  const reflector = new Reflector();

  it('@Roles restricts to OWNER, FINANCE_MANAGER, ACCOUNTANT — excludes BRANCH_MANAGER and SALES', () => {
    const handler = ReceiptsController.prototype.issueCreditNote;
    const roles = reflector.get<string[]>(ROLES_KEY, handler);

    expect(roles).toEqual(expect.arrayContaining(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']));
    expect(roles).not.toContain('BRANCH_MANAGER');
    expect(roles).not.toContain('SALES');
  });

  it('delegates to receiptsService.issueCreditNoteManually with the real actor id from @CurrentUser', async () => {
    const issueCreditNoteManually = jest
      .fn()
      .mockResolvedValue({ receiptId: 'receipt-1', receiptNumber: 'RT-202607-00001' });
    const receiptsService = { issueCreditNoteManually } as unknown as ReceiptsService;
    const controller = new ReceiptsController(receiptsService);

    const dto = { contractId: 'contract-1', source: 'REPOSSESSION' as const };
    const user = { id: 'user-1', role: 'FINANCE_MANAGER' };

    const result = await controller.issueCreditNote(dto, user);

    expect(issueCreditNoteManually).toHaveBeenCalledWith('contract-1', 'REPOSSESSION', 'user-1');
    expect(result).toEqual({ receiptId: 'receipt-1', receiptNumber: 'RT-202607-00001' });
  });
});
