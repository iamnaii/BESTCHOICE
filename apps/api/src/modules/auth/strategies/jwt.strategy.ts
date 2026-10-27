import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessSnapshotService } from '../../employee-access/access-snapshot.service';
import { accessCompanies } from '../../employee-access/access-context';
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

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
    private accessSnapshots: AccessSnapshotService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // JWT_SECRET guaranteed by validateEnv() at startup
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
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

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        isActive: true,
        deletedAt: true,
        accessibleCompanies: true, // SP7.1
        primaryCompany: true, // SP7.1
      },
    });

    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedException('ผู้ใช้งานไม่ถูกต้องหรือถูกปิดการใช้งาน');
    const access = await this.accessSnapshots.forUser(user.id);
    return { ...user, ...accessCompanies(access, user.role, user.accessibleCompanies, user.primaryCompany), access, aud: payload.aud };
  }
}
