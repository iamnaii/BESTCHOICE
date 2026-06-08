/**
 * Wave 3 MED gap-fill — CHARACTERIZATION goldens for InterestConfigService.create().
 *
 * Pins the CURRENT behaviour of the shipped months-range guard + the exact field
 * set forwarded to prisma.interestConfig.create. Mock-based (no real DB): a
 * hand-mocked PrismaService is the only injected dependency (constructor takes
 * `private prisma: PrismaService`). Money/percent fields enter as plain numbers
 * (the service copies them verbatim into `data` — no Decimal ops here).
 *
 * Quirk encoded: the guard uses `>` (strict), so min === max is ALLOWED, matching
 * the Thai message "น้อยกว่าหรือเท่ากับ" (less-than-OR-EQUAL). Optional DTO fields
 * (storeCommissionPct, vatPct) are NOT stripped — they pass through as `undefined`
 * when omitted, which Prisma reads as "use column default".
 *
 * Existing specs in this module cover findAll/findOne/findByCategory/remove,
 * resolveConfig, and the rate-synthesis path; this file only touches create().
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InterestConfigService } from './interest-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInterestConfigDto } from './dto/interest-config.dto';

describe('InterestConfigService.create — months-range guard (Wave 3 MED gap-fill)', () => {
  let service: InterestConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      interestConfig: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [InterestConfigService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<InterestConfigService>(InterestConfigService);
  });

  const baseDto = (
    overrides: Partial<CreateInterestConfigDto> = {},
  ): CreateInterestConfigDto => ({
    name: 'มือ 1',
    productCategories: ['PHONE_NEW'],
    interestRate: 0.02,
    minDownPaymentPct: 0.15,
    storeCommissionPct: 0.1,
    vatPct: 0.07,
    minInstallmentMonths: 6,
    maxInstallmentMonths: 12,
    ...overrides,
  });

  describe('guard rejects min > max', () => {
    it('throws BadRequestException with the Thai message and never calls prisma.create', async () => {
      const dto = baseDto({ minInstallmentMonths: 12, maxInstallmentMonths: 6 });

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(
        'จำนวนงวดขั้นต่ำต้องน้อยกว่าหรือเท่ากับจำนวนงวดสูงสุด',
      );

      expect(prisma.interestConfig.create).not.toHaveBeenCalled();
    });
  });

  describe('guard allows min <= max', () => {
    it('forwards exactly the named fields to prisma.interestConfig.create for min < max', async () => {
      const dto = baseDto({ minInstallmentMonths: 6, maxInstallmentMonths: 12 });
      const created = { id: 'cfg-1', ...dto };
      prisma.interestConfig.create.mockResolvedValue(created);

      await expect(service.create(dto)).resolves.toBe(created);

      expect(prisma.interestConfig.create).toHaveBeenCalledTimes(1);
      expect(prisma.interestConfig.create).toHaveBeenCalledWith({
        data: {
          name: 'มือ 1',
          productCategories: ['PHONE_NEW'],
          interestRate: 0.02,
          minDownPaymentPct: 0.15,
          storeCommissionPct: 0.1,
          vatPct: 0.07,
          minInstallmentMonths: 6,
          maxInstallmentMonths: 12,
        },
      });
    });

    it('allows min === max (guard is strict `>`, message says น้อยกว่าหรือเท่ากับ)', async () => {
      const dto = baseDto({ minInstallmentMonths: 9, maxInstallmentMonths: 9 });
      prisma.interestConfig.create.mockResolvedValue({ id: 'cfg-eq' });

      await service.create(dto);

      expect(prisma.interestConfig.create).toHaveBeenCalledTimes(1);
      const dataArg = prisma.interestConfig.create.mock.calls[0][0].data;
      expect(dataArg.minInstallmentMonths).toBe(9);
      expect(dataArg.maxInstallmentMonths).toBe(9);
    });

    it('passes optional fields through as undefined (not stripped) when omitted', async () => {
      const dto = baseDto();
      delete dto.storeCommissionPct;
      delete dto.vatPct;
      prisma.interestConfig.create.mockResolvedValue({ id: 'cfg-opt' });

      await service.create(dto);

      const dataArg = prisma.interestConfig.create.mock.calls[0][0].data;
      expect('storeCommissionPct' in dataArg).toBe(true);
      expect('vatPct' in dataArg).toBe(true);
      expect(dataArg.storeCommissionPct).toBeUndefined();
      expect(dataArg.vatPct).toBeUndefined();
    });
  });
});
