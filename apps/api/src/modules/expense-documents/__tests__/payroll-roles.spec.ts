import { ForbiddenException } from '@nestjs/common';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { PAYROLL_FORBIDDEN_MSG, assertPayrollActor } from '../payroll-roles';

// คำตัดสินเจ้าของ 2026-10-28 — ผู้จัดการสาขาทำใบเงินเดือนไม่ได้ (สร้าง/แก้ = @Roles · ส่ง/อนุมัติ/ลงบัญชี/ยกเลิก/ลบ = facade)
describe('payroll roles — branch managers cannot act on PAYROLL', () => {
  it('assertPayrollActor lets owner / finance manager / accountant through and refuses the rest', () => {
    for (const role of ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']) expect(() => assertPayrollActor(role)).not.toThrow();
    for (const role of ['BRANCH_MANAGER', 'SALES', null, undefined]) {
      expect(() => assertPayrollActor(role)).toThrow(new ForbiddenException(PAYROLL_FORBIDDEN_MSG));
    }
  });

  function facade(documentType: string) {
    const prisma = { expenseDocument: { findFirst: jest.fn().mockResolvedValue({ documentType }) } };
    const lifecycle = {
      submitForApproval: jest.fn().mockResolvedValue('submitted'),
      post: jest.fn().mockResolvedValue('posted'),
      approve: jest.fn().mockResolvedValue('approved'),
      voidDocument: jest.fn().mockResolvedValue('voided'),
      softDelete: jest.fn().mockResolvedValue('deleted'),
    };
    const svc = new ExpenseDocumentsService(prisma as never, {} as never, lifecycle as never, {} as never);
    return { svc, lifecycle };
  }

  it.each([
    ['submitForApproval', (s: ExpenseDocumentsService) => s.submitForApproval('d1', 'u1', 'BRANCH_MANAGER')],
    ['post', (s: ExpenseDocumentsService) => s.post('d1', 'u1', 'BRANCH_MANAGER')],
    ['approve', (s: ExpenseDocumentsService) => s.approve('d1', 'u1', 'BRANCH_MANAGER')],
    ['voidDocument', (s: ExpenseDocumentsService) => s.voidDocument('d1', 'u1', {}, 'BRANCH_MANAGER')],
    ['softDelete', (s: ExpenseDocumentsService) => s.softDelete('d1', 'u1', 'BRANCH_MANAGER')],
  ])('%s on a PAYROLL document as BRANCH_MANAGER → 403 and the lifecycle is never called', async (name, call) => {
    const { svc, lifecycle } = facade('PAYROLL');
    await expect(call(svc)).rejects.toThrow(PAYROLL_FORBIDDEN_MSG);
    expect(lifecycle[name as keyof typeof lifecycle]).not.toHaveBeenCalled();
  });

  it('a branch manager still acts on ordinary expense documents', async () => {
    const { svc, lifecycle } = facade('EXPENSE_SAMEDAY');
    await expect(svc.post('d1', 'u1', 'BRANCH_MANAGER')).resolves.toBe('posted');
    expect(lifecycle.post).toHaveBeenCalled();
  });

  it('owner / accountant act on PAYROLL as before', async () => {
    const { svc } = facade('PAYROLL');
    await expect(svc.approve('d1', 'u1', 'OWNER')).resolves.toBe('approved');
    await expect(svc.submitForApproval('d1', 'u1', 'ACCOUNTANT')).resolves.toBe('submitted');
  });
});
