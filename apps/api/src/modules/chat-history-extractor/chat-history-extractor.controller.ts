import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChatHistoryExtractorService } from './chat-history-extractor.service';
import { KnowledgeExtractorService } from './knowledge-extractor.service';

@Controller('chat-history')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatHistoryExtractorController {
  constructor(
    private readonly svc: ChatHistoryExtractorService,
    private readonly knowledgeSvc: KnowledgeExtractorService,
  ) {}

  @Post('extract')
  @Roles('OWNER')
  async extract(@Body() body: { months?: number }) {
    return this.svc.extractAll(body.months ?? 12);
  }

  @Post('extract-knowledge')
  @Roles('OWNER')
  async extractKnowledge() {
    return this.knowledgeSvc.extractAndSeed();
  }
}
