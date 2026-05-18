import { Test, TestingModule } from '@nestjs/testing';
import { PrismaFinanceService } from './prisma-finance.service';

const HAS_DB = !!process.env.DATABASE_URL_FINANCE;

// SP7.1 — Integration tests that hit live postgres-finance container.
// Skipped when DATABASE_URL_FINANCE is not set (e.g. plain `npm test` without env).
// To run locally: `export DATABASE_URL_FINANCE=... && npx jest src/prisma/prisma-finance.service.spec.ts`
// CI integration deferred to SP7.1 Task 10.
const describeOrSkip = HAS_DB ? describe : describe.skip;

describeOrSkip('PrismaFinanceService', () => {
  let service: PrismaFinanceService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaFinanceService],
    }).compile();

    service = module.get<PrismaFinanceService>(PrismaFinanceService);
    await service.onModuleInit();
  });

  afterAll(async () => {
    if (service) await service.onModuleDestroy();
  });

  it('connects to bc_finance DB', async () => {
    const result = await service.$queryRaw<Array<{ now: Date }>>`SELECT NOW() as now`;
    expect(result[0].now).toBeInstanceOf(Date);
  });

  it('has access to healthCheck model', async () => {
    const created = await service.healthCheck.create({ data: {} });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeInstanceOf(Date);
    await service.healthCheck.delete({ where: { id: created.id } });
  });
});
