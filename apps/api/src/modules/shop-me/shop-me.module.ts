import { Module } from '@nestjs/common';
import { ShopMeController } from './shop-me.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ShopMeController],
})
export class ShopMeModule {}
