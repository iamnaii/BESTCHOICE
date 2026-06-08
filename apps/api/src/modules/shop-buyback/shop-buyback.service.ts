import { Injectable } from '@nestjs/common';
import { QuickQuoteDto } from './dto/quick-quote.dto';
import { SubmitBuybackDto } from './dto/submit.dto';
import { TradeInIntakeService } from '../shop-trade-in/trade-in-intake.service';

/**
 * Buyback (pure cash-out) — pays less than trade-in because there is no
 * downstream sale margin to offset (margin floor 0.80 / ceil 0.95). The
 * online-intake flow itself is shared with trade-in via TradeInIntakeService;
 * only the margin, the BUYBACK flow tag, and the confirmation-flex copy differ.
 */
@Injectable()
export class ShopBuybackService {
  constructor(private readonly intake: TradeInIntakeService) {}

  async quickQuote(dto: QuickQuoteDto) {
    return this.intake.quote(dto, { minMult: 0.8, maxMult: 0.95 });
  }

  async submit(dto: SubmitBuybackDto, customerId: string | undefined) {
    return this.intake.submit(dto, customerId, {
      flow: 'BUYBACK',
      flex: { altText: 'รับเรื่องรับซื้อแล้ว', title: 'รับเรื่องรับซื้อมือถือ' },
    });
  }

  async getStatus(id: string) {
    return this.intake.getStatus(id);
  }
}
