import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { CrmPipelineService } from './services/crm-pipeline.service';
import { CustomerScoringService } from './services/customer-scoring.service';

@Module({
  controllers: [CrmController],
  providers: [CrmPipelineService, CustomerScoringService],
  exports: [CrmPipelineService, CustomerScoringService],
})
export class CrmModule {}
