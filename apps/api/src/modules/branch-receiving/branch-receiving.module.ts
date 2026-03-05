import { Module } from '@nestjs/common';
import { BranchReceivingController } from './branch-receiving.controller';
import { BranchReceivingService } from './branch-receiving.service';

@Module({
  controllers: [BranchReceivingController],
  providers: [BranchReceivingService],
  exports: [BranchReceivingService],
})
export class BranchReceivingModule {}
