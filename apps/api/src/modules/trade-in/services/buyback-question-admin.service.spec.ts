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

  it('getSellConfig: ไม่มี row → default 10; updateSellConfig upsert พร้อม deletedAt:null', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    prisma.systemConfig.upsert.mockResolvedValue({});

    expect(await service.getSellConfig()).toEqual({ exchangeBonusPct: 10 });

    const dto: UpdateSellConfigDto = { exchangeBonusPct: 15 };
    await service.updateSellConfig(dto);

    const call = prisma.systemConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ key: 'sell_exchange_bonus_pct' });
    expect(call.update).toEqual({ value: '15', deletedAt: null });
    expect(call.create.value).toBe('15');
  });

  it('getSellConfig: row มี value → คืน parsed value', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: '42' });

    expect(await service.getSellConfig()).toEqual({ exchangeBonusPct: 42 });
  });
});
