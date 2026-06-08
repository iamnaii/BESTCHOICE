import { Injectable } from '@nestjs/common';
import { EstimateDto } from './dto/estimate.dto';
import { SubmitTradeInDto } from './dto/submit.dto';
import { TradeInIntakeService } from './trade-in-intake.service';

/**
 * Trade-in / exchange — pays more than a pure buyback because the downstream
 * sale margin offsets it (margin floor 0.85 / ceil 1.05). The online-intake
 * flow is shared with buyback via TradeInIntakeService; only the margin, the
 * EXCHANGE flow tag, the optional target product, and the flex copy differ.
 */
@Injectable()
export class ShopTradeInService {
  constructor(private readonly intake: TradeInIntakeService) {}

  async estimate(dto: EstimateDto) {
    return this.intake.quote(dto, { minMult: 0.85, maxMult: 1.05 });
  }

  async submit(dto: SubmitTradeInDto, customerId: string | undefined) {
    return this.intake.submit(dto, customerId, {
      flow: 'EXCHANGE',
      productId: dto.targetProductId,
      flex: { altText: 'รับเรื่องเก่าแลกใหม่แล้ว', title: 'รับเรื่องเก่าแลกใหม่' },
    });
  }

  async getStatus(id: string) {
    return this.intake.getStatus(id);
  }
}
