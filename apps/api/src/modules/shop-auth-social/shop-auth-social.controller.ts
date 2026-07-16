import { Body, Controller, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { LineLoginCallbackDto, FacebookLoginCallbackDto } from './dto/social-login.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';
import { shopLineRedirectUri } from '../../utils/shop-base-url.util';

@Controller('shop/auth')
@UseGuards(ShopBotDefenseGuard)
export class ShopAuthSocialController {
  constructor(private authService: ShopAuthSocialService) {}

  @Post('line/callback')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  async lineCallback(@Body() dto: LineLoginCallbackDto) {
    // Exchange code for LINE profile
    const profile = await this.exchangeLineCode(dto.code);
    return this.authService.handleLineLogin(profile);
  }

  @Post('facebook/callback')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  async facebookCallback(@Body() dto: FacebookLoginCallbackDto) {
    const profile = await this.exchangeFacebookToken(dto.accessToken);
    return this.authService.handleFacebookLogin(profile);
  }

  // SECURITY: the bind-phone route is intentionally NOT exposed.
  // ShopAuthSocialService.bindPhoneToSocial assumes the phone was already
  // verified by OTP, but no OTP flow exists yet — a public route here would
  // let anyone mint a customer token from a phone number alone. Re-add the
  // route only together with a server-verified OTP step.

  private async exchangeLineCode(code: string) {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        // Must byte-match the authorize-time redirect_uri the frontend got
        // from /shop/public-config/auth — both come from the same util.
        redirect_uri: shopLineRedirectUri() ?? '',
        client_id: process.env.LINE_LOGIN_CHANNEL_ID || '',
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new HttpException('LINE token exchange failed', HttpStatus.UNAUTHORIZED);
    const tokens = (await tokenRes.json()) as { access_token: string; id_token?: string };

    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!profileRes.ok) throw new HttpException('LINE profile fetch failed', HttpStatus.UNAUTHORIZED);
    const profile = (await profileRes.json()) as {
      userId: string;
      displayName: string;
      pictureUrl?: string;
    };

    return {
      lineUserId: profile.userId,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
    };
  }

  private async exchangeFacebookToken(accessToken: string) {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new HttpException('Facebook token verify failed', HttpStatus.UNAUTHORIZED);
    const data = (await res.json()) as { id: string; name: string; email?: string };
    return { facebookUserId: data.id, name: data.name, email: data.email };
  }
}
