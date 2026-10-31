/**
 * Why receiving is impossible, set ONLY with proof (Task 35): `CONFIG` = the Integration Hub
 * configuration cannot serve this Page · `META_PERMISSION` = Meta answered every readiness request
 * and the token/permission/feed subscription is not ready. Absent while `receive` is false = no
 * proof (Graph outage, rate limit, unknown) — callers must treat that as retryable.
 */
export type CommentReceiveNotReady = 'CONFIG' | 'META_PERMISSION';
export interface FacebookCommentEvidence {
  graphVersion: string;
  verified: boolean;
  receive?: boolean;
  publicReply?: boolean;
  privateReply?: boolean;
  reason?: string | null;
  checks?: { key: string; label: string; passed: boolean }[];
  notReady?: CommentReceiveNotReady;
}
export function capabilityFromEvidence(input: FacebookCommentEvidence) {
  return {
    graphVersion: input.graphVersion,
    receive: input.verified && input.receive === true,
    publicReply: input.verified && input.publicReply === true,
    privateReply: input.verified && input.privateReply === true,
    reason: input.reason ?? (input.verified ? null : 'ยังไม่ยืนยันสิทธิ์การเชื่อมต่อ'),
    ...(input.checks ? { checks: input.checks } : {}),
  };
}
