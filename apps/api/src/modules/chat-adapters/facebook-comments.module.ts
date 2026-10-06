import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FACEBOOK_COMMENT_TRANSPORT, FacebookCommentClient } from './facebook-comment-client';
import { FacebookCommentGraphTransport } from './facebook-comment-graph.transport';
import { FacebookCommentIngestService } from './facebook-comment-ingest.service';
@Module({
  imports: [IntegrationsModule],
  providers: [
    FacebookCommentClient,
    FacebookCommentIngestService,
    FacebookCommentGraphTransport,
    { provide: FACEBOOK_COMMENT_TRANSPORT, useExisting: FacebookCommentGraphTransport },
  ],
  exports: [FacebookCommentClient, FacebookCommentIngestService],
})
export class FacebookCommentsModule {}
