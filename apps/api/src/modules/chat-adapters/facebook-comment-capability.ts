export interface FacebookCommentEvidence {
  graphVersion: string;
  verified: boolean;
  receive?: boolean;
  publicReply?: boolean;
  privateReply?: boolean;
  reason?: string | null;
  checks?: { key: string; label: string; passed: boolean }[];
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
