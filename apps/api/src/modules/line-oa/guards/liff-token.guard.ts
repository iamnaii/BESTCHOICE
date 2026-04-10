import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * LIFF Token Guard — verify LIFF ID token server-side via LINE API.
 *
 * Before this guard, LIFF endpoints trusted `lineId` from the client
 * (anyone who knew a LINE userId could access customer data).
 *
 * Now: frontend sends `X-Liff-Id-Token` header (from `liff.getIDToken()`),
 * backend verifies it with LINE (`https://api.line.me/oauth2/v2.1/verify`)
 * and extracts the real `sub` (LINE userId) from the token.
 *
 * The verified lineId is injected into `request.liffUserId` for controllers.
 *
 * Cache: verified tokens are cached for 5 minutes to reduce LINE API calls.
 */
@Injectable()
export class LiffTokenGuard implements CanActivate {
  private readonly logger = new Logger(LiffTokenGuard.name);
  private readonly channelId: string;
  // Cache: token → { lineUserId, expiresAt }
  private readonly cache = new Map<string, { lineUserId: string; expiresAt: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(private config: ConfigService) {
    // LIFF channel ID (LINE Login channel, not Messaging API)
    this.channelId = this.config.get<string>('LIFF_CHANNEL_ID') || '2009442540';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const idToken = request.headers['x-liff-id-token'] as string | undefined;

    if (!idToken) {
      // Fallback: allow lineId from query/body for backward compatibility during migration
      // TODO: remove this fallback after all LIFF pages send ID token
      const lineId = (request.query as Record<string, string>).lineId
        || (request.body as Record<string, string>)?.lineId;
      if (lineId) {
        (request as unknown as LiffRequest).liffUserId = lineId;
        return true;
      }
      throw new UnauthorizedException('กรุณาเปิดผ่าน LINE');
    }

    // Check cache
    const cached = this.cache.get(idToken);
    if (cached && cached.expiresAt > Date.now()) {
      (request as unknown as LiffRequest).liffUserId = cached.lineUserId;
      return true;
    }

    // Verify with LINE API
    try {
      const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `id_token=${encodeURIComponent(idToken)}&client_id=${this.channelId}`,
      });

      if (!res.ok) {
        this.logger.warn(`[LiffToken] LINE verify failed: ${res.status}`);
        throw new UnauthorizedException('LIFF token ไม่ถูกต้อง');
      }

      const data = (await res.json()) as { sub: string; name?: string; picture?: string };
      const lineUserId = data.sub;

      if (!lineUserId) {
        throw new UnauthorizedException('LIFF token ไม่มี userId');
      }

      // Cache the result
      this.cache.set(idToken, {
        lineUserId,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      this.cleanupCache();

      (request as unknown as LiffRequest).liffUserId = lineUserId;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.error(
        `[LiffToken] Verify error: ${err instanceof Error ? err.message : err}`,
      );
      throw new UnauthorizedException('ไม่สามารถยืนยันตัวตนได้');
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, val] of this.cache) {
      if (val.expiresAt < now) this.cache.delete(key);
    }
  }
}

export interface LiffRequest {
  liffUserId: string;
}
