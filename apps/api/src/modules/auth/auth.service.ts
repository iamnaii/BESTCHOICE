import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { EmailService } from '../email/email.service';
import { LoginAuditService, LoginFailureKind } from './login-audit.service';

// Account lockout configuration. Tunable via env if needed later.
const LOCKOUT_THRESHOLD = 5; // failures before lock
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Password reset per-email rate limit (T7-C2).
// Prevents an attacker from spamming 1000s of reset emails to a target inbox
// and also reduces email-enumeration signal via bounce timing.
// Kept lightweight (in-memory Map) because:
//   - throttler is per-IP, not per-email
//   - DB-backed counter = extra write on a public endpoint
// Process-local is acceptable: attacker would still hit the per-IP throttle
// on the controller, and bypassing both would need many IPs AND many replicas.
const PASSWORD_RESET_MAX_PER_WINDOW = 3;
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface AuthMeta {
  ipAddress?: string;
  userAgent?: string;
  acceptLanguage?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * Per-email password reset request timestamps (T7-C2).
   * Map<lowercased email, number[] of request timestamps in ms>.
   * Cleaned up lazily inside `isPasswordResetRateLimited`.
   */
  private readonly passwordResetAttempts = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private loginAudit: LoginAuditService,
  ) {}

  /**
   * T7-C2: Returns true if this email has exceeded the allowed number of
   * password reset requests within the rolling window.
   *
   * Side-effect: records the new timestamp when under the limit. This means
   * a single call both checks and increments — callers should invoke it
   * exactly once per forgotPassword request.
   *
   * Intentionally silent (no exception). Caller returns the generic
   * "if this email exists…" message to preserve enumeration resistance —
   * an attacker must not be able to distinguish "rate-limited" from
   * "email not on file" via response shape or status code.
   */
  private isPasswordResetRateLimited(email: string): boolean {
    const key = email.toLowerCase();
    const now = Date.now();
    const cutoff = now - PASSWORD_RESET_WINDOW_MS;
    const existing = this.passwordResetAttempts.get(key) ?? [];
    const recent = existing.filter((t) => t > cutoff);

    if (recent.length >= PASSWORD_RESET_MAX_PER_WINDOW) {
      // Keep the trimmed list so stale entries don't grow unbounded.
      this.passwordResetAttempts.set(key, recent);
      return true;
    }

    recent.push(now);
    this.passwordResetAttempts.set(key, recent);
    return false;
  }

  private async auditLogin(
    emailTried: string,
    success: boolean,
    meta: AuthMeta | undefined,
    userId?: string | null,
    failureKind?: LoginFailureKind,
    twoFactorUsed = false,
  ): Promise<void> {
    void this.loginAudit.record({
      emailTried,
      success,
      userId,
      failureKind,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      acceptLanguage: meta?.acceptLanguage,
      twoFactorUsed,
    });
  }

  /**
   * Hash a raw refresh token using SHA-256 for secure DB storage.
   * SHA-256 is appropriate here because refresh tokens are high-entropy
   * random strings (64 bytes), so brute-force is infeasible.
   */
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Sign a short-lived temp JWT for the 2-step login flow.
   * Uses `aud` claim to namespace so it cannot be used as a full access token.
   */
  private signTempToken(userId: string, scope: '2fa_login' | '2fa_setup'): string {
    return this.jwtService.sign(
      { sub: userId, scope },
      {
        secret: this.configService.get<string>('JWT_SECRET')!,
        expiresIn: '5m',
        audience: scope,
      },
    );
  }

  /**
   * Verify a temp JWT and return its payload.
   * Throws UnauthorizedException if invalid, expired, or wrong audience.
   */
  private verifyTempToken(tempToken: string, expectedScope: '2fa_login' | '2fa_setup') {
    try {
      return this.jwtService.verify<{ sub: string; scope: string }>(tempToken, {
        secret: this.configService.get<string>('JWT_SECRET')!,
        audience: expectedScope,
      });
    } catch {
      throw new UnauthorizedException('Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
  }

  async login(loginDto: LoginDto, meta?: AuthMeta): Promise<
    | { state: 'AUTHENTICATED'; accessToken: string; refreshToken: string; user: object }
    | { state: 'OTP_REQUIRED'; tempToken: string }
    | { state: '2FA_SETUP_REQUIRED'; tempToken: string }
  > {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: { branch: true },
    });

    if (!user) {
      await this.auditLogin(loginDto.email, false, meta, null, 'user_not_found');
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }
    if (user.deletedAt || !user.isActive) {
      await this.auditLogin(loginDto.email, false, meta, user.id, 'account_disabled');
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    // Reject if currently locked. Use a generic message so attackers can't
    // distinguish "wrong password" from "locked" — both surface the same error.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.logger.warn(`Login attempt on locked account ${user.id}`);
      await this.auditLogin(loginDto.email, false, meta, user.id, 'account_locked');
      throw new UnauthorizedException(
        'บัญชีถูกล็อคชั่วคราว กรุณาลองใหม่ในอีกสักครู่',
      );
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      // Atomic increment to avoid the read-modify-write race where two
      // concurrent wrong-password requests both observe the same
      // failedLoginAttempts and write the same value, allowing a few
      // attempts to slip past the lockout threshold. (Audit finding P1.)
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (updated.failedLoginAttempts >= LOCKOUT_THRESHOLD) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
        });
        this.logger.warn(
          `Account ${user.id} locked after ${updated.failedLoginAttempts} failed attempts`,
        );
      }
      await this.auditLogin(loginDto.email, false, meta, user.id, 'wrong_password');
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    // Successful credential check → reset counters + stamp lastLoginAt.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // ── 2-step login state machine ──────────────────────────────────────
    // State 1: 2FA is enabled → require OTP before issuing full JWT
    if (user.twoFactorEnabled) {
      const tempToken = this.signTempToken(user.id, '2fa_login');
      await this.auditLogin(loginDto.email, false, meta, user.id, 'other');
      return { state: 'OTP_REQUIRED', tempToken };
    }

    // 2FA enrollment enforcement is disabled by product decision (P1Q6 deferred).
    // Voluntary 2FA via twoFactorEnabled (State 1 above) still works for users who opt in.

    // State 2: Fully authenticated
    await this.auditLogin(loginDto.email, true, meta, user.id);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      // Audience claim: distinguishes admin-app JWTs from shop/customer JWTs (C3).
      // JwtAudienceGuard enforces this at endpoint level via @RequireAudience('admin').
      aud: 'admin',
      scope: 'admin:full',
      // SP7.1 — dual-entity authorization
      accessibleCompanies: user.accessibleCompanies,
      primaryCompany: user.primaryCompany,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET')!,
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m') as JwtSignOptions['expiresIn'],
    });

    const refreshToken = await this.createRefreshToken(user.id);

    return {
      state: 'AUTHENTICATED',
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchId: user.branchId,
        branchName: user.branch?.name || null,
      },
    };
  }

  /**
   * Complete login after 2FA verification.
   * Verifies the temp token (scope: 2fa_login), then validates OTP via TwoFactorService.
   * Returns full JWT on success.
   */
  async loginWithTempToken(
    tempToken: string,
    otp: string,
    twoFactorService: {
      verifyLogin: (userId: string, token: string) => Promise<{ method: 'TOTP' | 'BACKUP_CODE' }>;
    },
    meta?: AuthMeta,
  ): Promise<{ accessToken: string; refreshToken: string; user: object }> {
    const payload = this.verifyTempToken(tempToken, '2fa_login');
    const userId = payload.sub;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { branch: true },
    });

    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้อง');
    }

    let twoFactorMethod: 'TOTP' | 'BACKUP_CODE';
    try {
      const result = await twoFactorService.verifyLogin(userId, otp);
      twoFactorMethod = result.method;
    } catch {
      await this.auditLogin(user.email, false, meta, userId, '2fa_invalid', true);
      throw new UnauthorizedException('รหัส OTP ไม่ถูกต้อง');
    }

    this.logger.log(`2FA login via ${twoFactorMethod} for user ${userId}`);
    await this.auditLogin(user.email, true, meta, userId, undefined, true);

    const jwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      // SP7.1 — dual-entity authorization
      accessibleCompanies: user.accessibleCompanies,
      primaryCompany: user.primaryCompany,
    };

    const accessToken = this.jwtService.sign(jwtPayload, {
      secret: this.configService.get<string>('JWT_SECRET')!,
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m') as JwtSignOptions['expiresIn'],
    });

    const refreshToken = await this.createRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchId: user.branchId,
        branchName: user.branch?.name || null,
      },
    };
  }

  async refreshToken(token: string) {
    const tokenHash = this.hashToken(token);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });

    // Token not found in DB — could be a legacy JWT token, try fallback
    if (!storedToken) {
      return this.refreshTokenJwt(token);
    }

    // Replay attack detection: token was already revoked
    if (storedToken.isRevoked) {
      this.logger.warn(
        `Replay attack detected for user ${storedToken.userId} — revoking all tokens`,
      );
      // Revoke ALL tokens for this user (token family invalidation)
      await this.revokeAllUserTokens(storedToken.userId);
      throw new UnauthorizedException('ตรวจพบการใช้งาน token ซ้ำ กรุณาเข้าสู่ระบบใหม่');
    }

    // Token expired
    if (storedToken.expiresAt < new Date()) {
      // Mark as revoked for audit trail
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true, revokedAt: new Date() },
      });
      throw new UnauthorizedException('โทเค็นหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: storedToken.userId },
    });

    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้อง');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      aud: 'admin',
      scope: 'admin:full',
      // SP7.1 — dual-entity authorization
      accessibleCompanies: user.accessibleCompanies,
      primaryCompany: user.primaryCompany,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET')!,
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m') as JwtSignOptions['expiresIn'],
    });

    // Rotation: revoke old + create new ATOMICALLY in a transaction
    // Prevents user lockout if crash occurs between revoke and create
    const newRawToken = crypto.randomBytes(64).toString('hex');
    const newTokenHash = this.hashToken(newRawToken);
    const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = new Date();
    const days = parseInt(expiresIn) || 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: { token: newTokenHash, userId: user.id, expiresAt },
      }),
    ]);

    return { accessToken, refreshToken: newRawToken };
  }

  async logout(refreshToken: string, userId: string) {
    // Revoke ALL refresh tokens for this user to ensure complete session termination
    await this.revokeAllUserTokens(userId);

    this.logger.log(`All refresh tokens revoked for user ${userId} on logout`);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        deletedAt: true,
        preferences: true,
        defaultCashAccountCode: true,
        // InternalControlActionBar — per-user reverse-permission override.
        // Null = use role-based default. Consumed by the shared bar to gate
        // the "↺ ยกเลิก/กลับรายการ" button.
        canReverseOverride: true,
        branch: { select: { id: true, name: true } },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('ไม่พบผู้ใช้งาน');
    }

    return user;
  }

  /**
   * Merge incoming preference patch into User.preferences (Json field).
   * Used by the frontend (Collections view toggle, etc.) to persist
   * per-user UI choices. Existing keys are preserved; only the keys
   * present in `prefs` are overwritten.
   */
  async updatePreferences(userId: string, prefs: Record<string, unknown>) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้');
    const current = (user.preferences as Record<string, unknown> | null) ?? {};
    const merged = { ...current, ...prefs };
    return this.prisma.user.update({
      where: { id: userId },
      data: { preferences: merged as Prisma.InputJsonValue },
      select: { id: true, preferences: true },
    });
  }

  /**
   * Request a password reset token.
   * Always returns success to prevent email enumeration.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    // Always return success to prevent email enumeration attacks
    const successMessage = 'หากอีเมลนี้มีอยู่ในระบบ คุณจะได้รับลิงก์รีเซ็ตรหัสผ่าน';

    // T7-C2: Per-email rate limit (max 3 / hour). Silently suppress email send
    // when exceeded — still return the generic success message so an attacker
    // can't distinguish "rate-limited" from "no such account" via response.
    if (this.isPasswordResetRateLimited(dto.email)) {
      this.logger.warn(
        `Password reset rate limit hit for email (hashed): ${this.hashToken(dto.email.toLowerCase()).slice(0, 12)}`,
      );
      return { message: successMessage };
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, name: true, email: true, isActive: true, deletedAt: true },
    });

    if (!user || user.deletedAt || !user.isActive) {
      return { message: successMessage };
    }

    // Invalidate any existing unused reset tokens for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Create a new reset token (valid for 15 minutes)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    // Store ONLY the hashed token in DB — raw token is sent via email
    await this.prisma.passwordResetToken.create({
      data: { token: tokenHash, userId: user.id, expiresAt },
    });

    // Send password reset email (falls back to console.log if SMTP not configured)
    await this.emailService.sendPasswordResetEmail(user.email, rawToken, user.name);

    this.logger.log(`Password reset token generated for user ${user.id}`);

    return { message: successMessage };
  }

  /**
   * Reset password using a valid token.
   * The incoming raw token is hashed before DB lookup (DB stores only hashes).
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
      include: { user: { select: { id: true, isActive: true } } },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุ');
    }

    if (!resetToken.user || !resetToken.user.isActive) {
      throw new BadRequestException('ผู้ใช้งานไม่ถูกต้อง');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      // Update password
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      }),
      // Mark token as used
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all refresh tokens for security
      this.prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
    ]);

    this.logger.log(`Password reset completed for user ${resetToken.userId}`);
    return { message: 'รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' };
  }

  /**
   * Revoke all active refresh tokens for a user.
   * Used for: logout, replay attack detection, password reset.
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date() },
    });
  }

  /**
   * Clean up expired and revoked tokens.
   * Called by the scheduled cron job.
   */
  async cleanupExpiredTokens(): Promise<number> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          // Expired tokens
          { expiresAt: { lt: new Date() } },
          // Revoked tokens older than 7 days (keep recent for audit trail)
          {
            isRevoked: true,
            updatedAt: { lt: sevenDaysAgo },
          },
        ],
      },
    });

    return result.count;
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const rawToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const expiresAt = new Date();
    const days = parseInt(expiresIn) || 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.refreshToken.create({
      data: {
        token: tokenHash,
        userId,
        expiresAt,
      },
    });

    // Return the RAW token to the client (only time it's available in plaintext)
    return rawToken;
  }

  /**
   * Fallback: JWT-based refresh token for backward compatibility.
   * This handles tokens issued before the DB-based system was deployed.
   */
  private async refreshTokenJwt(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || user.deletedAt || !user.isActive) {
        throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้อง');
      }

      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
        aud: 'admin',
        scope: 'admin:full',
        // SP7.1 — dual-entity authorization
        accessibleCompanies: user.accessibleCompanies,
        primaryCompany: user.primaryCompany,
      };

      const accessToken = this.jwtService.sign(newPayload, {
        secret: this.configService.get<string>('JWT_SECRET')!,
        expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m') as JwtSignOptions['expiresIn'],
      });

      // Migrate to DB-based token on next refresh
      const newRefreshToken = await this.createRefreshToken(user.id);

      return { accessToken, refreshToken: newRefreshToken };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('โทเค็นไม่ถูกต้องหรือหมดอายุ');
    }
  }
}
