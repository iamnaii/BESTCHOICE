import { SetMetadata } from '@nestjs/common';
import { LineChannelType } from '@prisma/client';

/**
 * LIFF channel metadata key.
 *
 * Tags a controller or handler with the LINE channel (SHOP/FINANCE/STAFF)
 * that the endpoint belongs to. The LiffTokenGuard reads this to enforce a
 * cross-company boundary — a lineUserId that is already linked to a customer
 * on a different channel must not be served here.
 */
export const LIFF_CHANNEL_KEY = 'liffChannel';

export const LiffChannel = (channel: LineChannelType) =>
  SetMetadata(LIFF_CHANNEL_KEY, channel);
