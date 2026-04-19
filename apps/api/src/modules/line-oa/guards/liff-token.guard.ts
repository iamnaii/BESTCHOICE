import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { LineChannelType } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { LIFF_CHANNEL_KEY } from './liff-channel.decorator';

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
 *
 * Cross-company boundary (T6-C15): controllers/handlers tagged with
 * `@LiffChannel(channel)` get an additional check — if the verified lineUserId
 * is already linked (via CustomerLineLink) to a different channel, the request
 * is rejected with 403. This prevents cross-company enumeration where a
 * FINANCE-linked LINE account could probe SHOP LIFF endpoints (or vice versa).
 */
@Injectable()
export class LiffTokenGuard implements CanActivate {
  private readonly logger = new Logger(LiffTokenGuard.name);
  private readonly channelId: string;
  // Cache: token → { lineUserId, expiresAt }
  private readonly cache = new Map<string, { lineUserId: string; expiresAt: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private config: ConfigService,
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {
    // LIFF channel ID (LINE Login channel, not Messaging API)
    const channelId = this.config.get<string>('LIFF_CHANNEL_ID');
    if (!channelId) {
      this.logger.error('LIFF_CHANNEL_ID is not configured — LIFF auth will fail');
    }
    this.channelId = channelId || '';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const idToken = request.headers['x-liff-id-token'] as string | undefined;

    if (!idToken) {
      throw new UnauthorizedException('กรุณาเปิดผ่าน LINE');
    }

    let lineUserId: string | null = null;

    // Check cache
    const cached = this.cache.get(idToken);
    if (cached && cached.expiresAt > Date.now()) {
      lineUserId = cached.lineUserId;
    } else {
      // Verify with LINE API
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `id_token=${encodeURIComponent(idToken)}&client_id=${this.channelId}`,
          signal: controller.signal,
        });

        if (!res.ok) {
          this.logger.warn(`[LiffToken] LINE verify failed: ${res.status}`);
          throw new UnauthorizedException('LIFF token ไม่ถูกต้อง');
        }

        const data = (await res.json()) as { sub: string; name?: string; picture?: string };
        lineUserId = data.sub;

        if (!lineUserId) {
          throw new UnauthorizedException('LIFF token ไม่มี userId');
        }

        // Cache the result
        this.cache.set(idToken, {
          lineUserId,
          expiresAt: Date.now() + this.cacheTtlMs,
        });
        this.cleanupCache();
      } catch (err) {
        if (err instanceof UnauthorizedException) throw err;
        this.logger.error(
          `[LiffToken] Verify error: ${err instanceof Error ? err.message : err}`,
        );
        throw new UnauthorizedException('ไม่สามารถยืนยันตัวตนได้');
      } finally {
        clearTimeout(timeout);
      }
    }

    // Cross-company boundary check (T6-C15)
    await this.enforceChannelBoundary(context, lineUserId);

    (request as unknown as LiffRequest).liffUserId = lineUserId;
    return true;
  }

  /**
   * If the handler is tagged with @LiffChannel(expectedChannel), ensure that
   * any existing CustomerLineLink for this lineUserId lives on the same
   * channel. Accepts: (a) no link yet (pre-verification flow), (b) a link on
   * the expected channel. Rejects: a link on a different channel.
   *
   * Consistent 403 message for both "mismatch" and "link unknown" to reduce
   * enumeration signal.
   */
  private async enforceChannelBoundary(
    context: ExecutionContext,
    lineUserId: string,
  ): Promise<void> {
    const expected = this.reflector.getAllAndOverride<LineChannelType | undefined>(
      LIFF_CHANNEL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!expected) return;

    const links = await this.prisma.customerLineLink.findMany({
      where: { lineUserId, unlinkedAt: null, deletedAt: null },
      select: { channel: true },
    });

    if (links.length === 0) return; // not linked yet — allow (enables registration flow)

    const hasExpected = links.some((l) => l.channel === expected);
    if (!hasExpected) {
      this.logger.warn(
        `[LiffToken] Channel boundary rejected: lineUserId=${lineUserId.slice(0, 8)}... expected=${expected}`,
      );
      throw new ForbiddenException('ไม่สามารถเข้าถึงข้อมูลได้');
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
