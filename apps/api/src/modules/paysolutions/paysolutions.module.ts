import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => LineOaModule),
    forwardRef(() => ReceiptsModule),
  ],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
