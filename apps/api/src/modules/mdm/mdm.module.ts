import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MdmAutoCron } from './mdm-auto.cron';
import { MdmAutoService } from './mdm-auto.service';
import { MdmController } from './mdm.controller';
import { MdmRestrictionsService } from './mdm-restrictions.service';
import { MdmService } from './mdm.service';

@Module({
  imports: [PrismaModule, LineOaModule, IntegrationsModule, NotificationsModule],
  controllers: [MdmController],
  providers: [MdmService, MdmAutoService, MdmAutoCron, MdmRestrictionsService],
  exports: [MdmService, MdmAutoService, MdmRestrictionsService],
})
export class MdmModule {}
