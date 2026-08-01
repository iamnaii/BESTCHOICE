import { Module } from '@nestjs/common';
import { IntercompanyController } from './intercompany.controller';
import { IntercompanyService } from './intercompany.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IntercompanyController],
  providers: [IntercompanyService],
})
export class IntercompanyModule {}
