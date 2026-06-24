import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FacebookAdapter } from './facebook.adapter';

export interface FbBackfillSummary {
  total: number;
  updatedName: number;
  updatedPicture: number;
  noProfile: number;
  failed: number;
  remaining: number;
  errors: string[];
}

/**
 * One-shot backfill of FB ChatRoom display name + avatar.
 *
 * getUserProfile only runs at room CREATION (via routeInbound), so rooms created
 * before a valid token / the first_name,last_name,profile_pic fix never got an
 * avatar. This re-runs getUserProfile for existing FB rooms using the stored
 * ChatRoom.externalUserId (= the webhook sender.id PSID — the id the User Profile
 * API actually accepts) and persists any name/picture it can resolve.
 *
 * Processes in capped batches; call repeatedly with onlyMissingPicture until
 * `remaining` is 0. Best-effort — never throws on a single room.
 */
@Injectable()
export class FacebookBackfillService {
  private readonly logger = new Logger(FacebookBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facebook: FacebookAdapter,
  ) {}

  async backfillProfiles(
    opts: { onlyMissingPicture?: boolean; limit?: number } = {},
  ): Promise<FbBackfillSummary> {
    const onlyMissingPicture = opts.onlyMissingPicture ?? true;
    const limit = Math.min(Math.max(opts.limit ?? 150, 1), 1000);

    const where: Prisma.ChatRoomWhereInput = {
      channel: ChatChannel.FACEBOOK,
      deletedAt: null,
      externalUserId: { not: null },
      ...(onlyMissingPicture ? { pictureUrl: null } : {}),
    };

    const rooms = await this.prisma.chatRoom.findMany({
      where,
      select: { id: true, externalUserId: true, displayName: true, pictureUrl: true },
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
    });

    const summary: FbBackfillSummary = {
      total: rooms.length,
      updatedName: 0,
      updatedPicture: 0,
      noProfile: 0,
      failed: 0,
      remaining: 0,
      errors: [],
    };

    for (const room of rooms) {
      try {
        const profile = await this.facebook.getUserProfile(room.externalUserId!);
        if (!profile) {
          summary.noProfile++;
        } else {
          const data: Prisma.ChatRoomUpdateInput = {};
          if (profile.displayName && profile.displayName !== room.displayName) {
            data.displayName = profile.displayName;
          }
          if (profile.avatarUrl && profile.avatarUrl !== room.pictureUrl) {
            data.pictureUrl = profile.avatarUrl;
          }
          if (data.displayName) summary.updatedName++;
          if (data.pictureUrl) summary.updatedPicture++;
          if (Object.keys(data).length > 0) {
            await this.prisma.chatRoom.update({ where: { id: room.id }, data });
          }
        }
      } catch (err) {
        summary.failed++;
        if (summary.errors.length < 5) {
          summary.errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      // Gentle pacing to stay well under FB rate limits.
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    summary.remaining = await this.prisma.chatRoom.count({ where });

    this.logger.log(`[FB backfill] ${JSON.stringify({ ...summary, errors: undefined })}`);
    return summary;
  }
}
