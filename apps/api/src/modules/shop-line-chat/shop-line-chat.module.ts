import { Module } from '@nestjs/common';
import { ShopLineChatController } from './shop-line-chat.controller';
import { ShopLineChatService } from './shop-line-chat.service';
import { LineOaModule } from '../line-oa/line-oa.module';

@Module({
  imports: [LineOaModule],
  controllers: [ShopLineChatController],
  providers: [ShopLineChatService],
})
export class ShopLineChatModule {}
