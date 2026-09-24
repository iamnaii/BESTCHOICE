import { ContractQueryService } from './services/contract-query.service';
import { PrismaService } from '../../prisma/prisma.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractWorkflowService } from './contract-workflow.service';
import { ContractPaymentService } from './contract-payment.service';
import { ContractDocumentService } from './contract-document.service';
import { ContractSnapshotService } from './contract-snapshot.service';
import { ContractJournalQueryService } from '../journal/contract-journal-query.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BranchGuard } from '../auth/guards/branch.guard';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { EarlyPayoffSlipService } from './early-payoff-slip/early-payoff-slip.service';

describe('POST /contracts/quote boundary', () => {
  let app: INestApplication;
  let actor: { id: string; role: string; branchId: string | null };
  const listDb = { contract: {
    findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { sellingPrice: null } }),
  } };
  const listService = new ContractQueryService(listDb as unknown as PrismaService);
  const findAll = jest.fn((filters, user) => listService.findAll(filters, user));
  const quote = jest.fn().mockResolvedValue({ fingerprint: 'a'.repeat(64) });
  const dto = { customerId: 'customer', productId: 'product', branchId: 'branch', sellingPrice: 10000, downPayment: 2000, totalMonths: 6, paymentDueDay: 31 };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [ContractsController], providers: [
      { provide: PrismaService, useValue: {} }, RolesGuard, BranchGuard, { provide: ContractsService, useValue: { quote, findAll } },
      ...[ContractWorkflowService, ContractPaymentService, ContractDocumentService, ContractSnapshotService, ContractJournalQueryService, JourneyEntryWriter, EarlyPayoffSlipService]
        .map(provide => ({ provide, useValue: {} })),
    ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = actor; return true;
    } }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { actor = { id: 'staff', role: 'SALES', branchId: 'branch' }; quote.mockClear(); });
  it.each(['SALES', 'BRANCH_MANAGER'])('fails closed on a branchless %s contract list/export', async role => {
    actor.role = role; actor.branchId = null;
    await request(app.getHttpServer()).get('/contracts').query({ limit: 200 }).expect(200);
    expect(listDb.contract.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }), take: 200 }));
  });
  it.each(['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'])('keeps %s cross-branch contract list access with an assigned branch', async role => {
    actor.role = role;
    await request(app.getHttpServer()).get('/contracts').expect(200);
    expect(listDb.contract.findMany.mock.calls.slice(-1)[0][0].where).not.toHaveProperty('branchId');
  });
  it.each([{ page: 0 }, { page: 'NaN' }, { limit: 201 }])('validates contract pagination %j', async query => {
    await request(app.getHttpServer()).get('/contracts').query(query).expect(400);
  });
  it.each(['OWNER', 'BRANCH_MANAGER', 'SALES'])('allows %s and passes the authenticated actor', async role => {
    actor.role = role;
    await request(app.getHttpServer()).post('/contracts/quote').send(dto).expect(201);
    expect(quote).toHaveBeenCalledWith(dto, actor);
  });
  it.each(['FINANCE_MANAGER', 'ACCOUNTANT'])('does not expand create permissions to %s', async role => {
    actor.role = role;
    await request(app.getHttpServer()).post('/contracts/quote').send(dto).expect(403);
    expect(quote).not.toHaveBeenCalled();
  });
  it.each([null, 'other'])('rejects absent or foreign actor branch (%s)', async branchId => {
    actor.branchId = branchId;
    await request(app.getHttpServer()).post('/contracts/quote').send(dto).expect(403);
    expect(quote).not.toHaveBeenCalled();
  });
  it.each([{ totalMonths: 0 }, { paymentDueDay: 32 }, { sellingPrice: 'bad' }, { downPayment: -1 }, { amountReceived: 123 }])('validates quote inputs (%j)', async change => {
    await request(app.getHttpServer()).post('/contracts/quote').send({ ...dto, ...change }).expect(400);
    expect(quote).not.toHaveBeenCalled();
  });
});
