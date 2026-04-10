/**
 * Standardized intent constants for chatbot-finance module.
 * Used in ChatMessage.intent field for analytics and routing.
 */
export const INTENTS = {
  // Verification
  VERIFY_REQUIRED: 'verify_required',
  VERIFY_INCONSISTENT: 'verify_inconsistent',

  // AI responses
  AI_REPLY: 'ai_reply',
  AI_HANDOFF: 'ai_handoff',
  AI_MAX_ITERATIONS: 'ai_max_iterations',

  // Fallback
  FALLBACK: 'fallback',

  // Image / Slip
  SLIP_MATCHED: 'slip_matched',
  SLIP_REVIEW: 'slip_review',
  IMAGE_ERROR: 'image_error',

  // Events
  FOLLOW_GREETING: 'follow_greeting',
  UNSUPPORTED_TYPE: 'unsupported_type',
} as const;

export type Intent = (typeof INTENTS)[keyof typeof INTENTS];
