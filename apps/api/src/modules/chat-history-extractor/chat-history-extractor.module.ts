import { Module } from '@nestjs/common';
import { ChatHistoryExtractorService } from './chat-history-extractor.service';
import { ChatHistoryExtractorController } from './chat-history-extractor.controller';
import { LineExtractorSource } from './sources/line-extractor.source';
import { FacebookExtractorSource } from './sources/facebook-extractor.source';

@Module({
  controllers: [ChatHistoryExtractorController],
  providers: [ChatHistoryExtractorService, LineExtractorSource, FacebookExtractorSource],
})
export class ChatHistoryExtractorModule {}
