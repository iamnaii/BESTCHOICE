import { Module } from '@nestjs/common';
import { RepossessionsController } from './repossessions.controller';
import { RepossessionsService } from './repossessions.service';

@Module({
  controllers: [RepossessionsController],
  providers: [RepossessionsService],
  exports: [RepossessionsService],
})
export class RepossessionsModule {}
