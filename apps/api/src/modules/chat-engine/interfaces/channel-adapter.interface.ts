import { ChatChannel, MessageType } from '@prisma/client';

/**
 * Inbound message from any channel — normalized before reaching the engine.
 * Each adapter converts its platform-specific format into this shape.
 */
export interface InboundMessage {
  /** Platform-specific message ID (LINE messageId, FB mid, etc.) */
  externalMessageId: string;
  /** Platform-specific user ID (LINE userId, FB PSID, web visitorId) */
  externalUserId: string;
  /** Which channel this came from */
  channel: ChatChannel;
  /** Message content type */
  type: MessageType;
  /** Text content (null for media-only messages) */
  text?: string;
  /** URL to media (image, video, audio, file) */
  mediaUrl?: string;
  /** MIME type of media */
  mediaType?: string;
  /** Raw platform payload for adapter-specific handling */
  rawPayload?: Record<string, unknown>;
  /** Timestamp from the platform (if available) */
  timestamp?: Date;
  /** UTM / referral attribution data (e.g. from Facebook ad click) */
  attribution?: {
    utmSource?: string;
    utmCampaign?: string;
    utmContent?: string;
    referrerUrl?: string;
  };
}

/**
 * Outbound message to be sent through a channel adapter.
 * The engine produces this; adapters convert it to platform format.
 */
export interface OutboundMessage {
  /** Target user on the platform */
  externalUserId: string;
  /** Which channel to send through */
  channel: ChatChannel;
  /** Message type */
  type: MessageType;
  /** Text content */
  text?: string;
  /** Media URL */
  mediaUrl?: string;
  /** Platform-specific template payload (e.g. LINE Flex, FB template) */
  templatePayload?: Record<string, unknown>;
}

/** Result of sending a message through an adapter */
export interface SendResult {
  success: boolean;
  /** Platform's message ID for the sent message */
  externalMessageId?: string;
  error?: string;
}

/**
 * IChannelAdapter — each channel (LINE Finance, LINE Shop, Facebook, TikTok, Web)
 * implements this interface. The ChatEngine doesn't know channel details;
 * it only talks through this contract.
 */
export interface IChannelAdapter {
  /** Which channel this adapter handles */
  readonly channel: ChatChannel;

  /** Send a message to the customer */
  sendMessage(message: OutboundMessage): Promise<SendResult>;

  /** Send a typing indicator (best-effort, adapters may no-op) */
  sendTypingIndicator?(externalUserId: string): Promise<void>;

  /** Get user profile from the platform (display name, avatar, etc.) */
  getUserProfile?(externalUserId: string): Promise<UserProfile | null>;
}

/** Normalized user profile from any platform */
export interface UserProfile {
  displayName: string;
  avatarUrl?: string;
  language?: string;
  /** Platform-specific extra fields */
  metadata?: Record<string, unknown>;
}

/**
 * Token used to register adapters at runtime.
 * ChatEngineModule collects all IChannelAdapter providers via this token.
 */
export const CHANNEL_ADAPTER_TOKEN = 'CHANNEL_ADAPTER';
