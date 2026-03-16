import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  branchId: string | null;
}

interface CachedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  cachedAt: number;
}

const USER_CACHE_TTL_MS = 30_000; // 30 seconds cache

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly userCache = new Map<string, CachedUser>();

  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });

    // Clean expired cache entries every 60 seconds
    setInterval(() => this.cleanExpiredCache(), 60_000);
  }

  async validate(payload: JwtPayload) {
    // Check cache first to avoid DB query on every request
    const cached = this.userCache.get(payload.sub);
    if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL_MS) {
      if (!cached.isActive) {
        throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้องหรือถูกปิดการใช้งาน');
      }
      const { cachedAt, ...user } = cached;
      return user;
    }

    // Cache miss or expired — query database
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      // Cache inactive status too, to avoid repeated DB hits
      if (user) {
        this.userCache.set(payload.sub, { ...user, cachedAt: Date.now() });
      }
      throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้องหรือถูกปิดการใช้งาน');
    }

    // Store in cache
    this.userCache.set(payload.sub, { ...user, cachedAt: Date.now() });

    return user;
  }

  private cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.userCache) {
      if (now - value.cachedAt > USER_CACHE_TTL_MS) {
        this.userCache.delete(key);
      }
    }
  }
}
