import { Module } from '@nestjs/common';
import { StickersController } from './stickers.controller';
import { StickersService } from './stickers.service';

@Module({
  controllers: [StickersController],
  providers: [StickersService],
  exports: [StickersService],
})
export class StickersModule {}
