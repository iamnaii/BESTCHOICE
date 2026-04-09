import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MdmController } from './mdm.controller';
import { MdmService } from './mdm.service';

@Module({
  imports: [PrismaModule],
  controllers: [MdmController],
  providers: [MdmService],
  exports: [MdmService],
})
export class MdmModule {}
