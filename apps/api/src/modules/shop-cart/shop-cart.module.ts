import { Module } from '@nestjs/common';
import { ShopCartService } from './shop-cart.service';
import { ShopCartController } from './shop-cart.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ShopCartController],
  providers: [ShopCartService],
  exports: [ShopCartService],
})
export class ShopCartModule {}
