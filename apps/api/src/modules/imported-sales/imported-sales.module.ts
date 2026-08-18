import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ImportedSalesController } from './imported-sales.controller';
import { ImportedSalesService } from './imported-sales.service';

@Module({
  imports: [PrismaModule],
  controllers: [ImportedSalesController],
  providers: [ImportedSalesService],
})
export class ImportedSalesModule {}
