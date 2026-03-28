import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';

/**
 * Custom throttler guard that combines IP-based and user-based rate limiting.
 * Uses `user:<userId>` as the tracker key for authenticated requests,
 * falling back to IP-based limiting for unauthenticated requests.
 *
 * This prevents a single user from overwhelming financial endpoints
 * (e.g., rapid payment recording) even if they share an IP with others.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // If user is authenticated, use user ID as the tracker
    const userId = req.user?.id || req.user?.sub;
    if (userId) {
      return `user:${userId}`;
    }
    // Fall back to IP-based tracking
    return req.ips?.length ? req.ips[0] : req.ip;
  }

  protected async throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new ThrottlerException('คำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่');
  }
}
