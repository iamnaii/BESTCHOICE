import { randomUUID } from 'crypto';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { OverdueController } from '../src/modules/overdue/overdue.controller';
import { ContractLetterService } from '../src/modules/overdue/contract-letter.service';
import { LetterPdfService } from '../src/modules/overdue/letter-pdf.service';
import { LetterDocumentAccessGuard } from '../src/modules/overdue/letter-document-access.guard';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { BranchGuard } from '../src/modules/auth/guards/branch.guard';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) throw new Error('Run tools/test-chat-credit.sh with its disposable database');

describe('Letter PDF boundary on isolated PostgreSQL', () => {
  const db = new PrismaService();
  const prefix = `LETTER-DOC-${randomUUID()}`;
  const pdf = Buffer.from('%PDF-1.4\nSynthetic letter PDF\n%%EOF');
  const render = jest.spyOn(LetterPdfService.prototype as any, 'htmlToPdf').mockResolvedValue(pdf);
  let app: INestApplication;
  let actor: { id: string; role: string; branchId: string | null };
  let branchA: string, branchB: string, userId: string, contractA: string, contractB: string;
  let letterA: string, letterB: string;
  let sequence = 0;
  const createLetter = async (contractId: string) => (await db.contractLetter.create({ data: {
    contractId, letterNumber: `${prefix}-${++sequence}`, letterType: 'CONTRACT_TERMINATION_60D',
  } })).id;
  const read = (id: string) => request(app.getHttpServer()).get(`/overdue/letters/${id}/pdf`);
  const mark = (id: string) => request(app.getHttpServer()).post(`/overdue/letters/${id}/pdf-generated`).send({});

  beforeAll(async () => {
    await db.$connect();
    branchA = (await db.branch.create({ data: { name: `${prefix}-A` } })).id;
    branchB = (await db.branch.create({ data: { name: `${prefix}-B` } })).id;
    userId = (await db.user.create({ data: { name: prefix, email: `${prefix}@example.invalid`, password: 'unused', role: 'OWNER', branchId: branchA } })).id;
    const customer = await db.customer.create({ data: { name: prefix, phone: '0800000000', nationalId: `798${Date.now().toString().slice(-10)}`, birthDate: new Date('1990-01-01') } });
    const makeContract = async (branchId: string) => {
      const product = await db.product.create({ data: { name: prefix, brand: 'TEST', model: 'TEST', category: 'PHONE_NEW', branchId, costPrice: '6000', cashPrice: '10000' } });
      const consent = await db.pDPAConsent.create({ data: { customerId: customer.id, consentVersion: 'test', privacyNoticeText: 'SYNTHETIC', status: 'GRANTED', grantedAt: new Date() } });
      return db.contract.create({ data: { contractNumber: `${prefix}-${branchId}`, planType: 'STORE_DIRECT', branchId, customerId: customer.id, productId: product.id, salespersonId: userId, pdpaConsentId: consent.id,
        sellingPrice: '10000', downPayment: '2000', interestRate: '0.01', totalMonths: 6, interestTotal: '480', financedAmount: '8000', monthlyPayment: '1413.33' } });
    };
    contractA = (await makeContract(branchA)).id;
    contractB = (await makeContract(branchB)).id;
    letterA = await createLetter(contractA);
    letterB = await createLetter(contractB);
    await db.companyInfo.upsert({ where: { companyCode: 'FINANCE' }, update: {}, create: { companyCode: 'FINANCE', nameTh: 'บริษัททดสอบ', taxId: '0000000000000', address: 'ที่อยู่ทดสอบ', directorName: 'ผู้ลงนามทดสอบ' } });
    const module = await Test.createTestingModule({ controllers: [OverdueController], providers: [
      ContractLetterService, LetterPdfService, LetterDocumentAccessGuard, RolesGuard, BranchGuard, { provide: PrismaService, useValue: db },
    ] }).useMocker(() => ({})).overrideGuard(JwtAuthGuard).useValue({ canActivate: (ctx: ExecutionContext) => { ctx.switchToHttp().getRequest().user = actor; return true; } }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    actor = { id: userId, role: 'SALES', branchId: branchA };
    render.mockClear();
    await db.contractLetter.updateMany({ where: { id: { in: [letterA, letterB] } }, data: { status: 'PENDING_DISPATCH', deletedAt: null, cancelledAt: null, cancelReason: null } });
  });
  afterAll(async () => { render.mockRestore(); await app?.close(); await db.$disconnect(); });

  it.each(['SALES', 'BRANCH_MANAGER'])('permits %s own branch and rejects foreign IDs or branchless actors before any PDF/audit', async role => {
    actor.role = role;
    await read(letterA).expect(200).expect('Content-Type', /application\/pdf/);
    const calls = render.mock.calls.length;
    const auditBefore = await db.auditLog.count({ where: { entityId: letterB } });
    await read(letterB).query({ branchId: branchA }).expect(403);
    await mark(letterB).expect(403);
    actor.branchId = null;
    await read(letterA).expect(403);
    await mark(letterA).expect(403);
    expect(render.mock.calls.length).toBe(calls);
    expect(await db.auditLog.count({ where: { entityId: letterB } })).toBe(auditBefore);
    expect((await db.contractLetter.findUniqueOrThrow({ where: { id: letterB } })).status).toBe('PENDING_DISPATCH');
    actor.branchId = branchA;
    await mark(letterA).expect(201);
  });
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('preserves %s cross-branch access', async role => {
    actor.role = role; actor.branchId = null;
    expect((await read(letterB).expect(200)).body).toEqual(pdf);
    await mark(letterB).expect(201);
  });
  it('rejects missing, deleted letters and deleted contracts', async () => {
    actor.role = 'OWNER';
    for (const id of [randomUUID(), letterB]) {
      if (id === letterB) await db.contractLetter.update({ where: { id }, data: { deletedAt: new Date() } });
      await read(id).expect(404); await mark(id).expect(404);
    }
    await db.contract.update({ where: { id: contractA }, data: { deletedAt: new Date() } });
    try { await read(letterA).expect(404); await mark(letterA).expect(404); }
    finally { await db.contract.update({ where: { id: contractA }, data: { deletedAt: null } }); }
    expect(render).not.toHaveBeenCalled();
  });
  it('does not revive a cancelled letter when marking resumes after its initial read', async () => {
    const original = db.contractLetter.findFirst.bind(db.contractLetter);
    const spy = jest.spyOn(db.contractLetter, 'findFirst').mockImplementationOnce((async (args: any) => {
      const result = await original(args);
      await db.contractLetter.update({ where: { id: letterA }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'ยกเลิกระหว่างสร้าง' } });
      return result;
    }) as typeof db.contractLetter.findFirst);
    const service = app.get(ContractLetterService);
    const count = await db.auditLog.count({ where: { entityId: letterA, action: 'LETTER_PDF_GENERATED' } });
    try { await expect(service.markPdfGenerated(letterA, null, userId)).rejects.toThrow('สถานะหนังสือเปลี่ยน'); }
    finally { spy.mockRestore(); }
    expect((await db.contractLetter.findUniqueOrThrow({ where: { id: letterA } })).status).toBe('CANCELLED');
    expect(await db.auditLog.count({ where: { entityId: letterA, action: 'LETTER_PDF_GENERATED' } })).toBe(count);
  });
  it('records only one audit when two confirmations arrive together', async () => {
    const count = await db.auditLog.count({ where: { entityId: letterA, action: 'LETTER_PDF_GENERATED' } });
    const results = await Promise.all([mark(letterA), mark(letterA)]);
    expect(results.map(row => row.status).sort()).toEqual([201, 201]);
    await mark(letterA).expect(201); // Retry after a committed response was lost.
    expect(await db.auditLog.count({ where: { entityId: letterA, action: 'LETTER_PDF_GENERATED' } })).toBe(count + 1);
  });
});
