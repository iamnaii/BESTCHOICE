import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CollectionsSessionModule } from '../collections-session/collections-session.module';
import { CollectionsManageController } from './collections-manage.controller';
import { CollectionsManageService } from './collections-manage.service';

@Module({
  imports: [PrismaModule, CollectionsSessionModule],
  controllers: [CollectionsManageController],
  providers: [CollectionsManageService],
})
export class CollectionsManageModule {}
