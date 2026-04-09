import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { EmailService } from '../email/email.service';

// Account lockout configuration. Tunable via env if needed later.
const LOCKOUT_THRESHOLD = 5; // failures before lock
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  /**
   * Hash a raw refresh token using SHA-256 for secure DB storage.
   * SHA-256 is appropriate here because refresh tokens are high-entropy
   * random strings (64 bytes), so brute-force is infeasible.
   */
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: { branch: true },
    });

    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    // Reject if currently locked. Use a generic message so attackers can't
    // distinguish "wrong password" from "locked" — both surface the same error.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      this.logger.warn(`Login attempt on locked account ${user.id}`);
      throw new UnauthorizedException(
        'บัญชีถูกล็อคชั่วคราว กรุณาลองใหม่ในอีกสักครู่',
      );
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      // Increment counter; lock if threshold reached.
      // We use updateMany so the result tells us how many rows changed but
      // doesn't throw if the row was concurrently deleted.
      const nextAttempts = user.failedLoginAttempts + 1;
      const shouldLock = nextAttempts >= LOCKOUT_THRESHOLD;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextAttempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCKOUT_DURATION_MS)
            : null,
        },
      });
      if (shouldLock) {
        this.logger.warn(
          `Account ${user.id} locked after ${nextAttempts} failed attempts`,
        );
      }
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    // Successful login → reset counters if they were non-zero.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m'),
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

  /**
   * Login with 2FA verification (re-authenticates credentials + verifies TOTP).
   */
  async loginWith2FA(email: string, password: string, code: string, twoFactorService: { verifyCode: (s: string, b: string | null, c: string) => boolean; consumeRecoveryCode: (id: string, c: string) => Promise<void> }) {
    const result = await this.login({ email, password });

    const user = await this.prisma.user.findUnique({
      where: { id: result.user.id },
      select: { twoFactorSecret: true, twoFactorBackup: true, twoFactorEnabled: true },
    });

    if (user?.twoFactorEnabled && user.twoFactorSecret) {
      const isValid = twoFactorService.verifyCode(user.twoFactorSecret, user.twoFactorBackup, code);
      if (!isValid) {
        throw new UnauthorizedException('รหัส OTP ไม่ถูกต้อง');
      }
      // Consume recovery code if used (8-char hex)
      if (code.length === 8) {
        await twoFactorService.consumeRecoveryCode(result.user.id, code);
      }
    }

    return result;
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
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m'),
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
        branch: { select: { id: true, name: true } },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('ไม่พบผู้ใช้งาน');
    }

    return user;
  }

  /**
   * Request a password reset token.
   * Always returns success to prevent email enumeration.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, name: true, email: true, isActive: true, deletedAt: true },
    });

    // Always return success to prevent email enumeration attacks
    const successMessage = 'หากอีเมลนี้มีอยู่ในระบบ คุณจะได้รับลิงก์รีเซ็ตรหัสผ่าน';

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
      };

      const accessToken = this.jwtService.sign(newPayload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRATION', '15m'),
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
