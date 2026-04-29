import { Module } from '@nestjs/common';
import { IntercompanyController } from './intercompany.controller';
import { IntercompanyService } from './intercompany.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { JournalModule } from '../journal/journal.module';

@Module({
  imports: [PrismaModule, JournalModule],
  controllers: [IntercompanyController],
  providers: [IntercompanyService],
})
export class IntercompanyModule {}
