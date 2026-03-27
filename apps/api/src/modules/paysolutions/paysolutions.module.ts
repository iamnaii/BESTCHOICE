import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
