import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { configureApp } from '../../../app.setup';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { BranchGuard } from '../../auth/guards/branch.guard';
import { ExpenseDocumentsController } from '../expense-documents.controller';
import { ExpenseDocumentsService } from '../expense-documents.service';
import { ExpenseVoucherPdfService } from '../services/expense-voucher-pdf.service';
import { ExpenseDocumentLifecycleService } from '../services/expense-document-lifecycle.service';
import { StatusTransitionService } from '../services/status-transition.service';
import { payrollGateConflict } from '../payroll-system/payroll-post-gate.service';
import type { StaleDiff } from '../payroll-system/payroll-system.types';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

/**
 * Payroll D4 ส่วนที่ 1 · Task 5 — สิ่งที่เบราว์เซอร์ได้รับจริงเมื่อด่านใบเงินเดือนปฏิเสธ
 * ยิงผ่าน controller + guard + pipe + SentryExceptionFilter + envelope ของ configureApp (ชุดเดียวกับ production)
 * ⇒ ถ้าตัวกรองตัด `code` / `diffs` / `closableAt` ทิ้ง หน้าเว็บจะวาดตารางยอดต่าง / บอกเวลาที่ทำได้ไม่ได้
 * route → ExpenseDocumentLifecycleService ตัวจริง (ด่านอยู่ก่อนเปลี่ยนสถานะ) → ด่าน (mock) โยน 409 ตัวจริงของด่าน
 */
const DOC_ID = 'doc-payroll-1';
const OWNER = { id: 'owner-1', role: 'OWNER', branchId: null };
const diffs: StaleDiff[] = [
  { userId: 'u1', employeeName: 'พนักงาน นุ๊ก', label: 'OT วันทำงาน (1.5 เท่า)', stored: { amount: '154.69', hours: '1.5' }, current: { amount: '257.81', hours: '2.5' } },
];

describe('Payroll gate 409s over HTTP', () => {
  let app: INestApplication;
  const gate = { assertPostable: jest.fn(), assertSubmittable: jest.fn(), inspect: jest.fn() };
  const creator = { updatePayrollInTx: jest.fn() };
  const doc = { id: DOC_ID, status: 'PENDING_APPROVAL', documentType: 'PAYROLL', branchId: 'br1', deletedAt: null, createdById: 'maker-1' };
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    user: { findFirst: jest.fn().mockResolvedValue({ id: OWNER.id, name: 'เจ้าของ', role: 'OWNER', branchId: null }) },
    systemConfig: { findFirst: jest.fn().mockResolvedValue({ value: 'true' }) },
    expenseDocument: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  const stub = () => ({ execute: jest.fn() });
  const lifecycle = new ExpenseDocumentLifecycleService(
    prisma as never,
    new StatusTransitionService(),
    stub() as never,
    stub() as never,
    stub() as never,
    stub() as never,
    stub() as never,
    stub() as never,
    stub() as never,
    { createAndPost: jest.fn() } as never,
    undefined,
    undefined,
    creator as never,
    gate as never,
  );

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ExpenseDocumentsController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        RolesGuard,
        BranchGuard,
        {
          provide: ExpenseDocumentsService,
          useValue: {
            approve: (id: string, userId: string, role?: string) => lifecycle.approve(id, userId, role),
            submitForApproval: (id: string, userId: string) => lifecycle.submitForApproval(id, userId),
          },
        },
        { provide: ExpenseVoucherPdfService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
          context.switchToHttp().getRequest().user = OWNER;
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    configureApp(app, { swagger: false });
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    jest.clearAllMocks();
    tx.expenseDocument.findUniqueOrThrow.mockResolvedValue(doc);
  });

  it('H1 approve with the gate refusing as stale → 409 JSON keeps code + diffs (the web draws the diff table) · status never flipped', async () => {
    gate.assertPostable.mockRejectedValueOnce(payrollGateConflict.stale(diffs));
    const res = await request(app.getHttpServer()).post(`/api/expense-documents/${DOC_ID}/approve`).expect(409);
    expect(res.body).toMatchObject({
      statusCode: 409,
      code: 'PAYROLL_STALE',
      diffs,
      message: 'ยังไม่ได้ลงบัญชี — ข้อมูลลงเวลาเปลี่ยนหลังบันทึกใบ ให้ผู้ทำเงินเดือนกด "แก้ไข" แล้วบันทึกใบอีกครั้ง (ระบบคิดยอดใหม่ให้) ตรวจยอด แล้วส่งขออนุมัติอีกครั้ง',
    });
    expect(gate.assertPostable).toHaveBeenCalledWith(tx, DOC_ID, expect.any(Date));
    expect(tx.expenseDocument.update).not.toHaveBeenCalled();
  });

  it('H2 approve with the gate refusing a device-conflict day → 409 JSON keeps code + days', async () => {
    const days = [{ dayId: 'day-1', userId: 'u1', employeeName: 'พนักงาน นุ๊ก', date: '2026-10-15', branchId: 'b1' }];
    gate.assertPostable.mockRejectedValueOnce(payrollGateConflict.deviceConflict(days));
    const res = await request(app.getHttpServer()).post(`/api/expense-documents/${DOC_ID}/approve`).expect(409);
    expect(res.body).toMatchObject({
      code: 'PAYROLL_DEVICE_CONFLICT',
      days,
      message: 'อนุมัติไม่ได้ — มีวันที่ติดธง เครื่องถูกใช้ซ้อน 1 วัน (พนักงาน นุ๊ก · 15 ต.ค.) ให้เจ้าของตรวจที่เมนู ลงเวลา แล้วกด "ตรวจแล้ว ล้างธง"',
    });
  });

  it('H3 submit-for-approval before the cutoff → 409 JSON keeps code + closableAt · nothing re-saved', async () => {
    tx.expenseDocument.findUniqueOrThrow.mockResolvedValue({ ...doc, status: 'DRAFT' });
    gate.assertSubmittable.mockRejectedValueOnce(payrollGateConflict.submitCutoff(new Date('2026-11-01T11:00:00.000Z')));
    const res = await request(app.getHttpServer()).post(`/api/expense-documents/${DOC_ID}/submit-for-approval`).expect(409);
    expect(res.body).toMatchObject({
      code: 'PAYROLL_SUBMIT_CUTOFF',
      closableAt: '2026-11-01T11:00:00.000Z',
      message: 'ส่งขออนุมัติได้ตั้งแต่ 1 พ.ย. 2569 18:00 — รอให้ข้อมูลลงเวลาของเดือนนี้ครบก่อน ระหว่างนี้บันทึกร่างไว้ได้',
    });
    expect(creator.updatePayrollInTx).not.toHaveBeenCalled();
    expect(tx.expenseDocument.update).not.toHaveBeenCalled();
  });
});
