import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IntercoSettlementController } from './interco-settlement.controller';
import { IntercoSettlementService } from './interco-settlement.service';
import { IntercoPendingService } from './interco-pending.service';

/**
 * IntercoSettlementController — roles matrix (spec §6/§9 + plan Task 5 table)
 * + functional delegation to the (mocked) service layer. The heavy lifting
 * (drift guard, SoD, paired JE) is covered by
 * `interco-settlement.service.spec.ts` (unit) and
 * `__tests__/interco-settlement.integration.spec.ts` (DB) — this spec only
 * proves the HTTP surface wires role guards + params through correctly.
 */
describe('IntercoSettlementController', () => {
  const reflector = new Reflector();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingService: any;
  let controller: IntercoSettlementController;

  const methodRoles = (methodName: string): string[] | undefined => {
    const handler = (IntercoSettlementController.prototype as unknown as Record<string, unknown>)[
      methodName
    ];
    if (typeof handler !== 'function') return undefined;
    return reflector.get<string[]>(ROLES_KEY, handler as () => void);
  };

  beforeEach(() => {
    service = {
      listBatches: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
      getBatch: jest.fn().mockResolvedValue({ id: 'b-1' }),
      createBatch: jest.fn().mockResolvedValue({ id: 'b-1' }),
      updateBatch: jest.fn().mockResolvedValue({ id: 'b-1' }),
      submitBatch: jest.fn().mockResolvedValue({ id: 'b-1', status: 'PENDING_APPROVAL' }),
      withdrawBatch: jest.fn().mockResolvedValue({ id: 'b-1', status: 'DRAFT' }),
      cancelBatch: jest.fn().mockResolvedValue({ id: 'b-1', status: 'CANCELLED' }),
      approveBatch: jest.fn().mockResolvedValue({ id: 'b-1', status: 'POSTED' }),
      reverseBatch: jest.fn().mockResolvedValue({ id: 'b-1', status: 'REVERSED' }),
      uploadSlip: jest.fn().mockResolvedValue({ id: 'b-1', slipFileKey: 'interco-slips/b-1/x' }),
      settleRecallCash: jest
        .fn()
        .mockResolvedValue({ financeEntryNo: 'JE-1', shopEntryNo: 'JE-2', deduped: false }),
    };
    pendingService = {
      getPendingContracts: jest.fn().mockResolvedValue([{ contractId: 'c-1' }]),
      getPendingRecalls: jest.fn().mockResolvedValue([{ contractId: 'c-recall' }]),
      getReconcileTotals: jest.fn().mockResolvedValue({ pendingTotal: 0, drift: 0 }),
    };
    controller = new IntercoSettlementController(
      service as unknown as IntercoSettlementService,
      pendingService as unknown as IntercoPendingService,
    );
  });

  describe('roles matrix', () => {
    it.each([
      ['pending', ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']],
      ['list', ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']],
      ['getOne', ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']],
      ['create', ['ACCOUNTANT', 'FINANCE_MANAGER']],
      ['update', ['ACCOUNTANT', 'FINANCE_MANAGER']],
      ['submit', ['ACCOUNTANT', 'FINANCE_MANAGER']],
      ['withdraw', ['ACCOUNTANT', 'FINANCE_MANAGER']],
      ['cancel', ['ACCOUNTANT', 'FINANCE_MANAGER']],
      ['approve', ['OWNER', 'FINANCE_MANAGER']],
      ['reverse', ['OWNER', 'FINANCE_MANAGER']],
      ['uploadSlip', ['ACCOUNTANT', 'FINANCE_MANAGER']],
      ['settleRecallCash', ['OWNER', 'FINANCE_MANAGER']],
    ])('%s() exposes exactly the expected roles', (methodName, expectedRoles) => {
      const roles = methodRoles(methodName);
      expect(roles).toBeDefined();
      expect(roles).toEqual(expect.arrayContaining(expectedRoles));
      expect(roles).toHaveLength(expectedRoles.length);
    });

    it('read endpoints (pending/list/getOne) do NOT allow SALES', () => {
      for (const m of ['pending', 'list', 'getOne']) {
        expect(methodRoles(m)).not.toContain('SALES');
      }
    });

    it('maker endpoints (create/update/submit/withdraw/cancel/slip) do NOT allow OWNER-only bypass of SoD — OWNER is absent, checker-only actions stay separate', () => {
      for (const m of ['create', 'update', 'submit', 'withdraw', 'cancel', 'uploadSlip']) {
        expect(methodRoles(m)).not.toContain('OWNER');
      }
    });

    it('checker endpoints (approve/reverse/settleRecallCash) do NOT allow ACCOUNTANT (maker role only)', () => {
      for (const m of ['approve', 'reverse', 'settleRecallCash']) {
        expect(methodRoles(m)).not.toContain('ACCOUNTANT');
      }
    });
  });

  describe('pending()', () => {
    it('combines getPendingContracts + getPendingRecalls + getReconcileTotals into { pending, recalls, reconcile }', async () => {
      const result = await controller.pending();
      expect(pendingService.getPendingContracts).toHaveBeenCalledTimes(1);
      expect(pendingService.getPendingRecalls).toHaveBeenCalledTimes(1);
      expect(pendingService.getReconcileTotals).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        pending: [{ contractId: 'c-1' }],
        recalls: [{ contractId: 'c-recall' }],
        reconcile: { pendingTotal: 0, drift: 0 },
      });
    });
  });

  describe('list()', () => {
    it('parses valid page/limit query params', () => {
      controller.list('DRAFT', '2', '10');
      expect(service.listBatches).toHaveBeenCalledWith({ status: 'DRAFT', page: 2, limit: 10 });
    });

    it('drops invalid/garbage page/limit to undefined instead of NaN', () => {
      controller.list(undefined, 'abc', '-5');
      expect(service.listBatches).toHaveBeenCalledWith({
        status: undefined,
        page: undefined,
        limit: undefined,
      });
    });
  });

  describe('create() / update()', () => {
    it('create() passes dto + userId through', async () => {
      const dto = { contractIds: ['c-1'], transferDate: '2026-07-30' } as never;
      await controller.create(dto, 'user-1');
      expect(service.createBatch).toHaveBeenCalledWith(dto, 'user-1');
    });

    it('update() passes id + dto + userId through', async () => {
      const dto = { contractIds: ['c-1'], transferDate: '2026-07-30' } as never;
      await controller.update('b-1', dto, 'user-1');
      expect(service.updateBatch).toHaveBeenCalledWith('b-1', dto, 'user-1');
    });
  });

  describe('lifecycle actions', () => {
    it('submit()/withdraw()/cancel() pass id + userId through', async () => {
      await controller.submit('b-1', 'user-1');
      expect(service.submitBatch).toHaveBeenCalledWith('b-1', 'user-1');
      await controller.withdraw('b-1', 'user-1');
      expect(service.withdrawBatch).toHaveBeenCalledWith('b-1', 'user-1');
      await controller.cancel('b-1', 'user-1');
      expect(service.cancelBatch).toHaveBeenCalledWith('b-1', 'user-1');
    });
  });

  describe('approve()', () => {
    it('converts a provided postedAt string to a Date', async () => {
      await controller.approve('b-1', { postedAt: '2026-08-01' }, 'approver-1');
      expect(service.approveBatch).toHaveBeenCalledWith('b-1', 'approver-1', new Date('2026-08-01'));
    });

    it('passes undefined when postedAt is omitted (service falls back to transferDate)', async () => {
      await controller.approve('b-1', {}, 'approver-1');
      expect(service.approveBatch).toHaveBeenCalledWith('b-1', 'approver-1', undefined);
    });
  });

  describe('reverse()', () => {
    it('passes id + userId + reason through', async () => {
      await controller.reverse('b-1', { reason: 'ยกเลิกเพราะยอดผิด' }, 'approver-1');
      expect(service.reverseBatch).toHaveBeenCalledWith('b-1', 'approver-1', 'ยกเลิกเพราะยอดผิด');
    });
  });

  describe('settleRecallCash()', () => {
    it('passes contractId + dto + userId through to the service', async () => {
      const dto = {
        amount: 3000,
        financeDepositAccountCode: '11-1201',
        requestId: '3f1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      } as never;
      await controller.settleRecallCash('c-recall', dto, 'approver-1');
      expect(service.settleRecallCash).toHaveBeenCalledWith('c-recall', dto, 'approver-1');
    });
  });

  describe('uploadSlip()', () => {
    it('passes id + file + userId through to the service (maker/status guard lives in the service)', async () => {
      const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'slip.jpg' } as Express.Multer.File;
      await controller.uploadSlip('b-1', 'maker-1', file);
      expect(service.uploadSlip).toHaveBeenCalledWith('b-1', file, 'maker-1');
    });
  });
});
