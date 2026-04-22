import { Module } from '@nestjs/common';
import { ChatHistoryExtractorService } from './chat-history-extractor.service';
import { ChatHistoryExtractorController } from './chat-history-extractor.controller';
import { LineExtractorSource } from './sources/line-extractor.source';
import { FacebookExtractorSource } from './sources/facebook-extractor.source';
import { KnowledgeExtractorService } from './knowledge-extractor.service';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [IntegrationsModule],
  controllers: [ChatHistoryExtractorController],
  providers: [
    ChatHistoryExtractorService,
    LineExtractorSource,
    FacebookExtractorSource,
    KnowledgeExtractorService,
  ],
})
export class ChatHistoryExtractorModule {}
