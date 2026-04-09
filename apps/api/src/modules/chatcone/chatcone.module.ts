import { Module } from '@nestjs/common';
import { ChatconeController } from './chatcone.controller';
import { ChatconeService } from './chatcone.service';

@Module({
  controllers: [ChatconeController],
  providers: [ChatconeService],
  exports: [ChatconeService],
})
export class ChatconeModule {}
