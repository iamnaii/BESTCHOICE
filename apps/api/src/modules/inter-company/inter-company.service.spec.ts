import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { InterCompanyService } from './inter-company.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * T5-C21: fromCompanyId / toCompanyId must never be NULL.
 *
 * The migration seeds stub SHOP/FINANCE CompanyInfo rows so a fresh DB always
 * has them. If they've been soft-deleted at runtime, the service must refuse
 * the tx with a clear Thai error — previously it silently passed `undefined`
 * FKs, which after migration 20260528300000 becomes a DB-level NOT NULL
 * violation (less helpful to the caller).
 */
describe('InterCompanyService — T5-C21 company FK guards', () => {
  let service: InterCompanyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      companyInfo: {
        findFirst: jest.fn(),
      },
      interCompanyTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'ict-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InterCompanyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<InterCompanyService>(InterCompanyService);
  });

  const baseDto = {
    saleId: 'sale-1',
    branchId: 'branch-1',
    fromEntity: 'BESTCHOICE FINANCE',
    toEntity: 'BESTCHOICE SHOP',
    principal: 10000,
    commission: 1000,
    commissionPct: 0.1,
    vatAmount: 700,
    vatPct: 0.07,
    totalAmount: 11000,
    interestTotal: 1500,
    costPrice: 8000,
    downPayment: 2000,
    sellingPrice: 12000,
    shopProfit: 3000,
    financeProfit: 500,
  };

  it('throws clear Thai error when FINANCE CompanyInfo is missing', async () => {
    // FINANCE missing, SHOP exists
    prisma.companyInfo.findFirst
      .mockResolvedValueOnce(null) // FINANCE
      .mockResolvedValueOnce({ id: 'shop-co' });

    await expect(service.createFromSale(baseDto as never)).rejects.toThrow(
      InternalServerErrorException,
    );

    await expect(service.createFromSale(baseDto as never)).rejects.toThrow(
      /FINANCE.*CompanyInfo|กรุณาเพิ่มข้อมูลบริษัท/,
    );

    expect(prisma.interCompanyTransaction.create).not.toHaveBeenCalled();
  });

  it('happy path: resolves both FKs and creates transaction with direction detection', async () => {
    prisma.companyInfo.findFirst
      .mockResolvedValueOnce({ id: 'finance-co' }) // FINANCE
      .mockResolvedValueOnce({ id: 'shop-co' });   // SHOP

    await service.createFromSale(baseDto as never);

    expect(prisma.interCompanyTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // fromEntity = "BESTCHOICE FINANCE" → fromCompanyId = finance-co
          fromCompanyId: 'finance-co',
          toCompanyId: 'shop-co',
        }),
      }),
    );
  });
});
