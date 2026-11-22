import { BuybackQuestionAdminService } from './buyback-question-admin.service';
import { UpdateSellConfigDto } from '../dto/buyback-question.dto';

describe('BuybackQuestionAdminService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let service: BuybackQuestionAdminService;

  beforeEach(() => {
    prisma = {
      systemConfig: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    service = new BuybackQuestionAdminService(prisma);
  });

  it('returns the fixed policy even if a legacy percentage exists', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: '42' });
    expect(await service.getSellConfig()).toEqual({ exchangeBonusPct: 0, mode: 'TIERED_FIXED', threshold: 20000, lowerBonus: 500, upperBonus: 1000 });
  });

  it('rejects obsolete percentage changes without writing configuration', async () => {
    const dto: UpdateSellConfigDto = { exchangeBonusPct: 15 };
    await expect(service.updateSellConfig(dto)).rejects.toThrow('ไม่รองรับการตั้งเป็นเปอร์เซ็นต์');
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });
});
