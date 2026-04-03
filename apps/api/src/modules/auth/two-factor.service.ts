import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from '@otplib/preset-default';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

// Configure TOTP window (allow 1 step before/after for clock drift)
authenticator.options = { window: 1 };

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /** Encrypt secret before storing in DB */
  private encrypt(text: string): string {
    const key = this.configService.get<string>('ENCRYPTION_KEY', '');
    if (!key || key.length < 16) return text; // fallback: no encryption in dev
    const iv = crypto.randomBytes(16);
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /** Decrypt secret from DB */
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

  /**
   * Step 1: Generate TOTP secret + QR code for user to scan.
   * Secret is NOT saved yet — user must verify first.
   */
  async generateSecret(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true },
    });
    if (!user) throw new BadRequestException('ไม่พบผู้ใช้');
    if (user.twoFactorEnabled) throw new BadRequestException('เปิดใช้ 2FA อยู่แล้ว');

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'BESTCHOICE', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret temporarily (not enabled yet)
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: this.encrypt(secret) },
    });

    return { secret, qrCodeDataUrl };
  }

  /**
   * Step 2: User verifies TOTP code → enable 2FA + generate recovery codes.
   */
  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true },
    });
    if (!user || !user.twoFactorSecret) {
      throw new BadRequestException('กรุณาสร้าง QR code ก่อน');
    }
    if (user.twoFactorEnabled) {
      throw new BadRequestException('เปิดใช้ 2FA อยู่แล้ว');
    }

    const secret = this.decrypt(user.twoFactorSecret);
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      throw new BadRequestException('รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่');
    }

    // Generate 8 recovery codes
    const recoveryCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex'),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorBackup: this.encrypt(JSON.stringify(recoveryCodes)),
      },
    });

    this.logger.log(`2FA enabled for user ${userId}`);
    return { recoveryCodes };
  }

  /**
   * Disable 2FA (requires valid TOTP code or recovery code).
   */
  async disableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorSecret: true, twoFactorEnabled: true, twoFactorBackup: true },
    });
    if (!user || !user.twoFactorEnabled) {
      throw new BadRequestException('ยังไม่ได้เปิดใช้ 2FA');
    }

    const isValid = this.verifyCode(user.twoFactorSecret!, user.twoFactorBackup, code);
    if (!isValid) {
      throw new UnauthorizedException('รหัส OTP หรือ recovery code ไม่ถูกต้อง');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackup: null,
      },
    });

    this.logger.log(`2FA disabled for user ${userId}`);
    return { message: 'ปิด 2FA สำเร็จ' };
  }

  /**
   * Verify TOTP code or recovery code during login.
   */
  verifyCode(encryptedSecret: string, encryptedBackup: string | null, code: string): boolean {
    const secret = this.decrypt(encryptedSecret);

    // Try TOTP first
    if (authenticator.verify({ token: code, secret })) {
      return true;
    }

    // Try recovery codes (8-char hex)
    if (encryptedBackup && code.length === 8) {
      try {
        const codes: string[] = JSON.parse(this.decrypt(encryptedBackup));
        const idx = codes.indexOf(code);
        if (idx !== -1) {
          // Remove used recovery code
          codes.splice(idx, 1);
          // Note: caller should save the updated backup codes
          return true;
        }
      } catch {
        // Invalid backup format
      }
    }

    return false;
  }

  /**
   * Consume a recovery code (remove from list after use).
   */
  async consumeRecoveryCode(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorBackup: true },
    });
    if (!user?.twoFactorBackup) return;

    try {
      const codes: string[] = JSON.parse(this.decrypt(user.twoFactorBackup));
      const idx = codes.indexOf(code);
      if (idx !== -1) {
        codes.splice(idx, 1);
        await this.prisma.user.update({
          where: { id: userId },
          data: { twoFactorBackup: this.encrypt(JSON.stringify(codes)) },
        });
      }
    } catch {
      // Invalid format — skip
    }
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
