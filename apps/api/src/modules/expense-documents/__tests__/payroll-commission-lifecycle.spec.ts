/* eslint-disable @typescript-eslint/no-explicit-any */
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { PayrollPostGateService } from '../payroll-system/payroll-post-gate.service';

/**
 * Payroll D4 ส่วนที่ 2 · Task 4 — ลำดับล็อก + จุดเรียกในวงจรเอกสาร (client ปลอม — ทางเงินจริงอยู่ที่
 * payroll-commission-flow.integration.spec.ts):
 * - กลับรายการ: `post:` → `payroll-clawback:*` (เรียง ไม่ซ้ำ) → ตรวจงวด → รายการกลับ JE (ล็อกเลข JE) → releaseOnVoid → CAS สถานะ (P2-R1)
 * - ลงบัญชี: ด่าน → PayrollTemplate → markCommissionsPaid(วันที่เอกสาร) · audit POSTED มี commissionItemIds
 * - ลบร่างปล่อยรายการค่าคอมโดยไม่ต้องต่อด่าน (P2-R13) · กลับรายการใบที่มีพนักงานผูกโดยไม่ได้ต่อด่าน = ปฏิเสธ (ไม่ปล่อยผ่าน)
 * - ด่านอนุมัติ/ลงบัญชี: `payroll:` → `payroll-attendance:*` → `payroll-clawback:*`
 */

const DOC_DATE = new Date('2026-10-31T00:00:00.000Z');
const SEEN = '2026-11-02T03:00:00.000Z';

function build(o: { gate?: any; calls?: string[] } = {}) {
  const calls = o.calls ?? [];
  const doc = {
    id: 'pr-1',
    number: 'PR-20261031-0001',
    documentType: 'PAYROLL',
    status: 'POSTED',
    branchId: 'b1',
    deletedAt: null,
    journalEntryId: 'je-1',
    settlement: null,
    documentDate: DOC_DATE,
    updatedAt: new Date(SEEN),
    paymentMethod: 'BANK_TRANSFER',
    depositAccountCode: 'S11-1202',
    totalAmount: { toString: () => '16000.00' },
    withholdingTax: { toString: () => '0', gt: () => false },
    receiptImageUrl: null,
    whtFormType: null,
    createdById: 'owner',
  };
  const tx: any = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner', name: 'เจ้าของ', role: 'OWNER', branchId: null }) },
    $executeRawUnsafe: jest.fn(async (_sql: string, key: string) => {
      calls.push(key);
      return 0;
    }),
    $executeRaw: jest.fn(async (_s: TemplateStringsArray, key: string) => {
      calls.push(key);
      return 0;
    }),
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    expenseDocument: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(doc),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(async (args: any) => ({ ...doc, ...args.data })),
      updateMany: jest.fn(async () => {
        calls.push('status-cas');
        return { count: 1 };
      }),
    },
    payrollDetail: { findUnique: jest.fn().mockResolvedValue({ entityScope: 'SHOP', lines: [{ id: 'l1' }] }) },
    payrollLine: { findMany: jest.fn().mockResolvedValue([{ userId: 'u2' }, { userId: 'u1' }, { userId: 'u1' }]) },
    payrollCommissionItem: {
      findMany: jest.fn().mockResolvedValue([{ id: 'item-b' }, { id: 'item-a' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'shop-co' }) },
    accountingPeriod: {
      findUnique: jest.fn(async () => {
        calls.push('period-check');
        return null;
      }),
    },
    journalEntry: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'je-1', companyId: 'shop-co', lines: [] }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
  const journal = {
    createAndPost: jest.fn(async () => {
      calls.push('reversal-je');
      return { id: 'je-rev' };
    }),
  };
  const template = {
    execute: jest.fn(async () => {
      calls.push('payroll-template');
      return { entryNo: 'JE-202610-0001' };
    }),
  };
  const unexpected = { execute: jest.fn(async () => { throw new Error('unexpected template'); }) };
  const lifecycle = new ExpenseDocumentLifecycleService(
    prisma as never,
    new StatusTransitionService(),
    unexpected as never,
    unexpected as never,
    unexpected as never,
    template as never,
    unexpected as never,
    unexpected as never,
    unexpected as never,
    journal as never,
    undefined,
    undefined,
    undefined,
    o.gate,
  );
  return { lifecycle, tx, calls, doc, journal, template };
}

const recordingGate = (calls: string[]) => ({
  assertPostable: jest.fn(async () => {
    calls.push('gate');
  }),
  markCommissionsPaid: jest.fn(async () => {
    calls.push('mark-paid');
    return ['item-pay-1'];
  }),
  releaseOnVoid: jest.fn(async () => {
    calls.push('release-on-void');
    return ['item-pay-1', 'item-claw-1'];
  }),
});

describe('voidDocument (PAYROLL) — payroll-clawback locks right after post:, before the period check and the reversal JE', () => {
  it('post: → payroll-clawback:u1 → payroll-clawback:u2 → period check → reversal JE → releaseOnVoid → status CAS · audit lists the released items', async () => {
    const calls: string[] = [];
    const gate = recordingGate(calls);
    const made = build({ gate, calls });
    await made.lifecycle.voidDocument('pr-1', 'owner', { reasonCode: 'data_entry_error' });
    expect(calls).toEqual([
      'post:pr-1',
      'payroll-clawback:u1',
      'payroll-clawback:u2',
      'period-check',
      'reversal-je',
      'release-on-void',
      'status-cas',
    ]);
    expect(gate.releaseOnVoid).toHaveBeenCalledWith(made.tx, 'pr-1');
    const audit = made.tx.auditLog.create.mock.calls.find((c: any[]) => c[0].data.action === 'EXPENSE_VOIDED')[0];
    expect(audit.data.newValue).toMatchObject({ status: 'VOIDED', releasedCommissionItemIds: ['item-pay-1', 'item-claw-1'] });
  });

  it('gate not wired + a linked line → Error(PayrollSystemRowsService not wired) before any reversal (never fails open)', async () => {
    const made = build();
    await expect(made.lifecycle.voidDocument('pr-1', 'owner', { reasonCode: 'data_entry_error' })).rejects.toThrow('PayrollSystemRowsService not wired');
    expect(made.journal.createAndPost).not.toHaveBeenCalled();
    expect(made.tx.expenseDocument.updateMany).not.toHaveBeenCalled();
  });

  it('gate not wired + free-text lines only → voids as before (no commission items exist)', async () => {
    const made = build();
    made.tx.payrollDetail.findUnique.mockResolvedValue({ entityScope: 'SHOP', lines: [] });
    await made.lifecycle.voidDocument('pr-1', 'owner', { reasonCode: 'data_entry_error' });
    expect(made.tx.expenseDocument.updateMany).toHaveBeenCalled();
    const audit = made.tx.auditLog.create.mock.calls.find((c: any[]) => c[0].data.action === 'EXPENSE_VOIDED')[0];
    expect(audit.data.newValue).not.toHaveProperty('releasedCommissionItemIds');
  });
});

describe('post (PAYROLL) — markCommissionsPaid after the JE template, in the same tx', () => {
  it('gate → PayrollTemplate → markCommissionsPaid(documentDate) · POSTED audit carries commissionItemIds · returns the template result', async () => {
    const calls: string[] = [];
    const gate = recordingGate(calls);
    const made = build({ gate, calls });
    made.doc.status = 'APPROVED';
    const result = await made.lifecycle.post('pr-1', 'owner', undefined, { expectedUpdatedAt: SEEN });
    expect(result).toEqual({ entryNo: 'JE-202610-0001' });
    expect(calls).toEqual(['post:pr-1', 'period-check', 'gate', 'payroll-template', 'mark-paid']);
    // คำตัดสินเจ้าของ 2026-10-28 — วันที่จ่าย = วันที่กดลงบัญชี: ใบถูกประทับวันนี้ (เวลาไทย) ก่อนลงรายการ ค่าคอมจ่ายวันเดียวกัน
    const today = new Date(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10));
    const stamped = made.tx.expenseDocument.update.mock.calls.find((c: any[]) => c[0].data?.documentDate)?.[0].data.documentDate;
    expect(stamped).toEqual(today);
    expect(gate.markCommissionsPaid).toHaveBeenCalledWith(made.tx, 'pr-1', today);
    const audit = made.tx.auditLog.create.mock.calls.find((c: any[]) => c[0].data.action === 'POSTED')[0];
    expect(audit.data.newValue).toEqual({ postedById: 'owner', commissionItemIds: ['item-pay-1'] });
  });
});

describe('softDelete (PAYROLL) — releases the draft\'s commission items with no gate wired (P2-R13)', () => {
  it('releases every live item of the document and lists them in the DELETED audit', async () => {
    const made = build();
    made.doc.status = 'DRAFT';
    await made.lifecycle.softDelete('pr-1', 'owner');
    expect(made.tx.payrollCommissionItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { releasedAt: null, payrollLine: { payroll: { documentId: 'pr-1' } } } }),
    );
    expect(made.tx.payrollCommissionItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['item-b', 'item-a'] }, releasedAt: null },
      data: { releasedAt: expect.any(Date) },
    });
    const audit = made.tx.auditLog.create.mock.calls[0][0];
    expect(audit.data).toMatchObject({ action: 'DELETED', newValue: { releasedCommissionItemIds: ['item-b', 'item-a'] } });
  });
});

describe('PayrollPostGateService.assertPostable — lock order', () => {
  it('payroll: → payroll-attendance:* → payroll-clawback:* (sorted, de-duplicated) before any check', async () => {
    const calls: string[] = [];
    const tx: any = {
      $executeRaw: jest.fn(async (_s: TemplateStringsArray, key: string) => {
        calls.push(key);
        return 0;
      }),
      payrollDetail: {
        findUnique: jest.fn().mockResolvedValue({
          payrollPeriod: '2026-10',
          entityScope: 'SHOP',
          document: { branchId: 'b1' },
          lines: [
            { userId: 'u2', employeeName: 'บี', customIncome: [], customDeduction: [], commissionItems: [] },
            { userId: 'u1', employeeName: 'เอ', customIncome: [], customDeduction: [], commissionItems: [] },
          ],
        }),
      },
      attendanceDay: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const compute = jest.fn(async () => {
      calls.push('compute');
      return {
        attendanceAccountCodes: [],
        commissionAccountCodes: [],
        rows: ['u2', 'u1'].map((userId) => ({ userId, systemIncome: [], systemDeductions: [], commissionItems: [], notes: { review: [], warnings: [] } })),
      };
    });
    const gate = new PayrollPostGateService({ compute } as never);
    await gate.assertPostable(tx, 'pr-1', new Date('2026-11-02T03:00:00.000Z'));
    expect(calls).toEqual([
      'payroll:b1:2026-10:SHOP',
      'payroll-attendance:u1:2026-10',
      'payroll-attendance:u2:2026-10',
      'payroll-clawback:u1',
      'payroll-clawback:u2',
      'compute',
    ]);
  });
});
