import { assertContractCreditApproval } from '../src/modules/credit-check/services/credit-approval';
import { computeInstallmentBreakdown } from '../src/modules/journal/compute-installment-breakdown';
import { Body, Controller, INestApplication, Post, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CreditCheckService } from '../src/modules/credit-check/credit-check.service';
import { JourneyEntryWriter } from '../src/modules/customer-journey/journey-entry-writer.service';
import { CustomerCreditCheckController, GlobalCreditCheckController } from '../src/modules/credit-check/credit-check.controller';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { BranchGuard } from '../src/modules/auth/guards/branch.guard';
import { IntegrationConfigService } from '../src/modules/integrations/integration-config.service';
import { AiUsageService } from '../src/modules/ai-usage/ai-usage.service';
import { AiProviderService } from '../src/modules/ai-usage/ai-provider.service';
import { ContractLifecycleService } from '../src/modules/contracts/services/contract-lifecycle.service';
import { CreateContractDto } from '../src/modules/contracts/dto/contract.dto';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
  throw new Error('Only the disposable database created by tools/test-chat-credit.sh is allowed');
}
const db = new PrismaService();
let lifecycle: ContractLifecycleService;
let ownerId: string;
@Controller('contracts')
class ApprovalContractTestController {
  @Post() create(@Body() dto: CreateContractDto) { return lifecycle.create(dto, ownerId, 'OWNER'); }
}
const basis = { verifiedMonthlyIncome: 15000, livingExpenses: 9000, externalMonthlyDebt: 0,
  salaryPayDay: 25, evidenceNotes: 'ยืนยันรายได้จากสลิป รายจ่าย หนี้ภายนอก และวันรับเงินครบแล้ว' };

describe('verified credit approval with PostgreSQL and real HTTP controllers', () => {
  let app: INestApplication;
  let credits: CreditCheckService;
  let branchId: string;
  let role = 'OWNER';
  beforeAll(async () => {
    await db.$connect();
    const owner = await db.user.create({ data: { name: 'APPROVAL TEST OWNER', email: `${randomUUID()}@test.invalid`, password: 'unused', role: 'OWNER' } });
    ownerId = owner.id;
    branchId = (await db.branch.create({ data: { name: 'APPROVAL TEST BRANCH' } })).id;
    const config = new ConfigService({});
    credits = new CreditCheckService(db, new IntegrationConfigService(db, config), new AiProviderService(new AiUsageService(db, config)));
    lifecycle = new ContractLifecycleService(db, {
      isTestModeEnabled: async () => false,
      findOne: (id: string) => db.contract.findUniqueOrThrow({ where: { id }, include: { payments: { orderBy: { installmentNo: 'asc' } } } }),
    } as never, { execute: jest.fn().mockResolvedValue({}) } as never,
    { execute: jest.fn().mockResolvedValue({}) } as never,
    { resolveBranchCashAccount: async () => 'S11-1101', resolveInflowCashAccount: async () => 'S11-1101' } as never);
    const module = await Test.createTestingModule({
      controllers: [GlobalCreditCheckController, CustomerCreditCheckController, ApprovalContractTestController],
      providers: [
        { provide: CreditCheckService, useValue: credits },
        { provide: JourneyEntryWriter, useValue: { recordAfterCommit: async () => undefined, recordInTx: async () => undefined } },
        { provide: PrismaService, useValue: db },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: context => {
      context.switchToHttp().getRequest().user = { id: ownerId, role }; return true;
    } }).overrideGuard(BranchGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // Bind the same IPv4 destination Supertest uses; Darwin permits a different IPv6 server on the same port.
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); await db.$disconnect(); });
  beforeEach(() => { role = 'OWNER'; });

  async function fixture() {
    const customer = await db.customer.create({ data: { name: 'APPROVAL TEST CUSTOMER', phone: '0000000000', salary: 15000, salaryPayDay: 25 } });
    const check = await db.creditCheck.create({ data: { customerId: customer.id, status: 'MANUAL_REVIEW', checkType: 'FULL',
      statementFiles: ['synthetic-statement.pdf'], aiAnalysis: { monthlyIncome: 15000, monthlyExpense: 9000 } } });
    const product = async () => db.product.create({ data: { name: 'APPROVAL TEST PHONE', brand: 'SYNTHETIC', model: 'TEST',
      category: 'PHONE_NEW', costPrice: 5000, branchId, imeiSerial: randomUUID(), status: 'IN_STOCK' } });
    const dto = async () => ({ customerId: customer.id, productId: (await product()).id, branchId,
      sellingPrice: 10000, downPayment: 2000, totalMonths: 12, interestRate: 0, paymentDueDay: 25 });
    const preview = async (input = basis) => (await request(app.getHttpServer()).post(`/api/credit-checks/${check.id}/affordability`).send(input).expect(201)).body;
    const decision = async (amount = 2500, input = basis) => ({ status: 'APPROVED', overrideReason: 'ตรวจหลักฐานและอนุมัติยอดผ่อนตามฐานที่ยืนยันแล้ว',
      affordability: { ...input, approvedMonthlyPayment: amount, confirmed: true, contextToken: (await preview(input)).contextToken } });
    const endpoint = `/api/customers/${customer.id}/credit-check/${check.id}/override`;
    return { customer, check, dto, preview, decision, endpoint };
  }

  it('approves the verified amount through HTTP, creates real installments and consumes it once', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    const response = await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(201);
    const approval = await db.creditApproval.findFirstOrThrow({ where: { creditCheckId: f.check.id } });
    expect(Number(approval.approvedMonthlyPayment)).toBe(2500);
    expect(approval.usedByContractId).toBe(response.body.id);
    expect(response.body.payments).toHaveLength(12);
    expect(response.body.payments.every(payment => Number(payment.amountDue) <= 2500)).toBe(true);
    expect(new Date(approval.usedFirstPaymentDue!).getTime()).toBe(new Date(response.body.payments[0].dueDate).getTime());
    await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(400);
    expect(await db.contract.count({ where: { customerId: f.customer.id } })).toBe(1);
  });

  it('rolls back a contract whose amount or payday does not match the approval', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision(500)).expect(201);
    await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(400);
    expect(await db.contract.count({ where: { customerId: f.customer.id } })).toBe(0);
    const approval = await db.creditApproval.findFirstOrThrow({ where: { creditCheckId: f.check.id } });
    expect(approval.usedAt).toBeNull();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    await request(app.getHttpServer()).post('/api/contracts').send({ ...await f.dto(), paymentDueDay: 30 }).expect(400);
    expect(await db.contract.count({ where: { customerId: f.customer.id } })).toBe(0);
  });

  it('keeps the financed principal separate and every payable installment equal to the accounting amount', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    const dto = { ...await f.dto(), interestRate: 0.025 };
    const response = await request(app.getHttpServer()).post('/api/contracts').send(dto).expect(201);
    const contract = await db.contract.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(Number(contract.interestTotal)).toBeGreaterThan(0);
    expect(Number(contract.storeCommission)).toBeGreaterThan(0);
    expect(Number(contract.financedAmount)).toBe(dto.sellingPrice - dto.downPayment);
    const accounting = computeInstallmentBreakdown(contract);
    const total = response.body.payments.reduce((sum, payment) => sum + Math.round(Number(payment.amountDue) * 100), 0);
    expect(total).toBe(accounting.grossExclVat.plus(accounting.vat).mul(100).toNumber());
    for (const payment of response.body.payments.slice(0, -1)) {
      expect(Number(payment.amountDue)).toBe(accounting.installmentTotal.toNumber());
      expect(Number(payment.monthlyInterest)).toBe(accounting.interestPerInst.toNumber());
      expect(Number(payment.vatAmount)).toBe(accounting.vatPerInst.toNumber());
    }
  });

  it('serializes two simultaneous approvals made from the same preview', async () => {
    const f = await fixture();
    const decision = await f.decision();
    const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post(f.endpoint).send(decision)));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await db.creditApproval.count({ where: { creditCheckId: f.check.id, supersededAt: null } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: f.check.id, action: 'CREDIT_CHECK_OVERRIDE' } })).toBe(1);
  });

  it('serializes two contract creations against one approved amount', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    const bodies = await Promise.all([f.dto(), f.dto()]);
    const responses = await Promise.all(bodies.map(body => request(app.getHttpServer()).post('/api/contracts').send(body)));
    expect(responses.map(response => response.status).sort()).toEqual([201, 400]);
    expect(await db.contract.count({ where: { customerId: f.customer.id } })).toBe(1);
  });

  it('does not grant permission or substitute missing debt with zero', async () => {
    const f = await fixture();
    const decision = await f.decision();
    role = 'SALES';
    await request(app.getHttpServer()).post(f.endpoint).send(decision).expect(403);
    role = 'OWNER';
    const { externalMonthlyDebt: _missing, ...incomplete } = decision.affordability;
    await request(app.getHttpServer()).post(f.endpoint).send({ ...decision, affordability: incomplete }).expect(400);
    expect(await db.creditApproval.count({ where: { creditCheckId: f.check.id } })).toBe(0);
  });

  it('rejects changed financial data and leaves the approval unused', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    await db.customer.update({ where: { id: f.customer.id }, data: { salary: 10000 } });
    await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(409);
    expect(await db.contract.count({ where: { customerId: f.customer.id } })).toBe(0);
  });
  it('keeps a deleted draft approval consumed and requires a fresh review', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    const created = (await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(201)).body;
    await lifecycle.softDelete(created.id, ownerId);
    const check = await db.creditCheck.findUniqueOrThrow({ where: { id: f.check.id }, include: { approvals: true } });
    expect(check.contractId).toBeNull();
    expect(check.approvals[0].usedByContractId).toBe(created.id);
    await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(400);
  });

  it('refuses moving the first installment after the approval is consumed', async () => {
    const f = await fixture();
    await request(app.getHttpServer()).post(f.endpoint).send(await f.decision()).expect(201);
    const created = (await request(app.getHttpServer()).post('/api/contracts').send(await f.dto()).expect(201)).body;
    const first = new Date(created.payments[0].dueDate);
    first.setMonth(first.getMonth() + 1);
    await expect(db.$transaction(tx => assertContractCreditApproval(tx, { customerId: f.customer.id, contractId: created.id,
      monthlyAmounts: created.payments.map(payment => Number(payment.amountDue)), paymentDueDay: 25, firstPaymentDue: first })))
      .rejects.toThrow(/งวดแรก/);
  });

  it('does not let a branch manager route a rejected decision through manual review to approve it', async () => {
    const f = await fixture();
    await db.creditCheck.update({ where: { id: f.check.id }, data: { status: 'REJECTED' } });
    role = 'BRANCH_MANAGER';
    await request(app.getHttpServer()).post(f.endpoint).send({ status: 'MANUAL_REVIEW',
      overrideReason: 'ทดสอบป้องกันการเลี่ยงสิทธิ์ด้วยการเปลี่ยนสถานะกลาง' }).expect(403);
    expect((await db.creditCheck.findUniqueOrThrow({ where: { id: f.check.id } })).status).toBe('REJECTED');
  });

});
