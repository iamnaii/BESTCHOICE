import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { SkipCsrf } from '../../guards/skip-csrf.decorator';
import {
  buildFrontendReturnUrl,
  loginNonceMatches,
  primaryFrontendUrl,
  sanitizeLoginNonce,
  sanitizeReturnPath,
} from '../../utils/line-login.util';
import { VerifyLineLoginDto } from './dto/verify-line-login.dto';

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LOGIN_REJECTED_MESSAGE = 'ยืนยันการเข้าสู่ระบบ LINE ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่';

/** ตัวตนจาก id_token ที่ LINE ยืนยันแล้วและ nonce ตรงกับแท็บที่เริ่มล็อกอิน */
export interface VerifiedLineLogin {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/**
 * LINE Login OAuth Controller — fallback for LIFF pages opened in regular browsers.
 *
 * Flow (Task 21 I-A — OIDC nonce ผูก token กับแท็บที่เริ่มล็อกอิน):
 * 1. หน้าเว็บ (`useLiffInit`) สุ่ม nonce เก็บ sessionStorage ของแท็บ → GET /line-oa/line-login/authorize?nonce=…
 * 2. authorize ส่งต่อ `nonce` ให้ LINE (LINE ฝังเป็น claim ใน id_token — ผู้โจมตีแก้ไม่ได้)
 * 3. LINE → GET /line-oa/line-login/callback → แลก code ได้ id_token → redirect กลับหน้าเว็บด้วย `#id_token=` เท่านั้น
 *    (ไม่มี userId/ชื่อ/รูปใน query — ปลอมได้และเป็น PII ใน URL/log)
 * 4. หน้าเว็บ POST /line-oa/line-login/verify { idToken, nonce ของแท็บ } → API ยืนยันกับ LINE (ลายเซ็น/aud/exp/nonce)
 *    → คืนตัวตนจาก payload ที่ยืนยันแล้ว. ไม่ตรง/ไม่มี nonce = 401 ⇒ หน้าเว็บทิ้ง token แล้วเริ่มล็อกอินใหม่
 * ⇒ code ของผู้โจมตี (ส่งลิงก์ callback ให้เหยื่อ) และลิงก์หน้าเว็บที่ฝัง `#id_token=` ของผู้โจมตี ใช้ไม่ได้ทั้งคู่
 *
 * ไม่ใช้ cookie ผูก state ฝั่ง API: บน prod หน้าเว็บเรียก authorize ผ่าน rewrite `/api/**` ของ Firebase Hosting
 * (host ของเว็บ — Firebase ส่งต่อเฉพาะ cookie `__session` ไปที่ Cloud Run) แต่ callback อยู่ที่ host ของ API
 * (`API_BASE_URL`) ⇒ cookie แบบ host-only ที่ตั้งตอน authorize ไปไม่ถึง callback
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
    this.channelId =
      this.config.get<string>('LINE_LOGIN_CHANNEL_ID') ||
      this.config.get<string>('LIFF_CHANNEL_ID') ||
      '';
    this.channelSecret = this.config.get<string>('LINE_LOGIN_CHANNEL_SECRET') || '';
    // M3: FRONTEND_URL อาจเป็นรายการ origin คั่น comma (ชุดเดียวกับ CORS) — ปลายทางใช้ค่าแรก
    this.frontendBaseUrl = primaryFrontendUrl(this.config.get<string>('FRONTEND_URL'));
    this.apiBaseUrl = this.config.get<string>('API_BASE_URL') || 'http://localhost:3000';
  }

  /**
   * Step 1: Redirect to LINE OAuth authorize
   * @param returnPath - the LIFF page path to return to after login (e.g., /liff/contract)
   */
  @Get('authorize')
  authorize(
    @Res() res: Response,
    @Query('returnPath') returnPath?: string,
    @Query('nonce') nonce?: string,
  ) {
    if (!this.channelId) {
      throw new BadRequestException('LINE Login ยังไม่ได้ตั้งค่า');
    }

    const callbackUrl = `${this.apiBaseUrl}/api/line-oa/line-login/callback`;
    // C2: state เป็นข้อความธรรมดา (ไม่ลงนาม) — callback ตรวจซ้ำเสมอ ที่นี่กรองไว้ชั้นแรก
    const state = encodeURIComponent(sanitizeReturnPath(returnPath));

    const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    lineAuthUrl.searchParams.set('response_type', 'code');
    lineAuthUrl.searchParams.set('client_id', this.channelId);
    lineAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    lineAuthUrl.searchParams.set('state', state);
    lineAuthUrl.searchParams.set('scope', 'profile openid');
    // I-A: nonce ของแท็บ (รูปแบบผิด = ไม่ส่ง ⇒ token ไม่มี nonce ⇒ หน้าเว็บไม่รับ แล้วเริ่มใหม่พร้อม nonce)
    const safeNonce = sanitizeLoginNonce(nonce);
    if (safeNonce) lineAuthUrl.searchParams.set('nonce', safeNonce);

    res.redirect(lineAuthUrl.toString());
  }

  /**
   * Step 2: LINE redirects here with auth code → exchange for id_token → redirect to the page with `#id_token=`
   */
  @Get('callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    // C2: state มาจาก query ที่ใครก็ปลอมได้ (ไม่ลงนาม ไม่ผูก session) ⇒ ห้ามเชื่อ — สร้างปลายทางด้วย
    // buildFrontendReturnUrl เท่านั้น (path สัมพัทธ์ + origin ต้องเป็นเว็บของเรา) ทั้งทางสำเร็จและทาง error
    const returnPath = this.decodeState(state);
    const redirectLoginError = () => {
      try {
        const url = buildFrontendReturnUrl(this.frontendBaseUrl, returnPath);
        url.searchParams.set('login_error', 'true');
        res.redirect(url.toString());
      } catch (err) {
        // M3: FRONTEND_URL ใช้ไม่ได้ ⇒ ไม่มีที่ redirect — ตอบ 500 ข้อความกลาง (เดิม throw ออกนอก try = 500 ดิบ)
        this.logger.error(
          `[LineLogin] Cannot build redirect (FRONTEND_URL?): ${err instanceof Error ? err.message : err}`,
        );
        Sentry.captureException(err, { tags: { module: 'line-login', reason: 'frontend-url' } });
        res.status(500).send('ระบบเข้าสู่ระบบด้วย LINE ขัดข้อง กรุณาลองใหม่ภายหลัง');
      }
    };

    if (error || !code) {
      this.logger.warn(`[LineLogin] Callback error: ${error || 'no code'}`);
      redirectLoginError();
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
        redirectLoginError();
        return;
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        id_token: string;
        token_type: string;
      };
      if (!tokenData.id_token) {
        this.logger.error('[LineLogin] Token exchange returned no id_token');
        redirectLoginError();
        return;
      }

      this.logger.log('[LineLogin] Code exchanged — handing the id_token back to the page');

      // Pass ID token via URL fragment (hash), not cookie:
      // - WebKit ITP + LINE WKWebView block cross-subdomain cookies แม้ว่า
      //   sameSite=none + secure + domain ตรง (confirmed 401 ใน Cloud Run logs)
      // - URL fragment (#) ไม่ถูกส่งไปที่ server (client-only) — ไม่ leak
      //   ใน referrer header หรือ server access logs
      // - Frontend อ่าน location.hash → clear hash ทันที → ยืนยัน nonce ที่ POST verify ก่อนใช้ (I-A)
      // I-A: ไม่ส่ง userId/ชื่อ/รูปใน query อีก — หน้าเว็บเอาตัวตนจาก token ที่ยืนยันแล้วเท่านั้น
      // (query ปลอมได้ และเป็น PII ใน URL/access log) ⇒ ไม่ต้องเรียก /v2/profile
      const redirectUrl = buildFrontendReturnUrl(this.frontendBaseUrl, returnPath);
      redirectUrl.searchParams.set('line_login', 'true');
      redirectUrl.hash = `id_token=${encodeURIComponent(tokenData.id_token)}`;

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
      redirectLoginError();
    }
  }

  /**
   * Step 3 (I-A): หน้าเว็บส่ง id_token ที่มากับ URL + nonce ของแท็บที่เริ่มล็อกอิน → ยืนยันกับ LINE
   * (`/oauth2/v2.1/verify` ตรวจลายเซ็น · aud = channel นี้ · exp · nonce) แล้วเทียบ `nonce`/`aud` ซ้ำเอง ·
   * คืนตัวตนจาก payload ที่ยืนยันแล้ว — หน้าเว็บห้ามใช้ token ที่มากับ URL โดยไม่ผ่านทางนี้.
   * token จาก LIFF SDK (`liff.getIDToken()` ในแอป LINE — ไม่ผ่าน redirect) ไม่ใช้ทางนี้ (`LiffTokenGuard` ตามเดิม)
   */
  @Post('verify')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 20 } }) // 20/นาที/IP — หน้าเว็บเรียกครั้งเดียวต่อการล็อกอิน
  async verify(@Body() dto: VerifyLineLoginDto): Promise<VerifiedLineLogin> {
    // ด่านซ้ำกับ DTO (ValidationPipe) — ไม่มี nonce = ห้ามรับ token จาก URL ไม่ว่าทางไหน
    const nonce = sanitizeLoginNonce(dto?.nonce);
    const idToken = typeof dto?.idToken === 'string' ? dto.idToken : '';
    if (!nonce || !idToken) {
      throw new BadRequestException('ข้อมูลเข้าสู่ระบบ LINE ไม่ครบ กรุณาเข้าสู่ระบบใหม่');
    }
    if (!this.channelId) {
      throw new BadRequestException('LINE Login ยังไม่ได้ตั้งค่า');
    }

    let payload: {
      sub?: unknown;
      aud?: unknown;
      nonce?: unknown;
      name?: unknown;
      picture?: unknown;
    };
    try {
      const verifyRes = await fetch(LINE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: this.channelId, nonce }),
        signal: AbortSignal.timeout(10_000),
      });
      if (verifyRes.status >= 500) {
        throw new Error(`LINE verify answered ${verifyRes.status}`); // LINE ขัดข้อง ≠ token ผิด → 503 ด้านล่าง
      }
      if (!verifyRes.ok) {
        // ไม่ log token/nonce — สถานะพอสำหรับไล่ปัญหา (LINE ตอบ 400 เมื่อ nonce/exp/ลายเซ็นไม่ผ่าน)
        this.logger.warn(`[LineLogin] id_token rejected by LINE verify: ${verifyRes.status}`);
        throw new UnauthorizedException(LOGIN_REJECTED_MESSAGE);
      }
      payload = (await verifyRes.json()) as typeof payload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      this.logger.error(
        `[LineLogin] verify unavailable${isTimeout ? ' (timeout)' : ''}: ${err instanceof Error ? err.message : err}`,
      );
      Sentry.captureException(err, {
        tags: { module: 'line-login', reason: isTimeout ? 'verify-timeout' : 'verify-error' },
      });
      throw new ServiceUnavailableException('ระบบยืนยัน LINE ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง');
    }

    // ชั้นที่สอง (ไม่พึ่ง LINE อย่างเดียว): claim nonce ต้องเท่ากับ nonce ของแท็บ · aud = channel นี้ · มี sub
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.aud !== this.channelId ||
      !loginNonceMatches(nonce, payload.nonce)
    ) {
      this.logger.warn('[LineLogin] id_token claims do not match this login (nonce/aud/sub)');
      throw new UnauthorizedException(LOGIN_REJECTED_MESSAGE);
    }
    return {
      lineUserId: payload.sub,
      displayName: typeof payload.name === 'string' ? payload.name : '',
      pictureUrl:
        typeof payload.picture === 'string' && payload.picture ? payload.picture : undefined,
    };
  }

  /** state ที่ decode ไม่ได้ (เช่น `%E0%A4%A` ที่ผู้โจมตีส่งมา) = ไม่มี state ไม่ใช่ 500 */
  private decodeState(state?: string): string | undefined {
    if (!state) return undefined;
    try {
      return decodeURIComponent(state);
    } catch {
      return undefined;
    }
  }
}
