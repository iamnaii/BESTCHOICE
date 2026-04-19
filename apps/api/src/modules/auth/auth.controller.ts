import { Controller, Post, Get, Body, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth , ApiOperation} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { VerifyTwoFactorDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  branchId: string | null;
}

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function setRefreshCookie(res: Response, token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  // Cookie domain: .bestchoicephone.app — shared between
  // bestchoicephone.app (frontend) and api.bestchoicephone.app (API).
  // These are same-site (same registrable domain), so SameSite=Lax is
  // sufficient AND avoids being treated as a third-party cookie by
  // Safari ITP / Chrome 3rd-party blocking / Brave shields — which
  // silently dropped the cookie on refresh and forced re-login every F5.
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined; // e.g. '.bestchoicephone.app'
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProduction || !!cookieDomain,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/api/auth',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

function clearRefreshCookie(res: Response) {
  const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
  res.clearCookie(REFRESH_COOKIE, {
    path: '/api/auth',
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
}

@ApiTags('Auth')
@ApiBearerAuth('JWT')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private twoFactorService: TwoFactorService,
  ) {}

  @Post('login')
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'เข้าสู่ระบบ (email + password)' })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = { ipAddress: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
    const result = await this.authService.login(loginDto, meta);

    // If user has 2FA enabled, require verification before issuing tokens
    if (result.user && await this.twoFactorService.isTwoFactorEnabled(result.user.id)) {
      // Don't return tokens yet — return a challenge
      return {
        requiresTwoFactor: true,
        userId: result.user.id,
        message: 'กรุณากรอกรหัส OTP จาก Authenticator App',
      };
    }

    setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('login/2fa')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'เข้าสู่ระบบด้วย 2FA (email + password + OTP)' })
  async loginWith2FA(
    @Body() body: { email: string; password: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta = { ipAddress: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
    const result = await this.authService.loginWith2FA(
      body.email,
      body.password,
      body.code,
      this.twoFactorService,
      meta,
    );
    setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @Throttle({ short: { ttl: 60000, limit: 10 } }) // 10 refresh attempts per minute
  @ApiOperation({ summary: 'Refresh access token (cookie-only)' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // T7-C5: Cookie-only — body `refreshToken` no longer accepted.
    // httpOnly cookie is not readable from JS and travels automatically; accepting
    // the token in the body was a CSRF exfiltration risk if SameSite ever dropped.
    // Web client already uses cookie (apps/web/src/lib/api.ts posts empty body).
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Refresh token ไม่ถูกต้องหรือหมดอายุ');
    }
    const result = await this.authService.refreshToken(token);
    setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'ออกจากระบบ' })
  async logout(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE] || body.refreshToken;
    await this.authService.logout(token || '', user.id);
    clearRefreshCookie(res);
    return { message: 'ออกจากระบบสำเร็จ' };
  }

  @Post('forgot-password')
  @Throttle({ short: { ttl: 60000, limit: 5 } }) // 5 requests per minute to prevent abuse
  @ApiOperation({ summary: 'ขอลิงก์รีเซ็ตรหัสผ่าน' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'ตั้งรหัสผ่านใหม่' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'ข้อมูลผู้ใช้ปัจจุบัน' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  // ─── Two-Factor Authentication ───────────────────────

  @Post('2fa/generate')
  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: 'สร้าง QR code สำหรับ 2FA' })
  async generate2FA(@CurrentUser('id') userId: string) {
    return this.twoFactorService.generateSecret(userId);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'เปิดใช้ 2FA (ยืนยันด้วย OTP)' })
  async enable2FA(@CurrentUser('id') userId: string, @Body() dto: VerifyTwoFactorDto) {
    return this.twoFactorService.enableTwoFactor(userId, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'ปิด 2FA' })
  async disable2FA(@CurrentUser('id') userId: string, @Body() dto: VerifyTwoFactorDto) {
    return this.twoFactorService.disableTwoFactor(userId, dto.code);
  }

  @Get('2fa/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'ตรวจสอบสถานะ 2FA' })
  async get2FAStatus(@CurrentUser('id') userId: string) {
    const enabled = await this.twoFactorService.isTwoFactorEnabled(userId);
    return { enabled };
  }
}
