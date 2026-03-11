import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dbTokensAvailable: boolean | null = null;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email },
      include: { branch: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
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

    const refreshToken = await this.createRefreshToken(user.id, payload);

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
    // Try DB-based token lookup first
    if (await this.isDbTokensAvailable()) {
      const storedToken = await this.prisma.refreshToken.findUnique({
        where: { token },
      });

      if (storedToken) {
        if (storedToken.revokedAt || storedToken.expiresAt < new Date()) {
          throw new UnauthorizedException('Refresh token ไม่ถูกต้องหรือหมดอายุ');
        }

        const user = await this.prisma.user.findUnique({
          where: { id: storedToken.userId },
        });

        if (!user || !user.isActive) {
          throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้อง');
        }

        // Revoke old token (rotation)
        await this.prisma.refreshToken.update({
          where: { id: storedToken.id },
          data: { revokedAt: new Date() },
        });

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

        const newRefreshToken = await this.createRefreshToken(user.id, payload);

        return { accessToken, refreshToken: newRefreshToken };
      }
    }

    // Fallback: JWT-based refresh token (backward compatibility)
    return this.refreshTokenJwt(token);
  }

  async logout(refreshToken: string) {
    if (await this.isDbTokensAvailable()) {
      await this.prisma.refreshToken.updateMany({
        where: { token: refreshToken, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => { /* ignore if table doesn't exist */ });
    }
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
        branch: { select: { id: true, name: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('ไม่พบผู้ใช้งาน');
    }

    return user;
  }

  private async createRefreshToken(userId: string, payload: Record<string, unknown>): Promise<string> {
    // Try DB-based token first
    if (await this.isDbTokensAvailable()) {
      try {
        const token = crypto.randomBytes(64).toString('hex');
        const expiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
        const expiresAt = new Date();
        const days = parseInt(expiresIn) || 7;
        expiresAt.setDate(expiresAt.getDate() + days);

        await this.prisma.refreshToken.create({
          data: { token, userId, expiresAt },
        });

        // Clean up expired tokens periodically
        if (Math.random() < 0.01) {
          this.prisma.refreshToken.deleteMany({
            where: { expiresAt: { lt: new Date() } },
          }).catch(() => { /* ignore cleanup errors */ });
        }

        return token;
      } catch (err) {
        this.logger.warn('DB refresh token creation failed, falling back to JWT');
        this.dbTokensAvailable = false;
      }
    }

    // Fallback: JWT-based refresh token
    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d'),
    });
  }

  private async refreshTokenJwt(token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive) {
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

      const newRefreshToken = await this.createRefreshToken(user.id, newPayload);

      return { accessToken, refreshToken: newRefreshToken };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Refresh token ไม่ถูกต้องหรือหมดอายุ');
    }
  }

  private async isDbTokensAvailable(): Promise<boolean> {
    if (this.dbTokensAvailable !== null) return this.dbTokensAvailable;

    try {
      await this.prisma.refreshToken.findFirst({ take: 1 });
      this.dbTokensAvailable = true;
    } catch {
      this.logger.warn('RefreshToken table not available - using JWT fallback. Run prisma migrate deploy to enable DB tokens.');
      this.dbTokensAvailable = false;
    }

    return this.dbTokensAvailable;
  }
}
