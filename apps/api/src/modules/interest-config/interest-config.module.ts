import { Module } from '@nestjs/common';
import { InterestConfigController } from './interest-config.controller';
import { InterestConfigService } from './interest-config.service';

@Module({
  controllers: [InterestConfigController],
  providers: [InterestConfigService],
  exports: [InterestConfigService],
})
export class InterestConfigModule {}
