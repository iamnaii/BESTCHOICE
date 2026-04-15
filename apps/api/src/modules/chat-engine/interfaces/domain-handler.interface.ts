import { ChatChannel, ChatRoom } from '@prisma/client';
import { InboundMessage, OutboundMessage } from './channel-adapter.interface';

/**
 * Context passed to domain handlers — everything they need to decide
 * how to process a message (AI reply, tool call, handoff, etc.)
 */
export interface DomainContext {
  /** The chat room (includes customer, verification state, etc.) */
  room: ChatRoom;
  /** The inbound message being processed */
  message: InboundMessage;
  /** Whether the customer is verified (has linked their identity) */
  isVerified: boolean;
  /** Whether the room is in handoff mode (staff should reply) */
  isHandoff: boolean;
}

/**
 * Result from a domain handler's processing.
 * The engine will send any reply messages and apply state changes.
 */
export interface DomainResult {
  /** Messages to send back to the customer */
  replies: OutboundMessage[];
  /** Should the room enter handoff mode? */
  shouldHandoff?: boolean;
  /** Reason for handoff (shown to staff) */
  handoffReason?: string;
  /** Priority to set on the room */
  handoffPriority?: 'low' | 'normal' | 'high' | 'critical';
  /** Tags to add to the room */
  tags?: string[];
}

/**
 * IDomainHandler — business-domain-specific message processing.
 * Finance domain handles payment inquiries, slip verification, etc.
 * Shop domain handles product inquiries, pricing, etc.
 *
 * The MessageRouter selects the appropriate handler based on the channel.
 */
export interface IDomainHandler {
  /** Which channels this handler serves */
  readonly supportedChannels: ChatChannel[];

  /** Process an inbound message and produce replies */
  handleMessage(context: DomainContext): Promise<DomainResult>;

  /** Check if this handler supports the given channel */
  supportsChannel(channel: ChatChannel): boolean;
}

/**
 * Token used to register domain handlers at runtime.
 * ChatEngineModule collects all IDomainHandler providers via this token.
 */
export const DOMAIN_HANDLER_TOKEN = 'DOMAIN_HANDLER';
