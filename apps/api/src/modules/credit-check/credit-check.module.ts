import { Module } from '@nestjs/common';
import { GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController, RiskScoreController } from './credit-check.controller';
import { CreditCheckService } from './credit-check.service';
import { RiskScoringService } from './risk-scoring.service';
import { PredictiveRiskService } from './predictive-risk.service';

@Module({
  controllers: [GlobalCreditCheckController, CreditCheckController, CustomerCreditCheckController, RiskScoreController],
  providers: [CreditCheckService, RiskScoringService, PredictiveRiskService],
  exports: [CreditCheckService, RiskScoringService, PredictiveRiskService],
})
export class CreditCheckModule {}
