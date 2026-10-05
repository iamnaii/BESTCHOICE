import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FacebookCommentClient } from './facebook-comment-client';
import { FacebookCommentIngestService } from './facebook-comment-ingest.service';
/** No live transport is provided here. Only isolated test/preview modules bind a synthetic one. */
@Module({
  imports: [IntegrationsModule],
  providers: [FacebookCommentClient, FacebookCommentIngestService],
  exports: [FacebookCommentClient, FacebookCommentIngestService],
})
export class FacebookCommentsModule {}
