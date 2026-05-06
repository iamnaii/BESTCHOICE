import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { DocNumberService } from '../services/doc-number.service';

describe('DocNumberService', () => {
  let service: DocNumberService;
  let prisma: PrismaService;
  let companyId: string;
  let createdById: string;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [DocNumberService, PrismaService],
    }).compile();
    await module.init(); // triggers onModuleInit → $connect()
    service = module.get(DocNumberService);
    prisma = module.get(PrismaService);
    await prisma.otherIncome.deleteMany({});

    // Resolve real FK IDs using raw SQL (required by FK constraints on other_incomes)
    const [company] = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM company_info WHERE deleted_at IS NULL LIMIT 1
    `;
    const [user] = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1
    `;
    if (!company || !user) throw new Error('No seeded company or user found — run db seed first');
    companyId = company.id;
    createdById = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('generates OI-YYYYMMDD-0001 when no doc exists for the date', async () => {
    const docNo = await service.nextDocNumber(prisma, new Date('2026-05-06'));
    expect(docNo).toBe('OI-20260506-0001');
  });

  it('increments sequence for same date', async () => {
    const date = new Date('2026-05-06');
    const a = await service.nextDocNumber(prisma, date);
    expect(a).toBe('OI-20260506-0001');
    await prisma.otherIncome.create({
      data: { docNumber: a, companyId, issueDate: date, createdById, paymentAccountCode: '11-1101' },
    });
    const b = await service.nextDocNumber(prisma, date);
    expect(b).toBe('OI-20260506-0002');
  });

  it('resets sequence on new date', async () => {
    const a = await service.nextDocNumber(prisma, new Date('2026-05-06'));
    await prisma.otherIncome.create({
      data: { docNumber: a, companyId, issueDate: new Date('2026-05-06'), createdById, paymentAccountCode: '11-1101' },
    });
    const b = await service.nextDocNumber(prisma, new Date('2026-05-07'));
    expect(b).toBe('OI-20260507-0001');
  });

  it('generates RC-YYYYMMDD-001 receipt number', async () => {
    const rc = await service.nextReceiptNumber(prisma, new Date('2026-05-06'));
    expect(rc).toBe('RC-20260506-001');
  });
});
