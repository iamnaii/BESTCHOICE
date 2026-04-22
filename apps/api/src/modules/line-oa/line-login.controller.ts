import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';

/**
 * LINE Login OAuth Controller — fallback for LIFF pages opened in regular browsers.
 *
 * Flow:
 * 1. Frontend detects it's NOT in LINE → redirects to GET /line-oa/line-login/authorize
 * 2. This endpoint redirects to LINE's OAuth authorize URL
 * 3. User logs in via LINE → LINE redirects to GET /line-oa/line-login/callback
 * 4. Callback exchanges code for access token → gets user profile → redirects back to frontend
 * 5. Frontend receives lineUserId + token via query params → stores in memory
 */
@Controller('line-oa/line-login')
@SkipCsrf()
export class LineLoginController {
  private readonly logger = new Logger(LineLoginController.name);
  private readonly channelId: string;
  private readonly channelSecret: string;
  private readonly frontendBaseUrl: string;

  private readonly apiBaseUrl: string;

  constructor(private config: ConfigService) {
    this.channelId = this.config.get<string>('LINE_LOGIN_CHANNEL_ID') || this.config.get<string>('LIFF_CHANNEL_ID') || '';
    this.channelSecret = this.config.get<string>('LINE_LOGIN_CHANNEL_SECRET') || '';
    this.frontendBaseUrl = this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    this.apiBaseUrl = this.config.get<string>('API_BASE_URL') || 'http://localhost:3000';
  }

  /**
   * Step 1: Redirect to LINE OAuth authorize
   * @param returnPath - the LIFF page path to return to after login (e.g., /liff/contract)
   */
  @Get('authorize')
  authorize(@Res() res: Response, @Query('returnPath') returnPath?: string) {
    if (!this.channelId) {
      throw new BadRequestException('LINE Login ยังไม่ได้ตั้งค่า');
    }

    const callbackUrl = `${this.apiBaseUrl}/api/line-oa/line-login/callback`;
    const state = encodeURIComponent(returnPath || '/liff/contract');

    const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    lineAuthUrl.searchParams.set('response_type', 'code');
    lineAuthUrl.searchParams.set('client_id', this.channelId);
    lineAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    lineAuthUrl.searchParams.set('state', state);
    lineAuthUrl.searchParams.set('scope', 'profile openid');

    res.redirect(lineAuthUrl.toString());
  }

  /**
   * Step 2: LINE redirects here with auth code → exchange for token → get profile → redirect to frontend
   */
  @Get('callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const returnPath = state ? decodeURIComponent(state) : '/liff/contract';

    if (error || !code) {
      this.logger.warn(`[LineLogin] Callback error: ${error || 'no code'}`);
      res.redirect(`${this.frontendBaseUrl}${returnPath}?login_error=true`);
      return;
    }

    try {
      const callbackUrl = `${this.apiBaseUrl}/api/line-oa/line-login/callback`;

      // Exchange code for access token + ID token
      const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUrl,
          client_id: this.channelId,
          client_secret: this.channelSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        this.logger.error(`[LineLogin] Token exchange failed: ${tokenRes.status} ${errBody}`);
        res.redirect(`${this.frontendBaseUrl}${returnPath}?login_error=true`);
        return;
      }

      const tokenData = await tokenRes.json() as {
        access_token: string;
        id_token: string;
        token_type: string;
      };

      // Get user profile with access token
      const profileRes = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!profileRes.ok) {
        this.logger.error(`[LineLogin] Profile fetch failed: ${profileRes.status}`);
        res.redirect(`${this.frontendBaseUrl}${returnPath}?login_error=true`);
        return;
      }

      const profile = await profileRes.json() as {
        userId: string;
        displayName: string;
        pictureUrl?: string;
      };

      this.logger.log(`[LineLogin] Success: ${profile.displayName} (${profile.userId})`);

      // Redirect back to frontend with LINE data as query params
      // Frontend will pick these up and store in memory
      const redirectUrl = new URL(`${this.frontendBaseUrl}${returnPath}`);
      redirectUrl.searchParams.set('line_login', 'true');
      redirectUrl.searchParams.set('line_user_id', profile.userId);
      redirectUrl.searchParams.set('line_display_name', profile.displayName);
      if (profile.pictureUrl) {
        redirectUrl.searchParams.set('line_picture', profile.pictureUrl);
      }
      // Set ID token in httpOnly cookie instead of URL (prevents leaking in browser history/Referrer)
      // COOKIE_DOMAIN (e.g. '.bestchoicephone.app') makes the cookie readable from
      // the root domain frontend, not only the api.* subdomain that served this callback.
      //
      // sameSite: 'none' (ไม่ใช่ 'lax') เพราะ frontend เรียก /id-token ผ่าน XHR
      // ข้าม subdomain (bestchoicephone.app → api.bestchoicephone.app) — WebKit
      // (Safari/LINE in-app WKWebView) ไม่ส่ง cookie sameSite=lax ใน XHR cross-
      // origin แม้ว่าจะ same-site เดียวกันก็ตาม. maxAge ขยายจาก 60s → 300s
      // เผื่อ network ช้าใน LINE WebView
      const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
      res.cookie('line_id_token', tokenData.id_token, {
        httpOnly: true,
        secure: true, // required for sameSite: 'none'
        sameSite: 'none',
        maxAge: 300_000, // 5 minutes — one-time use, buffer for slow networks
        path: '/',
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      });

      res.redirect(redirectUrl.toString());
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      this.logger.error(
        `[LineLogin] Error${isTimeout ? ' (timeout)' : ''}: ${err instanceof Error ? err.message : err}`,
      );
      if (isTimeout) {
        Sentry.captureException(err, {
          tags: { module: 'line-login', reason: 'timeout' },
        });
      }
      res.redirect(`${this.frontendBaseUrl}${returnPath}?login_error=true`);
    }
  }

  /**
   * One-shot endpoint — returns id_token from httpOnly cookie then clears it.
   * Frontend calls this right after the /callback redirect to pick up the token
   * the callback stored. Token is then kept in JS memory for LIFF API headers.
   */
  @Get('id-token')
  getIdToken(@Req() req: Request, @Res() res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.line_id_token;
    const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
    res.clearCookie('line_id_token', {
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
    if (!token) {
      return res.status(401).json({ error: 'No id_token cookie' });
    }
    return res.json({ token });
  }
}
