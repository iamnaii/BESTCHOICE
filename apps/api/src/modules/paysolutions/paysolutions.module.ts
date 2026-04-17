import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';
import { LiffTokenGuard } from '../line-oa/guards/liff-token.guard';

@Module({
  imports: [PrismaModule, LineOaModule, IntegrationsModule],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService, LiffTokenGuard],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
