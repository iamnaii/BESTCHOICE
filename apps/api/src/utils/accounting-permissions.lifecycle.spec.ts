import { ForbiddenException } from '@nestjs/common';
import { makeExpenseDocumentsService } from '../modules/expense-documents/__tests__/support/make-expense-documents-service';
import { OtherIncomeService } from '../modules/other-income/other-income.service';

const EXPENSE_ACTIONS = ['post', 'approve', 'voidDocument'] as const;
const INCOME_ACTIONS = ['post', 'approve', 'reverse'] as const;

function fixture(role = 'ACCOUNTANT', permissions: string[] = []) {
  const actor = { id: 'actor', name: 'ผู้ทำรายการ', role, branchId: 'b1' };
  const doc = {
    id: 'doc',
    status: 'DRAFT',
    documentType: 'EXPENSE',
    branchId: 'b1',
    createdById: 'maker',
    deletedAt: null,
  };
  const db: any = {
    user: { findFirst: jest.fn().mockResolvedValue(actor) },
    systemConfig: {
      findFirst: jest.fn(async ({ where }) => {
        if (where.key === 'accounting_permissions')
          return { value: JSON.stringify({ actor: permissions }) };
        if (where.key === 'auto_post_on_approve') return { value: 'false' };
        return null;
      }),
      findUnique: jest.fn().mockResolvedValue({ value: 'true' }),
    },
    $executeRawUnsafe: jest.fn().mockResolvedValue([]),
    expenseDocument: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(doc),
      update: jest.fn().mockResolvedValue(doc),
    },
    otherIncome: {
      findFirst: jest.fn().mockResolvedValue(doc),
      findUnique: jest.fn().mockResolvedValue(doc),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = jest.fn((fn) => fn(db));
  const expense = makeExpenseDocumentsService({ prisma: db });
  const template = { post: jest.fn() };
  const income = new OtherIncomeService(
    db,
    {} as never,
    {} as never,
    {} as never,
    template as never,
    {} as never,
    {} as never,
    { log: jest.fn() } as never,
  );
  return { actor, doc, db, expense, income, template };
}

describe('accounting lifecycle identity boundaries', () => {
  it.each(EXPENSE_ACTIONS)(
    'expense %s cannot bypass permission by omitting the old role argument',
    async (action) => {
      const f = fixture();
      const call =
        action === 'voidDocument'
          ? f.expense.service.voidDocument('doc', 'actor')
          : f.expense.service[action]('doc', 'actor');
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.db.expenseDocument.update).not.toHaveBeenCalled();
      expect(f.expense.sameDayTemplate.execute).not.toHaveBeenCalled();
    },
  );

  it.each(EXPENSE_ACTIONS)('expense %s ignores a forged legacy OWNER role', async (action) => {
    const f = fixture();
    const call =
      action === 'voidDocument'
        ? f.expense.service.voidDocument('doc', 'actor', {}, 'OWNER')
        : f.expense.service[action]('doc', 'actor', 'OWNER');
    await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.db.expenseDocument.update).not.toHaveBeenCalled();
  });

  it.each(EXPENSE_ACTIONS)(
    'assigned branch manager cannot %s another branch document',
    async (action) => {
      const f = fixture('BRANCH_MANAGER', ['EXPENSE_POST', 'EXPENSE_APPROVE', 'EXPENSE_CANCEL']);
      f.doc.branchId = 'b2';
      const call =
        action === 'voidDocument'
          ? f.expense.service.voidDocument('doc', 'actor', {}, 'OWNER')
          : f.expense.service[action]('doc', 'actor', 'OWNER');
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.db.expenseDocument.update).not.toHaveBeenCalled();
      expect(f.expense.sameDayTemplate.execute).not.toHaveBeenCalled();
      expect(f.expense.journal.createAndPost).not.toHaveBeenCalled();
    },
  );

  // กลับด้านจากเดิมโดยตั้งใจ (คำตัดสินเจ้าของ 2026-09-11) — เวอร์ชัน #1542 ชื่อ
  // "…preserves existing own-document approval policy" ปักไว้ว่า ACCOUNTANT อนุมัติใบที่
  // ตัวเองสร้างได้ เพราะ approve() ไม่เคยมีด่านนี้ (มีแค่ปุ่มบนจอที่ซ่อนไว้ ซึ่ง #1542 ก็ถอดออก)
  // เจ้าของเคาะว่าอนุมัติใบตัวเองได้เฉพาะ "ระดับผู้จัดการขึ้นไป" และฝ่ายบัญชีไม่นับ
  // (packages/shared/src/accounting-self-approval.ts) — ยังใช้ actor จริงจาก DB เหมือนเดิม
  // (ส่ง role 'VIEWER' ปลอมมาก็ไม่มีผล)
  it('expense approval uses the actual actor — an accountant cannot approve their own document', async () => {
    const f = fixture('ACCOUNTANT', ['EXPENSE_APPROVE']);
    f.doc.status = 'PENDING_APPROVAL';
    f.doc.createdById = f.actor.id;
    await expect(f.expense.service.approve('doc', f.actor.id, 'VIEWER')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.db.expenseDocument.update).not.toHaveBeenCalled();
    expect(f.expense.sameDayTemplate.execute).not.toHaveBeenCalled();
  });

  it.each(['FINANCE_MANAGER', 'BRANCH_MANAGER'])(
    'expense approval lets an assigned %s approve their own document',
    async (role) => {
      const f = fixture(role, ['EXPENSE_APPROVE']);
      f.doc.status = 'PENDING_APPROVAL';
      f.doc.createdById = f.actor.id;
      await f.expense.service.approve('doc', f.actor.id, 'VIEWER');
      expect(f.db.expenseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', approvedById: f.actor.id }),
        }),
      );
    },
  );

  it.each(INCOME_ACTIONS)(
    'income %s denies an ordinary accountant without assignment',
    async (action) => {
      const f = fixture();
      const call =
        action === 'reverse'
          ? f.income.reverse('doc', { reason: 'INPUT_ERROR', note: 'ทดสอบคืนรายการ' }, f.actor.id)
          : f.income[action]('doc', {}, f.actor.id);
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.db.otherIncome.update).not.toHaveBeenCalled();
      expect(f.db.otherIncome.updateMany).not.toHaveBeenCalled();
      expect(f.template.post).not.toHaveBeenCalled();
    },
  );

  it.each(INCOME_ACTIONS)(
    'income %s remains unavailable to a branch manager even with an old assignment',
    async (action) => {
      const f = fixture('BRANCH_MANAGER', ['INCOME_POST', 'INCOME_APPROVE', 'INCOME_CANCEL']);
      const call =
        action === 'reverse'
          ? f.income.reverse('doc', { reason: 'INPUT_ERROR', note: 'ทดสอบคืนรายการ' }, f.actor.id)
          : f.income[action]('doc', {}, f.actor.id);
      await expect(call).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.template.post).not.toHaveBeenCalled();
    },
  );

  it('income approval retains maker/checker separation despite an explicit approval grant', async () => {
    const f = fixture('ACCOUNTANT', ['INCOME_APPROVE']);
    f.doc.status = 'READY';
    f.doc.createdById = f.actor.id;
    await expect(f.income.approve('doc', {}, f.actor.id)).rejects.toMatchObject({
      response: { errors: [expect.objectContaining({ rule: 'V9' })] },
    });
    expect(f.db.otherIncome.updateMany).not.toHaveBeenCalled();
    expect(f.template.post).not.toHaveBeenCalled();
  });
});
