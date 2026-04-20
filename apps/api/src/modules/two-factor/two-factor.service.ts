import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from '@otplib/preset-default';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Allow 1 TOTP step before/after for clock drift
authenticator.options = { window: 1 };

export type TwoFactorMethod = 'TOTP' | 'BACKUP_CODE';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Encryption helpers ───────────────────────────────────────────────────

  private encrypt(text: string): string {
    const key = this.configService.get<string>('ENCRYPTION_KEY', '');
    if (!key || key.length < 16) return text; // dev fallback: no encryption
    const iv = crypto.randomBytes(16);
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(text: string): string {
    const key = this.configService.get<string>('ENCRYPTION_KEY', '');
    if (!key || key.length < 16 || !text.includes(':')) return text;
    const [ivHex, encrypted] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /** Hash a backup code for storage (SHA-256). */
  private hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code.toUpperCase()).digest('hex');
  }

  /** Generate 10 cryptographically random backup codes (plain text — show once). */
  private generateBackupCodes(): string[] {
    return Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString('hex').toUpperCase(),
    );
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Step 1: Generate TOTP secret + QR code for the user to scan.
   * Secret is stored temporarily; 2FA is NOT enabled until confirmEnrollment.
   */
  async startEnrollment(userId: string): Promise<{
    secret: string;
    otpAuthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true },
    });
    if (!user) throw new BadRequestException('ไม่พบผู้ใช้');
    if (user.twoFactorEnabled) throw new BadRequestException('เปิดใช้ 2FA อยู่แล้ว');

    const secret = authenticator.generateSecret();
    const otpAuthUrl = authenticator.keyuri(user.email, 'BESTCHOICE', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

    // Store encrypted secret temporarily (not enabled yet)
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.encrypt(secret) },
    });

    return { secret, otpAuthUrl, qrCodeDataUrl };
  }

  /**
   * Step 2: User verifies TOTP code → enable 2FA + generate 10 backup codes.
   * Returns plain-text backup codes — the only time they are shown.
   * Backup codes are stored as SHA-256 hashes.
   */
  async confirmEnrollment(userId: string, token: string): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('กรุณาสร้าง QR code ก่อน (เรียก /2fa/enroll)');
    }
    if (user.twoFactorEnabled) {
      throw new BadRequestException('เปิดใช้ 2FA อยู่แล้ว');
    }

    const secret = this.decrypt(user.twoFactorSecret);
    const isValid = authenticator.verify({ token, secret });
    if (!isValid) {
      throw new BadRequestException('รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่');
    }

    const backupCodes = this.generateBackupCodes();
    const hashedCodes = backupCodes.map((c) => this.hashBackupCode(c));

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorEnabledAt: new Date(),
        // Store hashes (not plain text) — mitigates DB breach exposure
        twoFactorBackupCodes: hashedCodes,
      },
    });

    this.logger.log(`2FA confirmed for user ${userId}`);
    return { backupCodes }; // plain text — shown only once
  }

  /**
   * Verify TOTP or backup code during login.
   * Backup codes are single-use: consumed on successful verification.
   * Returns the method used so callers can audit it.
   */
  async verifyLogin(
    userId: string,
    token: string,
  ): Promise<{ method: TwoFactorMethod }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, twoFactorBackupCodes: true },
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('ผู้ใช้ยังไม่ได้เปิดใช้ 2FA');
    }

    const secret = this.decrypt(user.twoFactorSecret);

    // Try TOTP first
    if (authenticator.verify({ token, secret })) {
      return { method: 'TOTP' };
    }

    // Try backup codes (8-char hex uppercase)
    const codes = user.twoFactorBackupCodes as string[] | null;
    if (codes && token.length === 8) {
      const codeHash = this.hashBackupCode(token);
      const idx = codes.indexOf(codeHash);
      if (idx !== -1) {
        // Mark as used: remove from list
        const updatedCodes = [...codes];
        updatedCodes.splice(idx, 1);
        await this.prisma.user.update({
          where: { id: userId },
          data: { twoFactorBackupCodes: updatedCodes },
        });
        this.logger.log(`Backup code used for user ${userId}`);
        return { method: 'BACKUP_CODE' };
      }
    }

    throw new UnauthorizedException('รหัส OTP หรือ backup code ไม่ถูกต้อง');
  }

  /**
   * Disable 2FA. Requires valid TOTP or backup code verification first.
   */
  async disable(userId: string, currentToken: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, twoFactorBackupCodes: true },
    });
    if (!user || !user.twoFactorEnabled) {
      throw new BadRequestException('ยังไม่ได้เปิดใช้ 2FA');
    }

    // Verify before disabling
    const secret = this.decrypt(user.twoFactorSecret!);
    const codes = user.twoFactorBackupCodes as string[] | null;
    const isTotpValid = authenticator.verify({ token: currentToken, secret });

    if (!isTotpValid) {
      // Try backup code
      if (codes && currentToken.length === 8) {
        const codeHash = this.hashBackupCode(currentToken);
        if (!codes.includes(codeHash)) {
          throw new UnauthorizedException('รหัส OTP หรือ backup code ไม่ถูกต้อง');
        }
      } else {
        throw new UnauthorizedException('รหัส OTP หรือ backup code ไม่ถูกต้อง');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: Prisma.JsonNull,
        twoFactorEnabledAt: null,
      },
    });

    this.logger.log(`2FA disabled for user ${userId}`);
    return { message: 'ปิด 2FA สำเร็จ' };
  }

  /**
   * Regenerate backup codes. Requires valid TOTP verification.
   * Old codes are invalidated immediately.
   */
  async regenerateBackupCodes(
    userId: string,
    currentToken: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('ยังไม่ได้เปิดใช้ 2FA');
    }

    const secret = this.decrypt(user.twoFactorSecret);
    const isValid = authenticator.verify({ token: currentToken, secret });
    if (!isValid) {
      throw new UnauthorizedException('รหัส OTP ไม่ถูกต้อง');
    }

    const backupCodes = this.generateBackupCodes();
    const hashedCodes = backupCodes.map((c) => this.hashBackupCode(c));

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorBackupCodes: hashedCodes },
    });

    this.logger.log(`Backup codes regenerated for user ${userId}`);
    return { backupCodes }; // plain text — shown only once
  }

  /** Check if user has 2FA enabled */
  async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return user?.twoFactorEnabled ?? false;
  }
}
