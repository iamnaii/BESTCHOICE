import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ShopAuthSocialController } from './shop-auth-social.controller';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: process.env.JWT_SECRET }),
    }),
  ],
  controllers: [ShopAuthSocialController],
  providers: [ShopAuthSocialService],
  exports: [ShopAuthSocialService],
})
export class ShopAuthSocialModule {}
