import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CollectionsSessionModule } from '../collections-session/collections-session.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { CollectionsManageController } from './collections-manage.controller';
import { CollectionsManageService } from './collections-manage.service';

@Module({
  imports: [PrismaModule, CollectionsSessionModule, LineOaModule],
  controllers: [CollectionsManageController],
  providers: [CollectionsManageService],
})
export class CollectionsManageModule {}
