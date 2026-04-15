import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { MdmAutoCron } from './mdm-auto.cron';
import { MdmAutoService } from './mdm-auto.service';
import { MdmController } from './mdm.controller';
import { MdmService } from './mdm.service';

@Module({
  imports: [PrismaModule, LineOaModule],
  controllers: [MdmController],
  providers: [MdmService, MdmAutoService, MdmAutoCron],
  exports: [MdmService, MdmAutoService],
})
export class MdmModule {}
