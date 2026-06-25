import { Module } from '@nestjs/common';
import { ConsecutiveMissedService } from './consecutive-missed.service';

@Module({
  providers: [ConsecutiveMissedService],
  exports: [ConsecutiveMissedService],
})
export class ConsecutiveMissedModule {}
