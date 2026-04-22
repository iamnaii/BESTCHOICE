import { Module } from '@nestjs/common';
import { FacebookAppReviewController } from './facebook-app-review.controller';
import { FacebookAppReviewService } from './facebook-app-review.service';

/**
 * FacebookAppReviewModule — admin-only endpoints that exercise every Graph
 * API permission BESTCHOICE has requested for Facebook App Review. Each
 * endpoint is a thin wrapper around a single Graph API call so reviewers (and
 * our own ops) can hit them in sequence from Live Mode to satisfy the
 * "at least 1 API call per permission" requirement.
 */
@Module({
  controllers: [FacebookAppReviewController],
  providers: [FacebookAppReviewService],
  exports: [FacebookAppReviewService],
})
export class FacebookAppReviewModule {}
