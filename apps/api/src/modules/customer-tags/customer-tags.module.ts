import { Module } from '@nestjs/common';
import { CustomerTagsController } from './customer-tags.controller';
import { CustomerTagsService } from './customer-tags.service';
import { CustomerTagRecomputeCron } from './customer-tag-recompute.cron';

@Module({
  controllers: [CustomerTagsController],
  providers: [CustomerTagsService, CustomerTagRecomputeCron],
  exports: [CustomerTagsService],
})
export class CustomerTagsModule {}
