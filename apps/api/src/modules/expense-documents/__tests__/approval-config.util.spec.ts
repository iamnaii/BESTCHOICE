import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  assertUserCanApprove,
  getApprovalRequiredDocTypes,
  getApproversList,
  getReverseReasons,
} from '../approval-config.util';

/**
 * Characterization spec for approval-config.util — pins the CURRENT behaviour
 * of the 4 free functions extracted out of ExpenseDocumentsService (slice E6).
 * Pure unit: tx is a mock with `systemConfig.findFirst` + `user.findMany`.
 */

type MockTx = {
  systemConfig: { findFirst: jest.Mock };
  user: { findMany: jest.Mock };
};

function makeTx(): MockTx {
  return {
    systemConfig: { findFirst: jest.fn() },
    user: { findMany: jest.fn() },
  };
}

// Cast the mock to the union type accepted by the util functions.
const asClient = (tx: MockTx) => tx as unknown as Prisma.TransactionClient | PrismaService;

describe('approval-config.util', () => {
  let tx: MockTx;

  beforeEach(() => {
    tx = makeTx();
  });

  describe('getApproversList', () => {
    it('returns [] when the SystemConfig row is missing', async () => {
      tx.systemConfig.findFirst.mockResolvedValue(null);
      await expect(getApproversList(asClient(tx))).resolves.toEqual([]);
      expect(tx.user.findMany).not.toHaveBeenCalled();
    });

    it('filters a valid JSON list to active/non-deleted users', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '["u1","u2"]' });
      // user.findMany returns only u1 (u2 inactive/deleted → filtered out by query)
      tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      await expect(getApproversList(asClient(tx))).resolves.toEqual(['u1']);
      expect(tx.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['u1', 'u2'] }, isActive: true, deletedAt: null },
        select: { id: true },
      });
    });

    it('returns [] on malformed JSON', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: 'not-json' });
      await expect(getApproversList(asClient(tx))).resolves.toEqual([]);
      expect(tx.user.findMany).not.toHaveBeenCalled();
    });

    it('returns [] when the parsed value is not an array', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '{"foo":"bar"}' });
      await expect(getApproversList(asClient(tx))).resolves.toEqual([]);
      expect(tx.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('assertUserCanApprove', () => {
    it('resolves for OWNER WITHOUT querying approvers (fast path)', async () => {
      await expect(
        assertUserCanApprove(asClient(tx), 'someone', 'OWNER'),
      ).resolves.toBeUndefined();
      expect(tx.systemConfig.findFirst).not.toHaveBeenCalled();
    });

    it('resolves for a non-OWNER user who is IN the approvers list', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '["u1"]' });
      tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      await expect(
        assertUserCanApprove(asClient(tx), 'u1', 'ACCOUNTANT'),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException with the exact Thai message when NOT in the list', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '["u1"]' });
      tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      await expect(
        assertUserCanApprove(asClient(tx), 'u2', 'ACCOUNTANT'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        assertUserCanApprove(asClient(tx), 'u2', 'ACCOUNTANT'),
      ).rejects.toThrow('ไม่มีสิทธิ์อนุมัติเอกสาร — ผู้ใช้นี้ไม่อยู่ในรายชื่อผู้อนุมัติ');
    });
  });

  describe('getApprovalRequiredDocTypes', () => {
    it("returns ['PAYROLL'] when the row is missing", async () => {
      tx.systemConfig.findFirst.mockResolvedValue(null);
      await expect(getApprovalRequiredDocTypes(asClient(tx))).resolves.toEqual(['PAYROLL']);
    });

    it('returns the valid list verbatim', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '["PAYROLL","EXPENSE"]' });
      await expect(getApprovalRequiredDocTypes(asClient(tx))).resolves.toEqual([
        'PAYROLL',
        'EXPENSE',
      ]);
    });

    it('filters out invalid enum values', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({
        value: '["EXPENSE","BOGUS","CREDIT_NOTE"]',
      });
      await expect(getApprovalRequiredDocTypes(asClient(tx))).resolves.toEqual([
        'EXPENSE',
        'CREDIT_NOTE',
      ]);
    });

    it("returns ['PAYROLL'] when all values are invalid", async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '["BOGUS","NOPE"]' });
      await expect(getApprovalRequiredDocTypes(asClient(tx))).resolves.toEqual(['PAYROLL']);
    });

    it("returns ['PAYROLL'] for an empty array", async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: '[]' });
      await expect(getApprovalRequiredDocTypes(asClient(tx))).resolves.toEqual(['PAYROLL']);
    });

    it("returns ['PAYROLL'] on malformed JSON", async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: 'not-json' });
      await expect(getApprovalRequiredDocTypes(asClient(tx))).resolves.toEqual(['PAYROLL']);
    });
  });

  describe('getReverseReasons', () => {
    it('returns the 6 canonical defaults when the row is missing', async () => {
      tx.systemConfig.findFirst.mockResolvedValue(null);
      const reasons = await getReverseReasons(asClient(tx));
      expect(reasons).toHaveLength(6);
      expect(reasons.map((r) => r.code)).toContain('data_entry_error');
    });

    it('returns a valid custom array verbatim', async () => {
      const custom = [{ code: 'oops', label: 'พิมพ์ผิด' }];
      tx.systemConfig.findFirst.mockResolvedValue({ value: JSON.stringify(custom) });
      await expect(getReverseReasons(asClient(tx))).resolves.toEqual(custom);
    });

    it('falls back to the 6 defaults on malformed JSON', async () => {
      tx.systemConfig.findFirst.mockResolvedValue({ value: 'not-json' });
      const reasons = await getReverseReasons(asClient(tx));
      expect(reasons).toHaveLength(6);
      expect(reasons.map((r) => r.code)).toContain('data_entry_error');
    });
  });
});
