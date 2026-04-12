import { Module } from '@nestjs/common';
import { CsatController } from './csat.controller';
import { CsatService } from './csat.service';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [LineOaModule],
  controllers: [CsatController],
  providers: [CsatService],
  exports: [CsatService],
})
export class CsatModule {}
