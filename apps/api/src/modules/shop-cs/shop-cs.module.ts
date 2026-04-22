import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ShopCsController } from './shop-cs.controller';
import { ShopCsService } from './shop-cs.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ShopCsController],
  providers: [ShopCsService],
  exports: [ShopCsService],
})
export class ShopCsModule {}
