import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { StatusTransitionService } from '../services/status-transition.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Payroll D4 ส่วนที่ 1 · R20 (FX2) — อนุมัติ / ลงบัญชีต้องเป็นฉบับที่ผู้กดเห็น (`expectedUpdatedAt` = `updatedAt` ตอนหน้าวาด)
 * ใบ PAYROLL: ไม่ส่ง / ไม่ตรง ⇒ 409 DOCUMENT_CHANGED ใต้ล็อก `post:${id}` ก่อนด่านใบเงินเดือน — ไม่เปลี่ยนสถานะ ไม่มี JE
 * ใบอื่น: ไม่บังคับ — เทียบเฉพาะเมื่อส่งมา
 */

const SEEN = '2026-11-02T03:15:20.123Z';
const CHANGED = '2026-11-02T03:16:01.456Z';
const APPROVE_CHANGED = {
  code: 'DOCUMENT_CHANGED',
  message: 'ใบนี้ถูกแก้ไขหลังจากที่คุณเปิดดู — โหลดหน้านี้ใหม่ ตรวจยอดอีกครั้ง แล้วกด อนุมัติและลงบัญชี',
};
const POST_CHANGED = {
  code: 'DOCUMENT_CHANGED',
  message: 'ใบนี้ถูกแก้ไขหลังจากที่คุณเปิดดู — โหลดหน้านี้ใหม่ ตรวจยอดอีกครั้ง แล้วกด บันทึกและลงบัญชี',
};

function setup(doc: { documentType: string; status: string; updatedAt: string }) {
  const row = {
    id: 'doc-1',
    number: 'PR-20261031-0001',
    branchId: 'b1',
    createdById: 'maker-1',
    deletedAt: null,
    paymentMethod: 'BANK_TRANSFER',
    depositAccountCode: 'S11-1202',
    totalAmount: new Decimal('16500.00'),
    withholdingTax: new Decimal('0'),
    whtFormType: null,
    receiptImageUrl: null,
    documentDate: new Date('2026-10-31T00:00:00.000Z'),
    ...doc,
    updatedAt: new Date(doc.updatedAt),
  };
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'owner-1', name: 'เจ้าของ', role: 'OWNER', branchId: null }) },
    systemConfig: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
    expenseDocument: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      update: jest.fn().mockResolvedValue(row),
    },
    payrollDetail: { findUnique: jest.fn().mockResolvedValue({ entityScope: 'SHOP' }) },
    companyInfo: { findFirst: jest.fn().mockResolvedValue({ id: 'shop-co' }) },
    accountingPeriod: { findUnique: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const template = () => ({ execute: jest.fn().mockResolvedValue({ entryNo: 'JE-1' }) });
  const templates = { sameDay: template(), accrual: template(), creditNote: template(), payroll: template() };
  const gate = { assertPostable: jest.fn().mockResolvedValue(undefined), assertSubmittable: jest.fn(), inspect: jest.fn() };
  const lifecycle = new ExpenseDocumentLifecycleService(
    prisma,
    new StatusTransitionService(),
    templates.sameDay as never,
    templates.accrual as never,
    templates.creditNote as never,
    templates.payroll as never,
    template() as never,
    template() as never,
    template() as never,
    { createAndPost: jest.fn() } as never,
    undefined,
    undefined,
    { updatePayrollInTx: jest.fn() } as never,
    gate as never,
  );
  return { prisma, templates, gate, lifecycle };
}

async function conflictOf(p: Promise<unknown>) {
  const err = await p.then(
    () => { throw new Error('expected a 409'); },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ConflictException);
  return (err as ConflictException).getResponse();
}

describe('approve / post require the version the approver saw (R20 FX2)', () => {
  describe('PAYROLL approve', () => {
    it('a different expectedUpdatedAt → 409 DOCUMENT_CHANGED · no gate, no status change, no JE', async () => {
      const { prisma, templates, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'PENDING_APPROVAL', updatedAt: CHANGED });
      expect(await conflictOf(lifecycle.approve('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN }))).toEqual(APPROVE_CHANGED);
      // ใต้ล็อก post:${id} — ล็อกก่อนอ่านใบ
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'post:doc-1');
      expect(gate.assertPostable).not.toHaveBeenCalled();
      expect(prisma.expenseDocument.update).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      expect(templates.payroll.execute).not.toHaveBeenCalled();
    });

    it('missing expectedUpdatedAt → 409 DOCUMENT_CHANGED', async () => {
      const { prisma, templates, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'PENDING_APPROVAL', updatedAt: SEEN });
      expect(await conflictOf(lifecycle.approve('doc-1', 'owner-1', 'OWNER'))).toEqual(APPROVE_CHANGED);
      expect(gate.assertPostable).not.toHaveBeenCalled();
      expect(prisma.expenseDocument.update).not.toHaveBeenCalled();
      expect(templates.payroll.execute).not.toHaveBeenCalled();
    });

    it('a malformed expectedUpdatedAt counts as different', async () => {
      const { lifecycle } = setup({ documentType: 'PAYROLL', status: 'PENDING_APPROVAL', updatedAt: SEEN });
      expect(await conflictOf(lifecycle.approve('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: 'not-a-date' }))).toEqual(APPROVE_CHANGED);
    });

    it('the same expectedUpdatedAt → gate, APPROVED, auto-posted', async () => {
      const { prisma, templates, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'PENDING_APPROVAL', updatedAt: SEEN });
      await lifecycle.approve('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN });
      expect(gate.assertPostable).toHaveBeenCalledWith(prisma, 'doc-1', expect.any(Date));
      expect(prisma.expenseDocument.update).toHaveBeenCalledWith({ where: { id: 'doc-1' }, data: { status: 'APPROVED', approvedById: 'owner-1' } });
      expect(templates.payroll.execute).toHaveBeenCalledWith('doc-1', prisma);
    });
  });

  describe('R23 — the version check runs after the approval-workflow and status checks (still before the payroll gate)', () => {
    it('a DRAFT payroll with approval on and no token → 400 "ต้องผ่านการอนุมัติก่อน" (not 409), nothing written', async () => {
      const { prisma, templates, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'DRAFT', updatedAt: SEEN });
      prisma.systemConfig.findFirst.mockImplementation(async ({ where }: { where: { key: string } }) =>
        where.key === 'approval_enabled' ? { value: 'true' } : null,
      );
      const err = await lifecycle.post('doc-1', 'owner-1', 'OWNER').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toContain('ต้องผ่านการอนุมัติก่อน');
      expect(gate.assertPostable).not.toHaveBeenCalled();
      expect(prisma.expenseDocument.update).not.toHaveBeenCalled();
      expect(templates.payroll.execute).not.toHaveBeenCalled();
    });

    it('approve of a payroll that is no longer PENDING_APPROVAL (sent back to DRAFT) with a stale token → the status error, not 409', async () => {
      const { prisma, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'DRAFT', updatedAt: CHANGED });
      const err = await lifecycle.approve('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(ConflictException);
      expect(gate.assertPostable).not.toHaveBeenCalled();
      expect(prisma.expenseDocument.update).not.toHaveBeenCalled();
    });

    it('post of a POSTED payroll with a stale token → the status error, not 409', async () => {
      const { templates, lifecycle } = setup({ documentType: 'PAYROLL', status: 'POSTED', updatedAt: CHANGED });
      const err = await lifecycle.post('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(templates.payroll.execute).not.toHaveBeenCalled();
    });
  });

  describe('PAYROLL post', () => {
    it('a different expectedUpdatedAt → 409 DOCUMENT_CHANGED (บันทึกและลงบัญชี) · no gate, no JE', async () => {
      const { prisma, templates, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'APPROVED', updatedAt: CHANGED });
      expect(await conflictOf(lifecycle.post('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN }))).toEqual(POST_CHANGED);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'post:doc-1');
      expect(gate.assertPostable).not.toHaveBeenCalled();
      expect(templates.payroll.execute).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('missing expectedUpdatedAt → 409 DOCUMENT_CHANGED', async () => {
      const { templates, lifecycle } = setup({ documentType: 'PAYROLL', status: 'APPROVED', updatedAt: SEEN });
      expect(await conflictOf(lifecycle.post('doc-1', 'owner-1', 'OWNER'))).toEqual(POST_CHANGED);
      expect(templates.payroll.execute).not.toHaveBeenCalled();
    });

    it('the same expectedUpdatedAt → gate + payroll JE', async () => {
      const { prisma, templates, gate, lifecycle } = setup({ documentType: 'PAYROLL', status: 'APPROVED', updatedAt: SEEN });
      await lifecycle.post('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN });
      expect(gate.assertPostable).toHaveBeenCalled();
      expect(templates.payroll.execute).toHaveBeenCalledWith('doc-1', prisma);
    });
  });

  describe('other document types keep today\'s behaviour (token optional, compared only when sent)', () => {
    it('EXPENSE approve / post without a token → unchanged (JE posted)', async () => {
      const approve = setup({ documentType: 'EXPENSE', status: 'PENDING_APPROVAL', updatedAt: SEEN });
      approve.prisma.systemConfig.findFirst.mockResolvedValue(null);
      await approve.lifecycle.approve('doc-1', 'owner-1', 'OWNER');
      expect(approve.templates.sameDay.execute).toHaveBeenCalledWith('doc-1', approve.prisma);

      const post = setup({ documentType: 'EXPENSE', status: 'APPROVED', updatedAt: SEEN });
      await post.lifecycle.post('doc-1', 'owner-1', 'OWNER');
      expect(post.templates.sameDay.execute).toHaveBeenCalledWith('doc-1', post.prisma);
    });

    it('EXPENSE with a stale token sent → 409 DOCUMENT_CHANGED · with the current one → posted', async () => {
      const stale = setup({ documentType: 'EXPENSE', status: 'APPROVED', updatedAt: CHANGED });
      expect(await conflictOf(stale.lifecycle.post('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN }))).toEqual(POST_CHANGED);
      expect(stale.templates.sameDay.execute).not.toHaveBeenCalled();

      const fresh = setup({ documentType: 'EXPENSE', status: 'APPROVED', updatedAt: SEEN });
      await fresh.lifecycle.post('doc-1', 'owner-1', 'OWNER', { expectedUpdatedAt: SEEN });
      expect(fresh.templates.sameDay.execute).toHaveBeenCalled();
    });
  });
});
