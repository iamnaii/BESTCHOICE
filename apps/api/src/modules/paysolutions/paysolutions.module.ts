import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PaySolutionsController } from './paysolutions.controller';
import { PaySolutionsService } from './paysolutions.service';

@Module({
  imports: [PrismaModule, LineOaModule, IntegrationsModule],
  controllers: [PaySolutionsController],
  providers: [PaySolutionsService],
  exports: [PaySolutionsService],
})
export class PaySolutionsModule {}
