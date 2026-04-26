import { Body, Controller, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShopAuthSocialService } from './shop-auth-social.service';
import { LineLoginCallbackDto, FacebookLoginCallbackDto, BindPhoneDto } from './dto/social-login.dto';
import { ShopBotDefenseGuard } from '../shop-bot-defense/shop-bot-defense.guard';

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

  @Post('bind-phone')
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  async bindPhone(@Body() dto: BindPhoneDto) {
    return this.authService.bindPhoneToSocial(dto);
  }

  private async exchangeLineCode(code: string) {
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SHOP_BASE_URL + '/auth/line-callback',
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
