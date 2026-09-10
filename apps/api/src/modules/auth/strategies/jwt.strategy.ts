import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { resolveCompanyAccess } from '@installment/shared';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email?: string;
  role: string;
  branchId?: string | null;
  aud?: string;
  // SP7.1 — dual-entity authorization. Mirrors DB; JwtStrategy.validate refetches.
  accessibleCompanies?: string[];
  primaryCompany?: string | null;
}

interface CachedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  accessibleCompanies: string[]; // SP7.1
  primaryCompany: string | null; // SP7.1
  cachedAt: number;
}

const USER_CACHE_TTL_MS = 10_000; // 10 seconds cache — short TTL for faster role/active revocation

/**
 * จุดคานงัดของกฎ "array ว่าง = ยังไม่ตั้งค่า" ฝั่ง API
 *
 * `req.user.accessibleCompanies` ที่ออกจากที่นี่ **ไม่ใช่ค่าดิบจากคอลัมน์ `users.accessible_companies`**
 * แต่เป็นค่าที่ผ่าน `resolveCompanyAccess()` แล้วเสมอ — แถวที่ยังไม่ backfill (array ว่าง ซึ่งเป็น
 * ค่า default ของคอลัมน์และไม่เคยมีเส้นทางไหนเขียนให้) จะถูกแปลงเป็นค่า default ของ role
 * ไม่ใช่ถูกตีความว่า "ไม่มีสิทธิ์บริษัทใดเลย" การวางไว้ตรงนี้จุดเดียวครอบทุกผู้อ่านที่รับ actor
 * จาก `req.user` พร้อมกัน (EntityScopeGuard, EntityScopeInterceptor, prepare-offer, room-ai-access)
 *
 * ผลข้างเคียงที่ตั้งใจ: หลัง backfill เขียนค่าจริงลง DB แต่ละ instance จะเห็นค่าใหม่ภายใน
 * `USER_CACHE_TTL_MS` (10 วินาที) จึงไม่ต้องบังคับ logout ใคร
 */
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
      // JWT_SECRET guaranteed by validateEnv() at startup
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });

    // Clean expired cache entries every 60 seconds.
    // unref(): timer นี้ต้องไม่ยื้อ event loop — CLI ที่ import AuthModule ทางอ้อม
    // (test-pack drive mode ผ่าน ExpenseDocumentsModule → AuthModule) จะ process ไม่จบ
    // ถ้า interval ถูก ref ไว้ (พบจาก smoke test ของ TestPackModule, Task 12).
    // ฝั่ง HTTP server พฤติกรรมเดิมทุกประการ — listener ยื้อ process อยู่แล้ว.
    setInterval(() => this.cleanExpiredCache(), 60_000).unref();
  }

  async validate(payload: JwtPayload) {
    // Shop/customer tokens (aud='shop') carry sub=customerId — look up Customer
    // instead of User. JwtAudienceGuard enforces the aud claim at route level.
    if (payload.aud === 'shop') {
      const customer = await this.prisma.customer.findFirst({
        where: { id: payload.sub, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!customer) {
        throw new UnauthorizedException('ลูกค้าไม่ถูกต้องหรือถูกปิดการใช้งาน');
      }
      return {
        sub: customer.id,
        id: customer.id,
        name: customer.name,
        role: 'CUSTOMER',
        aud: 'shop',
      };
    }

    // Admin path — backed by User table. Check cache first to avoid DB query on every request.
    // ค่าใน cache คือค่าที่ผ่าน resolveCompanyAccess() มาแล้ว (เขียนลง cache ตอน cache miss
    // ข้างล่าง) จึงคืนออกไปตรง ๆ ได้ ไม่ต้อง resolve ซ้ำ
    const cached = this.userCache.get(payload.sub);
    if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL_MS) {
      if (!cached.isActive) {
        throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้องหรือถูกปิดการใช้งาน');
      }
      const { cachedAt, ...user } = cached;
      return { ...user, aud: payload.aud };
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
        accessibleCompanies: true, // SP7.1
        primaryCompany: true, // SP7.1
      },
    });

    if (!user || !user.isActive) {
      // Cache inactive status too, to avoid repeated DB hits
      if (user) {
        this.userCache.set(payload.sub, { ...user, cachedAt: Date.now() });
      }
      throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้องหรือถูกปิดการใช้งาน');
    }

    // สิทธิ์บริษัทถูก resolve ก่อนเข้า cache — แถวที่ยังไม่ backfill (array ว่าง) จึงกลายเป็น
    // ค่า default ของ role ตั้งแต่ตรงนี้ ผู้อ่านปลายทางไม่ต้องรู้กฎนี้เอง
    const access = resolveCompanyAccess(user.role, user.accessibleCompanies, user.primaryCompany);
    const resolved = {
      ...user,
      accessibleCompanies: [...access.accessible],
      primaryCompany: access.primary,
    };

    // Store in cache — always use DB values (role/branchId may have changed since JWT was issued)
    this.userCache.set(payload.sub, { ...resolved, cachedAt: Date.now() });

    // Return DB values + JWT aud so JwtAudienceGuard can enforce audience claim
    return { ...resolved, aud: payload.aud };
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
