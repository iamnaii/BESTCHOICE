import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface SocialLoginResult {
  /** Display-safe profile for the customer's OWN session (frontend AuthCustomer). */
  customer: {
    id: string;
    name: string;
    phone: string | null;
    lineId: string | null;
    loyaltyBalance: number;
  } | null;
  token: string | null;
  requiresPhoneBinding: boolean;
}

export interface LineLoginInput {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  email?: string;
}

export interface FacebookLoginInput {
  facebookUserId: string;
  name: string;
  email?: string;
}

@Injectable()
export class ShopAuthSocialService {
  private readonly logger = new Logger(ShopAuthSocialService.name);

  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async handleLineLogin(input: LineLoginInput): Promise<SocialLoginResult> {
    const link = await this.prisma.customerLineLink.findFirst({
      where: { lineUserId: input.lineUserId },
    });
    if (!link) {
      return { customer: null, token: null, requiresPhoneBinding: true };
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: link.customerId, deletedAt: null },
    });
    if (!customer) {
      return { customer: null, token: null, requiresPhoneBinding: true };
    }
    const token = await this.signToken(customer.id);
    return {
      customer: this.toAuthProfile(customer, input.lineUserId),
      token,
      requiresPhoneBinding: false,
    };
  }

  async handleFacebookLogin(input: FacebookLoginInput): Promise<SocialLoginResult> {
    const customer = await this.prisma.customer.findFirst({
      where: { facebookUserId: input.facebookUserId, deletedAt: null },
    });
    if (!customer) {
      return { customer: null, token: null, requiresPhoneBinding: true };
    }
    const token = await this.signToken(customer.id);
    return { customer: this.toAuthProfile(customer, null), token, requiresPhoneBinding: false };
  }

  async bindPhoneToSocial(input: {
    phone: string;
    provider: 'LINE' | 'FACEBOOK';
    providerUserId: string;
  }): Promise<SocialLoginResult> {
    // Note: assumes phone OTP already verified by caller
    const customer = await this.prisma.customer.findFirst({
      where: { phone: input.phone, deletedAt: null },
    });
    if (!customer) {
      throw new UnauthorizedException('ไม่พบลูกค้าด้วยเบอร์นี้ — ติดต่อร้านเพื่อสมัครก่อน');
    }
    if (input.provider === 'FACEBOOK') {
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: { facebookUserId: input.providerUserId },
      });
    } else {
      // LINE: use existing CustomerLineLink table (don't create here — separate concern)
      this.logger.log(`LINE binding for customer ${customer.id} — call CustomerLineLink.create separately`);
    }
    const token = await this.signToken(customer.id);
    return {
      customer: this.toAuthProfile(customer, input.provider === 'LINE' ? input.providerUserId : null),
      token,
      requiresPhoneBinding: false,
    };
  }

  /** The customer's own display-safe profile — mirrors the frontend AuthCustomer shape. */
  private toAuthProfile(
    customer: { id: string; name: string; phone?: string | null; loyaltyBalance?: number | null },
    lineId: string | null,
  ): NonNullable<SocialLoginResult['customer']> {
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? null,
      lineId,
      loyaltyBalance: customer.loyaltyBalance ?? 0,
    };
  }

  private async signToken(customerId: string): Promise<string> {
    // audience: 'shop' is required — global JwtAudienceGuard blocks /api/shop/*
    // when the JWT aud claim is anything other than 'shop'.
    return this.jwt.signAsync(
      { sub: customerId, role: 'CUSTOMER' },
      { expiresIn: '7d', audience: 'shop' },
    );
  }
}
